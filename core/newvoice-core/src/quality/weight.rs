//! The weight index: a **heuristic**, baseline-relative proxy for vocal
//! weight (handbook §3.4).
//!
//! It averages three z-scores against the user's own baseline: −(H1*−H2*)
//! (pressed vs breathy source), alpha ratio (high-frequency energy) and CPPS
//! (clarity). Positive = heavier than the baseline, negative = lighter.
//!
//! No published study has validated an acoustic measure against perceived
//! weight in trans voices; the Stage 10 listener study is meant to fit or
//! replace this. Never present it as more than a proxy, and bump
//! [`WEIGHT_INDEX_VERSION`] whenever it changes.

/// Version of the weight index definition.
pub const WEIGHT_INDEX_VERSION: u32 = 1;

/// Smallest standard deviations used for z-scores (dB), so a very steady
/// baseline doesn't turn small changes into huge scores.
const MIN_SD_H1C_H2C_DB: f64 = 1.5;
const MIN_SD_ALPHA_DB: f64 = 1.0;
const MIN_SD_CPPS_DB: f64 = 0.75;

/// Mean and standard deviation of one feature in the baseline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FeatureStats {
    pub mean: f64,
    pub sd: f64,
}

impl FeatureStats {
    /// Population mean and SD of the values; `None` when empty.
    pub fn of(values: &[f64]) -> Option<Self> {
        if values.is_empty() {
            return None;
        }
        let n = values.len() as f64;
        let mean = values.iter().sum::<f64>() / n;
        let sd = (values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n).sqrt();
        Some(Self { mean, sd })
    }
}

/// The user's baseline for each feature.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeightBaseline {
    pub h1c_h2c_db: Option<FeatureStats>,
    pub alpha_ratio_db: Option<FeatureStats>,
    pub cpps_db: Option<FeatureStats>,
}

/// The features of the voice being scored.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct WeightFeatures {
    pub h1c_h2c_db: Option<f64>,
    pub alpha_ratio_db: Option<f64>,
    pub cpps_db: Option<f64>,
}

/// The weight index: the mean of the z-scores that both the features and
/// the baseline have. `None` when there are none. Live frames have no CPPS,
/// so a live index uses the other two.
pub fn weight_index(features: &WeightFeatures, baseline: &WeightBaseline) -> Option<f64> {
    let z = |value: Option<f64>, stats: Option<FeatureStats>, min_sd: f64, sign: f64| {
        let (v, s) = (value?, stats?);
        Some(sign * (v - s.mean) / s.sd.max(min_sd))
    };
    let zs: Vec<f64> = [
        z(
            features.h1c_h2c_db,
            baseline.h1c_h2c_db,
            MIN_SD_H1C_H2C_DB,
            -1.0,
        ),
        z(
            features.alpha_ratio_db,
            baseline.alpha_ratio_db,
            MIN_SD_ALPHA_DB,
            1.0,
        ),
        z(features.cpps_db, baseline.cpps_db, MIN_SD_CPPS_DB, 1.0),
    ]
    .into_iter()
    .flatten()
    .collect();
    (!zs.is_empty()).then(|| zs.iter().sum::<f64>() / zs.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn baseline() -> WeightBaseline {
        WeightBaseline {
            h1c_h2c_db: FeatureStats::of(&[2.0, 4.0, 6.0]),
            alpha_ratio_db: FeatureStats::of(&[-20.0, -18.0, -16.0]),
            cpps_db: FeatureStats::of(&[14.0, 15.0, 16.0]),
        }
    }

    #[test]
    fn baseline_itself_scores_zero() {
        let f = WeightFeatures {
            h1c_h2c_db: Some(4.0),
            alpha_ratio_db: Some(-18.0),
            cpps_db: Some(15.0),
        };
        assert!(weight_index(&f, &baseline()).unwrap().abs() < 1e-12);
    }

    #[test]
    fn lighter_and_heavier_have_the_right_sign() {
        let lighter = WeightFeatures {
            h1c_h2c_db: Some(10.0),
            alpha_ratio_db: Some(-24.0),
            cpps_db: Some(13.0),
        };
        let heavier = WeightFeatures {
            h1c_h2c_db: Some(-2.0),
            alpha_ratio_db: Some(-12.0),
            cpps_db: Some(17.0),
        };
        assert!(weight_index(&lighter, &baseline()).unwrap() < -1.0);
        assert!(weight_index(&heavier, &baseline()).unwrap() > 1.0);
    }

    #[test]
    fn uses_available_features_and_floors_the_sd() {
        let live = WeightFeatures {
            h1c_h2c_db: Some(4.0 - 1.5),
            alpha_ratio_db: None,
            cpps_db: None,
        };
        // SD of [2, 4, 6] is 1.63, above the 1.5 floor.
        let w = weight_index(&live, &baseline()).unwrap();
        assert!((w - 1.5 / (8.0f64 / 3.0).sqrt()).abs() < 1e-9, "{w}");
        let steady = WeightBaseline {
            h1c_h2c_db: FeatureStats::of(&[4.0, 4.0]),
            alpha_ratio_db: None,
            cpps_db: None,
        };
        assert!((weight_index(&live, &steady).unwrap() - 1.0).abs() < 1e-9);
        assert!(weight_index(&WeightFeatures::default(), &baseline()).is_none());
    }
}
