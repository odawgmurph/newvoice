//! Formant estimation.
//!
//! [`FormantAnalyser`] follows Praat's `To Formant (burg)`: resample to twice
//! the formant ceiling, pre-emphasise from 50 Hz, apply a Gaussian window of
//! twice the nominal length, fit Burg LPC with two poles per formant, and turn
//! the roots into frequencies and bandwidths, discarding any within 50 Hz of
//! 0 Hz or of the Nyquist frequency.
//!
//! Like Praat, LPC sometimes spends a pole pair on overall spectral tilt,
//! which shows up as a "formant" with a bandwidth of several kHz and pushes
//! the real F2 into the F3 slot. By default such poles are dropped (see
//! [`FormantConfig::max_bandwidth_hz`]); set it to `None` for Praat's raw
//! output, which the validation harness compares against.
//!
//! [`sweep`] repeats that over a range of ceilings and keeps the one whose
//! F1–F3 tracks are smoothest (after Barreda's Fast Track, 2021). A fixed
//! ceiling under-reports raised formants or merges F1/F2 on back vowels, and
//! users in training deliberately change their formants (handbook §3.3).

use std::f64::consts::PI;

use crate::lpc::{burg, inverse_filter_polynomial};
use crate::resample::GridResampler;
use crate::roots::roots;

/// Most formants kept per frame.
pub const MAX_FORMANTS: usize = 5;
/// Roots this close to 0 Hz or to the Nyquist frequency are discarded.
const SAFETY_MARGIN_HZ: f64 = 50.0;

/// Ceilings tried by [`sweep`] by default: 4500–6500 Hz in 250 Hz steps.
pub const SWEEP_CEILINGS_HZ: [f64; 9] = [
    4500.0, 4750.0, 5000.0, 5250.0, 5500.0, 5750.0, 6000.0, 6250.0, 6500.0,
];

/// Settings for one formant analysis (Praat's parameters and defaults).
#[derive(Debug, Clone, PartialEq)]
pub struct FormantConfig {
    /// Formant ceiling ("maximum formant"). The frame is resampled to twice this.
    pub ceiling_hz: f64,
    /// Formants to look for below the ceiling; the LPC order is twice this.
    pub max_formants: usize,
    /// Nominal window length. The Gaussian window spans twice this.
    pub window_s: f64,
    /// Pre-emphasis corner frequency.
    pub pre_emphasis_hz: f64,
    /// Poles wider than this are not formants (they model spectral tilt) and
    /// are dropped before numbering F1, F2, …. `None` keeps them, as Praat does.
    pub max_bandwidth_hz: Option<f64>,
}

impl Default for FormantConfig {
    fn default() -> Self {
        Self {
            ceiling_hz: 5500.0,
            max_formants: 5,
            window_s: 0.025,
            pre_emphasis_hz: 50.0,
            max_bandwidth_hz: Some(1000.0),
        }
    }
}

/// One formant.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Formant {
    pub frequency_hz: f64,
    pub bandwidth_hz: f64,
}

/// The formants found in one frame, lowest first.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct FormantFrame {
    len: usize,
    formants: [Formant; MAX_FORMANTS],
}

impl FormantFrame {
    pub fn from_slice(formants: &[Formant]) -> Self {
        let mut frame = Self::default();
        for f in formants.iter().take(MAX_FORMANTS) {
            frame.formants[frame.len] = *f;
            frame.len += 1;
        }
        frame
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_slice(&self) -> &[Formant] {
        &self.formants[..self.len]
    }

    /// Formant `i`, counting from 0 (so `get(1)` is F2).
    pub fn get(&self, i: usize) -> Option<Formant> {
        self.as_slice().get(i).copied()
    }

    /// Frequency of formant `i`, counting from 0.
    pub fn frequency(&self, i: usize) -> Option<f64> {
        self.get(i).map(|f| f.frequency_hz)
    }
}

/// Formants of an already resampled, pre-emphasised and windowed frame,
/// lowest first, dropping poles wider than `max_bandwidth_hz` if given.
pub fn frame_formants(
    x: &[f64],
    rate: f64,
    lpc_order: usize,
    max_bandwidth_hz: Option<f64>,
) -> FormantFrame {
    let Some((d, _)) = burg(x, lpc_order) else {
        return FormantFrame::default();
    };
    let nyquist = rate / 2.0;
    let mut found: Vec<Formant> = roots(&inverse_filter_polynomial(&d))
        .into_iter()
        .filter(|z| z.im >= 0.0 && z.abs() > 0.0)
        .filter_map(|z| {
            // Reflect roots outside the unit circle back inside (1 / z̄).
            let z = if z.abs() > 1.0 { z.conj().recip() } else { z };
            let f = z.arg().abs() * rate / (2.0 * PI);
            (SAFETY_MARGIN_HZ..=nyquist - SAFETY_MARGIN_HZ)
                .contains(&f)
                .then(|| Formant {
                    frequency_hz: f,
                    bandwidth_hz: -z.abs().ln() * rate / PI,
                })
        })
        .filter(|f| max_bandwidth_hz.is_none_or(|max| f.bandwidth_hz <= max))
        .collect();
    found.sort_by(|a, b| a.frequency_hz.total_cmp(&b.frequency_hz));
    FormantFrame::from_slice(&found)
}

/// Frame-by-frame formant analysis at one ceiling.
#[derive(Debug, Clone)]
pub struct FormantAnalyser {
    cfg: FormantConfig,
    rate: f64,
    grid: GridResampler,
    window: Vec<f64>,
    buf: Vec<f64>,
    frame: Vec<f64>,
}

impl FormantAnalyser {
    /// An analyser for input sampled at `in_rate`.
    pub fn new(in_rate: f64, cfg: FormantConfig) -> Self {
        assert!(cfg.ceiling_hz > 2.0 * SAFETY_MARGIN_HZ, "ceiling too low");
        let rate = 2.0 * cfg.ceiling_hz;
        let n = (2.0 * cfg.window_s * rate).floor() as usize;
        // Praat's Gaussian window (sidelobes below −120 dB).
        let edge = (-12.0f64).exp();
        let mid = 0.5 * (n as f64 + 1.0);
        let denom = (n as f64 + 1.0).powi(2);
        let window = (1..=n)
            .map(|i| {
                let d = i as f64 - mid;
                ((-48.0 * d * d / denom).exp() - edge) / (1.0 - edge)
            })
            .collect();
        Self {
            grid: GridResampler::new(in_rate, rate),
            rate,
            window,
            buf: Vec::with_capacity(n + 1),
            frame: Vec::with_capacity(n),
            cfg,
        }
    }

    pub fn config(&self) -> &FormantConfig {
        &self.cfg
    }

    /// Seconds of input read on each side of a frame centre.
    pub fn reach_s(&self) -> f64 {
        let rs = self.grid.resampler();
        (self.window.len() as f64 / 2.0 + 2.0) / self.rate
            + rs.half_width_samples() as f64 / rs.in_rate()
    }

    /// Formants of the frame centred at `t` seconds. `src(i)` returns input
    /// sample `i`, and 0 outside the signal.
    pub fn analyse(&mut self, src: impl Fn(i64) -> f32, t: f64) -> FormantFrame {
        let n = self.window.len();
        // One extra sample before the window for pre-emphasis.
        // Window centred on the grid sample nearest `t`, plus one sample
        // before it for pre-emphasis.
        let start = (t * self.rate - (n as f64 - 1.0) / 2.0).round() as i64 - 1;
        self.buf.clear();
        self.buf.resize(n + 1, 0.0);
        self.grid.read(src, start, &mut self.buf);
        self.grid.forget_before(start);
        let alpha = (-2.0 * PI * self.cfg.pre_emphasis_hz / self.rate).exp();
        self.frame.clear();
        self.frame.extend(
            self.buf
                .windows(2)
                .zip(&self.window)
                .map(|(pair, w)| (pair[1] - alpha * pair[0]) * w),
        );
        frame_formants(
            &self.frame,
            self.rate,
            2 * self.cfg.max_formants,
            self.cfg.max_bandwidth_hz,
        )
    }
}

/// How one ceiling scored in a [`sweep`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CeilingScore {
    pub ceiling_hz: f64,
    /// Sum over F1–F3 of each track's mean absolute deviation from a cubic
    /// fit in time (Hz). Infinite when F1–F3 weren't found in most frames.
    pub track_error_hz: f64,
    /// Sum over F1–F3 of how far the median formant moves when the ceiling
    /// steps to its neighbours (Hz, averaged over the neighbours that work).
    pub instability_hz: f64,
}

impl CeilingScore {
    /// Lower is better.
    pub fn total(&self) -> f64 {
        self.track_error_hz + self.instability_hz
    }
}

/// The outcome of a [`sweep`].
#[derive(Debug, Clone, PartialEq)]
pub struct SweepResult {
    /// The chosen ceiling.
    pub ceiling_hz: f64,
    /// Frames at the chosen ceiling, one per requested time.
    pub frames: Vec<FormantFrame>,
    /// Every ceiling tried, in order.
    pub scores: Vec<CeilingScore>,
}

/// Fraction of frames that must contain a formant for its track to count.
const MIN_TRACK_COVERAGE: f64 = 0.8;
/// Instability charged against a side with no usable neighbour.
const MISSING_NEIGHBOUR_HZ: f64 = 500.0;

/// Analyses the frames at `times` at each ceiling and keeps the best one.
///
/// Two things mark a good ceiling, and both are measured in Hz so they add
/// without weights: its F1–F3 tracks are smooth in time (Fast Track's
/// criterion), and its answer barely changes when the ceiling is nudged to
/// the neighbouring values. A wrong ceiling splits, merges or skips a
/// formant, which shows as a jump between neighbouring ceilings. The second
/// term matters for sustained vowels, where every ceiling's tracks are
/// smooth and the first term alone can't choose. `ceilings` should be sorted
/// and evenly spaced. Returns `None` when no ceiling produced usable tracks.
pub fn sweep(
    src: impl Fn(i64) -> f32 + Copy,
    in_rate: f64,
    times: &[f64],
    base: &FormantConfig,
    ceilings: &[f64],
) -> Option<SweepResult> {
    let analyses: Vec<(Vec<FormantFrame>, f64, Option<[f64; 3]>)> = ceilings
        .iter()
        .map(|&ceiling| {
            let mut analyser = FormantAnalyser::new(
                in_rate,
                FormantConfig {
                    ceiling_hz: ceiling,
                    ..base.clone()
                },
            );
            let frames: Vec<FormantFrame> =
                times.iter().map(|&t| analyser.analyse(src, t)).collect();
            let error = track_error(times, &frames);
            let medians = error.is_finite().then(|| median_tracks(&frames));
            (frames, error, medians)
        })
        .collect();

    let shift =
        |a: &[f64; 3], b: &[f64; 3]| -> f64 { a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum() };
    let scores: Vec<CeilingScore> = analyses
        .iter()
        .enumerate()
        .map(|(i, (_, error, medians))| {
            let instability = medians.map_or(f64::INFINITY, |m| {
                let side = |j: Option<usize>| -> f64 {
                    j.and_then(|j| analyses.get(j))
                        .and_then(|(_, _, n)| n.as_ref())
                        .map_or(MISSING_NEIGHBOUR_HZ, |n| shift(&m, n))
                };
                // At either end of the range only one neighbour exists.
                let below = (i > 0).then(|| side(Some(i - 1)));
                let above = (i + 1 < analyses.len()).then(|| side(Some(i + 1)));
                match (below, above) {
                    (Some(a), Some(b)) => 0.5 * (a + b),
                    (Some(a), None) | (None, Some(a)) => a,
                    (None, None) => 0.0,
                }
            });
            CeilingScore {
                ceiling_hz: ceilings[i],
                track_error_hz: *error,
                instability_hz: instability,
            }
        })
        .collect();

    let best = scores
        .iter()
        .enumerate()
        .filter(|(_, s)| s.total().is_finite())
        .min_by(|(_, a), (_, b)| a.total().total_cmp(&b.total()))
        .map(|(i, _)| i)?;
    let (frames, _, _) = analyses.into_iter().nth(best).expect("index in range");
    Some(SweepResult {
        ceiling_hz: ceilings[best],
        frames,
        scores,
    })
}

/// Median F1–F3 over frames (each over the frames that have it).
fn median_tracks(frames: &[FormantFrame]) -> [f64; 3] {
    std::array::from_fn(|k| {
        let v: Vec<f64> = frames.iter().filter_map(|f| f.frequency(k)).collect();
        crate::units::median(&v).unwrap_or(f64::NAN)
    })
}

/// Sum over F1–F3 of the mean absolute deviation (Hz) of each track from its
/// least-squares cubic in time.
fn track_error(times: &[f64], frames: &[FormantFrame]) -> f64 {
    let mut total = 0.0;
    for k in 0..3 {
        let (ts, fs): (Vec<f64>, Vec<f64>) = times
            .iter()
            .zip(frames)
            .filter_map(|(&t, f)| f.frequency(k).map(|v| (t, v)))
            .unzip();
        if (ts.len() as f64) < MIN_TRACK_COVERAGE * times.len() as f64 || ts.is_empty() {
            return f64::INFINITY;
        }
        total += mean_abs_residual(&ts, &fs, 3);
    }
    total
}

/// Mean absolute residual of a least-squares polynomial fit of `ys` on `xs`.
pub(crate) fn mean_abs_residual(xs: &[f64], ys: &[f64], order: usize) -> f64 {
    let n = xs.len();
    let order = order.min(n.saturating_sub(1));
    let (lo, hi) = xs
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), &x| (lo.min(x), hi.max(x)));
    let span = (hi - lo).max(1e-12);
    let u: Vec<f64> = xs.iter().map(|&x| 2.0 * (x - lo) / span - 1.0).collect();
    let m = order + 1;
    // Normal equations A c = b.
    let mut a = vec![vec![0.0; m + 1]; m];
    for (&ui, &yi) in u.iter().zip(ys) {
        let powers: Vec<f64> = (0..m).map(|p| ui.powi(p as i32)).collect();
        for r in 0..m {
            for c in 0..m {
                a[r][c] += powers[r] * powers[c];
            }
            a[r][m] += powers[r] * yi;
        }
    }
    let coeffs = solve(a);
    u.iter()
        .zip(ys)
        .map(|(&ui, &yi)| {
            let fit: f64 = coeffs
                .iter()
                .enumerate()
                .map(|(p, c)| c * ui.powi(p as i32))
                .sum();
            (yi - fit).abs()
        })
        .sum::<f64>()
        / n as f64
}

/// Gaussian elimination with partial pivoting on an augmented matrix.
fn solve(mut a: Vec<Vec<f64>>) -> Vec<f64> {
    let m = a.len();
    for col in 0..m {
        let pivot = (col..m)
            .max_by(|&i, &j| a[i][col].abs().total_cmp(&a[j][col].abs()))
            .expect("non-empty");
        a.swap(col, pivot);
        if a[col][col].abs() < 1e-300 {
            continue;
        }
        let (upper, lower) = a.split_at_mut(col + 1);
        let pivot_row = &upper[col];
        for row in lower {
            let factor = row[col] / pivot_row[col];
            for (cell, p) in row[col..].iter_mut().zip(&pivot_row[col..]) {
                *cell -= factor * p;
            }
        }
    }
    let mut x = vec![0.0; m];
    for row in (0..m).rev() {
        let s: f64 = (row + 1..m).map(|c| a[row][c] * x[c]).sum();
        x[row] = if a[row][row].abs() < 1e-300 {
            0.0
        } else {
            (a[row][m] - s) / a[row][row]
        };
    }
    x
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    const RATE: f64 = 44_100.0;

    // Peterson & Barney-style targets with higher formants added.
    const MALE_A: [(f64, f64); 5] = [
        (730.0, 80.0),
        (1090.0, 90.0),
        (2440.0, 120.0),
        (3400.0, 150.0),
        (4400.0, 200.0),
    ];
    const FEMALE_I: [(f64, f64); 5] = [
        (310.0, 60.0),
        (2790.0, 100.0),
        (3310.0, 120.0),
        (4300.0, 150.0),
        (5100.0, 200.0),
    ];

    fn median_formants(frames: &[FormantFrame]) -> Vec<f64> {
        (0..3)
            .map(|k| {
                let v: Vec<f64> = frames.iter().filter_map(|f| f.frequency(k)).collect();
                crate::units::median(&v).unwrap()
            })
            .collect()
    }

    fn analyse_fixed(x: &[f32], ceiling: f64) -> Vec<f64> {
        let mut a = FormantAnalyser::new(
            RATE,
            FormantConfig {
                ceiling_hz: ceiling,
                ..FormantConfig::default()
            },
        );
        let src = |i: i64| {
            usize::try_from(i)
                .ok()
                .and_then(|i| x.get(i))
                .copied()
                .unwrap_or(0.0)
        };
        let frames: Vec<FormantFrame> = (10..40).map(|k| a.analyse(src, k as f64 * 0.01)).collect();
        median_formants(&frames)
    }

    fn assert_close(got: &[f64], want: &[(f64, f64)], tol: f64) {
        for (k, (g, (w, _))) in got.iter().zip(want).enumerate() {
            let err = (g / w - 1.0).abs();
            assert!(err < tol, "F{}: got {g:.0}, want {w:.0} ({err:.3})", k + 1);
        }
    }

    #[test]
    fn male_a_at_5000() {
        let x = to_f32(&vowel(110.0, &MALE_A, RATE, 22_050, 0.0));
        assert_close(&analyse_fixed(&x, 5000.0), &MALE_A, 0.05);
    }

    #[test]
    fn female_i_at_5500() {
        let x = to_f32(&vowel(210.0, &FEMALE_I, RATE, 22_050, 0.0));
        assert_close(&analyse_fixed(&x, 5500.0), &FEMALE_I, 0.05);
    }

    #[test]
    fn raw_mode_keeps_wide_tilt_poles_like_praat() {
        // Praat reports a ~1100 Hz pole with a ~2800 Hz bandwidth here.
        let x = to_f32(&vowel(210.0, &FEMALE_I, RATE, 22_050, 0.0));
        let mut a = FormantAnalyser::new(
            RATE,
            FormantConfig {
                max_bandwidth_hz: None,
                ..FormantConfig::default()
            },
        );
        let src = |i: i64| {
            usize::try_from(i)
                .ok()
                .and_then(|i| x.get(i))
                .copied()
                .unwrap_or(0.0)
        };
        let f2 = a.analyse(src, 0.2).get(1).unwrap();
        assert!(f2.bandwidth_hz > 1000.0, "{f2:?}");
    }

    #[test]
    fn window_and_rate_follow_praat() {
        let a = FormantAnalyser::new(48_000.0, FormantConfig::default());
        assert_eq!(a.rate, 11_000.0);
        assert_eq!(a.window.len(), 550); // 2 × 25 ms at 11 kHz
        let peak = a.window.iter().copied().fold(0.0, f64::max);
        assert!((peak - 1.0).abs() < 1e-3);
        assert!(a.window[0].abs() < 1e-3);
    }

    #[test]
    fn sweep_picks_a_ceiling_that_finds_the_formants() {
        for (f0, formants) in [(110.0, MALE_A), (210.0, FEMALE_I)] {
            let x = to_f32(&vowel(f0, &formants, RATE, 22_050, 0.3));
            let src = |i: i64| {
                usize::try_from(i)
                    .ok()
                    .and_then(|i| x.get(i))
                    .copied()
                    .unwrap_or(0.0)
            };
            let times: Vec<f64> = (0..60).map(|k| 0.1 + k as f64 * 0.005).collect();
            let r = sweep(
                src,
                RATE,
                &times,
                &FormantConfig::default(),
                &SWEEP_CEILINGS_HZ,
            )
            .unwrap();
            assert_eq!(r.scores.len(), SWEEP_CEILINGS_HZ.len());
            assert_close(&median_formants(&r.frames), &formants, 0.05);
        }
    }

    #[test]
    fn polynomial_fit_residual() {
        let xs: Vec<f64> = (0..20).map(f64::from).collect();
        let cubic: Vec<f64> = xs
            .iter()
            .map(|x| 3.0 + 0.5 * x - 0.1 * x * x + 0.01 * x * x * x)
            .collect();
        assert!(mean_abs_residual(&xs, &cubic, 3) < 1e-6);
        let zigzag: Vec<f64> = (0..20)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        assert!(mean_abs_residual(&xs, &zigzag, 3) > 0.9);
    }
}
