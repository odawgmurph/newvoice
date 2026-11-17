"""Golden F0 tests: newvoice-core against Praat and against the known truth.

The build fails beyond ±1% F0 (build plan, Stage 1).
"""

import numpy as np
import pytest

from validation import corpus
from validation.measure import compare_pitch

TOLERANCE = 0.01
# Share of compared frames that must be within tolerance.
REQUIRED_SHARE = 0.99

CASES = corpus.pitch_cases()


@pytest.mark.parametrize("algorithm", ["yin", "mpm"])
@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_f0_matches_praat_and_truth(case, algorithm):
    c = compare_pitch(case, algorithm)

    # Voicing: ours finds the voiced part where Praat does, and nothing in silence.
    assert c.voiced_share("praat") > 0.98
    assert c.voiced_share("ours") >= 0.98 * c.voiced_share("praat")
    assert not np.any(~np.isnan(c.ours[c.silent])), "voiced frames in silence"

    vs_praat = c.error_vs_praat()
    vs_truth = c.error_vs_truth()
    assert len(vs_praat) > 10
    assert np.mean(vs_praat <= TOLERANCE) >= REQUIRED_SHARE, f"max {vs_praat.max():.4f}"
    assert np.mean(vs_truth <= TOLERANCE) >= REQUIRED_SHARE, f"max {vs_truth.max():.4f}"


TRAPS = corpus.octave_trap_cases()


@pytest.mark.parametrize("algorithm", ["yin", "mpm"])
@pytest.mark.parametrize("case", TRAPS, ids=[c.name for c in TRAPS])
def test_no_octave_errors(case, algorithm):
    # A weak fundamental must not read an octave high, and jitter must not
    # produce sub-harmonics. Praat gets all of these right.
    c = compare_pitch(case, algorithm)
    assert c.voiced_share("ours") > 0.95
    voiced = c.inner & ~np.isnan(c.ours)
    err = np.abs(c.ours[voiced] / c.truth[voiced] - 1)
    assert np.mean(err <= 0.05) >= REQUIRED_SHARE, f"worst {err.max():.3f}"
