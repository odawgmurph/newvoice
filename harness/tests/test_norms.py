import json
import math

import pytest

from norms import build_norms as bn


def test_formant_dispersion_recovers_uniform_tube():
    # A 17.5 cm uniform tube (c = 35000 cm/s) has formants at 500, 1500, 2500, 3500 Hz.
    delta_f = bn.formant_dispersion([500.0, 1500.0, 2500.0, 3500.0])
    assert delta_f == pytest.approx(1000.0)
    assert bn.SPEED_OF_SOUND_CM_S / (2 * delta_f) == pytest.approx(17.5)


def test_parse_skips_children_headers_and_treats_zero_as_missing():
    text = "\n".join(
        [
            "  1    2   3    4    5    6    7    8    9   10    11  12   13    14  15   16",
            "m01ae 323 174  663 2012 2659    0  669 2008 2671  671 1992 2659  685 1773 2680",
            "w01iy 300 220  400 2800 3300 4300  400 2800 3300  400 2800 3300  400 2800 3300",
            "b01iy 300 260  400 3000 3600 4500  400 3000 3600  400 3000 3600  400 3000 3600",
        ]
    )
    tokens = bn.parse(text)
    assert [(t.group, t.speaker, t.vowel) for t in tokens] == [
        ("men", "m01", "ae"),
        ("women", "w01", "iy"),
    ]
    assert tokens[0].values["f4"] is None
    assert tokens[1].values["f2"] == 2800.0


def test_describe_log_fields_match_hz():
    stats = bn.describe([100.0, 200.0, 400.0])
    assert stats["n"] == 3
    assert stats["median"] == 200.0
    assert stats["log_mean"] == pytest.approx(math.log(200.0), abs=1e-5)


@pytest.fixture(scope="module")
def norms():
    return json.loads(bn.OUTPUT_PATH.read_text(encoding="utf-8"))


def test_committed_norms_have_all_vowels_and_groups(norms):
    assert norms["schema_version"] == bn.SCHEMA_VERSION
    assert set(norms["groups"]) == {"men", "women"}
    for group in norms["groups"].values():
        assert list(group["vowels"]) == list(bn.VOWELS)


def test_committed_norms_are_plausible(norms):
    men, women = norms["groups"]["men"], norms["groups"]["women"]
    assert 90 < men["f0_speaker_median_hz"]["mean"] < 160
    assert 180 < women["f0_speaker_median_hz"]["mean"] < 260
    assert women["avtl_cm"]["mean"] < men["avtl_cm"]["mean"]
    for code in bn.VOWELS:
        m, w = men["vowels"][code]["measures_hz"], women["vowels"][code]["measures_hz"]
        assert w["f2"]["mean"] > m["f2"]["mean"], code
        assert w["f3"]["mean"] > m["f3"]["mean"], code
