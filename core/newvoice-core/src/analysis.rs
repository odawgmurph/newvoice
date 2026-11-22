//! Frame-level analysis on a fixed grid, for finished recordings ([`analyse`])
//! and live audio ([`StreamAnalyser`]).
//!
//! Frame `k` is centred at `k × hop` seconds; audio before the start or after
//! the end of the signal reads as silence. Both paths run the same per-frame
//! code on the same input samples, so a streamed frame equals the batch frame
//! except where the jump guard needed more look-ahead than the stream had
//! (see [`Config::lookahead_frames`]).

use std::collections::VecDeque;

use crate::formant::{FormantAnalyser, FormantConfig, FormantFrame};
use crate::pitch::pyin::{self, PyinConfig};
use crate::pitch::smooth::{SmoothConfig, smooth, smooth_window};
use crate::pitch::{LagRange, PITCH_RATE, PitchAlgorithm, mpm, yin};
use crate::quality::spectral::{FrameSpectral, SpectralAnalyser};
use crate::resample::GridResampler;
use crate::units::PitchStats;

/// Analysis settings. Defaults follow handbook §3.1–3.3.
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    /// Frame hop in seconds.
    pub hop_s: f64,
    /// Lowest F0 searched (allows vocal fry).
    pub f0_min_hz: f64,
    /// Highest F0 searched (allows M2 / falsetto).
    pub f0_max_hz: f64,
    pub pitch_algorithm: PitchAlgorithm,
    /// YIN absolute threshold on the normalised difference.
    pub yin_threshold: f64,
    /// MPM key-maximum threshold, relative to the highest peak.
    pub mpm_k: f64,
    /// Frames at least this periodic (0–1) are voiced.
    pub voicing_threshold: f64,
    /// Frames quieter than this (dB re a full-scale sine) are silence.
    pub silence_dbfs: f64,
    /// Jump guard and median filter for YIN and MPM tracks. pYIN's HMM does
    /// this job, so its track is not smoothed again.
    pub smoothing: SmoothConfig,
    /// pYIN settings, used when `pitch_algorithm` is [`PitchAlgorithm::Pyin`].
    pub pyin: PyinConfig,
    /// Per-frame formants, or `None` to skip them (pitch only).
    pub formants: Option<FormantConfig>,
    /// Streaming only: frames of look-ahead before a frame is emitted. It
    /// must cover the median filter radius. The default, 4 frames (40 ms), is
    /// `min_run_frames - 1`: enough for the jump guard to confirm the run a
    /// frame starts, so the live trace never draws a short octave jump that
    /// the batch track rejects. Only the median's neighbours can still
    /// differ from batch; full equality needs `min_run_frames - 1 + radius`
    /// (6). Decision D16, evidence in `docs/validation/live-lookahead.md`.
    pub lookahead_frames: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hop_s: 0.01,
            f0_min_hz: 60.0,
            f0_max_hz: 500.0,
            pitch_algorithm: PitchAlgorithm::Yin,
            yin_threshold: 0.15,
            mpm_k: 0.9,
            voicing_threshold: 0.7,
            silence_dbfs: -60.0,
            smoothing: SmoothConfig::default(),
            pyin: PyinConfig::default(),
            formants: Some(FormantConfig::default()),
            lookahead_frames: 4,
        }
    }
}

/// The analysis of one frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub index: u64,
    /// Centre of the frame, in seconds from the start of the signal.
    pub time_s: f64,
    /// RMS level in dB relative to a full-scale sine. Phone microphones are
    /// not calibrated, so compare this with the user's own baseline only.
    pub level_dbfs: f64,
    /// Periodicity of the frame, 0–1 (see [`crate::pitch::PitchEstimate`]).
    pub periodicity: f64,
    /// Above the silence gate and at least `voicing_threshold` periodic.
    pub voiced: bool,
    /// The frame's own F0 estimate, when voiced. With pYIN, the most
    /// probable candidate.
    pub f0_raw_hz: Option<f64>,
    /// F0 after the jump guard and median filter (YIN, MPM) or HMM decoding
    /// (pYIN). `None` when unvoiced or rejected as an octave jump; this is
    /// the value to show and score.
    pub f0_hz: Option<f64>,
    /// Formants, when enabled. Empty below the silence gate. Present for
    /// unvoiced frames too, since whispered vowels have formants.
    pub formants: Option<FormantFrame>,
    /// How far to trust F1/F2 here, 0–1: roughly the chance both are within
    /// 10%, fitted on real vowels (see `formant_confidence`). The fit used
    /// steady-state medians; a single frame's bandwidths are noisier.
    pub formant_confidence: f64,
    /// Spectral voice-quality measures (H1–H2, alpha ratio, …), on frames
    /// with an F0 (`f0_hz` is `Some`) only.
    pub spectral: Option<FrameSpectral>,
}

/// Frame-level analysis of a finished recording.
#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    pub sample_rate: f64,
    pub duration_s: f64,
    pub hop_s: f64,
    pub frames: Vec<Frame>,
}

impl Analysis {
    /// Smoothed F0 of the voiced frames, in order.
    pub fn voiced_f0_hz(&self) -> Vec<f64> {
        self.frames.iter().filter_map(|f| f.f0_hz).collect()
    }

    /// Pitch statistics over the voiced frames, or `None` if there are none.
    pub fn pitch_stats(&self) -> Option<PitchStats> {
        PitchStats::from_hz(&self.voiced_f0_hz(), self.hop_s)
    }
}

/// Analyses a whole recording.
pub fn analyse(samples: &[f32], sample_rate: f64, cfg: &Config) -> Analysis {
    let mut fa = FrameAnalyser::new(cfg, sample_rate);
    let src = |i: i64| {
        usize::try_from(i)
            .ok()
            .and_then(|i| samples.get(i))
            .copied()
            .unwrap_or(0.0)
    };
    let n = frame_count(samples.len() as i64, sample_rate, cfg.hop_s);
    let frames = if cfg.pitch_algorithm == PitchAlgorithm::Pyin {
        // Pass 1: candidates for every frame. Then decode the whole track,
        // and pass 2 measures everything else at the decoded F0.
        let mut observer = pyin::Observer::new(fa.lags, &cfg.pyin);
        let obs: Vec<pyin::Observation> = (0..n)
            .map(|k| fa.observe_pyin(src, k, &mut observer))
            .collect();
        let decoded = pyin::decode(&obs, cfg.f0_min_hz, cfg.f0_max_hz, cfg.hop_s, &cfg.pyin);
        (0..n)
            .zip(obs.iter().zip(&decoded))
            .map(|(k, (o, d))| {
                let best = o.best();
                let pitch = Pitch {
                    periodicity: best.map_or(0.0, |c| c.periodicity),
                    voiced: d.f0_hz.is_some(),
                    raw_f0_hz: best.filter(|_| d.f0_hz.is_some()).map(|c| c.f0_hz),
                    f0_hz: d.f0_hz,
                };
                let raw = fa.analyse(src, k, Some(pitch));
                raw.finish(raw.f0_hz)
            })
            .collect()
    } else {
        let raws: Vec<RawFrame> = (0..n).map(|k| fa.analyse(src, k, None)).collect();
        let f0: Vec<Option<f64>> = raws.iter().map(|r| r.f0_hz).collect();
        raws.iter()
            .zip(smooth(&f0, &cfg.smoothing))
            .map(|(raw, f0)| raw.finish(f0))
            .collect()
    };
    Analysis {
        sample_rate,
        duration_s: samples.len() as f64 / sample_rate,
        hop_s: cfg.hop_s,
        frames,
    }
}

/// Live analysis: push audio as it arrives, pop frames as they're ready.
///
/// Frames come out in order, each [`StreamAnalyser::latency_s`] after its
/// centre time. Not thread-safe; drive it from the audio thread or behind a
/// lock.
#[derive(Debug, Clone)]
pub struct StreamAnalyser {
    fa: FrameAnalyser,
    cfg: Config,
    sample_rate: f64,
    reach_s: f64,
    lookahead: u64,
    history: u64,
    samples: VecDeque<f32>,
    /// Absolute index of `samples[0]`.
    first: i64,
    /// Samples pushed so far.
    total: i64,
    next_analyse: u64,
    raws: VecDeque<RawFrame>,
    next_emit: u64,
    out: VecDeque<Frame>,
    finished: bool,
}

impl StreamAnalyser {
    /// Panics for [`PitchAlgorithm::Pyin`], which needs the whole
    /// utterance: use [`analyse`] on the finished recording instead.
    pub fn new(sample_rate: f64, cfg: Config) -> Self {
        assert!(
            cfg.pitch_algorithm != PitchAlgorithm::Pyin,
            "pYIN needs the whole utterance; use analyse()"
        );
        let fa = FrameAnalyser::new(&cfg, sample_rate);
        let radius = cfg.smoothing.median_frames / 2;
        Self {
            reach_s: fa.reach_s(),
            lookahead: cfg.lookahead_frames.max(radius) as u64,
            history: (cfg.smoothing.min_run_frames + radius + 1) as u64,
            fa,
            cfg,
            sample_rate,
            samples: VecDeque::new(),
            first: 0,
            total: 0,
            next_analyse: 0,
            raws: VecDeque::new(),
            next_emit: 0,
            out: VecDeque::new(),
            finished: false,
        }
    }

    /// True once [`finish`](Self::finish) has been called.
    pub fn is_finished(&self) -> bool {
        self.finished
    }

    /// Delay from a frame's centre time until it can be emitted, ignoring
    /// buffering outside the analyser.
    pub fn latency_s(&self) -> f64 {
        self.reach_s + self.lookahead as f64 * self.cfg.hop_s
    }

    /// Adds samples. Panics if called after [`finish`](Self::finish).
    pub fn push(&mut self, samples: &[f32]) {
        assert!(!self.finished, "push after finish");
        self.samples.extend(samples);
        self.total += samples.len() as i64;
        loop {
            let t = self.next_analyse as f64 * self.cfg.hop_s;
            let last_needed = ((t + self.reach_s) * self.sample_rate).ceil() as i64;
            if last_needed >= self.total {
                break;
            }
            self.analyse_next();
        }
        self.emit(false);
        // Drop samples no future frame will read.
        let t = self.next_analyse as f64 * self.cfg.hop_s;
        let keep_from = ((t - self.reach_s) * self.sample_rate).floor() as i64 - 1;
        while self.first < keep_from && self.samples.pop_front().is_some() {
            self.first += 1;
        }
    }

    /// Ends the stream: analyses the remaining frames up to the end of the
    /// audio (padding with silence), as batch analysis would.
    pub fn finish(&mut self) {
        if self.finished {
            return;
        }
        let n = frame_count(self.total, self.sample_rate, self.cfg.hop_s);
        while self.next_analyse < n {
            self.analyse_next();
        }
        self.finished = true;
        self.emit(true);
    }

    /// The next ready frame, if any.
    pub fn pop(&mut self) -> Option<Frame> {
        self.out.pop_front()
    }

    /// All ready frames.
    pub fn drain(&mut self) -> Vec<Frame> {
        self.out.drain(..).collect()
    }

    fn analyse_next(&mut self) {
        let (samples, first, total) = (&self.samples, self.first, self.total);
        let src = |i: i64| {
            if i >= first && i < total {
                samples[(i - first) as usize]
            } else {
                0.0
            }
        };
        let raw = self.fa.analyse(src, self.next_analyse, None);
        self.raws.push_back(raw);
        self.next_analyse += 1;
    }

    fn emit(&mut self, end_of_signal: bool) {
        while self.next_emit < self.next_analyse {
            let last = self.next_analyse - 1;
            if !end_of_signal && last - self.next_emit < self.lookahead {
                break;
            }
            let lo = self.raws.front().expect("frames pending").index;
            let hi = (self.next_emit + self.lookahead).min(last);
            let window: Vec<Option<f64>> = self
                .raws
                .iter()
                .take_while(|r| r.index <= hi)
                .map(|r| r.f0_hz)
                .collect();
            let open_end = !(end_of_signal && hi == last);
            let smoothed = smooth_window(&window, &self.cfg.smoothing, lo > 0, open_end);
            let pos = (self.next_emit - lo) as usize;
            self.out.push_back(self.raws[pos].finish(smoothed[pos]));
            self.next_emit += 1;
            while self
                .raws
                .front()
                .is_some_and(|r| r.index + self.history < self.next_emit)
            {
                self.raws.pop_front();
            }
        }
    }
}

/// Number of frames for `n` samples: centres from 0 up to the end time.
fn frame_count(n: i64, sample_rate: f64, hop_s: f64) -> u64 {
    if n <= 0 {
        0
    } else {
        ((n as f64 / sample_rate) / hop_s + 1e-9).floor() as u64 + 1
    }
}

/// Per-frame measurements before track smoothing.
#[derive(Debug, Clone, Copy, PartialEq)]
struct RawFrame {
    index: u64,
    time_s: f64,
    level_dbfs: f64,
    periodicity: f64,
    voiced: bool,
    /// The frame's own estimate (`Frame::f0_raw_hz`).
    raw_f0_hz: Option<f64>,
    /// The track value before YIN/MPM smoothing; for pYIN, already final.
    f0_hz: Option<f64>,
    formants: Option<FormantFrame>,
    spectral: Option<FrameSpectral>,
}

/// A pitch decision made outside the frame (pYIN's decoded track).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Pitch {
    periodicity: f64,
    voiced: bool,
    raw_f0_hz: Option<f64>,
    f0_hz: Option<f64>,
}

impl RawFrame {
    fn finish(&self, f0_hz: Option<f64>) -> Frame {
        Frame {
            index: self.index,
            time_s: self.time_s,
            level_dbfs: self.level_dbfs,
            periodicity: self.periodicity,
            voiced: self.voiced,
            f0_raw_hz: self.raw_f0_hz,
            f0_hz,
            formants: self.formants,
            formant_confidence: self.formants.map_or(0.0, |fr| {
                formant_confidence(
                    f0_hz,
                    fr.get(0).map(|f| f.bandwidth_hz),
                    fr.get(1).map(|f| f.bandwidth_hz),
                )
            }),
            spectral: self.spectral.filter(|_| f0_hz.is_some()),
        }
    }
}

/// Formant confidence from F0 and the F1/F2 bandwidths: roughly the chance
/// that F1 and F2 are both within 10% of a hand-checked measurement.
///
/// The bandwidth term is a logistic fit to the Hillenbrand (1995) vowels
/// measured at their judged steady state (decision D11): with B the wider of
/// the F1/F2 bandwidths, P(error > 10%) = 1 / (1 + exp(4.56 − 0.898·B/100)),
/// about 2% at 100 Hz, 13% at 300 Hz and 70% at 600 Hz. F0 barely mattered
/// for those adult voices (up to ~300 Hz), but the synthetic corpus shows
/// LPC snapping to harmonics from 250 Hz (handbook §3.3), so the source term
/// falls linearly from 1 at 250 Hz to 0.3 at 400 Hz. Unvoiced frames above
/// the gate (whisper, or noise) get 0.5: nothing has calibrated them yet.
pub(crate) fn formant_confidence(
    f0_hz: Option<f64>,
    f1_bandwidth_hz: Option<f64>,
    f2_bandwidth_hz: Option<f64>,
) -> f64 {
    let (Some(b1), Some(b2)) = (f1_bandwidth_hz, f2_bandwidth_hz) else {
        return 0.0;
    };
    let source = f0_hz.map_or(0.5, |f0| (1.0 - 0.7 * (f0 - 250.0) / 150.0).clamp(0.3, 1.0));
    let p_error = 1.0 / (1.0 + (4.56 - 0.898 * b1.max(b2) / 100.0).exp());
    source * (1.0 - p_error)
}

/// The per-frame work shared by batch and streaming analysis.
#[derive(Debug, Clone)]
struct FrameAnalyser {
    cfg: Config,
    lags: LagRange,
    resampler: GridResampler,
    buf: Vec<f64>,
    scratch: Vec<f64>,
    formants: Option<FormantAnalyser>,
    spectral: SpectralAnalyser,
}

impl FrameAnalyser {
    fn new(cfg: &Config, sample_rate: f64) -> Self {
        assert!(cfg.hop_s > 0.0, "hop must be positive");
        Self {
            cfg: cfg.clone(),
            lags: LagRange::new(cfg.f0_min_hz, cfg.f0_max_hz),
            resampler: GridResampler::new(sample_rate, PITCH_RATE),
            buf: Vec::new(),
            scratch: Vec::new(),
            spectral: SpectralAnalyser::new(
                LagRange::new(cfg.f0_min_hz, cfg.f0_max_hz).frame_len(),
                PITCH_RATE,
            ),
            formants: cfg
                .formants
                .clone()
                .map(|f| FormantAnalyser::new(sample_rate, f)),
        }
    }

    /// Seconds of input read on each side of a frame centre.
    fn reach_s(&self) -> f64 {
        let rs = self.resampler.resampler();
        let pitch = (self.lags.frame_len() as f64 / 2.0 + 2.0) / PITCH_RATE
            + rs.half_width_samples() as f64 / rs.in_rate();
        self.formants
            .as_ref()
            .map_or(pitch, |f| pitch.max(f.reach_s()))
    }

    /// Reads frame `index` into `buf` and returns its level (dBFS).
    fn read(&mut self, src: impl Fn(i64) -> f32 + Copy, index: u64) -> f64 {
        let t = index as f64 * self.cfg.hop_s;
        let n = self.lags.frame_len();
        self.buf.clear();
        self.buf.resize(n, 0.0);
        // Frame centred on the grid sample nearest `t`.
        let start = (t * PITCH_RATE - (n as f64 - 1.0) / 2.0).round() as i64;
        self.resampler.read(src, start, &mut self.buf);
        self.resampler.forget_before(start);
        let mean_square = self.buf.iter().map(|v| v * v).sum::<f64>() / n as f64;
        10.0 * (2.0 * mean_square).max(1e-15).log10()
    }

    /// pYIN's first pass: the frame's F0 candidates (none below the gate).
    fn observe_pyin(
        &mut self,
        src: impl Fn(i64) -> f32 + Copy,
        index: u64,
        observer: &mut pyin::Observer,
    ) -> pyin::Observation {
        if self.read(src, index) >= self.cfg.silence_dbfs {
            observer.observe(&self.buf)
        } else {
            pyin::Observation::default()
        }
    }

    /// Measures frame `index`. The pitch comes from the frame's own YIN or
    /// MPM estimate, or from `pitch` when given (pYIN).
    fn analyse(
        &mut self,
        src: impl Fn(i64) -> f32 + Copy,
        index: u64,
        pitch: Option<Pitch>,
    ) -> RawFrame {
        let t = index as f64 * self.cfg.hop_s;
        let level_dbfs = self.read(src, index);
        let audible = level_dbfs >= self.cfg.silence_dbfs;

        let pitch = pitch.unwrap_or_else(|| {
            let estimate = audible
                .then(|| match self.cfg.pitch_algorithm {
                    PitchAlgorithm::Yin => yin::estimate(
                        &self.buf,
                        &self.lags,
                        self.cfg.yin_threshold,
                        &mut self.scratch,
                    ),
                    PitchAlgorithm::Mpm => {
                        mpm::estimate(&self.buf, &self.lags, self.cfg.mpm_k, &mut self.scratch)
                    }
                    PitchAlgorithm::Pyin => unreachable!("pYIN pitch is decoded per utterance"),
                })
                .flatten();
            let periodicity = estimate.map_or(0.0, |e| e.periodicity);
            let voiced = periodicity >= self.cfg.voicing_threshold;
            let f0_hz = estimate.filter(|_| voiced).map(|e| e.f0_hz);
            Pitch {
                periodicity,
                voiced,
                raw_f0_hz: f0_hz,
                f0_hz,
            }
        });
        let formants = self.formants.as_mut().map(|fa| {
            if audible {
                fa.analyse(src, t)
            } else {
                FormantFrame::default()
            }
        });
        let spectral = pitch.f0_hz.map(|f0| {
            self.spectral
                .analyse(&self.buf, f0, formants.as_ref().filter(|f| f.len() >= 2))
        });
        RawFrame {
            index,
            time_s: t,
            level_dbfs,
            periodicity: pitch.periodicity,
            voiced: pitch.voiced,
            raw_f0_hz: pitch.raw_f0_hz,
            f0_hz: pitch.f0_hz,
            formants,
            spectral,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    const RATE: f64 = 44_100.0;

    /// 0.3 s silence, 1 s of a gliding vowel, 0.3 s silence.
    fn utterance() -> Vec<f32> {
        let n = RATE as usize;
        let contour: Vec<f64> = (0..n)
            .map(|i| 150.0 * 2f64.powf(i as f64 / n as f64 * 7.0 / 12.0))
            .collect();
        let mut voiced = harmonic_source(&contour, RATE);
        resonate(
            &mut voiced,
            &[
                (700.0, 80.0),
                (1200.0, 90.0),
                (2600.0, 120.0),
                (3600.0, 150.0),
                (4500.0, 200.0),
            ],
            RATE,
        );
        let peak = voiced.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        let pad = vec![0.0; (0.3 * RATE) as usize];
        let mut x = pad.clone();
        x.extend(voiced.iter().map(|v| 0.5 * v / peak));
        x.extend(pad);
        to_f32(&x)
    }

    #[test]
    fn batch_tracks_a_glide_and_gates_silence() {
        let x = utterance();
        let a = analyse(&x, RATE, &Config::default());
        assert_eq!(a.frames.len(), 161);
        for f in &a.frames {
            if f.time_s < 0.27 || f.time_s > 1.33 {
                assert!(!f.voiced && f.f0_hz.is_none(), "t={} {f:?}", f.time_s);
            }
            if (0.35..1.25).contains(&f.time_s) {
                let truth = 150.0 * 2f64.powf((f.time_s - 0.3) * 7.0 / 12.0);
                let got = f.f0_hz.expect("voiced");
                assert!(
                    (got / truth - 1.0).abs() < 0.01,
                    "t={} {got} vs {truth}",
                    f.time_s
                );
                let f1 = f.formants.unwrap().frequency(0).unwrap();
                assert!((f1 / 700.0 - 1.0).abs() < 0.1, "t={} F1 {f1}", f.time_s);
                assert!(f.formant_confidence > 0.5, "t={} {f:?}", f.time_s);
            }
        }
        let stats = a.pitch_stats().unwrap();
        assert!((stats.voiced_s - 1.0).abs() < 0.05, "{stats:?}");
        assert!((stats.range_5_95_st - 0.9 * 7.0).abs() < 0.3, "{stats:?}");
    }

    #[test]
    fn mpm_agrees_with_yin() {
        let x = utterance();
        let cfg = Config {
            formants: None,
            ..Config::default()
        };
        let yin = analyse(&x, RATE, &cfg);
        let mpm = analyse(
            &x,
            RATE,
            &Config {
                pitch_algorithm: PitchAlgorithm::Mpm,
                ..cfg
            },
        );
        for (fy, fm) in yin.frames.iter().zip(&mpm.frames) {
            if let (Some(a), Some(b)) = (fy.f0_hz, fm.f0_hz) {
                assert!((a / b - 1.0).abs() < 0.005, "t={} {a} {b}", fy.time_s);
            }
        }
    }

    #[test]
    fn pyin_tracks_the_glide_and_gates_silence() {
        let x = utterance();
        let a = analyse(
            &x,
            RATE,
            &Config {
                pitch_algorithm: PitchAlgorithm::Pyin,
                ..Config::default()
            },
        );
        assert_eq!(a.frames.len(), 161);
        for f in &a.frames {
            if f.time_s < 0.27 || f.time_s > 1.33 {
                assert!(!f.voiced && f.f0_hz.is_none(), "t={} {f:?}", f.time_s);
            }
            if (0.35..1.25).contains(&f.time_s) {
                let truth = 150.0 * 2f64.powf((f.time_s - 0.3) * 7.0 / 12.0);
                let got = f.f0_hz.expect("voiced");
                assert!(
                    (got / truth - 1.0).abs() < 0.01,
                    "t={} {got} vs {truth}",
                    f.time_s
                );
                assert!(f.spectral.is_some() && f.formants.is_some());
            }
        }
    }

    #[test]
    #[should_panic(expected = "whole utterance")]
    fn pyin_cannot_stream() {
        let cfg = Config {
            pitch_algorithm: PitchAlgorithm::Pyin,
            ..Config::default()
        };
        StreamAnalyser::new(RATE, cfg);
    }

    #[test]
    fn streaming_matches_batch_for_any_chunking() {
        let x = utterance();
        let cfg = Config::default();
        let batch = analyse(&x, RATE, &cfg);
        for chunk in [1, 128, 441, 4096] {
            let mut s = StreamAnalyser::new(RATE, cfg.clone());
            let mut frames = Vec::new();
            for c in x.chunks(chunk) {
                s.push(c);
                frames.extend(s.drain());
            }
            s.finish();
            frames.extend(s.drain());
            assert_eq!(frames.len(), batch.frames.len(), "chunk={chunk}");
            assert_eq!(frames, batch.frames, "chunk={chunk}");
        }
    }

    /// A steady 150 Hz voice with a short burst an octave up: batch analysis
    /// rejects the 45 ms burst as an octave jump (shorter than 50 ms).
    fn octave_blip() -> Vec<f32> {
        let n = (0.6 * RATE) as usize;
        let (from, to) = ((0.3 * RATE) as usize, (0.345 * RATE) as usize);
        let contour: Vec<f64> = (0..n)
            .map(|i| {
                if (from..to).contains(&i) {
                    300.0
                } else {
                    150.0
                }
            })
            .collect();
        let mut x = harmonic_source(&contour, RATE);
        resonate(
            &mut x,
            &[(700.0, 80.0), (1200.0, 90.0), (2600.0, 120.0)],
            RATE,
        );
        let peak = x.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        to_f32(&x.iter().map(|v| 0.5 * v / peak).collect::<Vec<_>>())
    }

    fn streamed(x: &[f32], cfg: &Config) -> Vec<Frame> {
        let mut s = StreamAnalyser::new(RATE, cfg.clone());
        let mut frames = Vec::new();
        for c in x.chunks(441) {
            s.push(c);
            frames.extend(s.drain());
        }
        s.finish();
        frames.extend(s.drain());
        frames
    }

    fn octave_frames(frames: &[Frame]) -> usize {
        frames
            .iter()
            .filter(|f| f.f0_hz.is_some_and(|f0| f0 > 200.0))
            .count()
    }

    #[test]
    fn default_lookahead_never_draws_a_rejected_octave_jump() {
        let x = octave_blip();
        let cfg = Config::default();
        let raw = analyse(&x, RATE, &cfg)
            .frames
            .iter()
            .filter(|f| f.f0_raw_hz.is_some_and(|f0| f0 > 200.0))
            .count();
        assert!(raw > 0, "the burst should reach the raw track");
        assert_eq!(octave_frames(&analyse(&x, RATE, &cfg).frames), 0);
        assert_eq!(octave_frames(&streamed(&x, &cfg)), 0);
        // With only the median radius of look-ahead the live trace draws it.
        let short = Config {
            lookahead_frames: 2,
            ..Config::default()
        };
        assert!(octave_frames(&streamed(&x, &short)) > 0);
    }

    #[test]
    fn stream_emits_within_its_latency() {
        let cfg = Config::default();
        let mut s = StreamAnalyser::new(48_000.0, cfg);
        let latency = s.latency_s();
        assert!(latency < 0.1, "latency {latency}");
        let x = vec![0.0f32; 48_000];
        s.push(&x);
        let last = s.drain().last().unwrap().time_s;
        assert!(
            1.0 - last <= latency + 0.01,
            "last {last}, latency {latency}"
        );
    }

    #[test]
    fn empty_input() {
        assert!(analyse(&[], RATE, &Config::default()).frames.is_empty());
        let mut s = StreamAnalyser::new(RATE, Config::default());
        s.finish();
        assert!(s.pop().is_none());
    }

    #[test]
    fn confidence_falls_with_f0_and_bandwidth() {
        let c = |f0, b| formant_confidence(f0, Some(b), Some(b));
        assert!((c(Some(150.0), 100.0) - 0.975).abs() < 0.005);
        assert_eq!(c(Some(150.0), 100.0), c(Some(250.0), 100.0));
        assert!(c(Some(300.0), 100.0) < c(Some(250.0), 100.0));
        assert!((c(Some(500.0), 100.0) / c(Some(150.0), 100.0) - 0.3).abs() < 1e-9);
        assert!(c(Some(150.0), 600.0) < 0.35);
        assert!(c(Some(150.0), 800.0) < c(Some(150.0), 200.0));
        assert!((c(None, 100.0) / c(Some(150.0), 100.0) - 0.5).abs() < 1e-9);
        assert_eq!(formant_confidence(Some(150.0), Some(100.0), None), 0.0);
    }
}
