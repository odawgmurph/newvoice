//! Vocal tract length from formant spacing (handbook §3.3).

/// Speed of sound in the vocal tract (warm, humid air), in cm/s. Matches
/// `harness/norms/build_norms.py`, so values compare with the reference norms.
pub const SPEED_OF_SOUND_CM_S: f64 = 35_000.0;

/// Formant dispersion ΔF (Reby & McComb 2003): the zero-intercept regression
/// slope of Fᵢ on (2i − 1)/2, for formants F1, F2, … in order.
///
/// Returns `None` for an empty slice.
pub fn formant_dispersion(formants_hz: &[f64]) -> Option<f64> {
    if formants_hz.is_empty() {
        return None;
    }
    let (num, den) = formants_hz
        .iter()
        .enumerate()
        .fold((0.0, 0.0), |(num, den), (i, f)| {
            let x = (2 * i + 1) as f64 / 2.0;
            (num + x * f, den + x * x)
        });
    Some(num / den)
}

/// Apparent vocal tract length in cm for a formant dispersion: c / (2·ΔF).
pub fn apparent_vtl_cm(delta_f_hz: f64) -> f64 {
    SPEED_OF_SOUND_CM_S / (2.0 * delta_f_hz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_tube() {
        // A 17.5 cm uniform tube has formants at 500, 1500, 2500, 3500 Hz.
        let df = formant_dispersion(&[500.0, 1500.0, 2500.0, 3500.0]).unwrap();
        assert!((df - 1000.0).abs() < 1e-9);
        assert!((apparent_vtl_cm(df) - 17.5).abs() < 1e-9);
        assert!(formant_dispersion(&[]).is_none());
    }
}
