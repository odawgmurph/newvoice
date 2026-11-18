"""Real-speech validation: the LibriSpeech subset in corpus/librispeech/,
clean and degraded.

Real speech has no ground-truth F0, so Praat's `To Pitch (ac)` on the clean
recording is the reference: frames Praat finds voiced are the voiced
reference and its F0 there the reference value. Degraded copies are scored
against the clean reference, so a degradation's cost shows up directly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cache

import numpy as np
import parselmouth
from scipy import signal as sps

from validation import core, praat, synth
from validation.corpus import REPO_ROOT

CORPUS_DIR = REPO_ROOT / "harness" / "corpus" / "librispeech"

# Degradations: name -> description (for the report).
CONDITIONS = {
    "clean": "as recorded",
    "snr20": "white noise at 20 dB SNR",
    "snr10": "white noise at 10 dB SNR",
    "phone": "telephone channel: 300-3400 Hz band-pass, 8 kHz, 8-bit mu-law",
}

# Frames whose F0 differs from the reference by more than this are gross
# errors (octave and sub-harmonic jumps, or tracking a different source).
GROSS_ERROR = 0.2
FINE_TOLERANCE = 0.01


@dataclass(frozen=True)
class RealCase:
    name: str
    signal: np.ndarray = field(repr=False, compare=False)
    rate: int
    speaker: str
    sex: str
    condition: str


@cache
def manifest() -> dict:
    return json.loads((CORPUS_DIR / "manifest.json").read_text(encoding="utf-8"))


@cache
def _clean(file: str) -> tuple[np.ndarray, int]:
    s = parselmouth.Sound(str(CORPUS_DIR / file))
    return s.values[0].astype(float), int(s.sampling_frequency)


def mu_law(x: np.ndarray, mu: float = 255.0) -> np.ndarray:
    """Encode and decode through 8-bit mu-law."""
    peak = np.abs(x).max()
    y = np.sign(x) * np.log1p(mu * np.abs(x / peak)) / np.log1p(mu)
    y = np.round(y * 127) / 127
    return peak * np.sign(y) * np.expm1(np.abs(y) * np.log1p(mu)) / mu


def degrade(x: np.ndarray, rate: int, condition: str, seed: int) -> np.ndarray:
    if condition == "clean":
        return x
    if condition.startswith("snr"):
        return synth.add_noise(x, float(condition[3:]), seed=seed)
    if condition == "phone":
        sos = sps.butter(6, [300, 3400], btype="bandpass", fs=rate, output="sos")
        y = sps.resample_poly(sps.sosfiltfilt(sos, x), 8000, rate)
        return sps.resample_poly(mu_law(y), rate, 8000)
    raise ValueError(condition)


def cases(condition: str = "clean") -> list[RealCase]:
    out = []
    for i, u in enumerate(manifest()["utterances"]):
        x, rate = _clean(u["file"])
        out.append(
            RealCase(
                name=f"libri-{u['file'][:-5]}-{condition}",
                signal=degrade(x, rate, condition, seed=1000 + i),
                rate=rate,
                speaker=u["speaker"],
                sex=u["sex"],
                condition=condition,
            )
        )
    return out


@dataclass
class RealPitch:
    """One algorithm's F0 track on one case, against the clean reference."""

    ours: np.ndarray
    ref: np.ndarray

    @property
    def both(self) -> np.ndarray:
        return ~np.isnan(self.ours) & ~np.isnan(self.ref)

    def errors(self) -> np.ndarray:
        b = self.both
        return np.abs(self.ours[b] / self.ref[b] - 1)

    def recall(self) -> float:
        """Share of reference-voiced frames we call voiced."""
        voiced = ~np.isnan(self.ref)
        return float(np.mean(~np.isnan(self.ours[voiced])))

    def false_voicing(self) -> float:
        """Share of reference-unvoiced frames we call voiced."""
        unvoiced = np.isnan(self.ref)
        return float(np.mean(~np.isnan(self.ours[unvoiced]))) if unvoiced.any() else 0.0


_TRACKS: dict[tuple[str, str], dict] = {}


def ours_track(case: RealCase, algorithm: str) -> dict:
    key = (case.name, algorithm)
    if key not in _TRACKS:
        _TRACKS[key] = core.on_case(case, "frames", "--no-formants", "--algorithm", algorithm)
    return _TRACKS[key]


@cache
def reference_f0(clean_name: str, n: int) -> np.ndarray:
    case = next(c for c in cases("clean") if c.name == clean_name)
    return praat.f0_at(case, np.arange(n) * 0.01)


def compare(case: RealCase, algorithm: str) -> RealPitch:
    r = ours_track(case, algorithm)
    ours = np.array([np.nan if f["f0_hz"] is None else f["f0_hz"] for f in r["frames"]])
    clean_name = case.name.rsplit("-", 1)[0] + "-clean"
    return RealPitch(ours=ours, ref=reference_f0(clean_name, len(ours)))


def praat_on(case: RealCase) -> RealPitch:
    """Praat itself on a (degraded) case, against the clean reference."""
    n = int(len(case.signal) / case.rate / 0.01) + 1
    clean_name = case.name.rsplit("-", 1)[0] + "-clean"
    return RealPitch(ours=praat.f0_at(case, np.arange(n) * 0.01), ref=reference_f0(clean_name, n))


def summary(results: list[RealPitch]) -> dict:
    """Pooled frame-level metrics over a set of cases."""
    errors = np.concatenate([r.errors() for r in results])
    return {
        "frames": int(errors.size),
        "within_1pct": float(np.mean(errors <= FINE_TOLERANCE)),
        "gross": float(np.mean(errors > GROSS_ERROR)),
        "recall": float(np.mean([r.recall() for r in results])),
        "false_voicing": float(np.mean([r.false_voicing() for r in results])),
    }
