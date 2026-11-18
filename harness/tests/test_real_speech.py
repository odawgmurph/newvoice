"""Real-speech pitch tests on the LibriSpeech subset (corpus/librispeech/).

Real speech has no ground truth, so these compare against Praat on the clean
recording (validation/real.py). They are regression gates set a little below
the measured values in docs/validation/stage1-real.md, not the ±1% accuracy
gate, which the synthetic corpus with known F0 carries. Praat itself agrees
with its own clean track on only ~97% of frames once 20 dB of noise is
added, so a frame-level ±1% match on every frame is not a meaningful target.

The telephone channel removes most men's fundamentals, so every tracker
(Praat included, ~10% gross errors) struggles there; it is gated loosely
and documented as a limitation.
"""

import pytest

from validation import real

# algorithm -> (min share within 1%, max gross-error share, min voicing
# recall, max false voicing) on the clean and noisy conditions.
GATES = {
    "yin": (0.90, 0.01, 0.55, 0.06),
    "mpm": (0.80, 0.01, 0.50, 0.06),
    "pyin": (0.78, 0.01, 0.80, 0.15),
}
# The telephone channel: (min within 1%, max gross).
PHONE_GATES = {"yin": (0.78, 0.15), "mpm": (0.70, 0.19), "pyin": (0.78, 0.13)}


@pytest.mark.parametrize("condition", ["clean", "snr20", "snr10"])
@pytest.mark.parametrize("algorithm", list(GATES))
def test_pitch_against_praat(algorithm, condition):
    s = real.summary([real.compare(c, algorithm) for c in real.cases(condition)])
    within, gross, recall, false_voicing = GATES[algorithm]
    assert s["within_1pct"] >= within, s
    assert s["gross"] <= gross, s
    assert s["recall"] >= recall, s
    assert s["false_voicing"] <= false_voicing, s


@pytest.mark.parametrize("algorithm", list(PHONE_GATES))
def test_pitch_on_a_telephone_channel(algorithm):
    s = real.summary([real.compare(c, algorithm) for c in real.cases("phone")])
    within, gross = PHONE_GATES[algorithm]
    assert s["within_1pct"] >= within, s
    assert s["gross"] <= gross, s


def test_corpus_is_balanced_and_intact():
    utts = real.manifest()["utterances"]
    assert sorted(u["sex"] for u in utts) == ["F"] * 10 + ["M"] * 10
    from corpus import build_librispeech

    assert build_librispeech.main(["--check"]) == 0
