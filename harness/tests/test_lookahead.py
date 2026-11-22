"""Regression gate for the live look-ahead (decision D16).

With the default look-ahead the streamed pitch track must stay as close to
the batch track as the evidence in docs/validation/live-lookahead.md shows:
no frame on clean or noisy read speech where the live trace draws an F0 the
batch track rejects. Gates leave a little room above the measured values.
"""

from __future__ import annotations

import numpy as np
import pytest

from validation import core, lookahead, real

LIVE_DEFAULT = 4


@pytest.fixture(scope="module")
def clean():
    return real.cases("clean")


def _live_default(case: real.RealCase) -> np.ndarray:
    # No --lookahead: the core's own default, which the phone uses.
    return lookahead.track(core.on_case(case, "frames", "--no-formants", "--stream"))


def test_default_live_track_matches_batch_on_clean_speech(clean):
    rows = [lookahead.disagreement(_live_default(c), lookahead.batch_track(c)) for c in clean]
    seconds = sum(len(c.signal) / c.rate for c in clean)
    pooled = lookahead.pooled(rows, seconds)
    assert pooled["extra"] == 0.0, pooled
    assert pooled["share"] <= 0.002, pooled


def test_default_is_the_measured_choice(clean):
    # The CLI default must be the look-ahead the report recommends.
    case = clean[0]
    explicit = lookahead.live_track(case, LIVE_DEFAULT)
    np.testing.assert_array_equal(_live_default(case), explicit)


def test_short_lookahead_shows_rejected_jumps(clean):
    # Sanity check that the gate can fail: two frames draws extra F0.
    rows = [
        lookahead.disagreement(lookahead.live_track(c, 2), lookahead.batch_track(c)) for c in clean
    ]
    assert sum(r.extra for r in rows) > 0
