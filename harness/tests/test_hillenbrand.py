"""Real vowels against hand-checked measurements: Hillenbrand et al. (1995),
540 tokens from 45 men and 576 from 48 women (validation/hillenbrand.py).

Gates sit a little below the values in docs/validation/stage1-real.md:

1. Formants measured at the judges' steady-state instant against
   Hillenbrand's hand-corrected LPC values there.
2. The formant confidence ranks tokens by error: it was fitted on this set
   (decision D11), so this guards the fit against regressions.
3. The resonance score per speaker, over their 12 vowels measured as the app
   measures prompted vowels (middle half of the nucleus), against the same
   score from the hand-checked formants; and the two groups' scores.
4. F0 over the nucleus against Hillenbrand's steady-state F0.
"""

import numpy as np
import pytest

from validation import hillenbrand, resonance

GROUPS = ("men", "women")


@pytest.fixture(scope="module")
def steady():
    return hillenbrand.measure_all(at_steady_state=True)


@pytest.fixture(scope="module")
def nucleus():
    return hillenbrand.measure_all()


@pytest.mark.parametrize("group", GROUPS)
def test_formants_match_hand_checked_values(steady, group):
    res = [(t, m) for t, m in steady if t.group == group]
    assert sum(m is None for _, m in res) <= 0.03 * len(res)
    e = hillenbrand.formant_errors([(t, m) for t, m in res if m is not None])
    within = np.nanmean(e <= 0.10, axis=0)
    assert np.all(within >= [0.95, 0.92, 0.90]), within
    assert np.all(np.nanmedian(e, axis=0) <= 0.025), np.nanmedian(e, axis=0)


def test_confidence_ranks_formant_errors(steady):
    res = [(t, m) for t, m in steady if m is not None]
    bad = np.nanmax(hillenbrand.formant_errors(res)[:, :2], axis=1) > 0.10
    conf = np.array([m["confidence"] for _, m in res])
    good, poor = conf[~bad], conf[bad]
    auc = np.mean(good[:, None] > poor[None, :]) + 0.5 * np.mean(good[:, None] == poor[None, :])
    assert auc >= 0.72, auc
    # Calibration: the mean confidence roughly matches the share within 10%.
    assert abs(conf.mean() - (1 - bad.mean())) <= 0.08, (conf.mean(), bad.mean())


def speaker_scores(nucleus):
    by_speaker: dict[tuple[str, str], list] = {}
    for t, m in nucleus:
        if m is not None:
            by_speaker.setdefault((t.group, t.name[:3]), []).append((t, m))
    out = {g: [] for g in GROUPS}
    for (group, _), items in by_speaker.items():
        ours = resonance.score(
            [(t.vowel, m["formants_hz"][:3]) for t, m in items], [m["confidence"] for _, m in items]
        )
        hand = resonance.score([(t.vowel, t.formants_hz[:3]) for t, _ in items])
        out[group].append((ours, hand))
    return {g: np.array(v) for g, v in out.items()}


def test_resonance_score_per_speaker(nucleus):
    scores = speaker_scores(nucleus)
    for group, target in zip(GROUPS, (0.0, 1.0), strict=True):
        ours, hand = scores[group][:, 0], scores[group][:, 1]
        diff = np.abs(ours - hand)
        assert np.median(diff) <= 0.1 and diff.max() <= 0.4, (group, np.median(diff), diff.max())
        assert abs(np.median(ours) - target) <= 0.1, (group, np.median(ours))
    men, women = scores["men"][:, 0], scores["women"][:, 0]
    assert np.mean(women[:, None] > men[None, :]) >= 0.98


@pytest.mark.parametrize(
    ("algorithm", "max_gross"), [("yin", 0.025), ("mpm", 0.025), ("pyin", 0.01)]
)
def test_f0_against_hand_checked_values(algorithm, max_gross):
    e = hillenbrand.f0_errors(algorithm)
    assert not np.any(np.isnan(e))
    assert np.mean(e > 0.2) <= max_gross, np.mean(e > 0.2)
    assert np.median(e) <= 0.02, np.median(e)
