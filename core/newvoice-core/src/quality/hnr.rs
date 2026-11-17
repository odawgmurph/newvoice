//! Harmonics-to-noise ratio by Boersma's (1993) autocorrelation method,
//! following Praat's `To Harmonicity (ac)` so values compare with Praat.
//! That command uses Praat's "accurate" autocorrelation variant: a Gaussian
//! window twice the nominal length (9 periods of the pitch floor), with the
//! window's own autocorrelation divided out, and windowed-sinc refinement of
//! each peak.
//!
//! Lower HNR = noisier voice (handbook §3.4). Batch measure, for finished
//! utterances; it runs at the recording's own sample rate.

use crate::fft::Fft;
use crate::numeric::improve_maximum_sinc;
use crate::roots::Complex;

/// Settings, with Praat's defaults for `To Harmonicity (ac)`.
#[derive(Debug, Clone, PartialEq)]
pub struct HnrConfig {
    pub time_step_s: f64,
    pub min_pitch_hz: f64,
    /// Frames whose local peak is below this fraction of the global peak
    /// tend towards unvoiced.
    pub silence_threshold: f64,
    pub periods_per_window: f64,
}

impl Default for HnrConfig {
    fn default() -> Self {
        Self {
            time_step_s: 0.01,
            min_pitch_hz: 75.0,
            silence_threshold: 0.1,
            periods_per_window: 4.5,
        }
    }
}

/// HNR per frame; `None` where the frame is unvoiced (Praat's −200 dB).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HnrTrack {
    /// Frame centres in seconds (input sample `i` is at `i / rate`).
    pub times_s: Vec<f64>,
    pub hnr_db: Vec<Option<f64>>,
}

impl HnrTrack {
    /// Mean over voiced frames, as Praat's `Get mean`.
    pub fn mean(&self) -> Option<f64> {
        self.mean_where(|_| true)
    }

    /// Mean over voiced frames whose centre passes `keep`.
    pub fn mean_where(&self, keep: impl Fn(f64) -> bool) -> Option<f64> {
        let v: Vec<f64> = self
            .times_s
            .iter()
            .zip(&self.hnr_db)
            .filter(|(t, _)| keep(**t))
            .filter_map(|(_, h)| *h)
            .collect();
        (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
    }
}

/// Most candidates kept per frame (Praat's default).
const MAX_CANDIDATES: usize = 15;
/// Sinc interpolation depth for the peak refinement (Praat's `SINC700`).
const SINC_DEPTH: usize = 700;
/// Candidates whose parabolic strength trails the best refined one by more
/// than this are not refined.
const REFINE_MARGIN: f64 = 0.02;
/// Share of the window over which lags are kept (Gaussian variant).
const INTERPOLATION_DEPTH: f64 = 0.25;

/// Computes the HNR track of a recording.
pub fn hnr_track(samples: &[f32], sample_rate: f64, cfg: &HnrConfig) -> HnrTrack {
    let n = samples.len();
    let dx = 1.0 / sample_rate;
    let x: Vec<f64> = samples.iter().map(|&v| f64::from(v)).collect();

    // The Gaussian window is twice as long as the nominal one.
    let periods_per_window = 2.0 * cfg.periods_per_window;
    let dt_window = periods_per_window / cfg.min_pitch_hz;
    let half_window = (dt_window / dx).floor() as usize / 2;
    if half_window < 3 {
        return HnrTrack::default();
    }
    let half_window = half_window - 1;
    let nsamp_window = 2 * half_window;
    let max_lag =
        ((nsamp_window as f64 / periods_per_window).floor() as usize + 2).min(nsamp_window);
    let nsamp_period = (1.0 / dx / cfg.min_pitch_hz).floor() as usize;
    let half_period = nsamp_period / 2 + 1;

    // Frame placement (Praat's Sampled_shortTermAnalysis; sample i at (i + ½)·dx).
    let duration = n as f64 * dx;
    if duration < dt_window {
        return HnrTrack::default();
    }
    let frames = ((duration - dt_window) / cfg.time_step_s).floor() as usize + 1;
    let t1 = 0.5 * duration - 0.5 * frames as f64 * cfg.time_step_s + 0.5 * cfg.time_step_s;

    let mean = x.iter().sum::<f64>() / n as f64;
    let global_peak = x.iter().fold(0.0f64, |m, v| m.max((v - mean).abs()));

    let nfft =
        ((nsamp_window as f64 * (1.0 + INTERPOLATION_DEPTH)).ceil() as usize).next_power_of_two();
    let fft = Fft::new(nfft);
    let edge = (-12.0f64).exp();
    let mid = 0.5 * (nsamp_window as f64 + 1.0);
    let denom = (nsamp_window as f64 + 1.0).powi(2);
    let window: Vec<f64> = (1..=nsamp_window)
        .map(|i| {
            let d = i as f64 - mid;
            ((-48.0 * d * d / denom).exp() - edge) / (1.0 - edge)
        })
        .collect();
    let mut buf = vec![Complex::ZERO; nfft];
    let autocorrelation = |frame: &[f64], buf: &mut Vec<Complex>| -> Vec<f64> {
        buf.fill(Complex::ZERO);
        for (b, v) in buf.iter_mut().zip(frame) {
            *b = Complex::new(*v, 0.0);
        }
        fft.forward(buf);
        for b in buf.iter_mut() {
            *b = Complex::new(b.re * b.re + b.im * b.im, 0.0);
        }
        fft.inverse(buf);
        buf.iter().map(|c| c.re).collect()
    };
    let window_r = autocorrelation(&window, &mut buf);
    let brent_max = (nsamp_window as f64 * INTERPOLATION_DEPTH).floor() as usize;

    let mut times = Vec::with_capacity(frames);
    let mut hnr = Vec::with_capacity(frames);
    let mut frame = vec![0.0; nsamp_window];
    // r over lags −brent_max..=brent_max, stored at index lag + brent_max.
    let mut r = vec![0.0; 2 * brent_max + 1];
    for f in 0..frames {
        let t = t1 + f as f64 * cfg.time_step_s;
        times.push(t - 0.5 * dx);
        let left = ((t - 0.5 * dx) / dx).floor() as usize;
        let right = left + 1;

        let (lo, hi) = (right - nsamp_period, left + nsamp_period);
        let local_mean = x[lo..=hi].iter().sum::<f64>() / (2 * nsamp_period) as f64;
        let start = right - half_window;
        for (j, v) in frame.iter_mut().enumerate() {
            *v = (x[start + j] - local_mean) * window[j];
        }
        let peak_from = (half_window + 1).saturating_sub(half_period).max(1) - 1;
        let peak_to = (half_window + half_period).min(nsamp_window) - 1;
        let local_peak = frame[peak_from..=peak_to]
            .iter()
            .fold(0.0f64, |m, v| m.max(v.abs()));
        let intensity = if global_peak > 0.0 {
            (local_peak / global_peak).min(1.0)
        } else {
            0.0
        };
        let unvoiced_strength = (2.0 - intensity / cfg.silence_threshold).max(0.0);

        let ac = autocorrelation(&frame, &mut buf);
        if ac[0] <= 0.0 {
            hnr.push(None);
            continue;
        }
        r[brent_max] = 1.0;
        for i in 1..=brent_max {
            let v = ac[i] / (ac[0] * window_r[i] / window_r[0]);
            r[brent_max + i] = v;
            r[brent_max - i] = v;
        }

        // Local maxima, ranked by parabolic strength; keep the best few.
        let mut candidates: Vec<(f64, f64)> = Vec::new(); // (lag, strength)
        for i in 2..=max_lag.min(brent_max - 1) {
            let (a, b, c) = (r[brent_max + i - 1], r[brent_max + i], r[brent_max + i + 1]);
            if b > 0.0 && b > a && b >= c {
                let dr = 0.5 * (c - a);
                let d2r = 2.0 * b - a - c;
                candidates.push((i as f64 + dr / d2r, b + 0.5 * dr * dr / d2r));
            }
        }
        candidates.sort_by(|p, q| q.1.total_cmp(&p.1));
        candidates.truncate(MAX_CANDIDATES - 1);

        // Refine each candidate. One whose refined frequency reaches the
        // ceiling (Nyquist; a lag of 2 samples or less) counts as voiceless,
        // as in Praat's path finder: it is a noise ripple next to lag 0.
        // Candidates are in descending parabolic strength, and refinement
        // moves a strength by far less than REFINE_MARGIN, so stop once the
        // rest can't win.
        let mut best = f64::NEG_INFINITY;
        for &(lag, strength) in &candidates {
            if strength < best - REFINE_MARGIN {
                break;
            }
            let mid = lag.trunc() as usize + brent_max;
            let (pos, value) = improve_maximum_sinc(&r, mid, SINC_DEPTH);
            if pos - brent_max as f64 > 2.0 {
                best = best.max(if value > 1.0 { 1.0 / value } else { value });
            }
        }
        hnr.push((best > unvoiced_strength).then(|| {
            if best <= 1e-15 {
                -150.0
            } else if best > 1.0 - 1e-15 {
                150.0
            } else {
                10.0 * (best / (1.0 - best)).log10()
            }
        }));
    }
    HnrTrack {
        times_s: times,
        hnr_db: hnr,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    #[test]
    fn hnr_falls_as_noise_rises() {
        let rate = 16_000.0;
        let n = 16_000;
        let clean = vowel(160.0, &[(600.0, 80.0), (1200.0, 90.0)], rate, n, 0.0);
        let at = |noise_amp: f64| {
            let x: Vec<f64> = clean
                .iter()
                .zip(noise(noise_amp, n, 3))
                .map(|(a, b)| a + b)
                .collect();
            hnr_track(&to_f32(&x), rate, &HnrConfig::default())
                .mean()
                .unwrap()
        };
        let (h1, h2, h3) = (at(0.005), at(0.05), at(0.2));
        assert!(h1 > h2 + 5.0 && h2 > h3 + 5.0, "{h1} {h2} {h3}");
        assert!(h1 > 20.0 && h3 < 10.0, "{h1} {h3}");
    }

    #[test]
    fn silence_is_unvoiced_and_short_input_is_empty() {
        let mut x = vec![0.0f32; 16_000];
        let tone = vowel(150.0, &[(600.0, 80.0)], 16_000.0, 8000, 0.0);
        x[..8000].copy_from_slice(&to_f32(&tone));
        let t = hnr_track(&x, 16_000.0, &HnrConfig::default());
        assert!(t.hnr_db.last().unwrap().is_none());
        assert!(t.hnr_db[t.hnr_db.len() / 4].is_some());
        assert!(
            hnr_track(&x[..500], 16_000.0, &HnrConfig::default())
                .mean()
                .is_none()
        );
    }
}
