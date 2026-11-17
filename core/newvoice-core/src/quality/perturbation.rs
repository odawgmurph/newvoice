//! Cycle-to-cycle perturbation: local jitter and local shimmer.
//!
//! Glottal pulses are tracked through each voiced stretch, guided by the F0
//! track: starting from the strongest peak, each next pulse is placed at the
//! sub-sample shift that best aligns one cycle with the next (normalised
//! cross-correlation). Jitter and shimmer then follow Praat's definitions
//! and validity rules, so they compare with Praat's "local" measures:
//!
//! - periods count only between 0.1 and 20 ms, with neighbouring periods
//!   within a factor of 1.3;
//! - a pulse's amplitude is the Hann-windowed RMS from 0.2 periods before it
//!   to 0.2 periods after it (Praat's `To AmplitudeTier (period)`);
//! - neighbouring amplitudes must be within a factor of 1.6.
//!
//! Rising jitter and shimmer within a session feed the strain monitor
//! (Stage 3).

use std::f64::consts::PI;

use crate::analysis::Frame;
use crate::pitch::parabolic;

/// Praat's defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct PerturbationConfig {
    pub period_floor_s: f64,
    pub period_ceiling_s: f64,
    pub max_period_factor: f64,
    pub max_amplitude_factor: f64,
}

impl Default for PerturbationConfig {
    fn default() -> Self {
        Self {
            period_floor_s: 0.0001,
            period_ceiling_s: 0.02,
            max_period_factor: 1.3,
            max_amplitude_factor: 1.6,
        }
    }
}

/// Glottal pulse times (seconds), one list per voiced stretch.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Pulses {
    pub runs: Vec<Vec<f64>>,
}

/// Jitter and shimmer of a recording.
#[derive(Debug, Clone, PartialEq)]
pub struct Perturbation {
    /// Periods that passed the validity rules.
    pub periods: usize,
    /// Mean absolute difference of consecutive periods over the mean period
    /// (a fraction: 0.01 = 1%).
    pub jitter_local: Option<f64>,
    /// Mean absolute difference of consecutive pulse amplitudes over the
    /// mean amplitude (a fraction).
    pub shimmer_local: Option<f64>,
}

/// Unvoiced gaps up to this many frames inside phonation are bridged: very
/// irregular voicing (exactly what jitter measures) can dip below the
/// voicing threshold for a frame or two.
const MAX_GAP_FRAMES: usize = 3;

/// Tracks glottal pulses through the voiced stretches of `frames` (from
/// [`crate::analyse`] on the same samples).
pub fn track_pulses(samples: &[f32], sample_rate: f64, frames: &[Frame]) -> Pulses {
    let x: Vec<f64> = samples.iter().map(|&v| f64::from(v)).collect();
    let voiced: Vec<usize> = (0..frames.len())
        .filter(|&i| frames[i].f0_hz.is_some())
        .collect();
    let mut runs = Vec::new();
    let mut k = 0;
    while k < voiced.len() {
        let start = k;
        while k + 1 < voiced.len() && voiced[k + 1] - voiced[k] <= MAX_GAP_FRAMES + 1 {
            k += 1;
        }
        let (first, last) = (voiced[start], voiced[k]);
        k += 1;
        if last - first < 2 {
            continue;
        }
        let guide = F0Guide::new(&frames[first..=last]);
        let marks = track_run(&x, sample_rate, &guide);
        if marks.len() >= 3 {
            runs.push(marks.iter().map(|m| m / sample_rate).collect());
        }
    }
    Pulses { runs }
}

/// The F0 track of one stretch of phonation, with gaps interpolated.
struct F0Guide {
    t0: f64,
    hop: f64,
    f0: Vec<f64>,
}

impl F0Guide {
    fn new(frames: &[Frame]) -> Self {
        let known: Vec<(usize, f64)> = frames
            .iter()
            .enumerate()
            .filter_map(|(i, f)| f.f0_hz.map(|v| (i, v)))
            .collect();
        let f0 = (0..frames.len())
            .map(|i| {
                let after = known.partition_point(|&(j, _)| j < i);
                match (after.checked_sub(1).map(|a| known[a]), known.get(after)) {
                    (_, Some(&(j, v))) if j == i => v,
                    (Some((a, va)), Some(&(b, vb))) => {
                        va + (vb - va) * (i - a) as f64 / (b - a) as f64
                    }
                    (Some((_, v)), None) | (None, Some(&(_, v))) => v,
                    (None, None) => 100.0,
                }
            })
            .collect();
        Self {
            t0: frames[0].time_s,
            hop: frames.get(1).map_or(0.01, |f| f.time_s - frames[0].time_s),
            f0,
        }
    }

    fn start_s(&self) -> f64 {
        self.t0
    }

    fn end_s(&self) -> f64 {
        self.t0 + (self.f0.len() - 1) as f64 * self.hop
    }

    /// Period in samples at time `t`.
    fn period_at(&self, t: f64, rate: f64) -> f64 {
        let pos = ((t - self.t0) / self.hop).clamp(0.0, (self.f0.len() - 1) as f64);
        let k = pos.floor() as usize;
        let next = (k + 1).min(self.f0.len() - 1);
        let frac = pos - k as f64;
        rate / (self.f0[k] * (1.0 - frac) + self.f0[next] * frac)
    }
}

/// Pulse positions (in samples) through one stretch of phonation.
fn track_run(x: &[f64], rate: f64, guide: &F0Guide) -> Vec<f64> {
    let first = ((guide.start_s() * rate).ceil() as usize).min(x.len());
    let last = ((guide.end_s() * rate).floor() as usize).min(x.len().saturating_sub(1));
    if last <= first {
        return Vec::new();
    }
    // Follow whichever polarity has the larger excursion.
    let (lo, hi) = x[first..=last]
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)));
    let sign = if hi >= -lo { 1.0 } else { -1.0 };

    // Anchor: the strongest peak in the first 1.5 periods.
    let p0 = guide.period_at(guide.start_s(), rate);
    let anchor_end = (first + (1.5 * p0) as usize).min(last);
    let mut mark = (first..=anchor_end)
        .max_by(|&a, &b| (sign * x[a]).total_cmp(&(sign * x[b])))
        .expect("non-empty") as f64;

    let mut marks = vec![mark];
    loop {
        let period = guide.period_at(mark / rate, rate);
        let half = (0.5 * period).round() as isize;
        let reference = mark.round() as isize;
        let lo_c = (mark + 0.8 * period).floor() as isize - 1;
        let hi_c = (mark + 1.25 * period).ceil() as isize + 1;
        if hi_c + half >= last as isize || reference - half < first as isize {
            break;
        }
        // Normalised cross-correlation of the cycle around `reference` with
        // the window around each candidate pulse position.
        let ncc = |c: isize| -> f64 {
            let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
            for j in -half..=half {
                let a = x[(reference + j) as usize];
                let b = x[(c + j) as usize];
                ab += a * b;
                aa += a * a;
                bb += b * b;
            }
            if aa > 0.0 && bb > 0.0 {
                ab / (aa * bb).sqrt()
            } else {
                0.0
            }
        };
        let scores: Vec<f64> = (lo_c..=hi_c).map(ncc).collect();
        let best = (1..scores.len() - 1)
            .max_by(|&a, &b| scores[a].total_cmp(&scores[b]))
            .expect("non-empty");
        if scores[best] < 0.5 {
            break; // lost the cycle
        }
        let (delta, _) = parabolic(scores[best - 1], scores[best], scores[best + 1]);
        mark += (lo_c + best as isize) as f64 + delta - reference as f64;
        marks.push(mark);
    }
    marks
}

/// Hann-windowed RMS from `left` seconds before `t` to `right` after it.
fn hann_rms(x: &[f32], rate: f64, t: f64, left: f64, right: f64) -> Option<f64> {
    let lo = ((t - left) * rate).ceil().max(0.0) as usize;
    let hi = (((t + right) * rate).floor() as usize).min(x.len().checked_sub(1)?);
    let (mut sum, mut weights) = (0.0, 0.0);
    for (i, &v) in x.iter().enumerate().take(hi + 1).skip(lo) {
        let ti = i as f64 / rate;
        let phase = if ti < t {
            (ti - (t - left)) / left
        } else {
            1.0 + (ti - t) / right
        };
        let w = 0.5 - 0.5 * (PI * phase).cos();
        sum += w * f64::from(v) * f64::from(v);
        weights += w;
    }
    (weights > 0.0).then(|| (sum / weights).sqrt())
}

/// Local jitter and shimmer from tracked pulses, with Praat's rules.
pub fn perturbation(
    samples: &[f32],
    sample_rate: f64,
    pulses: &Pulses,
    cfg: &PerturbationConfig,
) -> Perturbation {
    let ok = |p: f64| p >= cfg.period_floor_s && p <= cfg.period_ceiling_s;
    let factor = |a: f64, b: f64| a.max(b) / a.min(b);
    let (mut period_sum, mut periods) = (0.0, 0usize);
    let (mut jitter_sum, mut jitter_pairs) = (0.0, 0usize);
    let (mut amp_sum, mut amp_count) = (0.0, 0usize);
    let (mut shimmer_sum, mut shimmer_pairs) = (0.0, 0usize);
    for run in &pulses.runs {
        let p: Vec<f64> = run.windows(2).map(|w| w[1] - w[0]).collect();
        for (i, &pi) in p.iter().enumerate() {
            if !ok(pi) {
                continue;
            }
            period_sum += pi;
            periods += 1;
            if i > 0 && ok(p[i - 1]) && factor(pi, p[i - 1]) <= cfg.max_period_factor {
                jitter_sum += (pi - p[i - 1]).abs();
                jitter_pairs += 1;
            }
        }
        // Amplitudes at pulses with acceptable periods on both sides.
        let mut amps: Vec<(f64, f64)> = Vec::new(); // (time, amplitude)
        for i in 1..run.len() - 1 {
            let (p1, p2) = (p[i - 1], p[i]);
            if ok(p1)
                && ok(p2)
                && factor(p1, p2) <= cfg.max_period_factor
                && let Some(a) = hann_rms(samples, sample_rate, run[i], 0.2 * p1, 0.2 * p2)
                && a > 0.0
            {
                amps.push((run[i], a));
            }
        }
        for (k, &(t, a)) in amps.iter().enumerate() {
            amp_sum += a;
            amp_count += 1;
            if let Some(&(t0, a0)) = k.checked_sub(1).map(|j| &amps[j])
                && ok(t - t0)
                && factor(a, a0) <= cfg.max_amplitude_factor
            {
                shimmer_sum += (a - a0).abs();
                shimmer_pairs += 1;
            }
        }
    }
    let ratio = |sum: f64, pairs: usize, total: f64, count: usize| {
        (pairs > 0 && count > 0 && total > 0.0)
            .then(|| (sum / pairs as f64) / (total / count as f64))
    };
    Perturbation {
        periods,
        jitter_local: ratio(jitter_sum, jitter_pairs, period_sum, periods),
        shimmer_local: ratio(shimmer_sum, shimmer_pairs, amp_sum, amp_count),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::analysis::{Config, analyse};
    use crate::testsig::*;

    /// A source whose cycle k lasts `periods[k]` seconds and whose envelope
    /// is `amps[k]` at the start of cycle k (where the pulse is), varying
    /// linearly to `amps[k + 1]`.
    pub fn perturbed_source(periods: &[f64], amps: &[f64], rate: f64) -> Vec<f64> {
        let mut contour = Vec::new();
        let mut envelope = Vec::new();
        let mut t = 0.0;
        for (k, &p) in periods.iter().enumerate() {
            let end = t + p;
            let next = amps[(k + 1).min(amps.len() - 1)];
            while (contour.len() as f64) / rate < end {
                let u = (contour.len() as f64 / rate - t) / p;
                contour.push(1.0 / p);
                envelope.push(amps[k] + (next - amps[k]) * u);
            }
            t = end;
        }
        harmonic_source(&contour, rate)
            .iter()
            .zip(&envelope)
            .map(|(s, e)| 0.15 * s * e)
            .collect()
    }

    /// Deterministic per-cycle perturbation of a nominal period.
    pub fn perturbed_periods(f0: f64, n: usize, jitter: f64, seed: u64) -> Vec<f64> {
        noise(1.0, n, seed)
            .iter()
            .map(|e| (1.0 + jitter * e) / f0)
            .collect()
    }

    pub fn local(values: &[f64]) -> f64 {
        let diffs: f64 = values.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
        (diffs / (values.len() - 1) as f64) / (values.iter().sum::<f64>() / values.len() as f64)
    }

    fn measure(x: &[f64], rate: f64) -> Perturbation {
        let x = to_f32(x);
        let cfg = Config {
            formants: None,
            ..Config::default()
        };
        let a = analyse(&x, rate, &cfg);
        let pulses = track_pulses(&x, rate, &a.frames);
        perturbation(&x, rate, &pulses, &PerturbationConfig::default())
    }

    #[test]
    fn steady_source_has_almost_no_jitter_or_shimmer() {
        let rate = 44_100.0;
        let periods = vec![1.0 / 180.0; 180];
        let p = measure(&perturbed_source(&periods, &vec![1.0; 180], rate), rate);
        assert!(p.periods > 150, "{p:?}");
        assert!(p.jitter_local.unwrap() < 0.001, "{p:?}");
        assert!(p.shimmer_local.unwrap() < 0.005, "{p:?}");
    }

    #[test]
    fn recovers_known_jitter_and_shimmer() {
        let rate = 44_100.0;
        for (f0, j, s) in [(120.0, 0.01, 0.03), (210.0, 0.005, 0.08)] {
            let n = f0 as usize;
            let periods = perturbed_periods(f0, n, j * 1.5, 7);
            let amps: Vec<f64> = noise(1.0, n, 11)
                .iter()
                .map(|e| 1.0 + s * 1.5 * e)
                .collect();
            let p = measure(&perturbed_source(&periods, &amps, rate), rate);
            let (tj, ts) = (local(&periods), local(&amps));
            let mj = p.jitter_local.unwrap();
            let ms = p.shimmer_local.unwrap();
            assert!(
                (mj - tj).abs() < 0.15 * tj + 0.0005,
                "f0 {f0}: jitter {mj} vs {tj}"
            );
            assert!(
                (ms - ts).abs() < 0.25 * ts + 0.002,
                "f0 {f0}: shimmer {ms} vs {ts}"
            );
        }
    }
}
