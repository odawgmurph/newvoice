//! Synthetic test signals (unit tests only).

use std::f64::consts::PI;

pub fn sine(f0: f64, rate: f64, n: usize) -> Vec<f64> {
    (0..n)
        .map(|i| 0.5 * (2.0 * PI * f0 * i as f64 / rate).sin())
        .collect()
}

/// Band-limited sawtooth (all harmonics below Nyquist, 1/k amplitudes).
pub fn sawtooth(f0: f64, rate: f64, n: usize) -> Vec<f64> {
    harmonic_source(&vec![f0; n], rate)
        .into_iter()
        .map(|v| v * 0.3)
        .collect()
}

/// Deterministic white noise in [−amp, amp].
pub fn noise(amp: f64, n: usize, mut seed: u64) -> Vec<f64> {
    (0..n)
        .map(|_| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((seed >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) * amp
        })
        .collect()
}

/// Sum of harmonics with 1/k amplitudes following a per-sample F0 contour,
/// keeping every harmonic below 0.45 × rate.
pub fn harmonic_source(f0: &[f64], rate: f64) -> Vec<f64> {
    let f_max = f0.iter().copied().fold(1.0, f64::max);
    let harmonics = ((0.45 * rate) / f_max).floor() as usize;
    let mut phase = 0.0f64;
    f0.iter()
        .map(|&f| {
            phase = (phase + 2.0 * PI * f / rate) % (2.0 * PI);
            // sin(kθ) by the Chebyshev recurrence.
            let two_cos = 2.0 * phase.cos();
            let (mut s_prev, mut s) = (0.0, phase.sin());
            let mut acc = 0.0;
            for k in 1..=harmonics {
                acc += s / k as f64;
                let next = two_cos * s - s_prev;
                s_prev = s;
                s = next;
            }
            acc
        })
        .collect()
}

/// Klatt cascade resonators applied in place.
pub fn resonate(x: &mut [f64], formants: &[(f64, f64)], rate: f64) {
    for &(f, bw) in formants {
        let t = 1.0 / rate;
        let c = -(-2.0 * PI * bw * t).exp();
        let b = 2.0 * (-PI * bw * t).exp() * (2.0 * PI * f * t).cos();
        let a = 1.0 - b - c;
        let (mut y1, mut y2) = (0.0, 0.0);
        for v in x.iter_mut() {
            let y = a * *v + b * y1 + c * y2;
            y2 = y1;
            y1 = y;
            *v = y;
        }
    }
}

/// A synthetic vowel: harmonic source at `f0` with optional vibrato
/// (`vibrato_st` semitones peak at 5 Hz), through cascade resonators at the
/// given (frequency, bandwidth) pairs. Peak-normalised to 0.5.
pub fn vowel(f0: f64, formants: &[(f64, f64)], rate: f64, n: usize, vibrato_st: f64) -> Vec<f64> {
    let contour: Vec<f64> = (0..n)
        .map(|i| {
            let t = i as f64 / rate;
            f0 * 2f64.powf(vibrato_st * (2.0 * PI * 5.0 * t).sin() / 12.0)
        })
        .collect();
    let mut x = harmonic_source(&contour, rate);
    resonate(&mut x, formants, rate);
    let peak = x.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    x.iter().map(|v| 0.5 * v / peak).collect()
}

pub fn to_f32(x: &[f64]) -> Vec<f32> {
    x.iter().map(|&v| v as f32).collect()
}
