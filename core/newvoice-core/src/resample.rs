//! Band-limited resampling by windowed-sinc interpolation.
//!
//! The analysis reads every frame through a [`Resampler`]: pitch at a fixed
//! internal rate and formants at twice the formant ceiling (as Praat does).
//! Because the resampler evaluates the band-limited signal at arbitrary times
//! straight from the input samples, batch and streaming analysis read exactly
//! the same values for a given frame.

use std::f64::consts::PI;

/// Zero crossings of the sinc kernel on each side, at the lower of the two rates.
const ZERO_CROSSINGS: usize = 32;
/// Kernel table entries per zero crossing (linear interpolation between them).
const TABLE_OVERSAMPLE: usize = 512;
/// Kaiser window shape (about 80 dB stopband).
const KAISER_BETA: f64 = 8.0;
/// Cutoff as a fraction of the lower Nyquist frequency. Close to 1 because
/// Praat's resampling (which the formant analysis mirrors) keeps the band up
/// to the new Nyquist; the little aliasing this allows lands within a few
/// percent of Nyquist, above the formant safety margin.
const ROLLOFF: f64 = 0.985;

/// Converts a signal from `in_rate` to `out_rate`, one window at a time.
#[derive(Debug, Clone)]
pub struct Resampler {
    in_rate: f64,
    out_rate: f64,
    /// Cutoff in cycles per input sample.
    cutoff: f64,
    /// Kernel half-width in input samples.
    half_width: f64,
    /// Kernel indexed by distance in zero-crossing units, `TABLE_OVERSAMPLE` per unit.
    table: Vec<f64>,
    /// True when no filtering is needed (equal rates, output on the input grid).
    identity: bool,
}

impl Resampler {
    pub fn new(in_rate: f64, out_rate: f64) -> Self {
        assert!(
            in_rate > 0.0 && out_rate > 0.0,
            "sample rates must be positive"
        );
        let cutoff = 0.5 * (out_rate / in_rate).min(1.0) * ROLLOFF;
        let half_width = ZERO_CROSSINGS as f64 / (2.0 * cutoff);
        let n = ZERO_CROSSINGS * TABLE_OVERSAMPLE + 2;
        let i0_beta = bessel_i0(KAISER_BETA);
        let table = (0..n)
            .map(|i| {
                let u = i as f64 / TABLE_OVERSAMPLE as f64; // zero-crossing units
                let r = u / ZERO_CROSSINGS as f64;
                if r >= 1.0 {
                    return 0.0;
                }
                let window = bessel_i0(KAISER_BETA * (1.0 - r * r).sqrt()) / i0_beta;
                2.0 * cutoff * sinc(u) * window
            })
            .collect();
        Self {
            in_rate,
            out_rate,
            cutoff,
            half_width,
            table,
            identity: (in_rate - out_rate).abs() < 1e-9,
        }
    }

    pub fn in_rate(&self) -> f64 {
        self.in_rate
    }

    pub fn out_rate(&self) -> f64 {
        self.out_rate
    }

    /// Input samples the kernel reaches on each side of an output time.
    pub fn half_width_samples(&self) -> usize {
        self.half_width.ceil() as usize + 1
    }

    /// Fills `out` with the signal at times `t0 + j / out_rate` (seconds).
    ///
    /// `src(i)` returns input sample `i` (time `i / in_rate`) and must return
    /// 0 outside the signal.
    pub fn render(&self, src: impl Fn(i64) -> f32, t0: f64, out: &mut [f64]) {
        let start = t0 * self.in_rate;
        if self.identity && (start - start.round()).abs() < 1e-6 {
            let first = start.round() as i64;
            for (j, o) in out.iter_mut().enumerate() {
                *o = f64::from(src(first + j as i64));
            }
            return;
        }
        let step = self.in_rate / self.out_rate;
        let units_per_sample = 2.0 * self.cutoff * TABLE_OVERSAMPLE as f64;
        let hw = self.half_width;
        for (j, o) in out.iter_mut().enumerate() {
            let pos = start + j as f64 * step;
            let lo = (pos - hw).ceil() as i64;
            let hi = (pos + hw).floor() as i64;
            let mut acc = 0.0;
            for i in lo..=hi {
                let x = src(i);
                if x == 0.0 {
                    continue;
                }
                let k = (pos - i as f64).abs() * units_per_sample;
                let idx = k as usize;
                let frac = k - idx as f64;
                if idx + 1 >= self.table.len() {
                    continue;
                }
                let w = self.table[idx] + frac * (self.table[idx + 1] - self.table[idx]);
                acc += f64::from(x) * w;
            }
            *o = acc;
        }
    }
}

fn sinc(u: f64) -> f64 {
    if u.abs() < 1e-12 {
        1.0
    } else {
        (PI * u).sin() / (PI * u)
    }
}

/// Modified Bessel function of the first kind, order 0 (power series).
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let half = x / 2.0;
    for k in 1..64 {
        term *= half / k as f64;
        let t2 = term * term;
        sum += t2;
        if t2 < sum * 1e-17 {
            break;
        }
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f64, rate: f64, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * PI * freq * i as f64 / rate).sin() as f32)
            .collect()
    }

    fn render_slice(r: &Resampler, x: &[f32], t0: f64, n: usize) -> Vec<f64> {
        let mut out = vec![0.0; n];
        r.render(
            |i| {
                usize::try_from(i)
                    .ok()
                    .and_then(|i| x.get(i))
                    .copied()
                    .unwrap_or(0.0)
            },
            t0,
            &mut out,
        );
        out
    }

    #[test]
    fn downsampled_sine_matches_analytic_value() {
        let x = sine(440.0, 48_000.0, 48_000);
        let r = Resampler::new(48_000.0, 11_000.0);
        let out = render_slice(&r, &x, 0.3, 500);
        for (j, v) in out.iter().enumerate() {
            let t = 0.3 + j as f64 / 11_000.0;
            assert!((v - (2.0 * PI * 440.0 * t).sin()).abs() < 2e-3, "j={j}");
        }
    }

    #[test]
    fn upsampled_sine_matches_analytic_value() {
        let x = sine(1000.0, 16_000.0, 16_000);
        let r = Resampler::new(16_000.0, 44_100.0);
        let out = render_slice(&r, &x, 0.25, 800);
        for (j, v) in out.iter().enumerate() {
            let t = 0.25 + j as f64 / 44_100.0;
            assert!((v - (2.0 * PI * 1000.0 * t).sin()).abs() < 2e-3, "j={j}");
        }
    }

    #[test]
    fn content_above_new_nyquist_is_removed() {
        // 7 kHz is above the 5.5 kHz Nyquist of an 11 kHz output.
        let x = sine(7000.0, 48_000.0, 48_000);
        let r = Resampler::new(48_000.0, 11_000.0);
        let out = render_slice(&r, &x, 0.3, 1000);
        let peak = out.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        assert!(peak < 1e-3, "alias peak {peak}");
    }

    #[test]
    fn equal_rates_on_grid_copy_exactly() {
        let x = sine(300.0, 16_000.0, 1000);
        let r = Resampler::new(16_000.0, 16_000.0);
        let out = render_slice(&r, &x, 100.0 / 16_000.0, 50);
        for (j, v) in out.iter().enumerate() {
            assert_eq!(*v, f64::from(x[100 + j]));
        }
    }
}
