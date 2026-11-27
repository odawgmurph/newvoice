"""Ear-training stimuli differ in one dimension only (Stage 5, decision D21).

Handbook §2.3: stimuli hold F0 fixed and shift formants, or the reverse.
The app synthesises them on the phone (app/src/eartraining/synth.ts); this
renders pairs at the easiest, the checkpoint and the finest staircase level
and measures them independently:
- F0 with Praat `To Pitch (ac)`: the pitch shift is the asked number of
  semitones (the harness's ±1% F0 gate, D9), and brightness and weight
  pairs have equal F0;
- H1-H2 from a long Hann-windowed spectrum: weight pairs differ by the
  asked dB, pitch and brightness pairs barely;
- formants with Praat `To Formant (burg)` (poles wider than 1000 Hz
  dropped, as the core does, D8), on the same pair re-rendered at 100 Hz
  F0, where LPC is reliable (§3.3: at higher F0 it snaps to harmonics):
  F1/F2 sit within the handbook's ±5-8% of the synthesiser's targets, and
  brightness pairs differ by the asked ratio.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import parselmouth
import pytest
from scipy.io import wavfile

from validation import praat
from validation.corpus import REPO_ROOT, Case

RENDER = REPO_ROOT / "harness" / "tools" / "eartrain-render.mjs"


@pytest.fixture(scope="module")
def stimuli(tmp_path_factory):
    out = tmp_path_factory.mktemp("eartraining")
    subprocess.run(
        ["node", "--no-warnings", "--experimental-strip-types", str(RENDER), str(out)],
        check=True,
    )
    return out, json.loads((out / "stimuli.json").read_text())


def load(path: Path) -> tuple[np.ndarray, int]:
    rate, x = wavfile.read(path)
    return x.astype(np.float64) / 32768.0, rate


def f0(path: Path) -> float:
    x, rate = load(path)
    snd = parselmouth.Sound(x, sampling_frequency=rate)
    pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=500)
    return pitch.get_value_at_time(snd.duration / 2)


def h1h2(path: Path, f0_hz: float) -> float:
    x, rate = load(path)
    a, b = int(0.15 * rate), int(0.45 * rate)
    seg = x[a:b] * np.hanning(b - a)
    n = 1 << 16
    spec = np.abs(np.fft.rfft(seg, n))
    freqs = np.fft.rfftfreq(n, 1 / rate)

    def peak_db(k: int) -> float:
        band = (freqs > k * f0_hz * 0.9) & (freqs < k * f0_hz * 1.1)
        return 20 * np.log10(spec[band].max())

    return peak_db(1) - peak_db(2)


BANDWIDTHS = [80, 100, 140, 200, 250]


def resonator_db(f: float, fc: float, bw: float, fs: float) -> float:
    """Klatt (1980) digital resonator gain, written out independently of synth.ts."""
    t = 1 / fs
    c = -np.exp(-2 * np.pi * bw * t)
    b = 2 * np.exp(-np.pi * bw * t) * np.cos(2 * np.pi * fc * t)
    z = np.exp(-1j * 2 * np.pi * f * t)
    return 20 * np.log10(abs((1 - b - c) / (1 - b * z - c * z * z)))


def envelope_h1h2(params: dict, fs: float = 22050) -> float:
    fcs = np.array(params["formantsHz"]) * params["formantScale"]
    f0_hz = params["f0Hz"]
    return sum(
        resonator_db(f0_hz, fc, bw, fs) - resonator_db(2 * f0_hz, fc, bw, fs)
        for fc, bw in zip(fcs, BANDWIDTHS, strict=True)
    )


def formants(path: Path, ceiling_hz: float) -> np.ndarray:
    x, rate = load(path)
    case = Case(path.stem, x, rate, 100, 100, 0.0, len(x) / rate)
    return praat.formants_at(
        case, np.array([len(x) / rate / 2]), ceiling_hz, n=2, max_bandwidth_hz=1000
    )[0]


def problems(out: Path, item: dict) -> list[str]:
    up, down, d = item["up"], item["down"], item["difference"]
    p = lambda suffix: out / f"{item['name']}-{suffix}.wav"  # noqa: E731
    found = []

    st = 12 * np.log2(f0(p("up")) / f0(p("down")))
    want_st = d if item["dimension"] == "pitch" else 0.0
    if abs(st - want_st) > max(0.17, 0.01 * abs(want_st)):
        found.append(f"F0 shift {st:.3f} ST, want {want_st}")

    dh = h1h2(p("up"), up["f0Hz"]) - h1h2(p("down"), down["f0Hz"])
    if item["dimension"] == "weight":
        if abs(dh - d) > 0.3:
            found.append(f"H1-H2 shift {dh:.2f} dB, want {d}")
    else:
        # The source is unchanged: any H1-H2 change is the formant envelope
        # moving under H1 and H2 (why the core corrects to H1*-H2*, D10).
        want = envelope_h1h2(up) - envelope_h1h2(down)
        if abs(dh - want) > 0.3:
            found.append(f"H1-H2 moved {dh:.2f} dB, envelope predicts {want:.2f}")

    # Envelope, at 100 Hz F0. Ceiling as Praat's convention for each size.
    for which, params in (("up", up), ("down", down)):
        truth = np.array(params["formantsHz"][:2]) * params["formantScale"]
        got = formants(p(f"{which}-low"), 5000 * params["formantScale"])
        err = np.abs(got / truth - 1)
        if not np.all(err < 0.08):
            found.append(f"{which} F1/F2 {np.round(got)} vs {np.round(truth)}")
    if item["dimension"] == "brightness":
        lo_up = formants(p("up-low"), 5000 * up["formantScale"])
        lo_down = formants(p("down-low"), 5000 * down["formantScale"])
        ratio = lo_up[1] / lo_down[1]
        if abs(ratio / (1 + d / 100) - 1) > 0.02:
            found.append(f"F2 ratio {ratio:.4f}, want {1 + d / 100}")
    return [f"{item['name']}: {m}" for m in found]


def test_each_pair_differs_only_in_its_dimension(stimuli):
    out, data = stimuli
    assert len(data["items"]) == 27
    assert [m for item in data["items"] for m in problems(out, item)] == []
