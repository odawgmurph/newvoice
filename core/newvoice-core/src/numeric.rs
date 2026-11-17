//! Small numerical routines that follow Praat's definitions exactly, so that
//! measures validated against Praat behave the same way.

use std::f64::consts::PI;

/// Median of a slice (sorts it in place). `NaN` when empty.
pub fn median_in_place(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

/// Robust straight-line fit by Theil's incomplete method (Praat's
/// `NUMfitLine_theil` as used by "Robust"): the slope is the median of the
/// slopes between points i and i + n/2; the intercept the median of
/// y − slope·x. Returns (slope, intercept).
pub fn theil_incomplete(x: &[f64], y: &[f64]) -> (f64, f64) {
    let n = x.len();
    assert_eq!(n, y.len());
    match n {
        0 => (0.0, 0.0),
        1 => (0.0, y[0]),
        2 => {
            let m = (y[1] - y[0]) / (x[1] - x[0]);
            (m, y[0] - m * x[0])
        }
        _ => {
            let half = n / 2;
            let mut slopes: Vec<f64> = (0..half)
                .map(|i| (y[half + i] - y[i]) / (x[half + i] - x[i]))
                .collect();
            let m = median_in_place(&mut slopes);
            let mut b: Vec<f64> = x.iter().zip(y).map(|(xi, yi)| yi - m * xi).collect();
            (m, median_in_place(&mut b))
        }
    }
}

/// Praat's centred moving average (`VECsmoothByMovingAverage`): for an even
/// window the extra point is on the left; the window shrinks at the edges.
pub fn moving_average(input: &[f64], window: usize, out: &mut Vec<f64>) {
    let n = input.len();
    out.clear();
    if window <= 1 {
        out.extend_from_slice(input);
        return;
    }
    for i in 0..n {
        let from = i.saturating_sub(window / 2);
        let mut to = i + window / 2;
        if window.is_multiple_of(2) {
            to -= 1;
        }
        let to = to.min(n - 1);
        let sum: f64 = input[from..=to].iter().sum();
        out.push(sum / (to - from + 1) as f64);
    }
}

/// Praat's `NUM_interpolate_sinc`: `y` sampled at integers 0..n, evaluated
/// at real position `x` with a raised-cosine-windowed sinc of up to
/// `max_depth` samples each side.
pub fn interpolate_sinc(y: &[f64], x: f64, max_depth: usize) -> f64 {
    let n = y.len();
    if n == 0 {
        return f64::NAN;
    }
    if x <= 0.0 {
        return y[0];
    }
    if x >= (n - 1) as f64 {
        return y[n - 1];
    }
    let midleft = x.floor() as usize;
    if x == midleft as f64 {
        return y[midleft];
    }
    let midright = midleft + 1;
    let depth = max_depth.min(midright).min(n - 1 - midleft);
    if depth == 0 {
        return y[(x.round()) as usize];
    }
    if depth == 1 {
        return y[midleft] + (x - midleft as f64) * (y[midright] - y[midleft]);
    }
    let left = midright - depth;
    let right = midleft + depth;
    // Each term is sinc(d) · ½(1 + cos(π·d / span)) at distance d from x.
    // Stepping d by 1 flips the sign of sin(πd) and rotates the window's
    // cosine by a fixed angle, so the loop needs no trigonometry (as in
    // Praat).
    let side = |start_distance: f64, span: f64, values: &mut dyn Iterator<Item = f64>| {
        let mut a = PI * start_distance;
        let mut half_sin_a = 0.5 * a.sin();
        let (step_cos, step_sin) = ((PI / span).cos(), (PI / span).sin());
        let (mut cos_w, mut sin_w) = ((a / span).cos(), (a / span).sin());
        let mut sum = 0.0;
        for v in values {
            sum += v * half_sin_a / a * (1.0 + cos_w);
            a += PI;
            (cos_w, sin_w) = (
                cos_w * step_cos - sin_w * step_sin,
                cos_w * step_sin + sin_w * step_cos,
            );
            half_sin_a = -half_sin_a;
        }
        sum
    };
    side(
        x - midleft as f64,
        x - left as f64 + 1.0,
        &mut y[left..=midleft].iter().rev().copied(),
    ) + side(
        midright as f64 - x,
        right as f64 - x + 1.0,
        &mut y[midright..=right].iter().copied(),
    )
}

/// Refines a local maximum of `y` at integer `i` by maximising the sinc
/// interpolation over (i − 1, i + 1), as Praat's `NUMimproveMaximum` does.
/// Returns (position, value).
pub fn improve_maximum_sinc(y: &[f64], i: usize, depth: usize) -> (f64, f64) {
    let f = |x: f64| interpolate_sinc(y, x, depth);
    let x = crate::quality::spectral::golden_max(f, i as f64 - 1.0, i as f64 + 1.0, 1e-7);
    (x, f(x))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theil_ignores_outliers() {
        let x: Vec<f64> = (0..21).map(f64::from).collect();
        let mut y: Vec<f64> = x.iter().map(|v| 2.0 * v + 1.0).collect();
        y[3] = 100.0;
        y[17] = -50.0;
        let (m, b) = theil_incomplete(&x, &y);
        assert!(
            (m - 2.0).abs() < 1e-12 && (b - 1.0).abs() < 1e-12,
            "{m} {b}"
        );
    }

    #[test]
    fn moving_average_matches_praat_layout() {
        let mut out = Vec::new();
        moving_average(&[1.0, 2.0, 3.0, 4.0, 5.0], 2, &mut out);
        // Window 2: [i−1, i], shrinking at the start.
        assert_eq!(out, vec![1.0, 1.5, 2.5, 3.5, 4.5]);
        moving_average(&[1.0, 2.0, 3.0, 4.0, 5.0], 3, &mut out);
        assert_eq!(out, vec![1.5, 2.0, 3.0, 4.0, 4.5]);
    }

    #[test]
    fn sinc_interpolation_reproduces_a_slow_sine() {
        let y: Vec<f64> = (0..200).map(|i| (i as f64 * 0.1).sin()).collect();
        for x in [50.3, 99.75, 120.5] {
            let v = interpolate_sinc(&y, x, 70);
            assert!((v - (x * 0.1).sin()).abs() < 1e-3, "{x}: {v}");
        }
        // Peak of sin(0.1x) at x = 25π, with the full 70-sample depth available.
        let (pos, val) = improve_maximum_sinc(&y, 79, 70);
        assert!(
            (pos - 25.0 * PI).abs() < 1e-3 && (val - 1.0).abs() < 1e-4,
            "{pos} {val}"
        );
    }
}
