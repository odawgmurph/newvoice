//! Measuring a sustained vowel: the steady-state formants, chosen ceiling and
//! vocal tract length, as used for baseline capture and vowel exercises.

use crate::analysis::{Config, analyse, formant_confidence};
use crate::formant::{CeilingScore, FormantConfig, SWEEP_CEILINGS_HZ, sweep};
use crate::units::median;
use crate::vtl::{apparent_vtl_cm, formant_dispersion};

/// Settings for [`measure_vowel`].
#[derive(Debug, Clone, PartialEq)]
pub struct VowelConfig {
    /// Pitch and voicing settings (its `formants` field is not used).
    pub analysis: Config,
    /// Base formant settings for every ceiling in the sweep.
    pub formant: FormantConfig,
    /// Ceilings to try.
    pub ceilings_hz: Vec<f64>,
    /// Shortest voiced stretch worth measuring.
    pub min_voiced_s: f64,
    /// Fraction of the voiced stretch, centred, treated as steady state.
    pub steady_fraction: f64,
    /// Spacing of formant frames within the steady state.
    pub formant_hop_s: f64,
}

impl Default for VowelConfig {
    fn default() -> Self {
        Self {
            analysis: Config {
                formants: None,
                ..Config::default()
            },
            formant: FormantConfig::default(),
            ceilings_hz: SWEEP_CEILINGS_HZ.to_vec(),
            min_voiced_s: 0.25,
            steady_fraction: 0.5,
            formant_hop_s: 0.005,
        }
    }
}

/// A sustained vowel's measurements.
#[derive(Debug, Clone, PartialEq)]
pub struct VowelMeasurement {
    /// Start of the steady-state region measured, in seconds.
    pub start_s: f64,
    /// End of the steady-state region measured, in seconds.
    pub end_s: f64,
    /// Length of the voiced stretch the region was taken from.
    pub voiced_s: f64,
    /// Median smoothed F0 over the region.
    pub f0_median_hz: f64,
    /// The formant ceiling the sweep chose.
    pub ceiling_hz: f64,
    /// How every ceiling in the sweep scored (diagnostics).
    pub ceiling_scores: Vec<CeilingScore>,
    /// Median F1–F4, where found in at least half the frames.
    pub formants_hz: [Option<f64>; 4],
    /// Median bandwidths of F1–F4.
    pub bandwidths_hz: [Option<f64>; 4],
    /// Formant dispersion from F1–F4 (needs all four).
    pub delta_f_hz: Option<f64>,
    /// Apparent vocal tract length from ΔF.
    pub avtl_cm: Option<f64>,
    /// Confidence in the formants, 0–1 (see
    /// [`crate::analysis::Frame::formant_confidence`]), scaled by how many
    /// frames had both F1 and F2.
    pub confidence: f64,
}

/// Measures the longest voiced stretch in `samples` as a sustained vowel.
/// Returns `None` when there is no voiced stretch of `min_voiced_s`, or no
/// ceiling finds F1–F3.
pub fn measure_vowel(
    samples: &[f32],
    sample_rate: f64,
    cfg: &VowelConfig,
) -> Option<VowelMeasurement> {
    let pitch_cfg = Config {
        formants: None,
        ..cfg.analysis.clone()
    };
    let analysis = analyse(samples, sample_rate, &pitch_cfg);
    let frames = &analysis.frames;

    // Longest voiced run, bridging gaps of up to two frames.
    let mut best: Option<(usize, usize)> = None;
    let mut run: Option<(usize, usize)> = None;
    for (i, f) in frames.iter().enumerate() {
        if f.f0_hz.is_none() {
            continue;
        }
        run = match run {
            Some((s, e)) if i - e <= 3 => Some((s, i)),
            _ => Some((i, i)),
        };
        if let Some((s, e)) = run
            && best.is_none_or(|(bs, be)| e - s > be - bs)
        {
            best = Some((s, e));
        }
    }
    let (s, e) = best?;
    let voiced_s = (e - s) as f64 * analysis.hop_s;
    if voiced_s < cfg.min_voiced_s {
        return None;
    }
    let (t_start, t_end) = (frames[s].time_s, frames[e].time_s);
    measure_steady_state(
        samples,
        sample_rate,
        cfg,
        &analysis.frames,
        t_start,
        t_end,
        voiced_s,
    )
}

/// Measures a vowel whose boundaries are known (a prompted vowel, or one
/// located by alignment): the steady state is the middle `steady_fraction`
/// of `[start_s, end_s]` (handbook §3.3). Returns `None` when the segment
/// has no voiced frames there or no ceiling finds F1–F3.
pub fn measure_vowel_between(
    samples: &[f32],
    sample_rate: f64,
    start_s: f64,
    end_s: f64,
    cfg: &VowelConfig,
) -> Option<VowelMeasurement> {
    if end_s.partial_cmp(&start_s) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    let pitch_cfg = Config {
        formants: None,
        ..cfg.analysis.clone()
    };
    let analysis = analyse(samples, sample_rate, &pitch_cfg);
    let voiced_s = analysis
        .frames
        .iter()
        .filter(|f| f.f0_hz.is_some() && (start_s..=end_s).contains(&f.time_s))
        .count() as f64
        * analysis.hop_s;
    measure_steady_state(
        samples,
        sample_rate,
        cfg,
        &analysis.frames,
        start_s,
        end_s,
        voiced_s,
    )
}

/// The shared second half: formants, ΔF and confidence over the middle of
/// `[t_start, t_end]`.
fn measure_steady_state(
    samples: &[f32],
    sample_rate: f64,
    cfg: &VowelConfig,
    frames: &[crate::Frame],
    t_start: f64,
    t_end: f64,
    voiced_s: f64,
) -> Option<VowelMeasurement> {
    let margin = 0.5 * (1.0 - cfg.steady_fraction) * (t_end - t_start);
    let (start_s, end_s) = (t_start + margin, t_end - margin);

    let f0s: Vec<f64> = frames
        .iter()
        .filter(|f| (start_s..=end_s).contains(&f.time_s))
        .filter_map(|f| f.f0_hz)
        .collect();
    let f0_median_hz = median(&f0s)?;

    let n = ((end_s - start_s) / cfg.formant_hop_s).floor() as usize + 1;
    let times: Vec<f64> = (0..n)
        .map(|k| start_s + k as f64 * cfg.formant_hop_s)
        .collect();
    let src = |i: i64| {
        usize::try_from(i)
            .ok()
            .and_then(|i| samples.get(i))
            .copied()
            .unwrap_or(0.0)
    };
    let result = sweep(src, sample_rate, &times, &cfg.formant, &cfg.ceilings_hz)?;

    let mut formants_hz = [None; 4];
    let mut bandwidths_hz = [None; 4];
    for k in 0..4 {
        let (f, b): (Vec<f64>, Vec<f64>) = result
            .frames
            .iter()
            .filter_map(|fr| fr.get(k).map(|f| (f.frequency_hz, f.bandwidth_hz)))
            .unzip();
        if 2 * f.len() >= result.frames.len() {
            formants_hz[k] = median(&f);
            bandwidths_hz[k] = median(&b);
        }
    }
    let delta_f_hz = formants_hz
        .iter()
        .copied()
        .collect::<Option<Vec<f64>>>()
        .and_then(|f| formant_dispersion(&f));
    let with_f1_f2 = result.frames.iter().filter(|f| f.len() >= 2).count();
    let confidence = formant_confidence(Some(f0_median_hz), bandwidths_hz[0], bandwidths_hz[1])
        * with_f1_f2 as f64
        / result.frames.len() as f64;

    Some(VowelMeasurement {
        start_s,
        end_s,
        voiced_s,
        f0_median_hz,
        ceiling_hz: result.ceiling_hz,
        ceiling_scores: result.scores,
        formants_hz,
        bandwidths_hz,
        delta_f_hz,
        avtl_cm: delta_f_hz.map(apparent_vtl_cm),
        confidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::*;

    const RATE: f64 = 48_000.0;

    fn padded(x: Vec<f64>) -> Vec<f32> {
        let pad = vec![0.0; (0.2 * RATE) as usize];
        let mut out = pad.clone();
        out.extend(x);
        out.extend(pad);
        to_f32(&out)
    }

    #[test]
    fn uniform_tube_vowel_gives_its_length() {
        // Schwa from a 17.5 cm tube: formants at 500, 1500, 2500, 3500 Hz.
        let formants = [
            (500.0, 60.0),
            (1500.0, 80.0),
            (2500.0, 100.0),
            (3500.0, 130.0),
            (4500.0, 170.0),
        ];
        let x = padded(vowel(120.0, &formants, RATE, RATE as usize, 0.2));
        let m = measure_vowel(&x, RATE, &VowelConfig::default()).unwrap();
        assert!((m.f0_median_hz / 120.0 - 1.0).abs() < 0.01, "{m:?}");
        for (k, (want, _)) in formants.iter().take(4).enumerate() {
            let got = m.formants_hz[k].unwrap();
            assert!(
                (got / want - 1.0).abs() < 0.05,
                "F{} {got} vs {want}",
                k + 1
            );
        }
        assert!((m.avtl_cm.unwrap() - 17.5).abs() < 0.6, "{m:?}");
        assert!((0.9..1.1).contains(&m.voiced_s), "{m:?}");
        assert!(m.start_s > 0.4 && m.end_s < 1.0, "{m:?}");
        assert!(m.confidence > 0.8, "{m:?}");
    }

    #[test]
    fn known_boundaries_measure_their_middle() {
        let formants = [
            (500.0, 60.0),
            (1500.0, 80.0),
            (2500.0, 100.0),
            (3500.0, 130.0),
            (4500.0, 170.0),
        ];
        // 0.2 s of padding, 0.3 s of vowel: shorter than the 0.25 s a
        // sustained vowel needs once edges are trimmed, but fine with known
        // boundaries.
        let x = padded(vowel(150.0, &formants, RATE, (0.3 * RATE) as usize, 0.2));
        let m = measure_vowel_between(&x, RATE, 0.2, 0.5, &VowelConfig::default()).unwrap();
        assert!((m.start_s - 0.275).abs() < 1e-9 && (m.end_s - 0.425).abs() < 1e-9);
        assert!(
            (m.formants_hz[1].unwrap() / 1500.0 - 1.0).abs() < 0.05,
            "{m:?}"
        );
        assert!(measure_vowel_between(&x, RATE, 0.5, 0.2, &VowelConfig::default()).is_none());
        assert!(measure_vowel_between(&x, RATE, 0.0, 0.15, &VowelConfig::default()).is_none());
    }

    #[test]
    fn too_short_or_silent_is_none() {
        let short = padded(vowel(150.0, &[(600.0, 80.0)], RATE, 4800, 0.0));
        assert!(measure_vowel(&short, RATE, &VowelConfig::default()).is_none());
        assert!(measure_vowel(&[0.0; 48_000], RATE, &VowelConfig::default()).is_none());
    }
}
