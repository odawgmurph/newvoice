//! Band-limited resampling by windowed-sinc interpolation.
//!
//! The analysis reads every frame through a [`Resampler`]: pitch at a fixed
//! internal rate and formants at twice the formant ceiling (as Praat does).
//! Because the resampler evaluates the band-limited signal at arbitrary times
//! straight from the input samples, batch and streaming analysis read exactly
//! the same values for a given frame.

use std::collections::VecDeque;
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
        for (j, o) in out.iter_mut().enumerate() {
            *o = self.value_at(&src, start + j as f64 * step);
        }
    }

    /// Fills `out` with output-grid samples `start, start + 1, …`, where grid
    /// sample `j` is the signal at time `j / out_rate`. Each value depends
    /// only on `j` and the input, never on how the range was split up.
    pub fn render_grid(&self, src: impl Fn(i64) -> f32, start: i64, out: &mut [f64]) {
        let step = self.in_rate / self.out_rate;
        for (o, j) in out.iter_mut().zip(start..) {
            *o = if self.identity {
                f64::from(src(j))
            } else {
                self.value_at(&src, j as f64 * step)
            };
        }
    }

    /// The band-limited input signal at input-sample position `pos`.
    fn value_at(&self, src: &impl Fn(i64) -> f32, pos: f64) -> f64 {
        let units_per_sample = 2.0 * self.cutoff * TABLE_OVERSAMPLE as f64;
        let lo = (pos - self.half_width).ceil() as i64;
        let hi = (pos + self.half_width).floor() as i64;
        let last = self.table.len() - 1;
        let mut acc = 0.0;
        for i in lo..=hi {
            let k = (pos - i as f64).abs() * units_per_sample;
            let idx = k as usize;
            if idx >= last {
                continue;
            }
            let frac = k - idx as f64;
            let w = self.table[idx] + frac * (self.table[idx + 1] - self.table[idx]);
            acc += f64::from(src(i)) * w;
        }
        acc
    }
}

/// A resampled signal on the output grid (sample `j` at `j / out_rate`),
/// computed on demand and cached, so overlapping analysis windows share work.
#[derive(Debug, Clone)]
pub struct GridResampler {
    rs: Resampler,
    /// Grid index of `cache[0]`.
    first: i64,
    cache: VecDeque<f64>,
    scratch: Vec<f64>,
}

impl GridResampler {
    pub fn new(in_rate: f64, out_rate: f64) -> Self {
        Self {
            rs: Resampler::new(in_rate, out_rate),
            first: 0,
            cache: VecDeque::new(),
            scratch: Vec::new(),
        }
    }

    pub fn resampler(&self) -> &Resampler {
        &self.rs
    }

    /// Copies grid samples `start .. start + out.len()` into `out`.
    ///
    /// Samples not cached yet are computed from `src`; the caller must only
    /// ask for samples whose input is final (see
    /// [`Resampler::half_width_samples`]).
    pub fn read(&mut self, src: impl Fn(i64) -> f32, start: i64, out: &mut [f64]) {
        let cached_end = self.first + self.cache.len() as i64;
        if self.cache.is_empty() || start < self.first || start > cached_end {
            self.cache.clear();
            self.first = start;
        }
        let cached_end = self.first + self.cache.len() as i64;
        let end = start + out.len() as i64;
        if end > cached_end {
            self.scratch.clear();
            self.scratch.resize((end - cached_end) as usize, 0.0);
            self.rs.render_grid(&src, cached_end, &mut self.scratch);
            self.cache.extend(&self.scratch);
        }
        let offset = (start - self.first) as usize;
        for (o, v) in out.iter_mut().zip(self.cache.range(offset..)) {
            *o = *v;
        }
    }

    /// Drops cached samples before grid index `index`.
    pub fn forget_before(&mut self, index: i64) {
        while self.first < index && self.cache.pop_front().is_some() {
            self.first += 1;
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
    fn grid_reads_do_not_depend_on_how_they_are_split() {
        let x = sine(440.0, 44_100.0, 44_100);
        let src = |i: i64| {
            usize::try_from(i)
                .ok()
                .and_then(|i| x.get(i))
                .copied()
                .unwrap_or(0.0)
        };
        let mut whole = vec![0.0; 600];
        GridResampler::new(44_100.0, 11_000.0).read(src, -50, &mut whole);
        let mut g = GridResampler::new(44_100.0, 11_000.0);
        let mut pieces = Vec::new();
        for start in (-50..550).step_by(37) {
            let mut out = vec![0.0; 80];
            g.read(src, start, &mut out);
            pieces.push((start, out));
            g.forget_before(start);
        }
        for (start, out) in pieces {
            let lo = (start + 50) as usize;
            let n = out.len().min(600 - lo);
            assert_eq!(out[..n], whole[lo..lo + n], "start {start}");
        }
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
