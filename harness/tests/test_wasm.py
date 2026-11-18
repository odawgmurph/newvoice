"""The WebAssembly build computes what the native build computes.

The Praat golden tests run the native CLI. Here the same CLI, compiled for
wasm32-wasip1 and run under Node's WASI, analyses a spread of the corpus,
and its output must match the native output: the same voicing decisions,
chosen ceilings and missing values, and every number within 1e-9 relative.
(Bit-identical is too strict: exp/ln round differently in the last place.
dB values also get 0.001 dB: HNR on a noiseless signal is ~100 dB, where
10·log10(r / (1 − r)) magnifies last-place differences in r.)
So the native golden results hold for the WebAssembly build (build plan
Stage 1 exit), and the same reasoning covers iOS and Android, which share
the code but cannot run here.
"""

import math

import pytest

from validation import core, corpus

CASES = [
    corpus.vowel_case("men", "ah", 110.0),
    corpus.vowel_case("women", "iy", 220.0),
    corpus.vowel_case("women", "ae", 200.0, rate=48_000),
    *[c for c in corpus.pitch_cases() if c.name in ("glide-90-300Hz", "saw-180Hz-snr10")],
    *corpus.octave_trap_cases()[:2],
]
COMMANDS = [
    ("frames", "--algorithm", "yin"),
    ("frames", "--algorithm", "pyin"),
    ("vowel", "--vowel", "ah"),
    ("quality",),
]


def same(a, b, path="") -> None:
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), path
        for k in a:
            same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            same(x, y, f"{path}[{i}]")
    elif isinstance(a, float) or isinstance(b, float):
        assert isinstance(b, int | float) and isinstance(a, int | float), path
        abs_tol = 1e-3 if path.endswith("_db") else 1e-9
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=abs_tol), f"{path}: {a} vs {b}"
    else:
        assert a == b, f"{path}: {a!r} vs {b!r}"


@pytest.mark.parametrize("command", COMMANDS, ids=lambda c: "-".join(c).replace("--", ""))
@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_wasm_matches_native(case, command):
    native = core.on_case(case, *command)
    wasm = core.run_signal(case.name, case.signal, case.rate, *command, wasm=True)
    same(native, wasm)
