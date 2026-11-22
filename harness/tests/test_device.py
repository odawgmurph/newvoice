"""The device-matrix scorer (validation/device.py) on a synthetic export.

The export is built the way the app builds it: a WAV of what the analyser
received and the analyser's frames as columns. Here the desktop core stands
in for the phone, so phone-vs-core agreement must be exact, and agreement
with Praat must look like the synthetic golden results.
"""

import json

import numpy as np
import pytest

from validation import core, corpus, device, synth

RATE = 48_000
CEILING_HZ = 5500.0


def _frame_columns(frames: list[dict]) -> dict:
    def formant(f, k):
        fs = f["formants"] or []
        return fs[k][0] if len(fs) > k else None

    return {
        "t": [f["t"] for f in frames],
        "levelDbfs": [f["level_dbfs"] for f in frames],
        "periodicity": [f["periodicity"] for f in frames],
        "voiced": [f["voiced"] for f in frames],
        "f0Hz": [f["f0_hz"] for f in frames],
        "f1Hz": [formant(f, 0) for f in frames],
        "f2Hz": [formant(f, 1) for f in frames],
        "f3Hz": [formant(f, 2) for f in frames],
        "formantConfidence": [f["formant_confidence"] for f in frames],
    }


def _stats(median, p95, mx, n):
    return {"median": median, "p95": p95, "max": mx, "n": n}


@pytest.fixture(scope="module")
def export(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("export")
    vowel = corpus.vowel_case("women", "ah", 210.0, rate=RATE, seconds=1.0).signal
    glide = synth.harmonic_source(synth.f0_contour(120.0, 300.0, RATE, RATE), RATE)
    x = np.concatenate([vowel, synth.pad(synth.normalise(glide), RATE, 0.15)])
    wav = tmp / "nv-iPhone15_2-builtin-20261118-120000.wav"
    synth.write_wav(wav, x, RATE)

    phone = core.run("frames", wav, "--ceiling", str(CEILING_HZ))
    inputs = [{"type": "MicrophoneBuiltIn", "name": "iPhone Microphone"}]
    capture = {"measurementMode": True, "inputs": inputs}
    report = {
        "format": device.FORMAT,
        "formatVersion": device.FORMAT_VERSION,
        "wav": wav.name,
        "device": {"model": "iPhone15,2", "system": "iOS 26.1"},
        "coreVersion": phone["core_version"],
        "settings": {
            "f0MinHz": 60.0,
            "f0MaxHz": 600.0,
            "pitchAlgorithm": "yin",
            "formantCeilingHz": CEILING_HZ,
            "silenceDbfs": -60.0,
        },
        "clip": {
            "sampleRate": RATE,
            "samples": len(x),
            "seconds": len(x) / RATE,
            "reachedLimit": True,
            "droppedSamples": 0,
        },
        "captureAtStart": capture,
        "captureAtEnd": capture,
        "liveCost": {"ticks": 600, "frames": 300, "usPerFrame": 310.0, "maxTickUs": 900.0},
        "benchmark": {"usPerFrame": 280.0, "hopUs": 10_000, "frames": 300},
        "app": {
            "micToScreenMs": _stats(48.0, 61.0, 75.0, 180),
            "uiFps": _stats(60.0, 60.0, 61.0, 3),
            "note": "",
        },
        "frames": _frame_columns(phone["frames"]),
    }
    path = wav.with_suffix(".json")
    path.write_text(json.dumps(report), encoding="utf-8")
    return device.load(path)


@pytest.fixture(scope="module")
def result(export):
    return device.evaluate(export)


def test_phone_frames_match_the_desktop_core_exactly(result):
    c = result["core"]
    assert c["times_aligned"]
    assert c["voicing_agreement"] == 1.0
    assert c["f0_agreement"] == 1.0
    assert c["f2_agreement"] == 1.0


def test_pitch_is_scored_against_praat(result):
    p = result["pitch"]
    assert p["frames"] > 150
    assert p["within_1pct"] >= 0.9, p
    assert p["gross"] <= 0.01, p


def test_formants_are_scored_where_the_app_shows_them(result):
    f = result["formants"]
    assert f["frames"] > 20, f
    assert f["f2_within_10pct"] >= 0.8, f


def test_budget_reads_the_app_and_native_numbers(result):
    b = result["budget"]
    assert b["passes"] == {"latency": True, "fps": True, "cost": True, "no_drops": True}
    assert b["measurement_mode"] and not b["route_changed"]


def test_table_row_matches_the_header(result):
    header = device.TABLE_HEADER.splitlines()[0]
    assert device.table_row(result).count("|") == header.count("|")
    assert "### nv-iPhone15_2" in device.markdown(result)


def test_other_formats_are_refused(export, tmp_path):
    bad = dict(export.report, formatVersion=device.FORMAT_VERSION + 1)
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="expected newvoice-diagnostics"):
        device.load(path)


def test_json_alone_scores_the_budget_and_reads_old_nulls(export, tmp_path):
    # Builds before the jsonSafe fix wrote missing values as "<null>"; and the
    # owner may send the JSON without the WAV.
    report = dict(export.report)
    report["frames"] = {
        k: ["<null>" if v is None else v for v in col] for k, col in report["frames"].items()
    }
    path = tmp_path / "nv-json-only.json"
    path.write_text(json.dumps(report), encoding="utf-8")
    e = device.load(path)
    assert e.signal is None
    assert np.isnan(e.frames["f0Hz"]).sum() == sum(
        v is None for v in export.report["frames"]["f0Hz"]
    )
    r = device.evaluate(e)
    assert r["pitch"] is None and r["core"] is None
    assert r["budget"]["passes"]["latency"]
    assert "not scored" in device.markdown(r)
    assert device.table_row(r).count("|") == device.TABLE_HEADER.splitlines()[0].count("|")
