//! `newvoice-cli`: runs newvoice-core on WAV files and prints JSON.
//!
//! Used by the Python validation harness (`harness/validation`). Not shipped.
//!
//! ```text
//! newvoice-cli frames <wav> [--algorithm yin|mpm|pyin] [--ceiling HZ] [--raw-formants] [--no-formants]
//! newvoice-cli vowel  <wav> [--ceiling HZ]... [--vowel CODE] [--start S --end S] [--max-bandwidth HZ]
//!                    (CODE adds the resonance score; --start/--end give known boundaries)
//! newvoice-cli quality <wav> [--algorithm yin|mpm|pyin] [--ceiling HZ]
//! newvoice-cli hnr    <wav>   (per-frame HNR track)
//! newvoice-cli cpps   <wav>   (per-frame cepstral peak prominence)
//! newvoice-cli bench  <wav> [--chunk N] [--repeat N]
//! ```

use std::process::ExitCode;
use std::time::Instant;

use newvoice_core::formant::FormantConfig;
use newvoice_core::pitch::PitchAlgorithm;
use newvoice_core::quality::cpps::cpps_track;
use newvoice_core::quality::hnr::hnr_track;
use newvoice_core::quality::spectral::FrameSpectral;
use newvoice_core::quality::{QUALITY_VERSION, QualityConfig, quality_with_tracks};
use newvoice_core::resonance::{RESONANCE_SCORE_VERSION, delta_f_position};
use newvoice_core::{
    Config, StreamAnalyser, VowelConfig, analyse, measure_vowel, measure_vowel_between,
};
use newvoice_core::{VowelNorm, VowelToken, resonance_score};
use serde_json::{Value, json};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(out) => {
            println!("{out}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("newvoice-cli: {e}");
            ExitCode::from(2)
        }
    }
}

fn run(args: &[String]) -> Result<Value, String> {
    let (cmd, rest) = args.split_first().ok_or(USAGE)?;
    let opts = Options::parse(rest)?;
    let (samples, rate) = read_wav(&opts.path)?;
    match cmd.as_str() {
        "frames" => Ok(frames(&samples, rate, &opts)),
        "vowel" => Ok(vowel(&samples, rate, &opts)),
        "quality" => Ok(quality(&samples, rate, &opts)),
        "hnr" => {
            let t = hnr_track(&samples, rate, &Default::default());
            Ok(json!({"times_s": t.times_s, "hnr_db": t.hnr_db}))
        }
        "cpps" => {
            let t = cpps_track(&samples, rate, &Default::default());
            Ok(json!({"times_s": t.times_s, "prominence_db": t.prominence_db}))
        }
        "bench" => Ok(bench(&samples, rate, &opts)),
        _ => Err(USAGE.into()),
    }
}

const USAGE: &str = "usage: newvoice-cli <frames|vowel|quality|hnr|cpps|bench> <wav> [options]";

#[derive(Default)]
struct Options {
    path: String,
    algorithm: PitchAlgorithm,
    ceilings: Vec<f64>,
    raw_formants: bool,
    no_formants: bool,
    chunk: usize,
    repeat: usize,
    vowel: Option<&'static VowelNorm>,
    median_frames: Option<usize>,
    median_outlier_st: Option<f64>,
    start_s: Option<f64>,
    end_s: Option<f64>,
    max_bandwidth_hz: Option<f64>,
}

impl Options {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut o = Options {
            chunk: 480,
            repeat: 3,
            ..Options::default()
        };
        let mut it = args.iter();
        while let Some(a) = it.next() {
            let mut value = |name: &str| it.next().ok_or(format!("{name} needs a value")).cloned();
            match a.as_str() {
                "--algorithm" => {
                    o.algorithm = match value(a)?.as_str() {
                        "yin" => PitchAlgorithm::Yin,
                        "mpm" => PitchAlgorithm::Mpm,
                        "pyin" => PitchAlgorithm::Pyin,
                        other => return Err(format!("unknown algorithm {other}")),
                    }
                }
                "--ceiling" => o.ceilings.push(number(&value(a)?)?),
                "--raw-formants" => o.raw_formants = true,
                "--no-formants" => o.no_formants = true,
                "--chunk" => o.chunk = number(&value(a)?)? as usize,
                "--repeat" => o.repeat = number(&value(a)?)? as usize,
                "--median-frames" => o.median_frames = Some(number(&value(a)?)? as usize),
                "--median-outlier-st" => o.median_outlier_st = Some(number(&value(a)?)?),
                "--start" => o.start_s = Some(number(&value(a)?)?),
                "--end" => o.end_s = Some(number(&value(a)?)?),
                "--max-bandwidth" => o.max_bandwidth_hz = Some(number(&value(a)?)?),
                "--vowel" => {
                    let code = value(a)?;
                    o.vowel = Some(VowelNorm::find(&code).ok_or(format!("unknown vowel {code}"))?);
                }
                s if s.starts_with("--") => return Err(format!("unknown option {s}")),
                s if o.path.is_empty() => o.path = s.to_owned(),
                s => return Err(format!("unexpected argument {s}")),
            }
        }
        if o.path.is_empty() {
            return Err(USAGE.into());
        }
        Ok(o)
    }

    fn formant_config(&self) -> FormantConfig {
        let mut f = FormantConfig::default();
        if let Some(&c) = self.ceilings.first() {
            f.ceiling_hz = c;
        }
        if self.max_bandwidth_hz.is_some() {
            f.max_bandwidth_hz = self.max_bandwidth_hz;
        }
        if self.raw_formants {
            f.max_bandwidth_hz = None;
        }
        f
    }

    fn config(&self) -> Config {
        let mut smoothing = Config::default().smoothing;
        if let Some(n) = self.median_frames {
            smoothing.median_frames = n;
        }
        if self.median_outlier_st.is_some() {
            smoothing.median_outlier_st = self.median_outlier_st;
        }
        Config {
            pitch_algorithm: self.algorithm,
            smoothing,
            formants: (!self.no_formants).then(|| self.formant_config()),
            ..Config::default()
        }
    }
}

fn number(s: &str) -> Result<f64, String> {
    s.parse().map_err(|_| format!("not a number: {s}"))
}

/// Reads a WAV file as mono f32 (channels averaged).
fn read_wav(path: &str) -> Result<(Vec<f32>, f64), String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| format!("{path}: {e}"))?;
    let spec = reader.spec();
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?
        }
    };
    let ch = usize::from(spec.channels.max(1));
    let mono = interleaved
        .chunks(ch)
        .map(|c| c.iter().sum::<f32>() / ch as f32)
        .collect();
    Ok((mono, f64::from(spec.sample_rate)))
}

/// JSON has no infinity: write non-finite numbers as null.
fn finite(v: f64) -> Value {
    opt(v.is_finite().then_some(v))
}

fn opt(v: Option<f64>) -> Value {
    v.map_or(Value::Null, |x| json!(x))
}

fn frames(samples: &[f32], rate: f64, opts: &Options) -> Value {
    let a = analyse(samples, rate, &opts.config());
    let frames: Vec<Value> = a
        .frames
        .iter()
        .map(|f| {
            json!({
                "t": f.time_s,
                "level_dbfs": f.level_dbfs,
                "periodicity": f.periodicity,
                "voiced": f.voiced,
                "f0_raw_hz": opt(f.f0_raw_hz),
                "f0_hz": opt(f.f0_hz),
                "formants": f.formants.map(|fr| {
                    fr.as_slice()
                        .iter()
                        .map(|x| json!([x.frequency_hz, x.bandwidth_hz]))
                        .collect::<Vec<_>>()
                }),
                "formant_confidence": f.formant_confidence,
                "spectral": f.spectral.as_ref().map(spectral_json),
            })
        })
        .collect();
    let stats = a.pitch_stats().map(|s| {
        json!({
            "voiced_s": s.voiced_s,
            "median_hz": s.median_hz,
            "median_st": s.median_st,
            "p10_st": s.p10_st,
            "p90_st": s.p90_st,
            "sd_st": s.sd_st,
            "range_5_95_st": s.range_5_95_st,
        })
    });
    json!({
        "core_version": newvoice_core::VERSION,
        "sample_rate": a.sample_rate,
        "duration_s": a.duration_s,
        "hop_s": a.hop_s,
        "frames": frames,
        "pitch_stats": stats,
    })
}

fn vowel(samples: &[f32], rate: f64, opts: &Options) -> Value {
    let mut cfg = VowelConfig::default();
    cfg.analysis.pitch_algorithm = opts.algorithm;
    cfg.formant = opts.formant_config();
    if !opts.ceilings.is_empty() {
        cfg.ceilings_hz = opts.ceilings.clone();
    }
    let measured = match (opts.start_s, opts.end_s) {
        (Some(start), Some(end)) => measure_vowel_between(samples, rate, start, end, &cfg),
        _ => measure_vowel(samples, rate, &cfg),
    };
    match measured {
        None => Value::Null,
        Some(m) => {
            let resonance = opts.vowel.and_then(|vowel| {
                resonance_score(&[VowelToken {
                    vowel,
                    formants_hz: [m.formants_hz[0], m.formants_hz[1], m.formants_hz[2]],
                    weight: 1.0,
                }])
            });
            json!({
            "core_version": newvoice_core::VERSION,
            "start_s": m.start_s,
            "end_s": m.end_s,
            "voiced_s": m.voiced_s,
            "f0_median_hz": m.f0_median_hz,
            "ceiling_hz": m.ceiling_hz,
            "ceiling_scores": m.ceiling_scores.iter().map(|s| json!({
                "ceiling_hz": s.ceiling_hz,
                "track_error_hz": finite(s.track_error_hz),
                "instability_hz": finite(s.instability_hz),
            })).collect::<Vec<_>>(),
            "formants_hz": m.formants_hz.map(opt),
            "bandwidths_hz": m.bandwidths_hz.map(opt),
            "delta_f_hz": opt(m.delta_f_hz),
            "avtl_cm": opt(m.avtl_cm),
            "confidence": m.confidence,
            "delta_f_position": opt(m.delta_f_hz.and_then(delta_f_position)),
            "resonance": resonance.map(|r| json!({
                "version": RESONANCE_SCORE_VERSION,
                "score": r.score,
                "by_formant": r.by_formant.map(opt),
            })),
            })
        }
    }
}

/// Streams the file through the live analyser in fixed chunks and reports the
/// cost per frame (best of `repeat` runs).
fn bench(samples: &[f32], rate: f64, opts: &Options) -> Value {
    let cfg = opts.config();
    let mut best = f64::MAX;
    let mut frames = 0;
    let mut latency_s = 0.0;
    for _ in 0..opts.repeat.max(1) {
        let mut s = StreamAnalyser::new(rate, cfg.clone());
        latency_s = s.latency_s();
        let start = Instant::now();
        frames = 0;
        for chunk in samples.chunks(opts.chunk.max(1)) {
            s.push(chunk);
            frames += s.drain().len();
        }
        s.finish();
        frames += s.drain().len();
        best = best.min(start.elapsed().as_secs_f64());
    }
    json!({
        "core_version": newvoice_core::VERSION,
        "frames": frames,
        "seconds": best,
        "us_per_frame": 1e6 * best / frames.max(1) as f64,
        "hop_us": 1e6 * cfg.hop_s,
        "latency_s": latency_s,
    })
}

fn spectral_json(s: &FrameSpectral) -> Value {
    json!({
        "h1_db": s.h1_db,
        "h2_db": s.h2_db,
        "h1_h2_db": s.h1_h2_db,
        "h1c_h2c_db": opt(s.h1c_h2c_db),
        "alpha_ratio_db": s.alpha_ratio_db,
        "hammarberg_db": s.hammarberg_db,
        "lh_ratio_db": s.lh_ratio_db,
    })
}

/// Utterance-level voice quality, plus whole-signal CPPS and HNR means
/// computed the way Praat reports them (for the golden comparisons).
fn quality(samples: &[f32], rate: f64, opts: &Options) -> Value {
    let cfg = QualityConfig {
        analysis: opts.config(),
        ..QualityConfig::default()
    };
    let analysis = analyse(samples, rate, &cfg.analysis);
    let cpps = cpps_track(samples, rate, &cfg.cpps);
    let hnr = hnr_track(samples, rate, &cfg.hnr);
    let q = quality_with_tracks(&analysis, samples, &cfg, &cpps, &hnr);
    json!({
        "core_version": newvoice_core::VERSION,
        "quality_version": QUALITY_VERSION,
        "voiced_s": q.voiced_s,
        "h1_h2_db": opt(q.h1_h2_db),
        "h1c_h2c_db": opt(q.h1c_h2c_db),
        "alpha_ratio_db": opt(q.alpha_ratio_db),
        "hammarberg_db": opt(q.hammarberg_db),
        "lh_ratio_db": opt(q.lh_ratio_db),
        "cpps_db": opt(q.cpps_db),
        "hnr_db": opt(q.hnr_db),
        "jitter_local": opt(q.jitter_local),
        "shimmer_local": opt(q.shimmer_local),
        "periods": q.periods,
        "praat_style": {
            "cpps_db": opt(cpps.mean()),
            "hnr_db": opt(hnr.mean()),
        },
    })
}
