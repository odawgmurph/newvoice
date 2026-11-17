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
