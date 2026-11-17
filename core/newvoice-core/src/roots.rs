//! Complex numbers and polynomial root finding (Aberth–Ehrlich, Newton-polished).

use std::ops::{Add, Div, Mul, Sub};

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Complex {
    pub re: f64,
    pub im: f64,
}

impl Complex {
    pub const ZERO: Self = Self { re: 0.0, im: 0.0 };
    pub const ONE: Self = Self { re: 1.0, im: 0.0 };

    pub const fn new(re: f64, im: f64) -> Self {
        Self { re, im }
    }

    pub fn from_polar(r: f64, theta: f64) -> Self {
        Self::new(r * theta.cos(), r * theta.sin())
    }

    pub fn abs(self) -> f64 {
        self.re.hypot(self.im)
    }

    pub fn arg(self) -> f64 {
        self.im.atan2(self.re)
    }

    pub fn conj(self) -> Self {
        Self::new(self.re, -self.im)
    }

    pub fn recip(self) -> Self {
        let d = self.re * self.re + self.im * self.im;
        Self::new(self.re / d, -self.im / d)
    }

    pub fn scale(self, k: f64) -> Self {
        Self::new(self.re * k, self.im * k)
    }
}

impl Add for Complex {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.re + o.re, self.im + o.im)
    }
}

impl Sub for Complex {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.re - o.re, self.im - o.im)
    }
}

impl Mul for Complex {
    type Output = Self;
    fn mul(self, o: Self) -> Self {
        Self::new(
            self.re * o.re - self.im * o.im,
            self.re * o.im + self.im * o.re,
        )
    }
}

impl Div for Complex {
    type Output = Self;
    #[allow(clippy::suspicious_arithmetic_impl)]
    fn div(self, o: Self) -> Self {
        self * o.recip()
    }
}

/// Value and derivative of Σ c[k] zᵏ at `z` (Horner).
fn eval(coeffs: &[f64], z: Complex) -> (Complex, Complex) {
    let mut p = Complex::ZERO;
    let mut dp = Complex::ZERO;
    for &c in coeffs.iter().rev() {
        dp = dp * z + p;
        p = p * z + Complex::new(c, 0.0);
    }
    (p, dp)
}

/// All complex roots of Σ c[k] zᵏ, where `coeffs[0]` is the constant term.
///
/// Trailing zero coefficients are ignored. Roots at zero (from leading zero
/// constant terms) are returned as exact zeros.
pub fn roots(coeffs: &[f64]) -> Vec<Complex> {
    let mut c: &[f64] = coeffs;
    while let Some((&last, rest)) = c.split_last() {
        if last != 0.0 {
            break;
        }
        c = rest;
    }
    let mut zeros = 0;
    while c.len() > 1 && c[0] == 0.0 {
        c = &c[1..];
        zeros += 1;
    }
    let n = c.len().saturating_sub(1);
    let mut out = vec![Complex::ZERO; zeros];
    if n == 0 {
        return out;
    }

    // Start on a circle whose radius is the geometric mean of the root moduli.
    let radius = (c[0] / c[n]).abs().powf(1.0 / n as f64).max(1e-3);
    let mut z: Vec<Complex> = (0..n)
        .map(|k| {
            Complex::from_polar(
                radius,
                2.0 * std::f64::consts::PI * k as f64 / n as f64 + 0.4,
            )
        })
        .collect();

    for _ in 0..500 {
        let mut biggest = 0.0f64;
        for i in 0..n {
            let (p, dp) = eval(c, z[i]);
            if p.abs() == 0.0 {
                continue;
            }
            let ratio = p / dp;
            let mut sum = Complex::ZERO;
            for (j, &zj) in z.iter().enumerate() {
                if j != i {
                    sum = sum + (z[i] - zj).recip();
                }
            }
            let w = ratio / (Complex::ONE - ratio * sum);
            if w.re.is_finite() && w.im.is_finite() {
                z[i] = z[i] - w;
                biggest = biggest.max(w.abs() / z[i].abs().max(1e-300));
            }
        }
        if biggest < 1e-15 {
            break;
        }
    }

    // Newton polish.
    for zi in &mut z {
        for _ in 0..3 {
            let (p, dp) = eval(c, *zi);
            if dp.abs() == 0.0 {
                break;
            }
            let step = p / dp;
            if !(step.re.is_finite() && step.im.is_finite()) {
                break;
            }
            *zi = *zi - step;
        }
    }
    out.extend(z);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(mut v: Vec<Complex>) -> Vec<Complex> {
        v.sort_by(|a, b| a.re.total_cmp(&b.re).then(a.im.total_cmp(&b.im)));
        v
    }

    #[test]
    fn real_roots() {
        // (z − 1)(z − 2)(z + 3) = z³ − 7z + 6
        let r = sorted(roots(&[6.0, -7.0, 0.0, 1.0]));
        for (got, want) in r.iter().zip([-3.0, 1.0, 2.0]) {
            assert!((got.re - want).abs() < 1e-10 && got.im.abs() < 1e-10);
        }
    }

    #[test]
    fn complex_conjugate_pairs_near_unit_circle() {
        // Product of (z² − 2r cos θ z + r²) for several resonances, as LPC gives.
        let poles = [
            (0.97, 0.1),
            (0.95, 0.5),
            (0.9, 1.2),
            (0.93, 2.0),
            (0.85, 2.8),
        ];
        let mut poly = vec![1.0];
        for (r, th) in poles {
            let quad = [r * r, -2.0 * r * f64::cos(th), 1.0];
            let mut next = vec![0.0; poly.len() + 2];
            for (i, a) in poly.iter().enumerate() {
                for (j, b) in quad.iter().enumerate() {
                    next[i + j] += a * b;
                }
            }
            poly = next;
        }
        let found = roots(&poly);
        assert_eq!(found.len(), 10);
        for (r, th) in poles {
            let want = Complex::from_polar(r, th);
            let best = found
                .iter()
                .map(|z| (*z - want).abs())
                .fold(f64::MAX, f64::min);
            assert!(best < 1e-9, "missing root r={r} θ={th}: {best}");
        }
    }

    #[test]
    fn zero_roots_and_trailing_zeros() {
        // z²(z − 5), written with a trailing zero coefficient.
        let r = sorted(roots(&[0.0, 0.0, -5.0, 1.0, 0.0]));
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], Complex::ZERO);
        assert!((r[2].re - 5.0).abs() < 1e-12);
    }
}
