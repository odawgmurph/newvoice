//! Native bindings for the NewVoice analysis core.
//!
//! The Swift/Kotlin audio module (Stage 2) creates a [`LiveAnalyser`], pushes
//! microphone samples into it on its audio thread, and pulls frame results
//! for the UI. Only computed results cross back to JavaScript, never raw
//! audio. Finished recordings go through [`analyse_recording`] and
//! [`measure_sustained_vowel`].

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

use newvoice_core as core;
use newvoice_core::formant::FormantConfig;
use newvoice_core::units::hz_to_st;

uniffi::setup_scaffolding!();

/// Version of the analysis core linked into this build.
#[uniffi::export]
pub fn core_version() -> String {
    core::VERSION.to_owned()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PitchAlgorithm {
    Yin,
    Mpm,
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

/// The core's default settings.
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
    /// Provisional 0-1 trust in F1/F2; hide formant readouts when low.
    pub formant_confidence: f64,
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
        }
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
        confidence: m.confidence,
    }))
}

/// Live analysis: push microphone samples from the audio thread, pull frames
/// for the UI. Safe to share between threads.
#[derive(Debug, uniffi::Object)]
pub struct LiveAnalyser {
    inner: Mutex<core::StreamAnalyser>,
}

impl LiveAnalyser {
    fn lock(&self) -> MutexGuard<'_, core::StreamAnalyser> {
        // A panic while holding the lock can't leave the analyser in a state
        // worse than restarting it would, so ignore poisoning.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[uniffi::export]
impl LiveAnalyser {
    #[uniffi::constructor]
    pub fn new(sample_rate: u32, settings: AnalysisSettings) -> Result<Arc<Self>, AnalysisError> {
        let cfg = config(sample_rate, &settings)?;
        Ok(Arc::new(Self {
            inner: Mutex::new(core::StreamAnalyser::new(f64::from(sample_rate), cfg)),
        }))
    }

    /// Seconds from a frame's centre until it can be pulled (analysis only;
    /// excludes audio-buffer and display latency).
    pub fn latency_s(&self) -> f64 {
        self.lock().latency_s()
    }

    /// Adds mono samples. Ignored after `finish`.
    pub fn push(&self, samples: Vec<f32>) {
        let mut s = self.lock();
        if !s.is_finished() {
            s.push(&samples);
        }
    }

    /// Frames ready since the last pull, oldest first.
    pub fn pull(&self) -> Vec<FrameResult> {
        self.lock().drain().iter().map(FrameResult::from).collect()
    }

    /// Ends the stream and returns the remaining frames.
    pub fn finish(&self) -> Vec<FrameResult> {
        let mut s = self.lock();
        s.finish();
        s.drain().iter().map(FrameResult::from).collect()
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
    }

    #[test]
    fn formants_can_be_turned_off() {
        let mut s = default_settings();
        s.formant_ceiling_hz = None;
        let a = analyse_recording(tone(150.0, 16_000, 0.3), 16_000, s).unwrap();
        assert!(a.frames.iter().all(|f| f.formants.is_empty()));
    }
}
