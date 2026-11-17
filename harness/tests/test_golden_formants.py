"""Golden formant tests.

1. Equivalence with Praat: at the same ceiling and with the same bandwidth
   filter, newvoice-core's Burg formants must match Praat's within ±5%
   (build plan, Stage 1: ±5-8% F1/F2), at every F0 in the corpus.
2. Accuracy against the known formants of the synthetic vowels, using the
   multi-ceiling sweep as the app does. F1 is allowed more error from 200 Hz
   up, where LPC peaks snap to the sparse harmonics (handbook §3.3); see
   docs/validation/stage1-synthetic.md for the measured error-vs-F0 curve.
"""

import numpy as np
import pytest

from validation import corpus
from validation.measure import (
    group_ceiling,
    ours_fixed_formants,
    ours_vowel,
    praat_fixed_formants,
    relative_error,
)
from validation.vtl import avtl_cm

EQUIVALENCE_TOLERANCE = 0.05

ALL = corpus.formant_cases(corpus.GATED_F0_HZ + corpus.HIGH_F0_HZ)
GATED = corpus.formant_cases(corpus.GATED_F0_HZ)


@pytest.mark.parametrize("case", ALL, ids=[c.name for c in ALL])
def test_matches_praat_at_the_same_ceiling(case):
    ceiling = group_ceiling(case)
    ours = ours_fixed_formants(case, ceiling)
    ref = praat_fixed_formants(case, ceiling, clean=True)
    err = np.abs(ours / ref - 1)
    assert np.all(err <= EQUIVALENCE_TOLERANCE), f"F1-F3 ours {ours} praat {ref}"


def accuracy_limits(f0: float) -> np.ndarray:
    """Allowed relative error for F1, F2, F3 at a given F0."""
    return np.array([0.05 if f0 <= 150 else 0.12, 0.06, 0.06])


@pytest.mark.parametrize("case", GATED, ids=[c.name for c in GATED])
def test_sweep_recovers_true_formants(case):
    m = ours_vowel(case)
    assert m is not None
    err = relative_error(m["formants_hz"][:3], case.formants[:3])
    assert np.all(err <= accuracy_limits(case.f0_start)), (
        f"F1-F3 {m['formants_hz'][:3]} truth {case.formants[:3]} ceiling {m['ceiling_hz']}"
    )
    assert abs(m["f0_median_hz"] / case.f0_start - 1) < 0.01


# aVTL comes from the baseline's /a/, /i/ and /u/ (plus /æ/ here). /ɝ/ is
# excluded: with F2 and F3 only ~330 Hz apart in men's /ɝ/, F4 is off by about
# ±10% from 150 Hz up, which the report documents as a known limitation.
VTL_CASES = [c for c in GATED if c.vowel != "er"]


@pytest.mark.parametrize("case", VTL_CASES, ids=[c.name for c in VTL_CASES])
def test_apparent_vtl(case):
    m = ours_vowel(case)
    assert m["avtl_cm"] is not None, "F4 not found"
    truth = avtl_cm(case.formants[:4])
    assert abs(m["avtl_cm"] / truth - 1) < 0.03, f"{m['avtl_cm']:.2f} cm vs {truth:.2f} cm"


def test_wrong_fixed_ceiling_is_what_the_sweep_avoids():
    # Men's /i/ at 200 Hz analysed at the women's 5500 Hz ceiling loses F2;
    # the sweep doesn't.
    case = corpus.vowel_case("men", "iy", 200.0)
    truth = np.array(case.formants[:3])
    wrong = ours_fixed_formants(case, 5500.0)
    swept = np.array(ours_vowel(case)["formants_hz"][:3])
    assert np.max(np.abs(swept / truth - 1)) < np.max(np.abs(wrong / truth - 1))
