"""Strain monitor gates (Stage 3, decision D18).

The fixture's synthetic sessions must match what the core computes now, and
the app's strain monitor must ask for a rest in every deliberately strained
session (after the strain starts) and in no healthy one, synthetic or real.
"""

from __future__ import annotations

import json

import pytest

from validation import strain


@pytest.fixture(scope="module")
def evaluation():
    return strain.evaluate()


def test_synthetic_sessions_are_up_to_date():
    assert strain.check() == []


def test_every_strained_session_asks_for_a_rest(evaluation):
    fixture = {s["name"]: s for s in json.loads(strain.FIXTURE.read_text())["sessions"]}
    strained = [r for r in evaluation["sessions"] if r["expectRest"]]
    assert len(strained) == sum(
        1 for name, *_ in strain.SYNTHETIC.items() if name.startswith("strained")
    )
    for r in strained:
        assert r["firstRestAt"] is not None, r
        # firstRestAt is 1-based; the onset is a 0-based utterance index.
        assert r["firstRestAt"] > fixture[r["name"]]["onsetUtterance"], r


def test_no_healthy_session_asks_for_a_rest(evaluation):
    healthy = [r for r in evaluation["sessions"] if not r["expectRest"]]
    assert len(healthy) >= 4
    assert [r for r in healthy if r["firstRestAt"] is not None] == []


def test_thresholds_sit_above_healthy_changes(evaluation):
    rules, healthy = evaluation["rules"], evaluation["healthyRatios"]
    assert healthy["jitter"] < rules["jitterRatio"]
    assert healthy["shimmer"] < rules["shimmerRatio"]
    assert healthy["cppsDrop"] < rules["cppsDropDb"]
