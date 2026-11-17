//! Linear prediction by Burg's method.

/// Burg's method (as `memcof` in Numerical Recipes, which Praat also uses).
///
/// Returns predictor coefficients `d[0..order]` such that
/// `x[n] ≈ Σₖ d[k−1]·x[n−k]`, and the residual power. Returns `None` when the
/// frame is too short or silent.
pub fn burg(x: &[f64], order: usize) -> Option<(Vec<f64>, f64)> {
    let n = x.len();
    if order == 0 || n <= order + 1 {
        return None;
    }
    let power: f64 = x.iter().map(|v| v * v).sum::<f64>() / n as f64;
    if power <= 0.0 {
        return None;
    }
    let mut residual = power;
    let mut wk1: Vec<f64> = x[..n - 1].to_vec();
    let mut wk2: Vec<f64> = x[1..].to_vec();
    let mut d = vec![0.0; order + 1]; // 1-based
    let mut wkm = vec![0.0; order + 1];

    for k in 1..=order {
        let mut num = 0.0;
        let mut den = 0.0;
        for j in 0..n - k {
            num += wk1[j] * wk2[j];
            den += wk1[j] * wk1[j] + wk2[j] * wk2[j];
        }
        if den <= 0.0 {
            return None;
        }
        d[k] = 2.0 * num / den;
        residual *= 1.0 - d[k] * d[k];
        for i in 1..k {
            d[i] = wkm[i] - d[k] * wkm[k - i];
        }
        if k == order {
            break;
        }
        wkm[1..=k].copy_from_slice(&d[1..=k]);
        for j in 0..n - k - 1 {
            wk1[j] -= wkm[k] * wk2[j];
            wk2[j] = wk2[j + 1] - wkm[k] * wk1[j + 1];
        }
    }
    d.remove(0);
    Some((d, residual))
}

/// Coefficients of zᵖ·A(z), where A(z) = 1 − Σ dₖ z⁻ᵏ is the inverse filter,
/// in ascending powers (constant term first).
pub fn inverse_filter_polynomial(d: &[f64]) -> Vec<f64> {
    let mut c: Vec<f64> = d.iter().rev().map(|v| -v).collect();
    c.push(1.0);
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsig::noise;

    #[test]
    fn recovers_a_known_ar2_process() {
        // x[n] = 1.6 x[n−1] − 0.81 x[n−2] + e[n]  (poles at 0.9∠±27°)
        let e = noise(1.0, 20_000, 42);
        let mut x = vec![0.0; e.len()];
        for n in 2..x.len() {
            x[n] = 1.6 * x[n - 1] - 0.81 * x[n - 2] + e[n];
        }
        let (d, _) = burg(&x, 2).unwrap();
        assert!((d[0] - 1.6).abs() < 0.02, "{d:?}");
        assert!((d[1] + 0.81).abs() < 0.02, "{d:?}");
    }

    #[test]
    fn silent_or_short_frames_are_rejected() {
        assert!(burg(&[0.0; 100], 10).is_none());
        assert!(burg(&[1.0, 2.0, 3.0], 10).is_none());
    }

    #[test]
    fn polynomial_layout() {
        assert_eq!(
            inverse_filter_polynomial(&[1.6, -0.81]),
            vec![0.81, -1.6, 1.0]
        );
    }
}
