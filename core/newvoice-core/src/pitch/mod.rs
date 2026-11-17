//! Fundamental frequency estimation.
//!
//! [`yin`] and [`mpm`] estimate F0 for one frame. [`smooth`] cleans a track of
//! frame estimates with the octave-jump guard and median filter from handbook
//! §3.2.

pub mod mpm;
pub mod smooth;
pub mod yin;

/// Sample rate the pitch estimators run at. Frames are resampled to it, so
/// lags and costs don't depend on the device's capture rate.
pub const PITCH_RATE: f64 = 16_000.0;

/// The octave-up guard shared by YIN and MPM.
///
/// When H1 is weak and H2 strong (for example H2 sitting on F1 in a pressed
/// /u/), the half period is nearly periodic too, and both estimators' "first
/// good candidate" rules pick it, reporting an octave too high. Given the
/// normalised square difference (MPM's NSDF, 1 = perfectly periodic) at the
/// chosen lag and near its double, switch to the double only when the chosen
/// lag is clearly imperfect and the double's aperiodicity (1 − NSDF) is
/// under a quarter of it. A ratio, not a difference, so noise or jitter,
/// which degrade both lags alike, don't trigger it (a fixed octave cost did,
/// and created sub-harmonic errors on jittery voices). Both estimators use
/// NSDF here because YIN's own normalisation can make a gliding voice's
/// double period look far cleaner than its true one.
pub(crate) fn octave_up_error(chosen_nsdf: f64, double_nsdf: f64) -> bool {
    let (chosen, double) = (1.0 - chosen_nsdf, 1.0 - double_nsdf);
    chosen > 0.02 && double < 0.25 * chosen
}

/// Normalised square difference of `x` at lag `tau`, over the whole frame.
pub(crate) fn nsdf_at(x: &[f64], tau: usize) -> f64 {
    let n = x.len();
    if tau >= n {
        return 0.0;
    }
    let (mut r, mut m) = (0.0, 0.0);
    for (a, b) in x[..n - tau].iter().zip(&x[tau..]) {
        r += a * b;
        m += a * a + b * b;
    }
    if m > 0.0 { 2.0 * r / m } else { 0.0 }
}

/// Peak NSDF near lag `tau`, interpolated to sub-sample precision. Integer
/// lags alone misjudge short periods: half a sample off at a 64-sample
/// period visibly lowers the NSDF, while the double lag may fall on a whole
/// sample, which made the octave guard choose the double period.
pub(crate) fn nsdf_peak(x: &[f64], tau: usize) -> f64 {
    // Climb to the nearest local maximum (YIN's dip can sit a sample away
    // from the NSDF peak), then interpolate.
    let mut t = tau;
    for _ in 0..3 {
        let (here, down, up) = (nsdf_at(x, t), nsdf_at(x, t - 1), nsdf_at(x, t + 1));
        if up > here && t + 2 < x.len() {
            t += 1;
        } else if down > here && t > 2 {
            t -= 1;
        } else {
            return parabolic(down, here, up).1;
        }
    }
    parabolic(nsdf_at(x, t - 1), nsdf_at(x, t), nsdf_at(x, t + 1)).1
}

/// Which per-frame pitch estimator to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PitchAlgorithm {
    /// YIN (de Cheveigné & Kawahara 2002): cumulative mean normalised difference.
    #[default]
    Yin,
    /// MPM (McLeod & Wyvill 2005): normalised square difference.
    Mpm,
}

/// One frame's pitch estimate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PitchEstimate {
    pub f0_hz: f64,
    /// How periodic the frame is, 0 (noise) to 1 (perfectly periodic).
    /// YIN: 1 − aperiodicity at the chosen lag. MPM: the NSDF peak (clarity).
    pub periodicity: f64,
}

/// Lag search range and window sizes, in samples at [`PITCH_RATE`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LagRange {
    /// Shortest lag searched (highest F0).
    pub min: usize,
    /// Longest lag searched (lowest F0).
    pub max: usize,
    /// YIN integration window.
    pub window: usize,
}

impl LagRange {
    pub fn new(f0_min_hz: f64, f0_max_hz: f64) -> Self {
        assert!(
            f0_min_hz > 0.0 && f0_max_hz > f0_min_hz,
            "invalid F0 search range"
        );
        let max = (PITCH_RATE / f0_min_hz).ceil() as usize;
        let min = ((PITCH_RATE / f0_max_hz).floor() as usize).max(2);
        // At least 25 ms, and never shorter than the longest period.
        let window = max.max((0.025 * PITCH_RATE).round() as usize);
        Self { min, max, window }
    }

    /// Samples one frame needs: the window, the longest lag, and one more lag
    /// for parabolic interpolation.
    pub fn frame_len(&self) -> usize {
        self.window + self.max + 2
    }
}

/// Vertex of the parabola through (−1, a), (0, b), (1, c): offset and value.
pub(crate) fn parabolic(a: f64, b: f64, c: f64) -> (f64, f64) {
    let denom = a - 2.0 * b + c;
    if denom.abs() < 1e-18 {
        return (0.0, b);
    }
    let delta = (0.5 * (a - c) / denom).clamp(-1.0, 1.0);
    (delta, b - 0.25 * (a - c) * delta)
}
