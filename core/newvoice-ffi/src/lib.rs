//! Native bindings for the NewVoice analysis core.
//!
//! The Swift/Kotlin audio module (Stage 2) creates a [`LiveAnalyser`], pushes
//! microphone samples into it on its audio thread, and pulls frame results
//! for the UI. Only computed results cross back to JavaScript, never raw
//! audio. Finished recordings go through [`analyse_recording`] and
//! [`measure_sustained_vowel`].

use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

use newvoice_core as core;
use newvoice_core::formant::FormantConfig;
use newvoice_core::quality::{self as vq, QualityConfig};
use newvoice_core::units::hz_to_st;
use newvoice_core::utterance::{UtteranceAudio, UtteranceConfig, UtteranceContext};

uniffi::setup_scaffolding!();

/// Version of the analysis core linked into this build.
#[uniffi::export]
pub fn core_version() -> String {
    core::VERSION.to_owned()
}

/// Frames of look-ahead the live analyser holds before emitting a frame
/// (decision D16). Diagnostics exports record it so the harness can
/// reproduce the phone's streamed track.
#[uniffi::export]
pub fn live_lookahead_frames() -> u32 {
    core::Config::default().lookahead_frames as u32
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PitchAlgorithm {
    Yin,
    Mpm,
    /// Finished recordings only; `LiveAnalyser` rejects it.
    Pyin,
}

/// The settings an app can change. Everything else uses the core defaults.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AnalysisSettings {
    pub f0_min_hz: f64,
    pub f0_max_hz: f64,
    pub pitch_algorithm: PitchAlgorithm,
    /// Formant ceiling for live formants, ideally the one the user's
    /// baseline vowels chose. `None` turns formants off.
    pub formant_ceiling_hz: Option<f64>,
    /// Frames quieter than this (dB re a full-scale sine) count as silence.
    pub silence_dbfs: f64,
}

/// The core's default settings for live analysis.
#[uniffi::export]
pub fn default_settings() -> AnalysisSettings {
    let d = core::Config::default();
    AnalysisSettings {
        f0_min_hz: d.f0_min_hz,
        f0_max_hz: d.f0_max_hz,
        pitch_algorithm: PitchAlgorithm::Yin,
        formant_ceiling_hz: d.formants.map(|f| f.ceiling_hz),
        silence_dbfs: d.silence_dbfs,
    }
}

/// Default settings for scoring finished recordings: as
/// [`default_settings`], but with pYIN, which decodes the whole utterance.
#[uniffi::export]
pub fn default_recording_settings() -> AnalysisSettings {
    AnalysisSettings {
        pitch_algorithm: PitchAlgorithm::Pyin,
        ..default_settings()
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Error)]
pub enum AnalysisError {
    InvalidSettings { reason: String },
}

impl fmt::Display for AnalysisError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSettings { reason } => write!(f, "invalid settings: {reason}"),
        }
    }
}

impl std::error::Error for AnalysisError {}

fn invalid(reason: &str) -> AnalysisError {
    AnalysisError::InvalidSettings {
        reason: reason.to_owned(),
    }
}

fn config(sample_rate: u32, s: &AnalysisSettings) -> Result<core::Config, AnalysisError> {
    if sample_rate < 8_000 {
        return Err(invalid("sample rate must be at least 8000 Hz"));
    }
    if !(s.f0_min_hz >= 30.0 && s.f0_max_hz > s.f0_min_hz && s.f0_max_hz <= 2_000.0) {
        return Err(invalid("need 30 Hz <= f0_min_hz < f0_max_hz <= 2000 Hz"));
    }
    if let Some(c) = s.formant_ceiling_hz
        && !(3_000.0..=8_000.0).contains(&c)
    {
        return Err(invalid("formant ceiling must be 3000-8000 Hz"));
    }
    if !s.silence_dbfs.is_finite() {
        return Err(invalid("silence_dbfs must be finite"));
    }
    Ok(core::Config {
        f0_min_hz: s.f0_min_hz,
        f0_max_hz: s.f0_max_hz,
        pitch_algorithm: match s.pitch_algorithm {
            PitchAlgorithm::Yin => core::pitch::PitchAlgorithm::Yin,
            PitchAlgorithm::Mpm => core::pitch::PitchAlgorithm::Mpm,
            PitchAlgorithm::Pyin => core::pitch::PitchAlgorithm::Pyin,
        },
        formants: s.formant_ceiling_hz.map(|ceiling_hz| FormantConfig {
            ceiling_hz,
            ..FormantConfig::default()
        }),
        silence_dbfs: s.silence_dbfs,
        ..core::Config::default()
    })
}

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct Formant {
    pub frequency_hz: f64,
    pub bandwidth_hz: f64,
}

/// One analysis frame (every 10 ms).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FrameResult {
    pub time_s: f64,
    /// Relative level; compare with the user's own baseline only.
    pub level_dbfs: f64,
    pub periodicity: f64,
    pub voiced: bool,
    /// Smoothed F0, `None` when unvoiced or rejected as an octave jump.
    pub f0_hz: Option<f64>,
    /// The same F0 in semitones on the MIDI scale (A4 = 69).
    pub f0_st: Option<f64>,
    /// F1, F2, … lowest first. Empty when formants are off or it's silent.
    pub formants: Vec<Formant>,
    /// 0-1 trust in F1/F2 (about the chance both are within 10%); hide
    /// formant readouts when low.
    pub formant_confidence: f64,
    /// Spectral voice-quality measures, on frames with an F0 only.
    pub spectral: Option<FrameSpectral>,
    /// Live only: this frame's resonance score against the vowel set with
    /// `LiveAnalyser::set_feedback_context`. Gate it on `formant_confidence`.
    pub resonance: Option<f64>,
    /// Live only: this frame's weight index against the context baseline
    /// (H1*–H2* and alpha ratio; frames have no CPPS). A proxy only.
    pub weight_index: Option<f64>,
}

/// Per-frame spectral voice-quality measures (dB).
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct FrameSpectral {
    pub h1_db: f64,
    pub h2_db: f64,
    /// Higher = breathier / lighter.
    pub h1_h2_db: f64,
    /// H1 − H2 corrected for F1 and F2; `None` without both formants.
    pub h1c_h2c_db: Option<f64>,
    pub alpha_ratio_db: f64,
    pub hammarberg_db: f64,
    pub lh_ratio_db: f64,
}

impl From<&vq::spectral::FrameSpectral> for FrameSpectral {
    fn from(s: &vq::spectral::FrameSpectral) -> Self {
        Self {
            h1_db: s.h1_db,
            h2_db: s.h2_db,
            h1_h2_db: s.h1_h2_db,
            h1c_h2c_db: s.h1c_h2c_db,
            alpha_ratio_db: s.alpha_ratio_db,
            hammarberg_db: s.hammarberg_db,
            lh_ratio_db: s.lh_ratio_db,
        }
    }
}

impl From<&core::Frame> for FrameResult {
    fn from(f: &core::Frame) -> Self {
        Self {
            time_s: f.time_s,
            level_dbfs: f.level_dbfs,
            periodicity: f.periodicity,
            voiced: f.voiced,
            f0_hz: f.f0_hz,
            f0_st: f.f0_hz.map(hz_to_st),
            formants: f
                .formants
                .map(|fr| {
                    fr.as_slice()
                        .iter()
                        .map(|x| Formant {
                            frequency_hz: x.frequency_hz,
                            bandwidth_hz: x.bandwidth_hz,
                        })
                        .collect()
                })
                .unwrap_or_default(),
            formant_confidence: f.formant_confidence,
            spectral: f.spectral.as_ref().map(FrameSpectral::from),
            resonance: None,
            weight_index: None,
        }
    }
}

impl FrameResult {
    /// A live frame with its context scores.
    fn live(f: &core::Frame, ctx: &UtteranceContext) -> Self {
        let mut out = Self::from(f);
        out.resonance = ctx
            .vowel
            .and_then(|v| core::utterance::frame_resonance(f, v));
        out.weight_index = ctx.weight_baseline.and_then(|b| {
            f.spectral
                .and_then(|s| vq::weight::weight_index(&s.weight_features(), &b))
        });
        out
    }
}

/// Utterance pitch statistics over voiced frames (handbook §3.2).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PitchSummary {
    pub voiced_s: f64,
    pub median_hz: f64,
    pub median_st: f64,
    pub p10_st: f64,
    pub p90_st: f64,
    pub sd_st: f64,
    pub range_5_95_st: f64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RecordingAnalysis {
    pub core_version: String,
    pub duration_s: f64,
    pub frames: Vec<FrameResult>,
    /// `None` when nothing was voiced.
    pub pitch: Option<PitchSummary>,
}

/// Analyses a finished mono recording.
#[uniffi::export]
pub fn analyse_recording(
    samples: Vec<f32>,
    sample_rate: u32,
    settings: AnalysisSettings,
) -> Result<RecordingAnalysis, AnalysisError> {
    let cfg = config(sample_rate, &settings)?;
    let a = core::analyse(&samples, f64::from(sample_rate), &cfg);
    Ok(RecordingAnalysis {
        core_version: core::VERSION.to_owned(),
        duration_s: a.duration_s,
        frames: a.frames.iter().map(FrameResult::from).collect(),
        pitch: a.pitch_stats().map(|s| PitchSummary {
            voiced_s: s.voiced_s,
            median_hz: s.median_hz,
            median_st: s.median_st,
            p10_st: s.p10_st,
            p90_st: s.p90_st,
            sd_st: s.sd_st,
            range_5_95_st: s.range_5_95_st,
        }),
    })
}

/// A sustained vowel's steady-state formants and vocal tract length.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct VowelResult {
    pub core_version: String,
    pub f0_median_hz: f64,
    /// The ceiling the sweep chose; feed it to live analysis as
    /// `formant_ceiling_hz`.
    pub ceiling_hz: f64,
    pub f1_hz: Option<f64>,
    pub f2_hz: Option<f64>,
    pub f3_hz: Option<f64>,
    pub f4_hz: Option<f64>,
    pub delta_f_hz: Option<f64>,
    pub avtl_cm: Option<f64>,
    /// ΔF on the resonance score's scale (0 and 1 at the two reference
    /// groups' speaker-level ΔF).
    pub delta_f_position: Option<f64>,
    pub confidence: f64,
}

/// Measures the longest voiced stretch of a recording as a sustained vowel.
/// `None` when there's no voiced stretch of at least 0.25 s or no usable
/// formants.
#[uniffi::export]
pub fn measure_sustained_vowel(
    samples: Vec<f32>,
    sample_rate: u32,
) -> Result<Option<VowelResult>, AnalysisError> {
    if sample_rate < 8_000 {
        return Err(invalid("sample rate must be at least 8000 Hz"));
    }
    let m = core::measure_vowel(
        &samples,
        f64::from(sample_rate),
        &core::VowelConfig::default(),
    );
    Ok(m.map(|m| VowelResult {
        core_version: core::VERSION.to_owned(),
        f0_median_hz: m.f0_median_hz,
        ceiling_hz: m.ceiling_hz,
        f1_hz: m.formants_hz[0],
        f2_hz: m.formants_hz[1],
        f3_hz: m.formants_hz[2],
        f4_hz: m.formants_hz[3],
        delta_f_hz: m.delta_f_hz,
        avtl_cm: m.avtl_cm,
        delta_f_position: m.delta_f_hz.and_then(core::resonance::delta_f_position),
        confidence: m.confidence,
    }))
}

/// A measured vowel token for the resonance score.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ResonanceToken {
    /// Hillenbrand code (`"iy"`) or IPA (`"i"`) of the vowel the user was
    /// asked to produce.
    pub vowel: String,
    pub f1_hz: Option<f64>,
    pub f2_hz: Option<f64>,
    pub f3_hz: Option<f64>,
    /// Trust in the token, for example `VowelResult.confidence`.
    pub weight: f64,
}

/// The vowel-normalised resonance score: a heuristic position between two
/// reference group means (0 and 1), not a perception estimate. Label it
/// brighter/darker unless the user opted into gendered bands.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ResonanceResult {
    pub version: u32,
    pub score: f64,
    pub f1: Option<f64>,
    pub f2: Option<f64>,
    pub f3: Option<f64>,
    pub tokens_used: u32,
}

/// Scores vowel tokens. `None` when no token has a scorable formant; an
/// error for an unknown vowel.
#[uniffi::export]
pub fn resonance_score(
    tokens: Vec<ResonanceToken>,
) -> Result<Option<ResonanceResult>, AnalysisError> {
    let tokens = tokens
        .iter()
        .map(|t| {
            Ok(core::VowelToken {
                vowel: core::VowelNorm::find(&t.vowel)
                    .ok_or_else(|| invalid(&format!("unknown vowel {}", t.vowel)))?,
                formants_hz: [t.f1_hz, t.f2_hz, t.f3_hz],
                weight: t.weight,
            })
        })
        .collect::<Result<Vec<_>, AnalysisError>>()?;
    Ok(core::resonance_score(&tokens).map(|r| ResonanceResult {
        version: core::resonance::RESONANCE_SCORE_VERSION,
        score: r.score,
        f1: r.by_formant[0],
        f2: r.by_formant[1],
        f3: r.by_formant[2],
        tokens_used: r.tokens_used as u32,
    }))
}

/// A reference vowel the resonance score knows.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ReferenceVowel {
    pub code: String,
    pub ipa: String,
    /// The h_d word it was recorded in, for example "heed".
    pub word: String,
    /// Whether F1, F2, F3 count towards its score.
    pub scored_formants: Vec<bool>,
}

/// The vowels [`resonance_score`] accepts.
#[uniffi::export]
pub fn reference_vowels() -> Vec<ReferenceVowel> {
    core::VowelNorm::all()
        .iter()
        .map(|v| ReferenceVowel {
            code: v.code.to_owned(),
            ipa: v.ipa.to_owned(),
            word: v.word.to_owned(),
            scored_formants: (0..3).map(|k| v.scores_formant(k)).collect(),
        })
        .collect()
}

/// Mean and standard deviation of one feature.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct FeatureStats {
    pub mean: f64,
    pub sd: f64,
}

/// A user's weight-index baseline; store it with their baseline recording.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct WeightBaseline {
    pub h1c_h2c_db: Option<FeatureStats>,
    pub alpha_ratio_db: Option<FeatureStats>,
    pub cpps_db: Option<FeatureStats>,
}

/// The features a weight index is computed from.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct WeightFeatures {
    pub h1c_h2c_db: Option<f64>,
    pub alpha_ratio_db: Option<f64>,
    pub cpps_db: Option<f64>,
}

fn stats_in(s: Option<FeatureStats>) -> Option<vq::weight::FeatureStats> {
    s.map(|s| vq::weight::FeatureStats {
        mean: s.mean,
        sd: s.sd,
    })
}

fn baseline_in(b: WeightBaseline) -> vq::weight::WeightBaseline {
    vq::weight::WeightBaseline {
        h1c_h2c_db: stats_in(b.h1c_h2c_db),
        alpha_ratio_db: stats_in(b.alpha_ratio_db),
        cpps_db: stats_in(b.cpps_db),
    }
}

fn stats_out(s: Option<vq::weight::FeatureStats>) -> Option<FeatureStats> {
    s.map(|s| FeatureStats {
        mean: s.mean,
        sd: s.sd,
    })
}

/// Utterance voice quality (handbook §3.4).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct VoiceQualityResult {
    pub core_version: String,
    /// Stored values are only comparable within one version.
    pub quality_version: u32,
    pub weight_index_version: u32,
    pub voiced_s: f64,
    pub h1_h2_db: Option<f64>,
    pub h1c_h2c_db: Option<f64>,
    pub alpha_ratio_db: Option<f64>,
    pub hammarberg_db: Option<f64>,
    pub lh_ratio_db: Option<f64>,
    pub cpps_db: Option<f64>,
    pub hnr_db: Option<f64>,
    /// Fractions (0.01 = 1%).
    pub jitter_local: Option<f64>,
    pub shimmer_local: Option<f64>,
    pub periods: u32,
    /// This utterance's features for `weight_index`.
    pub weight_features: WeightFeatures,
    /// This utterance as a weight baseline (use for the baseline recording).
    pub weight_baseline: WeightBaseline,
}

/// Measures the voice quality of a finished mono utterance.
#[uniffi::export]
pub fn measure_voice_quality(
    samples: Vec<f32>,
    sample_rate: u32,
    settings: AnalysisSettings,
) -> Result<VoiceQualityResult, AnalysisError> {
    let cfg = QualityConfig {
        analysis: config(sample_rate, &settings)?,
        ..QualityConfig::default()
    };
    let rate = f64::from(sample_rate);
    let analysis = core::analyse(&samples, rate, &cfg.analysis);
    let cpps = vq::cpps::cpps_track(&samples, rate, &cfg.cpps);
    let hnr = vq::hnr::hnr_track(&samples, rate, &cfg.hnr);
    let q = vq::quality_with_tracks(&analysis, &samples, &cfg, &cpps, &hnr);
    let baseline = vq::weight_baseline(&analysis, &cpps);
    let features = q.weight_features();
    Ok(VoiceQualityResult {
        core_version: core::VERSION.to_owned(),
        quality_version: vq::QUALITY_VERSION,
        weight_index_version: vq::weight::WEIGHT_INDEX_VERSION,
        voiced_s: q.voiced_s,
        h1_h2_db: q.h1_h2_db,
        h1c_h2c_db: q.h1c_h2c_db,
        alpha_ratio_db: q.alpha_ratio_db,
        hammarberg_db: q.hammarberg_db,
        lh_ratio_db: q.lh_ratio_db,
        cpps_db: q.cpps_db,
        hnr_db: q.hnr_db,
        jitter_local: q.jitter_local,
        shimmer_local: q.shimmer_local,
        periods: u32::try_from(q.periods).unwrap_or(u32::MAX),
        weight_features: WeightFeatures {
            h1c_h2c_db: features.h1c_h2c_db,
            alpha_ratio_db: features.alpha_ratio_db,
            cpps_db: features.cpps_db,
        },
        weight_baseline: WeightBaseline {
            h1c_h2c_db: stats_out(baseline.h1c_h2c_db),
            alpha_ratio_db: stats_out(baseline.alpha_ratio_db),
            cpps_db: stats_out(baseline.cpps_db),
        },
    })
}

/// The heuristic weight index (handbook §3.4): positive = heavier than the
/// baseline, negative = lighter, in baseline standard deviations. Live
/// frames give `h1c_h2c_db` and `alpha_ratio_db` only. `None` when no
/// feature is available in both. Unvalidated: present it as a proxy only.
#[uniffi::export]
pub fn weight_index(features: WeightFeatures, baseline: WeightBaseline) -> Option<f64> {
    vq::weight::weight_index(
        &vq::weight::WeightFeatures {
            h1c_h2c_db: features.h1c_h2c_db,
            alpha_ratio_db: features.alpha_ratio_db,
            cpps_db: features.cpps_db,
        },
        &baseline_in(baseline),
    )
}

/// One finished utterance's measures (handbook §3.1–3.5), computed with the
/// same batch analysis as finished recordings.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct UtteranceSummary {
    /// Stream times of the first and last voiced frames, seconds.
    pub start_s: f64,
    pub end_s: f64,
    pub voiced_s: f64,
    /// At least 1 s voiced: utterance scores may be shown.
    pub scored: bool,
    pub pitch: Option<PitchSummary>,
    /// F0 slope over the last 300 ms of voicing, ST/s.
    pub terminal_slope_st_per_s: Option<f64>,
    pub f1_hz: Option<f64>,
    pub f2_hz: Option<f64>,
    pub f3_hz: Option<f64>,
    pub formant_confidence: f64,
    /// Against the context vowel, when set.
    pub resonance: Option<f64>,
    /// Against the context weight baseline, when set.
    pub weight_index: Option<f64>,
    pub h1c_h2c_db: Option<f64>,
    pub alpha_ratio_db: Option<f64>,
    pub cpps_db: Option<f64>,
    pub hnr_db: Option<f64>,
    /// Fractions (0.01 = 1%).
    pub jitter_local: Option<f64>,
    pub shimmer_local: Option<f64>,
    pub periods: u32,
}

impl From<&core::UtteranceSummary> for UtteranceSummary {
    fn from(u: &core::UtteranceSummary) -> Self {
        let q = &u.quality;
        Self {
            start_s: u.start_s,
            end_s: u.end_s,
            voiced_s: u.voiced_s,
            scored: u.scored,
            pitch: u.pitch.as_ref().map(|s| PitchSummary {
                voiced_s: s.voiced_s,
                median_hz: s.median_hz,
                median_st: s.median_st,
                p10_st: s.p10_st,
                p90_st: s.p90_st,
                sd_st: s.sd_st,
                range_5_95_st: s.range_5_95_st,
            }),
            terminal_slope_st_per_s: u.terminal_slope_st_per_s,
            f1_hz: u.formants_hz[0],
            f2_hz: u.formants_hz[1],
            f3_hz: u.formants_hz[2],
            formant_confidence: u.formant_confidence,
            resonance: u.resonance,
            weight_index: u.weight_index,
            h1c_h2c_db: q.h1c_h2c_db,
            alpha_ratio_db: q.alpha_ratio_db,
            cpps_db: q.cpps_db,
            hnr_db: q.hnr_db,
            jitter_local: q.jitter_local,
            shimmer_local: q.shimmer_local,
            periods: u32::try_from(q.periods).unwrap_or(u32::MAX),
        }
    }
}

/// Finished utterances waiting for `pull_utterances`; older ones are dropped
/// beyond this, so an app that never pulls doesn't grow without bound.
const MAX_PENDING_UTTERANCES: usize = 8;

#[derive(Debug)]
struct Live {
    stream: core::StreamAnalyser,
    segmenter: core::UtteranceSegmenter,
    context: UtteranceContext,
}

/// Live analysis: push microphone samples from the audio thread, pull frames
/// for the UI. Safe to share between threads.
///
/// It also cuts the stream into utterances (an unvoiced gap of 300 ms ends
/// one). `pull_utterances` measures the finished ones; call it from a
/// lower-priority thread than `push`/`pull`, since it runs the batch
/// analysis and never holds the analyser's lock while doing so.
#[derive(Debug, uniffi::Object)]
pub struct LiveAnalyser {
    inner: Mutex<Live>,
    pending: Mutex<VecDeque<(UtteranceAudio, UtteranceContext)>>,
    config: core::Config,
}

/// Ignores poisoning: a panic while holding a lock can't leave the analyser
/// in a state worse than restarting it would.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl LiveAnalyser {
    fn lock(&self) -> MutexGuard<'_, Live> {
        lock(&self.inner)
    }

    /// Converts emitted frames, feeds them to the segmenter and queues any
    /// finished utterances. Call with the analyser locked.
    fn take_frames(&self, live: &mut Live, frames: Vec<core::Frame>) -> Vec<FrameResult> {
        let out = frames
            .iter()
            .map(|f| {
                live.segmenter.push_frame(f);
                FrameResult::live(f, &live.context)
            })
            .collect();
        self.queue_finished(live);
        out
    }

    fn queue_finished(&self, live: &mut Live) {
        if live.segmenter.pending() == 0 {
            return;
        }
        let mut pending = lock(&self.pending);
        while let Some(u) = live.segmenter.pop() {
            pending.push_back((u, live.context));
            while pending.len() > MAX_PENDING_UTTERANCES {
                pending.pop_front();
            }
        }
    }
}

#[uniffi::export]
impl LiveAnalyser {
    #[uniffi::constructor]
    pub fn new(sample_rate: u32, settings: AnalysisSettings) -> Result<Arc<Self>, AnalysisError> {
        if settings.pitch_algorithm == PitchAlgorithm::Pyin {
            return Err(invalid(
                "pYIN needs the whole utterance; use analyse_recording",
            ));
        }
        let cfg = config(sample_rate, &settings)?;
        let rate = f64::from(sample_rate);
        Ok(Arc::new(Self {
            inner: Mutex::new(Live {
                stream: core::StreamAnalyser::new(rate, cfg.clone()),
                segmenter: core::UtteranceSegmenter::new(rate, UtteranceConfig::default()),
                context: UtteranceContext::default(),
            }),
            pending: Mutex::new(VecDeque::new()),
            config: cfg,
        }))
    }

    /// What frames and utterances are scored against from now on: the
    /// vowel an exercise asks for (Hillenbrand code or IPA; enables
    /// resonance scores) and the user's weight baseline (enables weight
    /// indexes). `None` turns each off. An unknown vowel is an error.
    pub fn set_feedback_context(
        &self,
        vowel: Option<String>,
        weight_baseline: Option<WeightBaseline>,
    ) -> Result<(), AnalysisError> {
        let vowel = vowel
            .map(|v| {
                core::VowelNorm::find(&v).ok_or_else(|| invalid(&format!("unknown vowel {v}")))
            })
            .transpose()?;
        self.lock().context = UtteranceContext {
            vowel,
            weight_baseline: weight_baseline.map(baseline_in),
        };
        Ok(())
    }

    /// Measures the utterances finished since the last call, oldest first.
    /// Runs the batch analysis without holding the analyser's lock.
    pub fn pull_utterances(&self) -> Vec<UtteranceSummary> {
        let ready: Vec<_> = lock(&self.pending).drain(..).collect();
        let qcfg = QualityConfig {
            analysis: self.config.clone(),
            ..QualityConfig::default()
        };
        let ucfg = UtteranceConfig::default();
        ready
            .iter()
            .map(|(u, ctx)| UtteranceSummary::from(&core::summarise(u, &qcfg, &ucfg, ctx)))
            .collect()
    }

    /// Seconds from a frame's centre until it can be pulled (analysis only;
    /// excludes audio-buffer and display latency).
    pub fn latency_s(&self) -> f64 {
        self.lock().stream.latency_s()
    }

    /// Adds mono samples. Ignored after `finish`.
    pub fn push(&self, samples: Vec<f32>) {
        let mut live = self.lock();
        if !live.stream.is_finished() {
            live.stream.push(&samples);
            live.segmenter.push_samples(&samples);
        }
    }

    /// Frames ready since the last pull, oldest first.
    pub fn pull(&self) -> Vec<FrameResult> {
        let mut live = self.lock();
        let frames = live.stream.drain();
        self.take_frames(&mut live, frames)
    }

    /// Ends the stream and returns the remaining frames. The last utterance
    /// is closed too; collect it with `pull_utterances`.
    pub fn finish(&self) -> Vec<FrameResult> {
        let mut live = self.lock();
        live.stream.finish();
        let frames = live.stream.drain();
        let out = self.take_frames(&mut live, frames);
        live.segmenter.finish();
        self.queue_finished(&mut live);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(f0: f64, rate: u32, seconds: f64) -> Vec<f32> {
        let n = (seconds * f64::from(rate)) as usize;
        (0..n)
            .map(|i| {
                let t = i as f64 / f64::from(rate);
                (1..=10)
                    .map(|k| (2.0 * std::f64::consts::PI * k as f64 * f0 * t).sin() / k as f64)
                    .sum::<f64>() as f32
                    * 0.2
            })
            .collect()
    }

    #[test]
    fn reports_core_version() {
        assert_eq!(core_version(), newvoice_core::VERSION);
    }

    #[test]
    fn live_and_batch_agree() {
        let x = tone(196.0, 48_000, 0.5);
        let batch = analyse_recording(x.clone(), 48_000, default_settings()).unwrap();
        let live = LiveAnalyser::new(48_000, default_settings()).unwrap();
        assert!(live.latency_s() < 0.1);
        let mut frames = Vec::new();
        for chunk in x.chunks(480) {
            live.push(chunk.to_vec());
            frames.extend(live.pull());
        }
        frames.extend(live.finish());
        live.push(vec![0.0; 100]); // ignored after finish
        assert_eq!(frames, batch.frames);
        let p = batch.pitch.unwrap();
        assert!((p.median_hz / 196.0 - 1.0).abs() < 0.01);
        assert!((p.median_st - hz_to_st(196.0)).abs() < 0.1);
    }

    #[test]
    fn rejects_bad_settings() {
        let mut s = default_settings();
        s.f0_min_hz = 600.0;
        assert!(LiveAnalyser::new(48_000, s).is_err());
        assert!(analyse_recording(vec![], 4_000, default_settings()).is_err());
        let mut s = default_settings();
        s.formant_ceiling_hz = Some(20_000.0);
        assert!(analyse_recording(vec![], 48_000, s).is_err());
        assert!(LiveAnalyser::new(48_000, default_recording_settings()).is_err());
    }

    #[test]
    fn resonance_scores_tokens() {
        let token = |vowel: &str, f2| ResonanceToken {
            vowel: vowel.into(),
            f1_hz: None,
            f2_hz: Some(f2),
            f3_hz: None,
            weight: 1.0,
        };
        let men = resonance_score(vec![token("iy", 2322.0)]).unwrap().unwrap();
        let women = resonance_score(vec![token("i", 2761.0)]).unwrap().unwrap();
        assert!(men.score.abs() < 0.05 && (women.score - 1.0).abs() < 0.05);
        assert_eq!(women.tokens_used, 1);
        assert!(resonance_score(vec![token("zz", 2000.0)]).is_err());
        assert_eq!(resonance_score(vec![]).unwrap(), None);
        let vowels = reference_vowels();
        assert_eq!(vowels.len(), 12);
        let uw = vowels.iter().find(|v| v.code == "uw").unwrap();
        assert_eq!(uw.scored_formants, [true, false, true]);
    }

    #[test]
    fn recordings_can_use_pyin() {
        let x = tone(196.0, 48_000, 0.5);
        let a = analyse_recording(x, 48_000, default_recording_settings()).unwrap();
        let p = a.pitch.unwrap();
        assert!((p.median_hz / 196.0 - 1.0).abs() < 0.01, "{p:?}");
        assert!(p.voiced_s > 0.4, "{p:?}");
    }

    #[test]
    fn voice_quality_and_weight_index() {
        let x = tone(180.0, 44_100, 1.0);
        let q = measure_voice_quality(x, 44_100, default_settings()).unwrap();
        assert!(q.voiced_s > 0.8, "{q:?}");
        assert!(q.cpps_db.is_some() && q.hnr_db.is_some() && q.jitter_local.is_some());
        assert_eq!(q.quality_version, vq::QUALITY_VERSION);
        // An utterance scored against itself as baseline is at about zero.
        let w = weight_index(q.weight_features, q.weight_baseline).unwrap();
        assert!(w.abs() < 0.5, "{w}");
        let empty = WeightFeatures {
            h1c_h2c_db: None,
            alpha_ratio_db: None,
            cpps_db: None,
        };
        assert!(weight_index(empty, q.weight_baseline).is_none());
    }

    #[test]
    fn live_frames_carry_spectral_measures() {
        let live = LiveAnalyser::new(16_000, default_settings()).unwrap();
        live.push(tone(150.0, 16_000, 0.5));
        let frames = live.finish();
        assert!(
            frames
                .iter()
                .filter(|f| f.f0_hz.is_some())
                .all(|f| f.spectral.is_some())
        );
        assert!(frames.iter().any(|f| f.spectral.is_some()));
    }

    fn speech(rate: u32) -> Vec<f32> {
        let gap = vec![0.0f32; (rate / 2) as usize];
        let mut x = gap.clone();
        x.extend(tone(196.0, rate, 1.5));
        x.extend(&gap);
        x.extend(tone(147.0, rate, 1.2));
        x.extend(&gap);
        x
    }

    fn stream_all(live: &LiveAnalyser, x: &[f32]) -> Vec<FrameResult> {
        let mut frames = Vec::new();
        for chunk in x.chunks(240) {
            live.push(chunk.to_vec());
            frames.extend(live.pull());
        }
        frames
    }

    #[test]
    fn live_utterances_are_summarised() {
        let live = LiveAnalyser::new(44_100, default_settings()).unwrap();
        stream_all(&live, &speech(44_100));
        // Both utterances end with a 0.5 s gap, before finish.
        let u = live.pull_utterances();
        assert_eq!(u.len(), 2, "{u:#?}");
        assert!(live.pull_utterances().is_empty());
        assert!(u.iter().all(|u| u.scored));
        let medians: Vec<f64> = u
            .iter()
            .map(|u| u.pitch.as_ref().unwrap().median_hz)
            .collect();
        assert!((medians[0] / 196.0 - 1.0).abs() < 0.01, "{medians:?}");
        assert!((medians[1] / 147.0 - 1.0).abs() < 0.01, "{medians:?}");
        assert!(
            u[0].start_s > 0.45 && u[0].start_s < 0.55,
            "{}",
            u[0].start_s
        );
        assert!(
            u[0].jitter_local.is_some() && u[0].cpps_db.is_some(),
            "{:#?}",
            u[0]
        );
        assert!(
            u.iter()
                .all(|u| u.resonance.is_none() && u.weight_index.is_none())
        );
    }

    #[test]
    fn finish_closes_the_last_utterance() {
        let live = LiveAnalyser::new(16_000, default_settings()).unwrap();
        stream_all(&live, &tone(180.0, 16_000, 1.2));
        assert!(live.pull_utterances().is_empty());
        live.finish();
        assert_eq!(live.pull_utterances().len(), 1);
    }

    #[test]
    fn context_adds_resonance_and_weight() {
        let live = LiveAnalyser::new(16_000, default_settings()).unwrap();
        assert!(live.set_feedback_context(Some("zz".into()), None).is_err());
        let base = measure_voice_quality(tone(196.0, 16_000, 1.0), 16_000, default_settings())
            .unwrap()
            .weight_baseline;
        live.set_feedback_context(Some("ah".into()), Some(base))
            .unwrap();
        let frames = stream_all(&live, &speech(16_000));
        assert!(frames.iter().any(|f| f.resonance.is_some()));
        assert!(frames.iter().any(|f| f.weight_index.is_some()));
        assert!(
            frames
                .iter()
                .filter(|f| f.spectral.is_none())
                .all(|f| f.weight_index.is_none())
        );
        let u = live.pull_utterances();
        assert!(u.iter().all(|u| u.weight_index.is_some()), "{u:#?}");
        // Turning the context off stops the scores.
        live.set_feedback_context(None, None).unwrap();
        let frames = stream_all(&live, &speech(16_000));
        assert!(
            frames
                .iter()
                .all(|f| f.resonance.is_none() && f.weight_index.is_none())
        );
    }

    #[test]
    fn pending_utterances_are_capped() {
        let live = LiveAnalyser::new(16_000, default_settings()).unwrap();
        let mut x = Vec::new();
        for _ in 0..12 {
            x.extend(tone(180.0, 16_000, 0.3));
            x.extend(vec![0.0f32; 8_000]);
        }
        stream_all(&live, &x);
        assert_eq!(live.pull_utterances().len(), MAX_PENDING_UTTERANCES);
    }

    #[test]
    fn formants_can_be_turned_off() {
        let mut s = default_settings();
        s.formant_ceiling_hz = None;
        let a = analyse_recording(tone(150.0, 16_000, 0.3), 16_000, s).unwrap();
        assert!(a.frames.iter().all(|f| f.formants.is_empty()));
    }
}
