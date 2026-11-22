//! Utterances from live audio, and their summary measures (Stage 3).
//!
//! The feedback engine scores whole utterances, not frames (handbook §3.1:
//! "compute statistics only on voiced frames, requiring ≥ 1–2 s of voiced
//! audio for utterance-level scores"), and the strain monitor watches how
//! utterance-level jitter, shimmer and CPPS move over a session (handbook
//! §2.4). [`UtteranceSegmenter`] cuts a live frame stream into utterances
//! and keeps their audio; [`summarise`] measures one with the same batch code
//! that scores finished recordings, so a live utterance and the same audio
//! analysed as a recording get the same numbers.

use std::collections::VecDeque;

use crate::analysis::{Analysis, Frame, analyse};
use crate::quality::cpps::cpps_track;
use crate::quality::hnr::hnr_track;
use crate::quality::weight::{WeightBaseline, weight_index};
use crate::quality::{QualityConfig, VoiceQuality, quality_with_tracks};
use crate::resonance::{VowelNorm, VowelToken, resonance_score};
use crate::units::{PitchStats, hz_to_st, median};

/// Version of the utterance summary definition (segmentation, the terminal
/// slope, the formant medians). Bump it when any of them changes.
pub const UTTERANCE_VERSION: u32 = 1;

/// Formant medians and the resonance score only use frames at least this
/// confident (about a 50% chance of a >10% error, the readout threshold the
/// capture spike already uses).
pub const MIN_FORMANT_CONFIDENCE: f64 = 0.5;

/// How live audio is cut into utterances.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UtteranceConfig {
    /// An unvoiced gap this long ends an utterance. Pauses between phrases
    /// in read speech are mostly over 250 ms, stop closures under 150 ms.
    pub end_gap_s: f64,
    /// Longer voiced stretches are split, so a summary arrives at least this
    /// often and the audio kept stays bounded.
    pub max_s: f64,
    /// Utterance scores need at least this much voiced audio (handbook
    /// §3.1, 1–2 s); shorter utterances are summarised but not scored.
    pub min_voiced_s: f64,
    /// Audio kept before the first and after the last voiced frame, so the
    /// batch analysis sees the voicing edges with their context.
    pub margin_s: f64,
}

impl Default for UtteranceConfig {
    fn default() -> Self {
        Self {
            end_gap_s: 0.3,
            max_s: 12.0,
            min_voiced_s: 1.0,
            margin_s: 0.05,
        }
    }
}

/// One utterance's audio, cut from the stream.
#[derive(Debug, Clone, PartialEq)]
pub struct UtteranceAudio {
    /// Stream time of `samples[0]`, seconds.
    pub audio_start_s: f64,
    /// Stream times of the first and last voiced frames.
    pub start_s: f64,
    pub end_s: f64,
    pub sample_rate: f64,
    pub samples: Vec<f32>,
}

/// Cuts a live stream into utterances. Push every sample the analyser gets
/// (`push_samples`) and every frame it emits (`push_frame`), in order;
/// finished utterances come out of `pop`.
#[derive(Debug, Clone)]
pub struct UtteranceSegmenter {
    cfg: UtteranceConfig,
    rate: f64,
    buf: VecDeque<f32>,
    /// Absolute index of `buf[0]`.
    first: i64,
    total: i64,
    /// First and last voiced frame times of the open utterance.
    open: Option<(f64, f64)>,
    done: VecDeque<UtteranceAudio>,
}

/// Audio kept while no utterance is open: frames arrive about 80 ms after
/// their centre, so the start of an utterance must still be in the buffer.
const IDLE_KEEP_S: f64 = 0.5;

impl UtteranceSegmenter {
    pub fn new(sample_rate: f64, cfg: UtteranceConfig) -> Self {
        Self {
            cfg,
            rate: sample_rate,
            buf: VecDeque::new(),
            first: 0,
            total: 0,
            open: None,
            done: VecDeque::new(),
        }
    }

    pub fn config(&self) -> &UtteranceConfig {
        &self.cfg
    }

    pub fn push_samples(&mut self, samples: &[f32]) {
        self.buf.extend(samples);
        self.total += samples.len() as i64;
        let keep_from = match self.open {
            Some((start, _)) => self.index(start - self.cfg.margin_s),
            None => self.total - (IDLE_KEEP_S * self.rate) as i64,
        };
        self.trim(keep_from);
    }

    /// Feeds one emitted frame (in order). A frame with an F0 is voiced.
    pub fn push_frame(&mut self, frame: &Frame) {
        let t = frame.time_s;
        let voiced = frame.f0_hz.is_some();
        match self.open {
            None if voiced => self.open = Some((t, t)),
            None => {}
            Some((start, _)) if voiced => {
                self.open = Some((start, t));
                if t - start >= self.cfg.max_s {
                    self.close();
                }
            }
            Some((_, last)) => {
                if t - last >= self.cfg.end_gap_s {
                    self.close();
                }
            }
        }
    }

    /// Ends the stream, closing an open utterance.
    pub fn finish(&mut self) {
        if self.open.is_some() {
            self.close();
        }
    }

    pub fn pop(&mut self) -> Option<UtteranceAudio> {
        self.done.pop_front()
    }

    /// Finished utterances waiting to be popped.
    pub fn pending(&self) -> usize {
        self.done.len()
    }

    fn index(&self, t: f64) -> i64 {
        (t * self.rate).floor() as i64
    }

    fn trim(&mut self, keep_from: i64) {
        while self.first < keep_from && self.buf.pop_front().is_some() {
            self.first += 1;
        }
    }

    fn close(&mut self) {
        let Some((start, last)) = self.open.take() else {
            return;
        };
        let lo = self.index(start - self.cfg.margin_s).max(self.first);
        let hi = (self.index(last + self.cfg.margin_s) + 1).min(self.total);
        let samples: Vec<f32> = if hi > lo {
            self.buf
                .range((lo - self.first) as usize..(hi - self.first) as usize)
                .copied()
                .collect()
        } else {
            Vec::new()
        };
        self.done.push_back(UtteranceAudio {
            audio_start_s: lo as f64 / self.rate,
            start_s: start,
            end_s: last,
            sample_rate: self.rate,
            samples,
        });
        self.trim(self.total - (IDLE_KEEP_S * self.rate) as i64);
    }
}

/// What an utterance is scored against, when known.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct UtteranceContext {
    /// The vowel the user was asked to produce, for the resonance score.
    pub vowel: Option<&'static VowelNorm>,
    /// The user's weight-index baseline.
    pub weight_baseline: Option<WeightBaseline>,
}

/// One utterance's measures.
#[derive(Debug, Clone, PartialEq)]
pub struct UtteranceSummary {
    /// Stream times of the first and last voiced frames.
    pub start_s: f64,
    pub end_s: f64,
    pub voiced_s: f64,
    /// Enough voiced audio for utterance scores (`min_voiced_s`).
    pub scored: bool,
    pub pitch: Option<PitchStats>,
    /// F0 slope over the last 300 ms of voicing, ST/s (handbook §3.5: a
    /// rising terminal contour is above +2 ST/s). `None` with fewer than
    /// 10 voiced frames there.
    pub terminal_slope_st_per_s: Option<f64>,
    /// Median F1–F3 over confident voiced frames.
    pub formants_hz: [Option<f64>; 3],
    /// Median formant confidence over voiced frames (0 when none).
    pub formant_confidence: f64,
    /// Resonance score against the context vowel.
    pub resonance: Option<f64>,
    pub quality: VoiceQuality,
    /// Weight index against the context baseline (positive = heavier).
    pub weight_index: Option<f64>,
}

/// Measures one utterance with the batch analysis of `cfg.analysis`.
pub fn summarise(
    u: &UtteranceAudio,
    cfg: &QualityConfig,
    ucfg: &UtteranceConfig,
    ctx: &UtteranceContext,
) -> UtteranceSummary {
    let rate = u.sample_rate;
    let analysis = analyse(&u.samples, rate, &cfg.analysis);
    let cpps = cpps_track(&u.samples, rate, &cfg.cpps);
    let hnr = hnr_track(&u.samples, rate, &cfg.hnr);
    let quality = quality_with_tracks(&analysis, &u.samples, cfg, &cpps, &hnr);
    let pitch = analysis.pitch_stats();
    let voiced_s = pitch.as_ref().map_or(0.0, |p| p.voiced_s);

    let voiced: Vec<&Frame> = analysis
        .frames
        .iter()
        .filter(|f| f.f0_hz.is_some())
        .collect();
    let formant_confidence = median(
        &voiced
            .iter()
            .map(|f| f.formant_confidence)
            .collect::<Vec<_>>(),
    )
    .unwrap_or(0.0);
    let formants_hz: [Option<f64>; 3] = std::array::from_fn(|k| {
        median(
            &voiced
                .iter()
                .filter(|f| f.formant_confidence >= MIN_FORMANT_CONFIDENCE)
                .filter_map(|f| f.formants.and_then(|fr| fr.frequency(k)))
                .collect::<Vec<_>>(),
        )
    });
    let resonance = ctx.vowel.and_then(|vowel| {
        resonance_score(&[VowelToken {
            vowel,
            formants_hz,
            weight: 1.0,
        }])
        .map(|r| r.score)
    });
    let weight_index = ctx
        .weight_baseline
        .and_then(|b| weight_index(&quality.weight_features(), &b));

    UtteranceSummary {
        start_s: u.start_s,
        end_s: u.end_s,
        voiced_s,
        scored: voiced_s + 1e-9 >= ucfg.min_voiced_s,
        terminal_slope_st_per_s: terminal_slope(&analysis),
        pitch,
        formants_hz,
        formant_confidence,
        resonance,
        quality,
        weight_index,
    }
}

/// Least-squares F0 slope (ST/s) over the voiced frames in the last 300 ms
/// before the last voiced frame.
fn terminal_slope(a: &Analysis) -> Option<f64> {
    let pts: Vec<(f64, f64)> = a
        .frames
        .iter()
        .filter_map(|f| f.f0_hz.map(|hz| (f.time_s, hz_to_st(hz))))
        .collect();
    let end = pts.last()?.0;
    let tail: Vec<(f64, f64)> = pts.into_iter().filter(|p| p.0 > end - 0.3).collect();
    if tail.len() < 10 {
        return None;
    }
    let n = tail.len() as f64;
    let mt = tail.iter().map(|p| p.0).sum::<f64>() / n;
    let ms = tail.iter().map(|p| p.1).sum::<f64>() / n;
    let sxy: f64 = tail.iter().map(|p| (p.0 - mt) * (p.1 - ms)).sum();
    let sxx: f64 = tail.iter().map(|p| (p.0 - mt).powi(2)).sum();
    (sxx > 0.0).then(|| sxy / sxx)
}

/// Resonance score of a single frame's F1–F3 against a vowel, for the live
/// pitch × resonance map. Gate it on the frame's formant confidence.
pub fn frame_resonance(frame: &Frame, vowel: &'static VowelNorm) -> Option<f64> {
    let fr = frame.formants?;
    resonance_score(&[VowelToken {
        vowel,
        formants_hz: std::array::from_fn(|k| fr.frequency(k)),
        weight: 1.0,
    }])
    .map(|r| r.score)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{Config, StreamAnalyser};
    use crate::testsig::{harmonic_source, noise};
    use crate::units::st_to_hz;

    const RATE: f64 = 16_000.0;

    fn silence(s: f64) -> Vec<f64> {
        vec![0.0; (s * RATE) as usize]
    }

    fn tone(f0_start: f64, f0_end: f64, s: f64) -> Vec<f64> {
        let n = (s * RATE) as usize;
        let f0: Vec<f64> = (0..n)
            .map(|i| f0_start * (f0_end / f0_start).powf(i as f64 / n as f64))
            .collect();
        harmonic_source(&f0, RATE).iter().map(|v| v * 0.2).collect()
    }

    fn stream(x: &[f64]) -> Vec<UtteranceSummary> {
        let samples: Vec<f32> = x.iter().map(|&v| v as f32).collect();
        let cfg = Config::default();
        let mut sa = StreamAnalyser::new(RATE, cfg.clone());
        let mut seg = UtteranceSegmenter::new(RATE, UtteranceConfig::default());
        for chunk in samples.chunks(80) {
            sa.push(chunk);
            seg.push_samples(chunk);
            for f in sa.drain() {
                seg.push_frame(&f);
            }
        }
        sa.finish();
        for f in sa.drain() {
            seg.push_frame(&f);
        }
        seg.finish();
        let q = QualityConfig {
            analysis: cfg,
            ..QualityConfig::default()
        };
        std::iter::from_fn(|| seg.pop())
            .map(|u| summarise(&u, &q, &UtteranceConfig::default(), &UtteranceContext::default()))
            .collect()
    }

    #[test]
    fn pauses_split_utterances_and_short_ones_are_not_scored() {
        let mut x = silence(0.3);
        x.extend(tone(200.0, 200.0, 1.5));
        x.extend(silence(0.6));
        x.extend(tone(150.0, 150.0, 0.5));
        x.extend(silence(0.4));
        let u = stream(&x);
        assert_eq!(u.len(), 2, "{u:#?}");
        assert!((u[0].start_s - 0.3).abs() < 0.05 && (u[0].end_s - 1.8).abs() < 0.05);
        assert!(u[0].scored && !u[1].scored);
        let p = u[0].pitch.as_ref().unwrap();
        assert!((p.median_hz / 200.0 - 1.0).abs() < 0.01, "{p:?}");
        assert!((u[1].pitch.as_ref().unwrap().median_hz / 150.0 - 1.0).abs() < 0.01);
        // A steady harmonic tone: near-zero perturbation, high CPPS.
        let q = &u[0].quality;
        assert!(q.jitter_local.unwrap() < 0.005, "{q:?}");
        assert!(q.cpps_db.unwrap() > 15.0, "{q:?}");
    }

    #[test]
    fn short_gaps_do_not_split() {
        let mut x = silence(0.2);
        x.extend(tone(180.0, 180.0, 0.8));
        x.extend(silence(0.12));
        x.extend(tone(180.0, 180.0, 0.8));
        x.extend(silence(0.5));
        let u = stream(&x);
        assert_eq!(u.len(), 1, "{u:#?}");
        assert!(u[0].scored);
    }

    #[test]
    fn long_stretches_are_split_at_max_s() {
        let mut x = tone(160.0, 160.0, 13.0);
        x.extend(silence(0.5));
        let u = stream(&x);
        assert_eq!(u.len(), 2);
        assert!((u[0].end_s - u[0].start_s - 12.0).abs() < 0.05);
    }

    #[test]
    fn terminal_slope_sees_a_rise() {
        let mut x = silence(0.2);
        x.extend(tone(180.0, 180.0, 1.0));
        // Rise 2 ST over the last 0.4 s: +5 ST/s.
        x.extend(tone(180.0, st_to_hz(hz_to_st(180.0) + 2.0), 0.4));
        x.extend(silence(0.5));
        let u = stream(&x);
        let s = u[0].terminal_slope_st_per_s.unwrap();
        assert!((s - 5.0).abs() < 1.0, "{s}");
        let mut flat = silence(0.2);
        flat.extend(tone(180.0, 180.0, 1.4));
        flat.extend(silence(0.5));
        assert!(stream(&flat)[0].terminal_slope_st_per_s.unwrap().abs() < 0.5);
    }

    #[test]
    fn noise_alone_makes_no_utterance() {
        let x = noise(0.05, (2.0 * RATE) as usize, 7);
        assert!(stream(&x).is_empty());
    }

    #[test]
    fn idle_buffer_stays_bounded() {
        let mut seg = UtteranceSegmenter::new(RATE, UtteranceConfig::default());
        for _ in 0..100 {
            seg.push_samples(&[0.0; 1600]);
        }
        assert!(seg.buf.len() <= (IDLE_KEEP_S * RATE) as usize + 1600);
    }
}
