//! The vowel-normalised resonance score (handbook §3.3): a **heuristic**
//! placing a voice's formants between two reference groups, vowel by vowel.
//!
//! For each vowel token v and formant Fi,
//! `z = ln(Fi_v / Fi_ref_a(v)) / ln(Fi_ref_b(v) / Fi_ref_a(v))`,
//! so 0 sits at reference group A's mean and 1 at group B's, whatever the
//! vowel. The references are the Hillenbrand (1995) adult groups from
//! `content/norms/reference_norms.json` (A = men, B = women), and "mean"
//! here is the geometric mean (the mean of ln Hz), which is what a log
//! ratio compares against. The score is the weighted median of the
//! per-formant z values across tokens: F2 counts double, since it tracks
//! listeners' ratings more closely than F1 or F3 (handbook §1.3, §3.6), and
//! each token is weighted by the caller's confidence in it.
//!
//! A vowel's formant is left out when the two groups barely differ on it
//! relative to their spread (separation d′ under [`MIN_SEPARATION`]): there,
//! a small measurement error swings z widely. From the norms, that drops F1
//! of /o/ and F2 of /ʊ/ and /u/; it is how "F1 where vowel-appropriate" is
//! applied.
//!
//! The scale is only a position relative to two population means. It says
//! nothing about how a voice will be perceived, values below 0 and above 1
//! are normal, and the app labels it brighter/darker by default, never by
//! gender (decision D2). Bump [`RESONANCE_SCORE_VERSION`] on any change.

use crate::reference_norms::{DELTA_F, VOWELS};

/// Version of the resonance score definition.
pub const RESONANCE_SCORE_VERSION: u32 = 1;

/// Smallest group separation (difference of log means over the pooled log
/// SD) at which a vowel's formant is scored.
pub const MIN_SEPARATION: f64 = 1.0;

/// Relative weights of F1, F2 and F3 in the score.
pub const FORMANT_WEIGHTS: [f64; 3] = [1.0, 2.0, 1.0];

/// Natural-log mean and SD of a measure in Hz.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogNorm {
    pub mean: f64,
    pub sd: f64,
}

impl LogNorm {
    /// Separation between two groups in pooled-SD units.
    fn separation(a: LogNorm, b: LogNorm) -> f64 {
        (b.mean - a.mean) / (0.5 * (a.sd * a.sd + b.sd * b.sd)).sqrt()
    }

    /// Position of `value_hz` on the scale from `a` (0) to `b` (1).
    fn position(value_hz: f64, a: LogNorm, b: LogNorm) -> f64 {
        (value_hz.ln() - a.mean) / (b.mean - a.mean)
    }
}

/// One vowel's reference F1–F3 for each group.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VowelNorm {
    /// Hillenbrand's code, for example `"iy"`.
    pub code: &'static str,
    pub ipa: &'static str,
    /// The h_d word it was recorded in, for example `"heed"`.
    pub word: &'static str,
    pub men: [LogNorm; 3],
    pub women: [LogNorm; 3],
}

impl VowelNorm {
    /// Looks a vowel up by Hillenbrand code (`"iy"`) or IPA (`"i"`).
    pub fn find(key: &str) -> Option<&'static VowelNorm> {
        VOWELS.iter().find(|v| v.code == key || v.ipa == key)
    }

    /// All reference vowels.
    pub fn all() -> &'static [VowelNorm] {
        &VOWELS
    }

    /// Whether formant `k` (0 = F1) separates the groups well enough to score.
    pub fn scores_formant(&self, k: usize) -> bool {
        LogNorm::separation(self.men[k], self.women[k]) >= MIN_SEPARATION
    }

    /// The per-formant positions of a token of this vowel: `None` where the
    /// formant is missing, not positive, or not scored for this vowel.
    pub fn positions(&self, formants_hz: [Option<f64>; 3]) -> [Option<f64>; 3] {
        std::array::from_fn(|k| {
            formants_hz[k]
                .filter(|&f| f > 0.0 && self.scores_formant(k))
                .map(|f| LogNorm::position(f, self.men[k], self.women[k]))
        })
    }
}

/// One measured vowel token.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VowelToken {
    pub vowel: &'static VowelNorm,
    /// F1, F2, F3 in Hz.
    pub formants_hz: [Option<f64>; 3],
    /// How much to trust this token, ≥ 0 (for example
    /// [`crate::VowelMeasurement::confidence`]).
    pub weight: f64,
}

/// The resonance score of a set of tokens.
#[derive(Debug, Clone, PartialEq)]
pub struct ResonanceScore {
    /// Weighted median position across all scored formants of all tokens.
    pub score: f64,
    /// The same, per formant (F1, F2, F3), where any token had it.
    pub by_formant: [Option<f64>; 3],
    /// Tokens that contributed at least one formant.
    pub tokens_used: usize,
    /// Per-token positions (F1, F2, F3), in input order.
    pub token_positions: Vec<[Option<f64>; 3]>,
}

/// Scores tokens. `None` when no token has a scored formant with positive
/// weight.
pub fn resonance_score(tokens: &[VowelToken]) -> Option<ResonanceScore> {
    let token_positions: Vec<[Option<f64>; 3]> = tokens
        .iter()
        .map(|t| t.vowel.positions(t.formants_hz))
        .collect();
    let mut all = Vec::new();
    let mut per = [Vec::new(), Vec::new(), Vec::new()];
    let mut tokens_used = 0;
    for (t, pos) in tokens.iter().zip(&token_positions) {
        let w = if t.weight.is_finite() {
            t.weight.max(0.0)
        } else {
            0.0
        };
        if w == 0.0 || pos.iter().all(Option::is_none) {
            continue;
        }
        tokens_used += 1;
        for (k, p) in pos.iter().enumerate() {
            if let Some(z) = *p {
                all.push((z, w * FORMANT_WEIGHTS[k]));
                per[k].push((z, w));
            }
        }
    }
    Some(ResonanceScore {
        score: weighted_median(&mut all)?,
        by_formant: per.map(|mut v| weighted_median(&mut v)),
        tokens_used,
        token_positions,
    })
}

/// Position of a formant dispersion ΔF (Hz) on the same men (0) to women (1)
/// scale, from the groups' speaker-level ΔF. Vowel-independent, but needs
/// F1–F4 from a steady vowel.
pub fn delta_f_position(delta_f_hz: f64) -> Option<f64> {
    (delta_f_hz > 0.0).then(|| LogNorm::position(delta_f_hz, DELTA_F[0], DELTA_F[1]))
}

/// The value where the cumulative weight first reaches half the total,
/// averaging two values when it lands exactly on half. `None` for no
/// positive weight.
fn weighted_median(values: &mut [(f64, f64)]) -> Option<f64> {
    let total: f64 = values.iter().map(|v| v.1).sum();
    if total <= 0.0 {
        return None;
    }
    values.sort_by(|a, b| a.0.total_cmp(&b.0));
    let half = 0.5 * total;
    let mut acc = 0.0;
    for (i, &(z, w)) in values.iter().enumerate() {
        acc += w;
        if (acc - half).abs() <= 1e-12 * total {
            let next = values[i + 1..]
                .iter()
                .find(|v| v.1 > 0.0)
                .map_or(z, |v| v.0);
            return Some(0.5 * (z + next));
        }
        if acc > half {
            return Some(z);
        }
    }
    values.last().map(|v| v.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo(n: LogNorm) -> f64 {
        n.mean.exp()
    }

    fn token(code: &str, f: [f64; 3]) -> VowelToken {
        VowelToken {
            vowel: VowelNorm::find(code).unwrap(),
            formants_hz: f.map(Some),
            weight: 1.0,
        }
    }

    #[test]
    fn reference_means_score_zero_and_one() {
        for v in VowelNorm::all() {
            let men = token(v.code, v.men.map(geo));
            let women = token(v.code, v.women.map(geo));
            let a = resonance_score(&[men]).unwrap();
            let b = resonance_score(&[women]).unwrap();
            assert!(a.score.abs() < 1e-9, "{} {a:?}", v.code);
            assert!((b.score - 1.0).abs() < 1e-9, "{} {b:?}", v.code);
        }
    }

    #[test]
    fn weakly_separated_formants_are_left_out() {
        let skipped: Vec<(&str, usize)> = VowelNorm::all()
            .iter()
            .flat_map(|v| {
                (0..3)
                    .filter(|&k| !v.scores_formant(k))
                    .map(|k| (v.code, k))
            })
            .collect();
        assert_eq!(skipped, [("oa", 0), ("oo", 1), ("uw", 1)]);
        let uw = VowelNorm::find("u").unwrap();
        assert_eq!(uw.positions([Some(400.0), Some(1000.0), None])[1], None);
    }

    #[test]
    fn halfway_in_log_frequency_scores_one_half() {
        let v = VowelNorm::find("ae").unwrap();
        let mid = std::array::from_fn(|k| (0.5 * (v.men[k].mean + v.women[k].mean)).exp());
        let s = resonance_score(&[token("ae", mid)]).unwrap();
        assert!((s.score - 0.5).abs() < 1e-9);
        assert_eq!(s.by_formant.map(|z| (z.unwrap() * 1e6).round()), [5e5; 3]);
    }

    #[test]
    fn f2_outweighs_f1_and_f3_and_weights_matter() {
        let v = VowelNorm::find("iy").unwrap();
        // F2 at the women's mean, F1 and F3 at the men's.
        let f = [geo(v.men[0]), geo(v.women[1]), geo(v.men[2])];
        let s = resonance_score(&[token("iy", f)]).unwrap();
        // Weights 1, 2, 1 of values 0, 1, 0: half the weight on each side.
        assert!((s.score - 0.5).abs() < 1e-9, "{s:?}");

        let low = token("iy", v.men.map(geo));
        let mut high = token("iy", v.women.map(geo));
        high.weight = 3.0;
        assert!((resonance_score(&[low, high]).unwrap().score - 1.0).abs() < 1e-9);
        high.weight = 0.0;
        let s = resonance_score(&[low, high]).unwrap();
        assert_eq!(s.tokens_used, 1);
        assert!(s.score.abs() < 1e-9);
    }

    #[test]
    fn nothing_to_score_is_none() {
        assert!(resonance_score(&[]).is_none());
        let mut t = token("ah", [700.0, 1200.0, 2500.0]);
        t.formants_hz = [None; 3];
        assert!(resonance_score(&[t]).is_none());
        assert!(VowelNorm::find("xx").is_none());
    }

    #[test]
    fn delta_f_positions() {
        assert!(delta_f_position(DELTA_F[0].mean.exp()).unwrap().abs() < 1e-9);
        assert!((delta_f_position(DELTA_F[1].mean.exp()).unwrap() - 1.0).abs() < 1e-9);
        assert!(delta_f_position(0.0).is_none());
    }

    #[test]
    fn weighted_median_cases() {
        assert_eq!(
            weighted_median(&mut [(3.0, 1.0), (1.0, 1.0), (2.0, 1.0)]),
            Some(2.0)
        );
        assert_eq!(weighted_median(&mut [(1.0, 1.0), (2.0, 1.0)]), Some(1.5));
        assert_eq!(weighted_median(&mut [(1.0, 1.0), (5.0, 3.0)]), Some(5.0));
        assert_eq!(weighted_median(&mut [(1.0, 0.0)]), None);
    }
}
