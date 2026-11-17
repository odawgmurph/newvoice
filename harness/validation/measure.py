"""Measurements shared by the golden tests and the report."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from validation import core, praat
from validation.corpus import PRAAT_CEILING_HZ, Case

# Frames this close to a voicing edge are left out of comparisons.
EDGE_S = 0.05
# Formants are compared on the middle half of the vowel (steady state).
STEADY_FRACTION = 0.5
# newvoice-core's default bandwidth filter, applied to Praat too for
# like-for-like comparisons.
MAX_BANDWIDTH_HZ = 1000.0


def _nan(v):
    return np.nan if v is None else v


@dataclass
class PitchComparison:
    times: np.ndarray
    ours: np.ndarray
    praat: np.ndarray
    truth: np.ndarray
    inner: np.ndarray  # frames well inside the voiced part
    silent: np.ndarray  # frames well outside it

    @property
    def common(self) -> np.ndarray:
        return self.inner & ~np.isnan(self.ours) & ~np.isnan(self.praat)

    def error_vs_praat(self) -> np.ndarray:
        c = self.common
        return np.abs(self.ours[c] / self.praat[c] - 1)

    def error_vs_truth(self) -> np.ndarray:
        c = self.inner & ~np.isnan(self.ours)
        return np.abs(self.ours[c] / self.truth[c] - 1)

    def praat_error_vs_truth(self) -> np.ndarray:
        c = self.inner & ~np.isnan(self.praat)
        return np.abs(self.praat[c] / self.truth[c] - 1)

    def voiced_share(self, which: str) -> float:
        values = self.ours if which == "ours" else self.praat
        return float(np.mean(~np.isnan(values[self.inner])))


def compare_pitch(case: Case, algorithm: str) -> PitchComparison:
    r = core.on_case(case, "frames", "--no-formants", "--algorithm", algorithm)
    t = np.array([f["t"] for f in r["frames"]])
    return PitchComparison(
        times=t,
        ours=np.array([_nan(f["f0_hz"]) for f in r["frames"]]),
        praat=praat.f0_at(case, t),
        truth=case.true_f0(t),
        inner=(t > case.voiced_from + EDGE_S) & (t < case.voiced_to - EDGE_S),
        silent=(t < case.voiced_from - EDGE_S) | (t > case.voiced_to + EDGE_S),
    )


def steady_times(case: Case, times: np.ndarray) -> np.ndarray:
    dur = case.voiced_to - case.voiced_from
    margin = 0.5 * (1 - STEADY_FRACTION) * dur
    return (times >= case.voiced_from + margin) & (times <= case.voiced_to - margin)


def ours_fixed_formants(case: Case, ceiling_hz: float, raw: bool = False) -> np.ndarray:
    """Median F1-F3 from newvoice-core at a fixed ceiling over the steady state."""
    opts = ["--ceiling", str(ceiling_hz)] + (["--raw-formants"] if raw else [])
    r = core.on_case(case, "frames", *opts)
    t = np.array([f["t"] for f in r["frames"]])
    rows = [
        [f["formants"][k][0] if len(f["formants"]) > k else np.nan for k in range(3)]
        for f in r["frames"]
    ]
    return np.nanmedian(np.array(rows)[steady_times(case, t)], axis=0)


def praat_fixed_formants(case: Case, ceiling_hz: float, clean: bool) -> np.ndarray:
    """Median F1-F3 from Praat at a fixed ceiling over the same frames."""
    t = np.arange(0.0, len(case.signal) / case.rate, 0.01)
    t = t[steady_times(case, t)]
    bw = MAX_BANDWIDTH_HZ if clean else None
    return np.nanmedian(praat.formants_at(case, t, ceiling_hz, n=3, max_bandwidth_hz=bw), axis=0)


def ours_vowel(case: Case) -> dict:
    """newvoice-core's sustained-vowel measurement (multi-ceiling sweep)."""
    return core.on_case(case, "vowel")


def group_ceiling(case: Case) -> float:
    return PRAAT_CEILING_HZ[case.group]


def relative_error(estimate, truth) -> np.ndarray:
    est = np.array([_nan(v) for v in estimate], dtype=float)
    return np.abs(est / np.asarray(truth, dtype=float) - 1)


_QUALITY_CACHE: dict[str, dict] = {}


def quality(case) -> dict:
    """newvoice-core's utterance-level voice quality (cached per case name,
    since several tests and the report read the same cases)."""
    if case.name not in _QUALITY_CACHE:
        _QUALITY_CACHE[case.name] = core.on_case(case, "quality")
    return _QUALITY_CACHE[case.name]
