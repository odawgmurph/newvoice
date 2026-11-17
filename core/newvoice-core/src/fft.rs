//! Radix-2 complex FFT.

use std::f64::consts::PI;

use crate::roots::Complex;

/// A precomputed FFT of one power-of-two size.
#[derive(Debug, Clone)]
pub struct Fft {
    n: usize,
    twiddles: Vec<Complex>,
    bit_reverse: Vec<usize>,
}

impl Fft {
    /// Panics unless `n` is a power of two (and at least 2).
    pub fn new(n: usize) -> Self {
        assert!(
            n >= 2 && n.is_power_of_two(),
            "FFT size must be a power of two"
        );
        let bits = n.trailing_zeros();
        Self {
            n,
            twiddles: (0..n / 2)
                .map(|k| Complex::from_polar(1.0, -2.0 * PI * k as f64 / n as f64))
                .collect(),
            bit_reverse: (0..n)
                .map(|i| i.reverse_bits() >> (usize::BITS - bits))
                .collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        false
    }

    /// In-place forward transform: X[k] = Σ x[j]·e^(−2πi·jk/n).
    pub fn forward(&self, x: &mut [Complex]) {
        self.transform(x, false);
    }

    /// In-place inverse transform, including the 1/n scaling.
    pub fn inverse(&self, x: &mut [Complex]) {
        self.transform(x, true);
        let scale = 1.0 / self.n as f64;
        for v in x.iter_mut() {
            *v = v.scale(scale);
        }
    }

    fn transform(&self, x: &mut [Complex], inverse: bool) {
        assert_eq!(x.len(), self.n, "buffer length must equal the FFT size");
        for (i, &j) in self.bit_reverse.iter().enumerate() {
            if i < j {
                x.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= self.n {
            let half = size / 2;
            let stride = self.n / size;
            for start in (0..self.n).step_by(size) {
                for k in 0..half {
                    let w = self.twiddles[k * stride];
                    let w = if inverse { w.conj() } else { w };
                    let a = x[start + k];
                    let b = x[start + k + half] * w;
                    x[start + k] = a + b;
                    x[start + k + half] = a - b;
                }
            }
            size *= 2;
        }
    }

    /// Power spectrum |X[k]|² for k = 0..=n/2 of a real signal, zero-padded
    /// (or truncated) to the FFT size. `buf` is scratch space.
    pub fn power_spectrum(&self, x: &[f64], buf: &mut Vec<Complex>, out: &mut Vec<f64>) {
        buf.clear();
        buf.extend(x.iter().take(self.n).map(|&v| Complex::new(v, 0.0)));
        buf.resize(self.n, Complex::ZERO);
        self.forward(buf);
        out.clear();
        out.extend(buf[..=self.n / 2].iter().map(|c| c.re * c.re + c.im * c.im));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dft(x: &[Complex]) -> Vec<Complex> {
        let n = x.len();
        (0..n)
            .map(|k| {
                x.iter().enumerate().fold(Complex::ZERO, |acc, (j, &v)| {
                    acc + v * Complex::from_polar(1.0, -2.0 * PI * (j * k) as f64 / n as f64)
                })
            })
            .collect()
    }

    #[test]
    fn matches_naive_dft_and_inverts() {
        let x: Vec<Complex> = (0..64)
            .map(|i| Complex::new((i as f64 * 0.37).sin() + 0.1 * i as f64, (i as f64).cos()))
            .collect();
        let fft = Fft::new(64);
        let mut y = x.clone();
        fft.forward(&mut y);
        for (a, b) in y.iter().zip(dft(&x)) {
            assert!((*a - b).abs() < 1e-9);
        }
        fft.inverse(&mut y);
        for (a, b) in y.iter().zip(&x) {
            assert!((*a - *b).abs() < 1e-12);
        }
    }

    #[test]
    fn power_spectrum_of_a_bin_centred_sine() {
        let n = 256;
        let x: Vec<f64> = (0..n)
            .map(|i| (2.0 * PI * 8.0 * i as f64 / n as f64).cos())
            .collect();
        let (mut buf, mut p) = (Vec::new(), Vec::new());
        Fft::new(n).power_spectrum(&x, &mut buf, &mut p);
        assert_eq!(p.len(), n / 2 + 1);
        assert!((p[8] - (n as f64 / 2.0).powi(2)).abs() < 1e-6);
        assert!(p[7] < 1e-12 && p[9] < 1e-12);
    }
}
