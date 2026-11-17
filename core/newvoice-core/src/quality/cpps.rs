//! Smoothed cepstral peak prominence (CPPS), following Praat 6.1's
//! `To PowerCepstrogram` + `Get CPPS` with its default settings, so values
//! compare directly with the literature that uses Praat.
//!
//! Lower CPPS = breathier or less clearly periodic voice (handbook §3.4).
//! This is a batch measure (it smooths across time), for finished
//! utterances.

use std::f64::consts::PI;

use crate::fft::Fft;
use crate::numeric::{moving_average, theil_incomplete};
use crate::pitch::parabolic;
use crate::resample::Resampler;
use crate::roots::Complex;

/// Settings, with Praat's defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct CppsConfig {
    /// Sets the window: 3 periods of this, doubled for the Gaussian shape.
    pub pitch_floor_hz: f64,
    pub time_step_s: f64,
    /// The signal is resampled to twice this.
    pub max_frequency_hz: f64,
    pub pre_emphasis_hz: f64,
    pub time_averaging_s: f64,
    pub quefrency_averaging_s: f64,
    /// The peak is searched between 1/max and 1/min seconds of quefrency.
    pub peak_f0_min_hz: f64,
    pub peak_f0_max_hz: f64,
    /// Quefrency range of the trend line.
    pub trend_from_s: f64,
    pub trend_to_s: f64,
}

impl Default for CppsConfig {
    fn default() -> Self {
        Self {
            pitch_floor_hz: 60.0,
            time_step_s: 0.002,
            max_frequency_hz: 5000.0,
            pre_emphasis_hz: 50.0,
            time_averaging_s: 0.02,
            quefrency_averaging_s: 0.0005,
            peak_f0_min_hz: 60.0,
            peak_f0_max_hz: 330.0,
            trend_from_s: 0.001,
            trend_to_s: 0.05,
        }
    }
}

/// Cepstral peak prominence per frame, after smoothing.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CppsTrack {
    /// Frame centres, in seconds (input sample `i` is at `i / rate`).
    pub times_s: Vec<f64>,
    pub prominence_db: Vec<f64>,
}

impl CppsTrack {
    /// Mean over all frames: Praat's CPPS for the whole signal.
    pub fn mean(&self) -> Option<f64> {
        self.mean_where(|_| true)
    }

    /// Mean over the frames whose centre time passes `keep`.
    pub fn mean_where(&self, keep: impl Fn(f64) -> bool) -> Option<f64> {
        let v: Vec<f64> = self
            .times_s
            .iter()
            .zip(&self.prominence_db)
            .filter(|(t, _)| keep(**t))
            .map(|(_, p)| *p)
            .collect();
        (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
    }
}

/// Computes the smoothed cepstral peak prominence track of a recording.
pub fn cpps_track(samples: &[f32], sample_rate: f64, cfg: &CppsConfig) -> CppsTrack {
    let rate = 2.0 * cfg.max_frequency_hz;
    let dx = 1.0 / rate;
    // Praat puts sample i (0-based) at (i + ½)/rate. Keep its grid so frames
    // land where Praat's do; convert back to this crate's times at the end.
    let in_offset = 0.5 / sample_rate;
    let duration = samples.len() as f64 / sample_rate;
    let nx = (duration * rate).round() as usize;
    let mut x = vec![0.0; nx];
    let src = |i: i64| {
        usize::try_from(i)
            .ok()
            .and_then(|i| samples.get(i))
            .copied()
            .unwrap_or(0.0)
    };
    Resampler::new(sample_rate, rate).render(src, 0.5 * dx - in_offset, &mut x);
    let alpha = (-2.0 * PI * cfg.pre_emphasis_hz * dx).exp();
    for i in (1..nx).rev() {
        x[i] -= alpha * x[i - 1];
    }

    // Gaussian window of 2 × 3 periods of the pitch floor.
    let window_s = 2.0 * 3.0 / cfg.pitch_floor_hz;
    let nw = (window_s * rate).round() as usize;
    let edge = (-12.0f64).exp();
    let mid = 0.5 * (nw as f64 + 1.0);
    let window: Vec<f64> = (1..=nw)
        .map(|i| {
            let d = i as f64 - mid;
            ((-48.0 * d * d / ((nw + 1) as f64).powi(2)).exp() - edge) / (1.0 - edge)
        })
        .collect();

    // Praat's Sampled_shortTermAnalysis frame placement.
    let my_duration = nx as f64 * dx;
    if my_duration < window_s {
        return CppsTrack::default();
    }
    let frames = ((my_duration - window_s) / cfg.time_step_s).floor() as usize + 1;
    // x1 − ½dx + ½·duration, with Praat's first sample at x1 = ½dx.
    let mid_time = 0.5 * my_duration;
    let t1 = mid_time - 0.5 * frames as f64 * cfg.time_step_s + 0.5 * cfg.time_step_s;

    let nfft = nw.next_power_of_two();
    let fft = Fft::new(nfft);
    let nq = nfft / 2 + 1;
    let mut cepstrogram: Vec<Vec<f64>> = Vec::with_capacity(frames); // [frame][q]
    let mut frame = vec![0.0; nw];
    let mut buf = vec![Complex::ZERO; nfft];
    let mut times = Vec::with_capacity(frames);
    for f in 0..frames {
        let t = t1 + f as f64 * cfg.time_step_s;
        times.push(t - in_offset);
        let start = ((t - 0.5 * window_s - 0.5 * dx) / dx).round() as i64;
        for (j, v) in frame.iter_mut().enumerate() {
            *v = usize::try_from(start + j as i64)
                .ok()
                .and_then(|k| x.get(k))
                .copied()
                .unwrap_or(0.0);
        }
        let mean = frame.iter().sum::<f64>() / nw as f64;
        buf.fill(Complex::ZERO);
        for ((b, v), w) in buf.iter_mut().zip(&frame).zip(&window) {
            *b = Complex::new((v - mean) * w, 0.0);
        }
        fft.forward(&mut buf);
        for b in buf.iter_mut() {
            *b = Complex::new((b.re * b.re + b.im * b.im + 1e-300).ln(), 0.0);
        }
        fft.inverse(&mut buf);
        cepstrogram.push(buf[..nq].iter().map(|c| c.re * c.re).collect());
    }

    // Smooth the power: across time, then across quefrency.
    let dq = (0.5 * nfft as f64 / rate) / (nq - 1) as f64;
    let n_time = (cfg.time_averaging_s / cfg.time_step_s).floor() as usize;
    let n_quef = (cfg.quefrency_averaging_s / dq).floor() as usize;
    let mut column = Vec::with_capacity(frames);
    let mut smoothed = Vec::new();
    if n_time > 1 {
        for q in 0..nq {
            column.clear();
            column.extend(cepstrogram.iter().map(|row| row[q]));
            moving_average(&column, n_time, &mut smoothed);
            for (row, v) in cepstrogram.iter_mut().zip(&smoothed) {
                row[q] = *v;
            }
        }
    }
    if n_quef > 1 {
        for row in cepstrogram.iter_mut() {
            moving_average(row, n_quef, &mut smoothed);
            row.copy_from_slice(&smoothed);
        }
    }

    // Per frame: peak prominence above a robust trend line, in dB.
    let to_index = |q: f64, up: bool| -> usize {
        let i = if up {
            (q / dq).ceil()
        } else {
            (q / dq).floor()
        };
        (i.max(0.0) as usize).min(nq - 1)
    };
    let (trend_lo, trend_hi) = (
        to_index(cfg.trend_from_s, true).max(1),
        to_index(cfg.trend_to_s, false),
    );
    let (peak_lo, peak_hi) = (
        to_index(1.0 / cfg.peak_f0_max_hz, true),
        to_index(1.0 / cfg.peak_f0_min_hz, false),
    );
    let qs: Vec<f64> = (trend_lo..=trend_hi).map(|i| i as f64 * dq).collect();
    let mut prominence = Vec::with_capacity(frames);
    for row in &cepstrogram {
        let db: Vec<f64> = row.iter().map(|z| 10.0 * (z + 1e-30).log10()).collect();
        let (slope, intercept) = theil_incomplete(&qs, &db[trend_lo..=trend_hi]);
        let (peak_db, peak_index) = window_maximum(&db, peak_lo, peak_hi);
        prominence.push(peak_db - (intercept + slope * peak_index * dq));
    }
    CppsTrack {
        times_s: times,
        prominence_db: prominence,
    }
}

/// Praat's `Vector_getMaximumAndX` with parabolic interpolation: the larger
/// of the two window ends and every interpolated interior local maximum.
fn window_maximum(y: &[f64], lo: usize, hi: usize) -> (f64, f64) {
    let (mut best, mut at) = (y[lo], lo as f64);
    if y[hi] > best {
        best = y[hi];
        at = hi as f64;
    }
    for i in lo.max(1)..=hi.min(y.len() - 2) {
        if y[i] > y[i - 1] && y[i] >= y[i + 1] {
            let (delta, value) = parabolic(y[i - 1], y[i], y[i + 1]);
            if value > best {
                best = value;
                at = i as f64 + delta;
            }
        }
    }
    (best, at.clamp(lo as f64, hi as f64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    #[test]
    fn periodic_voice_beats_noise_and_breathiness() {
        let rate = 16_000.0;
        let clean = to_f32(&vowel(
            150.0,
            &[(600.0, 80.0), (1200.0, 90.0)],
            rate,
            16_000,
            0.0,
        ));
        let mut breathy_f = vowel(150.0, &[(600.0, 80.0), (1200.0, 90.0)], rate, 16_000, 0.0);
        for (v, n) in breathy_f.iter_mut().zip(noise(0.15, 16_000, 5)) {
            *v += n;
        }
        let breathy = to_f32(&breathy_f);
        let white = to_f32(&noise(0.3, 16_000, 9));
        let c = cpps_track(&clean, rate, &CppsConfig::default())
            .mean()
            .unwrap();
        let b = cpps_track(&breathy, rate, &CppsConfig::default())
            .mean()
            .unwrap();
        let w = cpps_track(&white, rate, &CppsConfig::default())
            .mean()
            .unwrap();
        assert!(
            c > b + 3.0 && b > w + 3.0,
            "clean {c}, breathy {b}, noise {w}"
        );
    }

    #[test]
    fn frame_layout_follows_praat() {
        let x = vec![0.1f32; 16_000]; // 1 s
        let t = cpps_track(&x, 16_000.0, &CppsConfig::default());
        // (1 s − 0.1 s window) / 2 ms + 1 frames, centred in the signal.
        assert_eq!(t.times_s.len(), 451);
        let mid = 0.5 * (t.times_s[0] + t.times_s[450]);
        assert!((mid - (0.5 - 0.5 / 16_000.0)).abs() < 1e-9, "{mid}");
        assert!(
            cpps_track(&x[..800], 16_000.0, &CppsConfig::default())
                .mean()
                .is_none()
        );
    }
}
