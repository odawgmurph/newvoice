//! Per-frame spectral voice-quality measures (handbook §3.4): H1–H2 and its
//! formant-corrected form H1*–H2*, alpha ratio, Hammarberg index and L/H
//! ratio.
//!
//! All run on the 16 kHz pitch frame of voiced frames, so they are available
//! live. Band edges are part of each measure's definition; changing one
//! changes the measure, so bump [`super::QUALITY_VERSION`].

use std::f64::consts::PI;

use crate::fft::Fft;
use crate::formant::FormantFrame;
use crate::roots::Complex;

/// Alpha ratio: energy 1–5 kHz over energy 50 Hz–1 kHz (eGeMAPS).
pub const ALPHA_LOW_HZ: (f64, f64) = (50.0, 1000.0);
pub const ALPHA_HIGH_HZ: (f64, f64) = (1000.0, 5000.0);
/// Hammarberg index: strongest peak 0–2 kHz minus strongest peak 2–5 kHz.
pub const HAMMARBERG_LOW_HZ: (f64, f64) = (0.0, 2000.0);
pub const HAMMARBERG_HIGH_HZ: (f64, f64) = (2000.0, 5000.0);
/// L/H ratio: energy 50 Hz–4 kHz over 4–8 kHz.
pub const LH_LOW_HZ: (f64, f64) = (50.0, 4000.0);
pub const LH_HIGH_HZ: (f64, f64) = (4000.0, 8000.0);

/// Spectral measures of one voiced frame, in dB.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameSpectral {
    /// First harmonic amplitude (dB re a full-scale sine).
    pub h1_db: f64,
    /// Second harmonic amplitude.
    pub h2_db: f64,
    /// H1 − H2. Higher = breathier / lighter, lower = pressed / heavier.
    pub h1_h2_db: f64,
    /// H1* − H2*: H1 − H2 with the boost from F1 and F2 removed (Iseli &
    /// Alwan 2004), so it reflects the source rather than the vowel. `None`
    /// without F1 and F2.
    pub h1c_h2c_db: Option<f64>,
    /// 10·log10(E[1–5 kHz] / E[50 Hz–1 kHz]). Less negative = more
    /// high-frequency energy.
    pub alpha_ratio_db: f64,
    /// Strongest peak 0–2 kHz minus strongest peak 2–5 kHz.
    pub hammarberg_db: f64,
    /// 10·log10(E[50 Hz–4 kHz] / E[4–8 kHz]).
    pub lh_ratio_db: f64,
}

/// Analyses frames of a fixed length at a fixed rate.
#[derive(Debug, Clone)]
pub struct SpectralAnalyser {
    rate: f64,
    window: Vec<f64>,
    window_sum: f64,
    fft: Fft,
    windowed: Vec<f64>,
    buf: Vec<Complex>,
    power: Vec<f64>,
}

impl SpectralAnalyser {
    pub fn new(frame_len: usize, rate: f64) -> Self {
        // Periodic-free symmetric Hann.
        let window: Vec<f64> = (0..frame_len)
            .map(|i| 0.5 - 0.5 * (2.0 * PI * (i as f64 + 1.0) / (frame_len as f64 + 1.0)).cos())
            .collect();
        Self {
            rate,
            window_sum: window.iter().sum(),
            window,
            fft: Fft::new(frame_len.next_power_of_two().max(2)),
            windowed: Vec::with_capacity(frame_len),
            buf: Vec::new(),
            power: Vec::new(),
        }
    }

    /// Measures one frame (`frame_len` samples) whose F0 is `f0_hz`.
    /// `formants`, if given, supply F1 and F2 for the H1*–H2* correction.
    pub fn analyse(
        &mut self,
        frame: &[f64],
        f0_hz: f64,
        formants: Option<&FormantFrame>,
    ) -> FrameSpectral {
        let mean = frame.iter().sum::<f64>() / frame.len() as f64;
        self.windowed.clear();
        self.windowed
            .extend(frame.iter().zip(&self.window).map(|(x, w)| (x - mean) * w));
        self.fft
            .power_spectrum(&self.windowed, &mut self.buf, &mut self.power);

        let bin_hz = self.rate / self.fft.len() as f64;
        let band = |(lo, hi): (f64, f64)| -> (f64, f64) {
            let (mut sum, mut peak) = (0.0, 0.0f64);
            for (k, p) in self.power.iter().enumerate() {
                let f = k as f64 * bin_hz;
                if f >= lo && f < hi {
                    sum += p;
                    peak = peak.max(*p);
                }
            }
            (sum, peak)
        };
        let db = |x: f64| 10.0 * x.max(1e-30).log10();
        let ratio = |num: (f64, f64), den: (f64, f64)| db(band(num).0) - db(band(den).0);

        let h1_db = self.harmonic_db(f0_hz, 1);
        let h2_db = self.harmonic_db(f0_hz, 2);
        let h1c_h2c_db = formants.and_then(|fr| {
            let (f1, f2) = (fr.frequency(0)?, fr.frequency(1)?);
            let boost = |f: f64| {
                [f1, f2]
                    .iter()
                    .map(|&fx| {
                        formant_boost_db(f, fx, hawks_miller_bandwidth(fx, f0_hz), self.rate)
                    })
                    .sum::<f64>()
            };
            Some((h1_db - boost(f0_hz)) - (h2_db - boost(2.0 * f0_hz)))
        });

        FrameSpectral {
            h1_db,
            h2_db,
            h1_h2_db: h1_db - h2_db,
            h1c_h2c_db,
            alpha_ratio_db: ratio(ALPHA_HIGH_HZ, ALPHA_LOW_HZ),
            hammarberg_db: db(band(HAMMARBERG_LOW_HZ).1) - db(band(HAMMARBERG_HIGH_HZ).1),
            lh_ratio_db: ratio(LH_LOW_HZ, LH_HIGH_HZ),
        }
    }

    /// Amplitude (dB re a full-scale sine) of harmonic `k`: the maximum of
    /// the windowed DTFT within ±10% of F0 around k·F0.
    fn harmonic_db(&self, f0_hz: f64, k: u32) -> f64 {
        let centre = f0_hz * f64::from(k);
        let (lo, hi) = (centre - 0.1 * f0_hz, centre + 0.1 * f0_hz);
        let magnitude = |f: f64| self.dtft_magnitude(f);
        // Coarse grid, then golden-section refinement around the best point.
        let steps = 10;
        let step = (hi - lo) / steps as f64;
        let best = (0..=steps)
            .map(|i| lo + i as f64 * step)
            .max_by(|a, b| magnitude(*a).total_cmp(&magnitude(*b)))
            .expect("non-empty grid");
        let f = golden_max(
            magnitude,
            (best - step).max(lo),
            (best + step).min(hi),
            0.01,
        );
        20.0 * (2.0 * magnitude(f) / self.window_sum).max(1e-15).log10()
    }

    /// |Σ w[j]·x[j]·e^(−2πi·f·j/rate)| of the current windowed frame.
    fn dtft_magnitude(&self, f: f64) -> f64 {
        let step = Complex::from_polar(1.0, -2.0 * PI * f / self.rate);
        let mut phasor = Complex::ONE;
        let mut acc = Complex::ZERO;
        for &x in &self.windowed {
            acc = acc + phasor.scale(x);
            phasor = phasor * step;
        }
        acc.abs()
    }
}

/// Maximises a unimodal `f` on [a, b] by golden-section search.
pub(crate) fn golden_max(f: impl Fn(f64) -> f64, mut a: f64, mut b: f64, tol: f64) -> f64 {
    let g = 0.5 * (5f64.sqrt() - 1.0);
    let mut c = b - g * (b - a);
    let mut d = a + g * (b - a);
    let (mut fc, mut fd) = (f(c), f(d));
    while (b - a).abs() > tol {
        if fc > fd {
            b = d;
            d = c;
            fd = fc;
            c = b - g * (b - a);
            fc = f(c);
        } else {
            a = c;
            c = d;
            fc = fd;
            d = a + g * (b - a);
            fd = f(d);
        }
    }
    0.5 * (a + b)
}

/// Gain (dB) at frequency `f` of a digital two-pole resonator at `fx` with
/// bandwidth `bx`, normalised to 0 dB at DC: the amount a formant boosts a
/// harmonic, as subtracted by Iseli & Alwan (2004) and VoiceSauce.
pub fn formant_boost_db(f: f64, fx: f64, bx: f64, rate: f64) -> f64 {
    let r = (-PI * bx / rate).exp();
    let wx = 2.0 * PI * fx / rate;
    let w = 2.0 * PI * f / rate;
    let a = r * r + 1.0 - 2.0 * r * (wx + w).cos();
    let b = r * r + 1.0 - 2.0 * r * (wx - w).cos();
    let dc = r * r + 1.0 - 2.0 * r * wx.cos();
    20.0 * dc.log10() - 10.0 * (a.log10() + b.log10())
}

/// Formant bandwidth predicted from its frequency and F0 (Hawks & Miller
/// 1995), as VoiceSauce uses for the H1*–H2* correction. LPC bandwidths are
/// too unreliable at high F0 to use directly.
pub fn hawks_miller_bandwidth(fx: f64, f0_hz: f64) -> f64 {
    const BELOW_500: [f64; 6] = [
        165.327516,
        -6.73636734e-1,
        1.80874446e-3,
        -4.52201682e-6,
        7.49514000e-9,
        -4.70219241e-12,
    ];
    const FROM_500: [f64; 6] = [
        15.8146139,
        8.10159009e-2,
        -9.79728215e-5,
        5.28725064e-8,
        -1.07099364e-11,
        7.91528509e-16,
    ];
    let s = 1.0 + 0.25 * (f0_hz - 132.0) / 88.0;
    let c = if fx < 500.0 { &BELOW_500 } else { &FROM_500 };
    s * c.iter().rev().fold(0.0, |acc, k| acc * fx + k)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pitch::PITCH_RATE;

    const N: usize = 669; // the default pitch frame length

    /// Harmonics k·f0 with amplitudes a(k), no formants.
    fn harmonics(f0: f64, amp: impl Fn(usize) -> f64) -> Vec<f64> {
        let top = (7900.0 / f0) as usize;
        (0..N)
            .map(|i| {
                let t = i as f64 / PITCH_RATE;
                (1..=top)
                    .map(|k| amp(k) * (2.0 * PI * k as f64 * f0 * t + 0.3 * k as f64).sin())
                    .sum()
            })
            .collect()
    }

    #[test]
    fn h1_h2_of_known_harmonics() {
        let mut a = SpectralAnalyser::new(N, PITCH_RATE);
        for (f0, h1h2) in [(100.0, 6.0), (150.0, -3.0), (220.0, 10.0), (310.0, 0.0)] {
            let a2 = 0.1 * 10f64.powf(-h1h2 / 20.0);
            let x = harmonics(f0, |k| match k {
                1 => 0.1,
                2 => a2,
                _ => 0.02 / k as f64,
            });
            let m = a.analyse(&x, f0 * 1.01, None);
            assert!((m.h1_h2_db - h1h2).abs() < 0.3, "f0 {f0}: {m:?}");
            assert!((m.h1_db - 20.0 * 0.1f64.log10()).abs() < 0.3, "{m:?}");
            assert!(m.h1c_h2c_db.is_none());
        }
    }

    #[test]
    fn band_ratios_follow_spectral_tilt() {
        let mut a = SpectralAnalyser::new(N, PITCH_RATE);
        let steep = a.analyse(&harmonics(150.0, |k| 1.0 / (k * k) as f64), 150.0, None);
        let flat = a.analyse(&harmonics(150.0, |k| 1.0 / k as f64), 150.0, None);
        assert!(
            flat.alpha_ratio_db > steep.alpha_ratio_db + 10.0,
            "{flat:?} {steep:?}"
        );
        assert!(flat.hammarberg_db < steep.hammarberg_db);
        assert!(flat.lh_ratio_db < steep.lh_ratio_db);
        // Flat 1/k spectrum: harmonic energy ~ 1/k², so the 1–5 kHz band holds
        // Σ_{7..33} 1/k² against Σ_{1..6} 1/k².
        let expected = 10.0
            * ((7..=33).map(|k| 1.0 / (k * k) as f64).sum::<f64>()
                / (1..=6).map(|k| 1.0 / (k * k) as f64).sum::<f64>())
            .log10();
        assert!(
            (flat.alpha_ratio_db - expected).abs() < 0.5,
            "{flat:?} vs {expected}"
        );
    }

    #[test]
    fn boost_is_zero_at_dc_and_peaks_at_the_formant() {
        assert!(formant_boost_db(0.0, 500.0, 80.0, 16_000.0).abs() < 1e-9);
        let at = formant_boost_db(500.0, 500.0, 80.0, 16_000.0);
        let off = formant_boost_db(1500.0, 500.0, 80.0, 16_000.0);
        assert!(at > 10.0 && off < 0.0, "{at} {off}");
    }

    #[test]
    fn hawks_miller_bandwidths_are_plausible_and_continuous() {
        let below = hawks_miller_bandwidth(499.999, 132.0);
        let above = hawks_miller_bandwidth(500.0, 132.0);
        assert!((below - above).abs() < 2.0, "{below} {above}");
        for f in [300.0, 1500.0, 2500.0] {
            let b = hawks_miller_bandwidth(f, 132.0);
            assert!((30.0..150.0).contains(&b), "{f}: {b}");
        }
        assert!(hawks_miller_bandwidth(1500.0, 220.0) > hawks_miller_bandwidth(1500.0, 132.0));
    }
}
