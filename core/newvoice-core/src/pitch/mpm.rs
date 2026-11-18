//! McLeod Pitch Method (McLeod & Wyvill 2005).

use super::{LagRange, PITCH_RATE, PitchEstimate, parabolic};

/// Estimates F0 for one frame of `lags.frame_len()` samples at [`PITCH_RATE`].
///
/// Computes the normalised square difference function over the whole frame,
/// takes the highest peak of each positive lobe ("key maxima"), and picks the
/// first key maximum within `k` of the highest. Returns `None` for a silent
/// frame or one with no periodic structure in range.
pub fn estimate(
    x: &[f64],
    lags: &LagRange,
    k: f64,
    scratch: &mut Vec<f64>,
) -> Option<PitchEstimate> {
    let n = lags.frame_len();
    assert!(x.len() >= n, "frame too short");
    let x = &x[..n];
    let top = lags.max + 1;
    scratch.clear();
    scratch.resize(top + 1, 0.0);
    let nsdf = scratch;

    let energy: f64 = x.iter().map(|v| v * v).sum();
    if energy == 0.0 {
        return None;
    }
    let mut m = 2.0 * energy;
    for (tau, value) in nsdf.iter_mut().enumerate() {
        if tau > 0 {
            m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
        }
        let r: f64 = x[..n - tau].iter().zip(&x[tau..]).map(|(a, b)| a * b).sum();
        *value = if m > 1e-300 { 2.0 * r / m } else { 0.0 };
    }

    // Key maxima: the highest point of each positive lobe after the first
    // negative-going zero crossing.
    let mut peaks: Vec<usize> = Vec::new();
    let mut tau = 1;
    while tau <= top && nsdf[tau] > 0.0 {
        tau += 1;
    }
    while tau <= top {
        while tau <= top && nsdf[tau] <= 0.0 {
            tau += 1;
        }
        let mut best: Option<usize> = None;
        while tau <= top && nsdf[tau] > 0.0 {
            if best.is_none_or(|b| nsdf[tau] > nsdf[b]) {
                best = Some(tau);
            }
            tau += 1;
        }
        if let Some(b) = best
            && b >= lags.min
            && b <= lags.max
        {
            peaks.push(b);
        }
    }
    let highest = peaks.iter().map(|&p| nsdf[p]).fold(f64::MIN, f64::max);
    let mut chosen = *peaks.iter().find(|&&p| nsdf[p] >= k * highest)?;

    // Octave-up guard (see `super::period_multiple`).
    let value_at = |p: usize| parabolic(nsdf[p - 1], nsdf[p], nsdf[p + 1]).1;
    chosen = super::period_multiple(chosen, lags.max, value_at(chosen), |lo, hi| {
        peaks
            .iter()
            .copied()
            .filter(|&p| p >= lo && p <= hi)
            .max_by(|&a, &b| nsdf[a].total_cmp(&nsdf[b]))
            .map(|p| (p, value_at(p)))
    });

    let (delta, value) = parabolic(nsdf[chosen - 1], nsdf[chosen], nsdf[chosen + 1]);
    Some(PitchEstimate {
        f0_hz: PITCH_RATE / (chosen as f64 + delta),
        periodicity: value.clamp(0.0, 1.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    fn run(x: &[f64]) -> Option<PitchEstimate> {
        let lags = LagRange::new(60.0, 500.0);
        estimate(x, &lags, 0.9, &mut Vec::new())
    }

    #[test]
    fn sines_and_sawtooths_within_a_fifth_of_a_percent() {
        for f0 in [62.0, 80.0, 110.0, 147.0, 196.0, 262.0, 349.0, 440.0, 490.0] {
            for x in [sine(f0, PITCH_RATE, 2000), sawtooth(f0, PITCH_RATE, 2000)] {
                let e = run(&x).unwrap();
                let err = (e.f0_hz / f0 - 1.0).abs();
                assert!(err < 2e-3, "f0={f0} got {} err={err}", e.f0_hz);
                assert!(e.periodicity > 0.9, "f0={f0} clarity {}", e.periodicity);
            }
        }
    }

    #[test]
    fn weak_fundamental_does_not_cause_an_octave_error() {
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
    fn silence_is_none_and_noise_has_low_clarity() {
        assert!(run(&vec![0.0; 2000]).is_none());
        if let Some(e) = run(&noise(0.3, 2000, 11)) {
            assert!(e.periodicity < 0.5, "noise clarity {}", e.periodicity);
        }
    }
}
