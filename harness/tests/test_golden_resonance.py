"""Golden tests for the vowel-normalised resonance score (handbook §3.3).

1. Formula: the core's positions for its own measured formants equal an
   independent Python implementation reading content/norms/reference_norms.json,
   so the generated Rust table and formula are right.
2. Accuracy: scores of synthetic vowels with known formants against their
   true scores. The score magnifies formant error (a 5% F2 error is ~0.3 on
   a vowel whose groups differ by 18%), and formant error grows with F0, so
   accuracy is gated up to 250 Hz and the higher F0s are only reported
   (docs/validation/stage1-synthetic.md).
"""

import numpy as np
import pytest

from validation import corpus, resonance
from validation.measure import ours_vowel

ALL = corpus.formant_cases(corpus.GATED_F0_HZ + corpus.HIGH_F0_HZ)
GATED = corpus.formant_cases(corpus.GATED_F0_HZ)

# Largest error of a single token, and of the median over a group's vowels.
TOKEN_TOLERANCE = 0.3
MEDIAN_TOLERANCE = 0.1


def ours(case) -> dict:
    m = ours_vowel(case, "--vowel", case.vowel)
    assert m is not None and m["resonance"] is not None
    return m


@pytest.mark.parametrize("case", ALL, ids=[c.name for c in ALL])
def test_positions_match_the_reference_formula(case):
    m = ours(case)
    want = resonance.positions(case.vowel, m["formants_hz"][:3])
    got = m["resonance"]["by_formant"]
    for g, w in zip(got, want, strict=True):
        assert (g is None) == (w is None)
        if w is not None:
            assert g == pytest.approx(w, abs=1e-6)
    assert m["resonance"]["score"] == pytest.approx(
        resonance.score([(case.vowel, m["formants_hz"][:3])]), abs=1e-6
    )


def test_weakly_separated_formants_are_the_documented_ones():
    skipped = [
        (v, k)
        for v in corpus.norms()["groups"]["men"]["vowels"]
        for k in range(3)
        if not resonance.scored(v, k)
    ]
    assert skipped == [("oa", 0), ("oo", 1), ("uw", 1)]


def token_error(case) -> float:
    return ours(case)["resonance"]["score"] - resonance.score([(case.vowel, case.formants)])


@pytest.mark.parametrize("case", GATED, ids=[c.name for c in GATED])
def test_token_score_is_accurate(case):
    assert abs(token_error(case)) <= TOKEN_TOLERANCE


@pytest.mark.parametrize("f0", corpus.GATED_F0_HZ)
@pytest.mark.parametrize("group", ["men", "women"])
def test_median_over_vowels_is_accurate(group, f0):
    errors = [token_error(c) for c in GATED if c.group == group and c.f0_start == f0]
    assert abs(np.median(errors)) <= MEDIAN_TOLERANCE, errors
