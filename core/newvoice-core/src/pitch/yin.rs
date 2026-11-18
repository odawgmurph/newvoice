//! YIN pitch estimation (de Cheveigné & Kawahara 2002).

use super::{LagRange, PITCH_RATE, PitchEstimate, parabolic};

/// Estimates F0 for one frame of `lags.frame_len()` samples at [`PITCH_RATE`].
///
/// Picks the first lag whose cumulative mean normalised difference falls
/// below `threshold` (then descends to the local minimum); if none does, the
/// global minimum, with correspondingly low periodicity. Returns `None` for a
/// silent frame.
pub fn estimate(
    x: &[f64],
    lags: &LagRange,
    threshold: f64,
    scratch: &mut Vec<f64>,
) -> Option<PitchEstimate> {
    let LagRange { min, max, .. } = *lags;
    if !difference(x, lags, scratch) {
        return None; // silence (or DC)
    }
    let (diff, d) = scratch.split_at(max + 2);

    // The textbook rule: the first dip below the threshold (descending to
    // its bottom), else the deepest dip.
    let mut chosen = None;
    let mut tau = min;
    while tau <= max {
        if d[tau] < threshold {
            while tau < max && d[tau + 1] < d[tau] {
                tau += 1;
            }
            chosen = Some(tau);
            break;
        }
        tau += 1;
    }
    let mut tau = chosen.unwrap_or_else(|| {
        (min..=max)
            .min_by(|&a, &b| d[a].total_cmp(&d[b]))
            .expect("non-empty lag range")
    });

    // Octave-up guard: if a dip near a multiple of the period is much more
    // periodic, the first dip was a fraction of the period of a voice whose
    // H2 (or another single harmonic) dominates.
    let frame = &x[..lags.frame_len()];
    let chosen_nsdf = super::nsdf_peak(frame, tau);
    tau = super::period_multiple(tau, max, chosen_nsdf, |lo, hi| {
        (lo.max(min)..=hi)
            .filter(|&t| d[t] < d[t - 1] && d[t] <= d[t + 1])
            .min_by(|&a, &b| d[a].total_cmp(&d[b]))
            .map(|t| (t, super::nsdf_peak(frame, t)))
    });

    // Refine the period on the raw difference function, which (unlike the
    // normalised one) has no lag-dependent weighting to bias the vertex.
    let (delta, _) = parabolic(diff[tau - 1], diff[tau], diff[tau + 1]);
    let (_, value) = parabolic(d[tau - 1], d[tau], d[tau + 1]);
    Some(PitchEstimate {
        f0_hz: PITCH_RATE / (tau as f64 + delta),
        periodicity: (1.0 - value).clamp(0.0, 1.0),
    })
}

/// Fills `scratch` with YIN's difference function followed by its cumulative
/// mean normalised form, each `lags.max + 2` long (lags 0 to one past the
/// range, for interpolation). Returns false for a silent (or DC) frame.
pub(crate) fn difference(x: &[f64], lags: &LagRange, scratch: &mut Vec<f64>) -> bool {
    let LagRange { max, window, .. } = *lags;
    assert!(x.len() >= lags.frame_len(), "frame too short");
    let top = max + 1; // one lag past the range, for interpolation
    scratch.clear();
    scratch.resize(2 * (top + 1), 0.0);
    let (diff, d) = scratch.split_at_mut(top + 1);

    // Difference function d(τ) = Σ_{j<W} (x_{s+j} − x_{s+j+τ})², with the
    // compared span [s, s + W + τ) centred in the frame for every lag. (The
    // textbook s = 0 puts short lags early in the frame, which skews the
    // estimate in time and biases it on glides.)
    for (tau, dt) in diff.iter_mut().enumerate().skip(1) {
        let s = (top - tau) / 2;
        *dt = x[s..s + window]
            .iter()
            .zip(&x[s + tau..s + tau + window])
            .map(|(a, b)| (a - b) * (a - b))
            .sum();
    }
    if diff[1..].iter().all(|&v| v == 0.0) {
        return false;
    }

    // Cumulative mean normalised difference.
    d[0] = 1.0;
    let mut running = 0.0;
    for tau in 1..=top {
        running += diff[tau];
        d[tau] = if running > 0.0 {
            diff[tau] * tau as f64 / running
        } else {
            1.0
        };
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    fn run(x: &[f64]) -> Option<PitchEstimate> {
        let lags = LagRange::new(60.0, 500.0);
        estimate(&x[..lags.frame_len()], &lags, 0.15, &mut Vec::new())
    }

    #[test]
    fn sines_and_sawtooths_within_a_fifth_of_a_percent() {
        for f0 in [62.0, 80.0, 110.0, 147.0, 196.0, 262.0, 349.0, 440.0, 490.0] {
            for x in [sine(f0, PITCH_RATE, 2000), sawtooth(f0, PITCH_RATE, 2000)] {
                let e = run(&x).unwrap();
                let err = (e.f0_hz / f0 - 1.0).abs();
                assert!(err < 2e-3, "f0={f0} got {} err={err}", e.f0_hz);
                assert!(
                    e.periodicity > 0.95,
                    "f0={f0} periodicity {}",
                    e.periodicity
                );
            }
        }
    }

    #[test]
    fn weak_fundamental_does_not_cause_an_octave_error() {
        // H2 eight times stronger than H1 (as when H2 sits on F1).
        let f0 = 231.0;
        let x: Vec<f64> = (0..2000)
            .map(|i| {
                let t = i as f64 / PITCH_RATE;
                let w = 2.0 * std::f64::consts::PI * f0 * t;
                0.05 * w.sin() + 0.4 * (2.0 * w).sin() + 0.03 * (3.0 * w).sin()
            })
            .collect();
        let e = run(&x).unwrap();
        assert!((e.f0_hz / f0 - 1.0).abs() < 2e-3, "got {}", e.f0_hz);
    }

    #[test]
    fn a_dominant_fourth_harmonic_does_not_quadruple_f0() {
        // H4 on F1, as in a man's /ɝ/: 12 dB above H3, more above H1.
        let f0 = 117.0;
        let amps = [0.05, 0.1, 0.3, 1.2, 0.1, 0.07];
        let x: Vec<f64> = (0..2000)
            .map(|i| {
                let w = 2.0 * std::f64::consts::PI * f0 * i as f64 / PITCH_RATE;
                amps.iter()
                    .enumerate()
                    .map(|(k, a)| a * ((k + 1) as f64 * w).sin())
                    .sum()
            })
            .collect();
        let e = run(&x).unwrap();
        assert!((e.f0_hz / f0 - 1.0).abs() < 2e-3, "got {}", e.f0_hz);
    }

    #[test]
    fn silence_is_none_and_noise_is_aperiodic() {
        assert!(run(&vec![0.0; 2000]).is_none());
        let e = run(&noise(0.3, 2000, 7)).unwrap();
        assert!(e.periodicity < 0.5, "noise periodicity {}", e.periodicity);
    }

    #[test]
    fn tolerates_moderate_noise() {
        let mut x = sawtooth(180.0, PITCH_RATE, 2000);
        for (v, n) in x.iter_mut().zip(noise(0.05, 2000, 3)) {
            *v += n;
        }
        let e = run(&x).unwrap();
        assert!((e.f0_hz / 180.0 - 1.0).abs() < 5e-3, "got {}", e.f0_hz);
    }
}
