//! pYIN (Mauch & Dixon 2014): probabilistic YIN with HMM smoothing, for
//! scoring finished utterances.
//!
//! Plain YIN commits to one threshold and one lag per frame. pYIN instead
//! spreads a prior over many thresholds (a beta distribution, mean 0.1), so
//! each frame yields several F0 candidates with probabilities and an overall
//! voicing probability. A hidden Markov model over (pitch bin × voiced /
//! unvoiced) then picks the most likely path through the whole utterance
//! with Viterbi decoding. Pitch moves smoothly and voicing rarely flips, so
//! isolated octave errors and spurious voicing are decoded away. It needs
//! the whole utterance (look-ahead), which is why live feedback uses YIN or
//! MPM (handbook §3.2, §4.5).
//!
//! Settings default to librosa's `pyin`, a widely used reference
//! implementation: 100 thresholds, beta(2, 18), 0.1-semitone bins, at most
//! 35.92 octaves/s of pitch movement, a 1% voicing switch probability and 1%
//! of a threshold's mass to the global minimum when no dip falls below it.
//! Two deliberate differences: each candidate passes through the same
//! octave-up guard as YIN and MPM, and a voiced frame reports its candidate's
//! interpolated F0 rather than the bin centre.

use super::{LagRange, PITCH_RATE, nsdf_peak, parabolic, period_multiple, yin};
use crate::units::{hz_to_st, st_to_hz};

/// Settings for pYIN.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PyinConfig {
    /// Number of thresholds the prior is spread over, evenly from 1/n to 1.
    pub n_thresholds: usize,
    /// Beta prior on the threshold (integer shape parameters).
    pub beta_a: u32,
    pub beta_b: u32,
    /// Share of a threshold's mass given to the global minimum when no dip
    /// is below the threshold.
    pub no_trough_prob: f64,
    /// Pitch bins per semitone in the HMM.
    pub bins_per_semitone: usize,
    /// Fastest pitch movement the HMM allows, in semitones per second.
    pub max_transition_st_per_s: f64,
    /// Probability of switching between voiced and unvoiced per frame.
    pub switch_prob: f64,
}

impl Default for PyinConfig {
    fn default() -> Self {
        Self {
            n_thresholds: 100,
            beta_a: 2,
            beta_b: 18,
            no_trough_prob: 0.01,
            bins_per_semitone: 10,
            max_transition_st_per_s: 35.92 * 12.0,
            switch_prob: 0.01,
        }
    }
}

/// One F0 candidate in a frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Candidate {
    pub f0_hz: f64,
    pub prob: f64,
    /// 1 − YIN aperiodicity at this lag.
    pub periodicity: f64,
}

/// A frame's candidates. Empty for silent frames.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Observation {
    pub candidates: Vec<Candidate>,
}

impl Observation {
    /// Probability that the frame is voiced: the candidates' total.
    pub fn voiced_prob(&self) -> f64 {
        self.candidates
            .iter()
            .map(|c| c.prob)
            .sum::<f64>()
            .clamp(0.0, 1.0)
    }

    /// The most probable candidate.
    pub fn best(&self) -> Option<&Candidate> {
        self.candidates
            .iter()
            .max_by(|a, b| a.prob.total_cmp(&b.prob))
    }
}

/// Regularised incomplete beta function I_x(a, b) for integer a, b ≥ 1: the
/// probability that a binomial(a + b − 1, x) variable is at least a.
fn beta_cdf(x: f64, a: u32, b: u32) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let n = a + b - 1;
    let mut total = 0.0;
    let mut binom = 1.0; // C(n, j), built up from j = 0
    for j in 0..=n {
        if j >= a {
            total += binom * x.powi(j as i32) * (1.0 - x).powi((n - j) as i32);
        }
        binom *= f64::from(n - j) / f64::from(j + 1);
    }
    total.clamp(0.0, 1.0)
}

/// Per-frame candidate extraction.
#[derive(Debug, Clone)]
pub struct Observer {
    lags: LagRange,
    no_trough_prob: f64,
    /// (threshold, prior mass), increasing threshold.
    thresholds: Vec<(f64, f64)>,
    scratch: Vec<f64>,
}

impl Observer {
    pub fn new(lags: LagRange, cfg: &PyinConfig) -> Self {
        let n = cfg.n_thresholds.max(1);
        let thresholds = (1..=n)
            .map(|i| {
                let (lo, hi) = ((i - 1) as f64 / n as f64, i as f64 / n as f64);
                let mass =
                    beta_cdf(hi, cfg.beta_a, cfg.beta_b) - beta_cdf(lo, cfg.beta_a, cfg.beta_b);
                (hi, mass)
            })
            .collect();
        Self {
            lags,
            no_trough_prob: cfg.no_trough_prob,
            thresholds,
            scratch: Vec::new(),
        }
    }

    /// The candidates for one frame of `lags.frame_len()` samples at
    /// [`PITCH_RATE`].
    pub fn observe(&mut self, x: &[f64]) -> Observation {
        let LagRange { min, max, .. } = self.lags;
        if !yin::difference(x, &self.lags, &mut self.scratch) {
            return Observation::default();
        }
        let (diff, d) = self.scratch.split_at(max + 2);
        let frame = &x[..self.lags.frame_len()];

        // Troughs of the normalised difference, in lag order. The first lag
        // counts when the function rises from it, as in YIN's rule.
        let troughs: Vec<usize> = (min..=max)
            .filter(|&t| (t == min || d[t] < d[t - 1]) && d[t] <= d[t + 1])
            .collect();
        let Some(&global) = troughs.iter().min_by(|&&a, &&b| d[a].total_cmp(&d[b])) else {
            return Observation::default();
        };

        // YIN's rule picks, for threshold s, the first trough below s. So
        // trough j takes the thresholds in (d_j, min of earlier troughs].
        let mut prob = vec![0.0; troughs.len()];
        let mut earlier_min = f64::INFINITY;
        for (j, &t) in troughs.iter().enumerate() {
            for &(s, mass) in &self.thresholds {
                if d[t] < s && s <= earlier_min {
                    prob[j] += mass;
                }
            }
            earlier_min = earlier_min.min(d[t]);
        }
        // Thresholds below every trough: a little mass to the global minimum.
        let global_j = troughs.iter().position(|&t| t == global).expect("in list");
        prob[global_j] += self.no_trough_prob
            * self
                .thresholds
                .iter()
                .filter(|&&(s, _)| s <= d[global])
                .map(|&(_, mass)| mass)
                .sum::<f64>();

        let mut candidates: Vec<(usize, f64)> = Vec::new();
        for (j, &t) in troughs.iter().enumerate() {
            if prob[j] <= 0.0 {
                continue;
            }
            // The octave-up guard, as in YIN: a much more periodic trough
            // near a multiple of this lag means this one is a fraction of
            // the period.
            let tau = period_multiple(t, max, nsdf_peak(frame, t), |lo, hi| {
                (lo.max(min)..=hi)
                    .filter(|&u| d[u] < d[u - 1] && d[u] <= d[u + 1])
                    .min_by(|&a, &b| d[a].total_cmp(&d[b]))
                    .map(|u| (u, nsdf_peak(frame, u)))
            });
            match candidates.iter_mut().find(|(u, _)| *u == tau) {
                Some((_, p)) => *p += prob[j],
                None => candidates.push((tau, prob[j])),
            }
        }

        Observation {
            candidates: candidates
                .into_iter()
                .map(|(tau, p)| {
                    let (delta, _) = parabolic(diff[tau - 1], diff[tau], diff[tau + 1]);
                    let (_, value) = parabolic(d[tau - 1], d[tau], d[tau + 1]);
                    Candidate {
                        f0_hz: PITCH_RATE / (tau as f64 + delta),
                        prob: p,
                        periodicity: (1.0 - value).clamp(0.0, 1.0),
                    }
                })
                .collect(),
        }
    }
}

/// A frame of the decoded track.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Decoded {
    /// `None` where the path is unvoiced.
    pub f0_hz: Option<f64>,
    /// The frame's voicing probability (before decoding).
    pub voiced_prob: f64,
}

/// Viterbi decoding of a whole utterance's observations.
pub fn decode(
    obs: &[Observation],
    f0_min_hz: f64,
    f0_max_hz: f64,
    hop_s: f64,
    cfg: &PyinConfig,
) -> Vec<Decoded> {
    let per_st = cfg.bins_per_semitone.max(1) as f64;
    let st_min = hz_to_st(f0_min_hz);
    let n_bins = ((hz_to_st(f0_max_hz) - st_min) * per_st).round() as usize + 1;
    let bin_of =
        |f0: f64| (((hz_to_st(f0) - st_min) * per_st).round().max(0.0) as usize).min(n_bins - 1);
    let bin_hz = |b: usize| st_to_hz(st_min + b as f64 / per_st);

    // Triangular pitch transitions within ±w bins, each source row
    // normalised to sum to 1 (rows near the ends have fewer targets).
    let w = (cfg.max_transition_st_per_s * hop_s * per_st)
        .round()
        .max(1.0) as usize;
    let tri = |k: usize| (w + 1 - k) as f64;
    let row_log_norm: Vec<f64> = (0..n_bins)
        .map(|i| {
            let lo = i.saturating_sub(w);
            let hi = (i + w).min(n_bins - 1);
            (lo..=hi).map(|j| tri(i.abs_diff(j))).sum::<f64>().ln()
        })
        .collect();
    let log_tri: Vec<f64> = (0..=w).map(|k| tri(k).ln()).collect();
    let (stay, switch) = ((1.0 - cfg.switch_prob).ln(), cfg.switch_prob.ln());
    let tiny = f64::MIN_POSITIVE.ln();
    let ln = |p: f64| if p > 0.0 { p.ln() } else { tiny };

    // Emission log-probabilities for frame t: voiced bins, then unvoiced.
    let emissions = |o: &Observation, out: &mut Vec<f64>| {
        out.clear();
        out.resize(2 * n_bins, 0.0);
        let mut voiced = vec![0.0; n_bins];
        for c in &o.candidates {
            if (f0_min_hz..=f0_max_hz).contains(&c.f0_hz) {
                voiced[bin_of(c.f0_hz)] += c.prob;
            }
        }
        let unvoiced = ln((1.0 - o.voiced_prob()) / n_bins as f64);
        for b in 0..n_bins {
            out[b] = ln(voiced[b]);
            out[n_bins + b] = unvoiced;
        }
    };

    let n = obs.len();
    if n == 0 {
        return Vec::new();
    }
    let mut em = Vec::new();
    emissions(&obs[0], &mut em);
    // Start unvoiced, uniform over pitch.
    let mut delta: Vec<f64> = (0..2 * n_bins)
        .map(|s| {
            if s < n_bins {
                tiny
            } else {
                -(n_bins as f64).ln() + em[s]
            }
        })
        .collect();
    let mut back: Vec<u16> = Vec::with_capacity(n * 2 * n_bins);
    debug_assert!(2 * n_bins <= usize::from(u16::MAX));
    let mut next = vec![0.0; 2 * n_bins];
    // Best predecessor within each voicing layer, per target bin.
    let mut best = [vec![(0.0, 0usize); n_bins], vec![(0.0, 0usize); n_bins]];
    for o in &obs[1..] {
        emissions(o, &mut em);
        for (layer, out) in best.iter_mut().enumerate() {
            let base = layer * n_bins;
            for (j, slot) in out.iter_mut().enumerate() {
                let lo = j.saturating_sub(w);
                let hi = (j + w).min(n_bins - 1);
                let mut top = (f64::NEG_INFINITY, lo);
                for i in lo..=hi {
                    let v = delta[base + i] + log_tri[i.abs_diff(j)] - row_log_norm[i];
                    if v > top.0 {
                        top = (v, i);
                    }
                }
                *slot = (top.0, base + top.1);
            }
        }
        for target in 0..2 {
            let (same, other) = (&best[target], &best[1 - target]);
            for (j, (s_best, o_best)) in same.iter().zip(other).enumerate() {
                let (from_same, from_other) = (s_best.0 + stay, o_best.0 + switch);
                let (v, src) = if from_same >= from_other {
                    (from_same, s_best.1)
                } else {
                    (from_other, o_best.1)
                };
                let s = target * n_bins + j;
                next[s] = v + em[s];
                back.push(src as u16);
            }
        }
        std::mem::swap(&mut delta, &mut next);
    }

    // Backtrack.
    let mut state = (0..2 * n_bins)
        .max_by(|&a, &b| delta[a].total_cmp(&delta[b]))
        .expect("states");
    let mut path = vec![0usize; n];
    path[n - 1] = state;
    for t in (1..n).rev() {
        state = usize::from(back[(t - 1) * 2 * n_bins + state]);
        path[t - 1] = state;
    }

    path.iter()
        .zip(obs)
        .map(|(&s, o)| {
            let voiced_prob = o.voiced_prob();
            if s >= n_bins {
                return Decoded {
                    f0_hz: None,
                    voiced_prob,
                };
            }
            // The candidate nearest the path's bin gives the precise F0;
            // the bin centre only if no candidate is within half a semitone.
            let target = bin_hz(s);
            let f0 = o
                .candidates
                .iter()
                .map(|c| (c.f0_hz, (hz_to_st(c.f0_hz) - hz_to_st(target)).abs()))
                .filter(|&(_, dist)| dist <= 0.5)
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map_or(target, |(f, _)| f);
            Decoded {
                f0_hz: Some(f0),
                voiced_prob,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    fn lags() -> LagRange {
        LagRange::new(60.0, 500.0)
    }

    #[test]
    fn beta_cdf_matches_closed_form() {
        // Beta(2, 18): I_x = 1 − (1 − x)^19 − 19 x (1 − x)^18.
        for x in [0.0f64, 0.05, 0.1, 0.2, 0.5, 1.0] {
            let want = 1.0 - (1.0 - x).powi(19) - 19.0 * x * (1.0 - x).powi(18);
            assert!((beta_cdf(x, 2, 18) - want).abs() < 1e-12, "x={x}");
        }
        assert!((beta_cdf(0.5, 1, 1) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn prior_mass_sums_to_one() {
        let o = Observer::new(lags(), &PyinConfig::default());
        let total: f64 = o.thresholds.iter().map(|t| t.1).sum();
        assert!((total - 1.0).abs() < 1e-9);
    }

    #[test]
    fn periodic_frame_is_confidently_voiced_at_its_f0() {
        let mut o = Observer::new(lags(), &PyinConfig::default());
        for f0 in [80.0, 150.0, 220.0, 440.0] {
            let x = sawtooth(f0, PITCH_RATE, 2000);
            let ob = o.observe(&x[..lags().frame_len()]);
            assert!(ob.voiced_prob() > 0.95, "f0={f0} {ob:?}");
            let best = ob.best().unwrap();
            assert!((best.f0_hz / f0 - 1.0).abs() < 2e-3, "f0={f0} {best:?}");
        }
    }

    #[test]
    fn noise_and_silence_are_unlikely_voiced() {
        let mut o = Observer::new(lags(), &PyinConfig::default());
        assert!(o.observe(&vec![0.0; 2000]).candidates.is_empty());
        let ob = o.observe(&noise(0.3, 2000, 11));
        assert!(ob.voiced_prob() < 0.2, "{}", ob.voiced_prob());
    }

    #[test]
    fn decoding_bridges_an_octave_blip_and_finds_voicing_edges() {
        let cfg = PyinConfig::default();
        let mut o = Observer::new(lags(), &cfg);
        let n = lags().frame_len();
        let tone = sawtooth(200.0, PITCH_RATE, n);
        let mut obs: Vec<Observation> = Vec::new();
        for k in 0..60 {
            obs.push(if (10..50).contains(&k) {
                o.observe(&tone)
            } else {
                o.observe(&noise(0.3, n, k as u64))
            });
        }
        // Make two frames prefer the octave above.
        for k in [25, 26] {
            obs[k] = Observation {
                candidates: vec![
                    Candidate {
                        f0_hz: 400.0,
                        prob: 0.6,
                        periodicity: 0.9,
                    },
                    Candidate {
                        f0_hz: 200.0,
                        prob: 0.35,
                        periodicity: 0.9,
                    },
                ],
            };
        }
        let out = decode(&obs, 60.0, 500.0, 0.01, &cfg);
        for (k, d) in out.iter().enumerate() {
            if (12..48).contains(&k) {
                let f = d.f0_hz.unwrap_or_else(|| panic!("frame {k} unvoiced"));
                assert!((f / 200.0 - 1.0).abs() < 2e-3, "frame {k}: {f}");
            }
            if !(8..52).contains(&k) {
                assert!(d.f0_hz.is_none(), "frame {k} voiced");
            }
        }
    }
}
