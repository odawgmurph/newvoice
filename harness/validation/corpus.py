"""Synthetic validation corpus.

Every case has a known F0 contour, and vowels have known formants, taken from
the Hillenbrand (1995) group means in `content/norms/reference_norms.json`.
Crossing men's and women's formants with the whole F0 range covers voices in
transition (for example a long vocal tract at a high F0), which is where
formant tracking is known to struggle.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import numpy as np

from validation import synth

REPO_ROOT = Path(__file__).resolve().parents[2]
NORMS_PATH = REPO_ROOT / "content" / "norms" / "reference_norms.json"

RATE = 44_100
PAD_S = 0.15

# Typical bandwidths (Hz) for F1-F5.
BANDWIDTHS = (80.0, 100.0, 140.0, 200.0, 250.0)
# F5 is not in the norms; place it above F4 so LPC has a realistic fifth pole.
F5_ABOVE_F4_HZ = 900.0

# Vowels used for formant validation: corners of the vowel space plus /ɝ/,
# whose low F3 is a classic tracking trap.
FORMANT_VOWELS = ("iy", "ae", "ah", "uw", "er")
# F0 grid for formant validation. 100-250 Hz is gated; above that is measured
# and reported (handbook §3.3: error grows with F0).
GATED_F0_HZ = (100.0, 150.0, 200.0, 250.0)
HIGH_F0_HZ = (300.0, 350.0, 400.0)
# Praat's conventional ceilings per group.
PRAAT_CEILING_HZ = {"men": 5000.0, "women": 5500.0}


@dataclass(frozen=True)
class Case:
    name: str
    signal: np.ndarray = field(repr=False, compare=False)
    rate: int
    f0_start: float
    f0_end: float
    # Start and end (s) of the voiced part.
    voiced_from: float
    voiced_to: float
    formants: tuple[float, ...] = ()
    group: str | None = None
    vowel: str | None = None
    vibrato_st: float = 0.0

    def true_f0(self, t: np.ndarray) -> np.ndarray:
        """F0 at times t, NaN outside the voiced part."""
        rel = t - self.voiced_from
        u = rel / (self.voiced_to - self.voiced_from)
        f = self.f0_start * (self.f0_end / self.f0_start) ** u
        f *= 2.0 ** (self.vibrato_st * np.sin(2 * np.pi * synth.VIBRATO_HZ * rel) / 12.0)
        return np.where((u >= 0) & (u <= 1), f, np.nan)


@cache
def norms() -> dict:
    return json.loads(NORMS_PATH.read_text(encoding="utf-8"))


def vowel_formants(group: str, vowel: str) -> tuple[float, ...]:
    m = norms()["groups"][group]["vowels"][vowel]["measures_hz"]
    f = [m[k]["mean"] for k in ("f1", "f2", "f3", "f4")]
    return (*f, f[3] + F5_ABOVE_F4_HZ)


def _case(name, x, rate, f0_start, f0_end, **kw) -> Case:
    dur = len(x) / rate
    return Case(
        name=name,
        signal=synth.pad(synth.normalise(x), rate, PAD_S),
        rate=rate,
        f0_start=f0_start,
        f0_end=f0_end,
        voiced_from=PAD_S,
        voiced_to=PAD_S + dur,
        **kw,
    )


# A little vibrato, as in natural sustained vowels. It also gives the formant
# sweep frame-to-frame variation to judge ceilings by.
VOWEL_VIBRATO_ST = 0.15


def vowel_case(group: str, vowel: str, f0: float, rate: int = RATE, seconds=0.6) -> Case:
    n = int(seconds * rate)
    formants = vowel_formants(group, vowel)
    contour = synth.f0_contour(f0, f0, n, rate, vibrato_st=VOWEL_VIBRATO_ST)
    source = synth.harmonic_source(contour, rate)
    x = synth.resonate(source, list(zip(formants, BANDWIDTHS, strict=True)), rate)
    return _case(
        f"vowel-{group}-{vowel}-{f0:.0f}Hz-{rate}",
        x,
        rate,
        f0,
        f0,
        formants=formants,
        group=group,
        vowel=vowel,
        vibrato_st=VOWEL_VIBRATO_ST,
    )


def pitch_cases() -> list[Case]:
    """Signals for the F0 golden test."""
    cases = []
    for f0 in (65.0, 80.0, 100.0, 130.0, 160.0, 200.0, 250.0, 300.0, 400.0, 480.0):
        n = int(0.5 * RATE)
        contour = synth.f0_contour(f0, f0, n, RATE)
        cases.append(_case(f"sine-{f0:.0f}Hz", synth.sine(contour, RATE), RATE, f0, f0))
        saw = synth.harmonic_source(contour, RATE)
        cases.append(_case(f"saw-{f0:.0f}Hz", saw, RATE, f0, f0))
    for lo, hi in ((90.0, 300.0), (300.0, 120.0)):
        n = RATE
        x = synth.harmonic_source(synth.f0_contour(lo, hi, n, RATE), RATE)
        cases.append(_case(f"glide-{lo:.0f}-{hi:.0f}Hz", x, RATE, lo, hi))
    for f0, snr in ((120.0, 20.0), (220.0, 20.0), (180.0, 10.0)):
        n = int(0.5 * RATE)
        x = synth.harmonic_source(synth.f0_contour(f0, f0, n, RATE), RATE)
        x = synth.add_noise(x, snr, seed=int(f0))
        cases.append(_case(f"saw-{f0:.0f}Hz-snr{snr:.0f}", x, RATE, f0, f0))
    for group, vowel, f0 in (("men", "ah", 110.0), ("women", "iy", 220.0), ("men", "uw", 300.0)):
        cases.append(vowel_case(group, vowel, f0))
    # Capture rates other than 44.1 kHz.
    for rate in (16_000, 48_000):
        cases.append(vowel_case("women", "ae", 200.0, rate=rate))
    return cases


def octave_trap_cases() -> list[Case]:
    """Signals that provoke octave errors: a weak fundamental with H2 on F1
    (octave-up), and jittery voices (sub-harmonics)."""
    cases = []
    for group, vowel, f0, slope in (("women", "uw", 231.0, 1.0), ("men", "iy", 150.0, 1.6)):
        q = quality_case(group, vowel, f0, -3.0, slope)
        cases.append(_case(f"weak-h1-{group}-{vowel}-{f0:.0f}Hz", q.signal, RATE, f0, f0))
    for f0 in (110.0, 200.0, 300.0):
        for jitter in (0.005, 0.01):
            p = perturbation_case(f0, jitter, 4 * jitter)
            n = int(PAD_S * RATE)
            cases.append(_case(f"jitter{100 * jitter:g}-{f0:.0f}Hz", p.signal[n:-n], RATE, f0, f0))
    return cases


def formant_cases(f0s=GATED_F0_HZ) -> list[Case]:
    """Vowels for the formant golden test and the error-vs-F0 report."""
    return [
        vowel_case(group, vowel, f0)
        for group in ("men", "women")
        for vowel in FORMANT_VOWELS
        for f0 in f0s
    ]


# --- Voice quality ---------------------------------------------------------


@dataclass(frozen=True)
class QualityCase:
    name: str
    signal: np.ndarray = field(repr=False, compare=False)
    rate: int
    f0: float
    formants: tuple[float, ...]
    bandwidths: tuple[float, ...]
    # Source H1-H2 (dB) and tilt, and the true band measures computed from
    # the exact harmonic amplitudes after the resonators.
    source_h1_h2_db: float
    truth: dict = field(compare=False)
    snr_db: float | None = None


# F0s whose harmonics all sit at least 30 Hz from the band edges at 1, 2, 4
# and 5 kHz, so FFT leakage across an edge doesn't blur the comparison.
QUALITY_F0_HZ = {"men": (120.0, 150.0), "women": (188.0, 231.0)}
QUALITY_VOWELS = {"men": ("ah", "iy"), "women": ("ae", "uw")}
EDGES_HZ = (1000.0, 2000.0, 4000.0, 5000.0)


def band_truth(freqs: np.ndarray, amps: np.ndarray) -> dict:
    power = amps**2
    db = 20 * np.log10(amps)

    def energy(lo, hi):
        return power[(freqs >= lo) & (freqs < hi)].sum()

    def peak(lo, hi):
        return db[(freqs >= lo) & (freqs < hi)].max()

    return {
        "alpha_ratio_db": 10 * np.log10(energy(1000, 5000) / energy(50, 1000)),
        "hammarberg_db": peak(0, 2000) - peak(2000, 5000),
        "lh_ratio_db": 10 * np.log10(energy(50, 4000) / energy(4000, 8000)),
    }


def quality_case(group, vowel, f0, h1_h2_db, slope, snr_db=None, seconds=1.0) -> QualityCase:
    rate = RATE
    n = int(seconds * rate)
    formants = vowel_formants(group, vowel)
    pairs = list(zip(formants, BANDWIDTHS, strict=True))
    contour = synth.f0_contour(f0, f0, n, rate)
    source, amps = synth.shaped_source(contour, rate, h1_h2_db, slope)
    x = synth.resonate(source, pairs, rate)
    freqs = f0 * np.arange(1, len(amps) + 1)
    truth = band_truth(freqs, amps * synth.resonator_gain(freqs, pairs, rate))
    if snr_db is not None:
        x = synth.add_noise(x, snr_db, seed=int(f0 * 10 + h1_h2_db))
    noise_tag = f"-snr{snr_db:.0f}" if snr_db is not None else ""
    return QualityCase(
        name=f"vq-{group}-{vowel}-{f0:.0f}Hz-h1h2{h1_h2_db:+.0f}-tilt{slope:g}{noise_tag}",
        signal=synth.normalise(x),
        rate=rate,
        f0=f0,
        formants=formants,
        bandwidths=BANDWIDTHS,
        source_h1_h2_db=h1_h2_db,
        truth=truth,
        snr_db=snr_db,
    )


def quality_cases() -> list[QualityCase]:
    """Clean vowels across F0, source H1-H2 and tilt (spectral measures)."""
    return [
        quality_case(group, vowel, f0, h1h2, slope)
        for group in ("men", "women")
        for vowel, f0 in zip(QUALITY_VOWELS[group], QUALITY_F0_HZ[group], strict=True)
        for h1h2 in (-3.0, 3.0, 9.0)
        for slope in (1.0, 1.6)
    ]


def noisy_quality_cases() -> list[QualityCase]:
    """The same vowels with added noise (CPPS and HNR)."""
    return [
        quality_case(group, vowel, f0, 3.0, 1.0, snr_db=snr)
        for group in ("men", "women")
        for vowel, f0 in zip(QUALITY_VOWELS[group], QUALITY_F0_HZ[group], strict=True)
        for snr in (40.0, 25.0, 15.0, 8.0)
    ]


@dataclass(frozen=True)
class PerturbationCase:
    name: str
    signal: np.ndarray = field(repr=False, compare=False)
    rate: int
    f0: float
    true_jitter: float
    true_shimmer: float


def _local(values: np.ndarray) -> float:
    return float(np.mean(np.abs(np.diff(values))) / np.mean(values))


def perturbation_case(f0, jitter, shimmer, vowel=("men", "ah"), seconds=1.0) -> PerturbationCase:
    """Source with uniform per-cycle period and amplitude perturbation of
    the given local size, through a vowel's resonators."""
    rng = np.random.default_rng(int(f0 * 1000 + jitter * 1e4 + shimmer * 1e3))
    n = int(seconds * f0)
    # Uniform e in [-1, 1] has E|e1 - e2| = 2/3, so scale by 1.5.
    periods = (1 + 1.5 * jitter * rng.uniform(-1, 1, n)) / f0
    amps = 1 + 1.5 * shimmer * rng.uniform(-1, 1, n)
    x = synth.perturbed_source(periods, amps, RATE)
    pairs = list(zip(vowel_formants(*vowel), BANDWIDTHS, strict=True))
    x = synth.resonate(x, pairs, RATE)
    return PerturbationCase(
        name=f"perturb-{f0:.0f}Hz-j{100 * jitter:g}-s{100 * shimmer:g}",
        signal=synth.pad(synth.normalise(x), RATE, PAD_S),
        rate=RATE,
        f0=f0,
        true_jitter=_local(periods),
        true_shimmer=_local(amps),
    )


def perturbation_cases() -> list[PerturbationCase]:
    return [
        perturbation_case(f0, j, s)
        for f0 in (110.0, 200.0)
        for j, s in ((0.0, 0.0), (0.005, 0.02), (0.01, 0.04), (0.02, 0.08))
    ]
