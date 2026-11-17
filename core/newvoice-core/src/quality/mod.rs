//! Voice quality: the weight, breathiness and clarity measures of handbook
//! §3.4.
//!
//! - [`spectral`]: per-frame H1–H2, H1*–H2*, alpha ratio, Hammarberg index
//!   and L/H ratio (live; carried on every voiced [`crate::Frame`]).
//! - [`cpps`], [`hnr`]: Praat-equivalent CPPS and HNR (batch).
//! - [`perturbation`]: local jitter and shimmer (batch).
//! - [`weight`]: the baseline-relative weight index (a heuristic).
//!
//! [`measure_quality`] runs them all on a finished utterance.

pub mod cpps;
pub mod hnr;
pub mod perturbation;
pub mod spectral;
pub mod weight;

use crate::analysis::{Analysis, Config, analyse};
use crate::units::median;
use cpps::{CppsConfig, CppsTrack, cpps_track};
use hnr::{HnrConfig, HnrTrack, hnr_track};
use perturbation::{PerturbationConfig, perturbation, track_pulses};

/// Version of the voice-quality definitions. Bump it whenever a measure's
/// definition changes (band edges, smoothing, aggregation), since stored
/// baselines are only comparable within one version.
pub const QUALITY_VERSION: u32 = 1;

/// Settings for [`measure_quality`].
#[derive(Debug, Clone, PartialEq, Default)]
pub struct QualityConfig {
    /// Frame analysis (pitch, voicing and the formants for H1*–H2*).
    pub analysis: Config,
    pub cpps: CppsConfig,
    pub hnr: HnrConfig,
    pub perturbation: PerturbationConfig,
}

/// Utterance-level voice quality, over voiced frames only.
#[derive(Debug, Clone, PartialEq)]
pub struct VoiceQuality {
    pub voiced_s: f64,
    /// Median H1 − H2 (dB).
    pub h1_h2_db: Option<f64>,
    /// Median H1* − H2* (dB), formant-corrected.
    pub h1c_h2c_db: Option<f64>,
    /// Mean alpha ratio (dB).
    pub alpha_ratio_db: Option<f64>,
    /// Mean Hammarberg index (dB).
    pub hammarberg_db: Option<f64>,
    /// Mean L/H ratio (dB).
    pub lh_ratio_db: Option<f64>,
    /// Mean CPPS (dB) over CPPS frames centred in voiced frames.
    pub cpps_db: Option<f64>,
    /// Mean HNR (dB) over HNR-voiced frames centred in voiced frames.
    pub hnr_db: Option<f64>,
    /// Local jitter and shimmer as fractions (0.01 = 1%).
    pub jitter_local: Option<f64>,
    pub shimmer_local: Option<f64>,
    /// Glottal periods the jitter and shimmer are based on.
    pub periods: usize,
}

/// Measures the voice quality of a finished utterance.
pub fn measure_quality(samples: &[f32], sample_rate: f64, cfg: &QualityConfig) -> VoiceQuality {
    let analysis = analyse(samples, sample_rate, &cfg.analysis);
    quality_of(&analysis, samples, cfg)
}

/// [`measure_quality`] for an utterance that has already been analysed with
/// `cfg.analysis`.
pub fn quality_of(analysis: &Analysis, samples: &[f32], cfg: &QualityConfig) -> VoiceQuality {
    let rate = analysis.sample_rate;
    quality_with_tracks(
        analysis,
        samples,
        cfg,
        &cpps_track(samples, rate, &cfg.cpps),
        &hnr_track(samples, rate, &cfg.hnr),
    )
}

/// [`quality_of`] with the CPPS and HNR tracks already computed.
pub fn quality_with_tracks(
    analysis: &Analysis,
    samples: &[f32],
    cfg: &QualityConfig,
    cpps: &CppsTrack,
    hnr: &HnrTrack,
) -> VoiceQuality {
    let rate = analysis.sample_rate;
    let voiced: Vec<_> = analysis
        .frames
        .iter()
        .filter(|f| f.f0_hz.is_some())
        .filter_map(|f| f.spectral)
        .collect();
    let collect = |get: fn(&spectral::FrameSpectral) -> Option<f64>| -> Vec<f64> {
        voiced.iter().filter_map(get).collect()
    };
    let mean = |v: Vec<f64>| (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64);

    let hop = analysis.hop_s;
    let is_voiced = |t: f64| {
        let k = (t / hop).round();
        k >= 0.0
            && analysis
                .frames
                .get(k as usize)
                .is_some_and(|f| f.f0_hz.is_some())
    };
    let pulses = track_pulses(samples, rate, &analysis.frames);
    let p = perturbation(samples, rate, &pulses, &cfg.perturbation);

    VoiceQuality {
        voiced_s: analysis.frames.iter().filter(|f| f.f0_hz.is_some()).count() as f64 * hop,
        h1_h2_db: median(&collect(|s| Some(s.h1_h2_db))),
        h1c_h2c_db: median(&collect(|s| s.h1c_h2c_db)),
        alpha_ratio_db: mean(collect(|s| Some(s.alpha_ratio_db))),
        hammarberg_db: mean(collect(|s| Some(s.hammarberg_db))),
        lh_ratio_db: mean(collect(|s| Some(s.lh_ratio_db))),
        cpps_db: cpps.mean_where(is_voiced),
        hnr_db: hnr.mean_where(is_voiced),
        jitter_local: p.jitter_local,
        shimmer_local: p.shimmer_local,
        periods: p.periods,
    }
}

impl VoiceQuality {
    /// This utterance's inputs to the [`weight::weight_index`].
    pub fn weight_features(&self) -> weight::WeightFeatures {
        weight::WeightFeatures {
            h1c_h2c_db: self.h1c_h2c_db,
            alpha_ratio_db: self.alpha_ratio_db,
            cpps_db: self.cpps_db,
        }
    }
}

impl spectral::FrameSpectral {
    /// This frame's inputs to the [`weight::weight_index`] (no CPPS live).
    pub fn weight_features(&self) -> weight::WeightFeatures {
        weight::WeightFeatures {
            h1c_h2c_db: self.h1c_h2c_db,
            alpha_ratio_db: Some(self.alpha_ratio_db),
            cpps_db: None,
        }
    }
}

/// The weight-index baseline of an utterance: the mean and spread of each
/// feature over its voiced frames (CPPS over CPPS frames centred in voiced
/// frames). Store it with the user's baseline recording.
pub fn weight_baseline(analysis: &Analysis, cpps: &CppsTrack) -> weight::WeightBaseline {
    let spectral: Vec<_> = analysis
        .frames
        .iter()
        .filter(|f| f.f0_hz.is_some())
        .filter_map(|f| f.spectral)
        .collect();
    let h1c: Vec<f64> = spectral.iter().filter_map(|s| s.h1c_h2c_db).collect();
    let alpha: Vec<f64> = spectral.iter().map(|s| s.alpha_ratio_db).collect();
    let hop = analysis.hop_s;
    let cpps_voiced: Vec<f64> = cpps
        .times_s
        .iter()
        .zip(&cpps.prominence_db)
        .filter(|(t, _)| {
            let k = (*t / hop).round();
            k >= 0.0
                && analysis
                    .frames
                    .get(k as usize)
                    .is_some_and(|f| f.f0_hz.is_some())
        })
        .map(|(_, p)| *p)
        .collect();
    weight::WeightBaseline {
        h1c_h2c_db: weight::FeatureStats::of(&h1c),
        alpha_ratio_db: weight::FeatureStats::of(&alpha),
        cpps_db: weight::FeatureStats::of(&cpps_voiced),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    #[test]
    fn breathier_voice_measures_as_breathier() {
        let rate = 44_100.0;
        let n = 44_100;
        let formants = [
            (600.0, 80.0),
            (1200.0, 90.0),
            (2600.0, 120.0),
            (3600.0, 150.0),
            (4500.0, 200.0),
        ];
        let modal = vowel(180.0, &formants, rate, n, 0.1);
        // "Breathy": a stronger fundamental, a steeper source and added noise.
        let contour = vec![180.0; n];
        let mut breathy = harmonic_source(&contour, rate);
        let fundamental: Vec<f64> = (0..n)
            .map(|i| (2.0 * std::f64::consts::PI * 180.0 * i as f64 / rate).sin())
            .collect();
        for (b, f) in breathy.iter_mut().zip(&fundamental) {
            *b = 0.3 * *b + 2.0 * f;
        }
        resonate(&mut breathy, &formants, rate);
        let peak = breathy.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        let breathy: Vec<f64> = breathy
            .iter()
            .zip(noise(0.04, n, 21))
            .map(|(v, e)| 0.5 * v / peak + e)
            .collect();

        let cfg = QualityConfig::default();
        let m = measure_quality(&to_f32(&modal), rate, &cfg);
        let b = measure_quality(&to_f32(&breathy), rate, &cfg);
        assert!(m.voiced_s > 0.9 && b.voiced_s > 0.9, "{m:?} {b:?}");
        assert!(
            b.h1_h2_db.unwrap() > m.h1_h2_db.unwrap() + 6.0,
            "{m:?} {b:?}"
        );
        assert!(
            b.h1c_h2c_db.unwrap() > m.h1c_h2c_db.unwrap() + 6.0,
            "{m:?} {b:?}"
        );
        assert!(
            b.alpha_ratio_db.unwrap() < m.alpha_ratio_db.unwrap(),
            "{m:?} {b:?}"
        );
        assert!(b.cpps_db.unwrap() < m.cpps_db.unwrap() - 2.0, "{m:?} {b:?}");
        assert!(b.hnr_db.unwrap() < m.hnr_db.unwrap() - 5.0, "{m:?} {b:?}");
        assert!(m.periods > 150, "{m:?}");
        assert!(m.jitter_local.unwrap() < 0.005, "{m:?}");

        // Against a modal baseline, the breathy voice scores lighter.
        let x = to_f32(&modal);
        let analysis = analyse(&x, rate, &cfg.analysis);
        let baseline = weight_baseline(&analysis, &cpps_track(&x, rate, &cfg.cpps));
        let w = weight::weight_index(&b.weight_features(), &baseline).unwrap();
        assert!(w < -1.0, "weight {w}");
        let own = weight::weight_index(&m.weight_features(), &baseline).unwrap();
        assert!(own.abs() < 0.5, "own weight {own}");
    }
}
