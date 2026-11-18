"""Real vowels with hand-checked formants: the Hillenbrand et al. (1995)
recordings.

Each token is an h-V-d word (16 kHz) with the vowel nucleus marked and two
judges' steady-state times, and steady-state F0 and F1-F4 measured by LPC
with hand correction (vowdata.dat). Those formants are the closest thing to
ground truth for real voices available here.

The recordings are fetched, pinned by commit and SHA-256, from Santiago
Barreda's mirror, which hosts them with Jim Hillenbrand's permission. They
are cached in harness/.cache and not committed: the mirror states no licence
for the recordings themselves, so the repository does not redistribute them.
"""

from __future__ import annotations

import hashlib
import io
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import cache

import numpy as np

from validation import core
from validation.corpus import REPO_ROOT

COMMIT = "7fee5b548ad3898b1d0be3755253f1cb33ad083d"
URL = (
    "https://raw.githubusercontent.com/santiagobarreda/hillenbrand_et_al_1995/"
    f"{COMMIT}/h95-alldata.zip"
)
SHA256 = "2560548591e3a726c88549b6dc9d226995616c26874d601c69fee8b9eee9d730"
CACHE_PATH = REPO_ROOT / "harness" / ".cache" / "h95-alldata.zip"

GROUPS = {"m": "men", "w": "women"}
VOWELS = ("iy", "ih", "ei", "eh", "ae", "ah", "aw", "oa", "oo", "uw", "uh", "er")


@dataclass(frozen=True)
class Token:
    name: str  # e.g. "m01ae"
    group: str
    vowel: str
    rate: int
    signal: np.ndarray = field(repr=False, compare=False)
    start_s: float  # vowel nucleus
    end_s: float
    steady_s: float  # mean of the judges' steady-state times
    f0_hz: float | None
    formants_hz: tuple[float | None, ...]  # F1-F4 at the steady state


def fetch() -> bytes:
    if not CACHE_PATH.exists():
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=120) as r:
            data = r.read()
        CACHE_PATH.write_bytes(data)
    data = CACHE_PATH.read_bytes()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError(f"{CACHE_PATH}: SHA-256 mismatch; delete it and rerun")
    return data


def _wav(data: bytes) -> tuple[np.ndarray, int]:
    """16-bit PCM WAV to float samples. Hillenbrand's headers are minimal, so
    walk the chunks rather than trust a fixed offset."""
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE", "not a WAV"
    pos, rate, bits, samples = 12, None, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos : pos + 4], int.from_bytes(data[pos + 4 : pos + 8], "little")
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"fmt ":
            rate = int.from_bytes(body[4:8], "little")
            bits = int.from_bytes(body[14:16], "little")
        elif cid == b"data":
            samples = body
        pos += 8 + size + (size & 1)
    assert rate and bits == 16 and samples is not None, "unsupported WAV"
    return np.frombuffer(samples[: len(samples) // 2 * 2], "<i2") / 32768.0, rate


@cache
def tokens() -> tuple[Token, ...]:
    outer = zipfile.ZipFile(io.BytesIO(fetch()))
    times = {}
    for line in outer.read("timedata.dat").decode("latin1").splitlines():
        parts = line.split()
        if len(parts) == 5 and parts[0][:1] in GROUPS and parts[0][-2:] in VOWELS:
            s, e, c1, c2 = (float(p) / 1000 for p in parts[1:])
            times[parts[0]] = (s, e, (c1 + c2) / 2)
    values = {}
    for line in outer.read("vowdata.dat").decode("latin1").splitlines():
        parts = line.split()
        if len(parts) == 16 and parts[0][:1] in GROUPS and parts[0][-2:] in VOWELS:
            nums = [float(p) or None for p in parts[2:7]]
            values[parts[0]] = (nums[0], tuple(nums[1:5]))
    out = []
    for group in GROUPS.values():
        inner = zipfile.ZipFile(io.BytesIO(outer.read(f"{group}.zip")))
        for member in sorted(inner.namelist()):
            name = member.rsplit("/", 1)[-1].removesuffix(".wav").lower()
            if name not in times or name not in values:
                continue
            x, rate = _wav(inner.read(member))
            s, e, c = times[name]
            f0, formants = values[name]
            out.append(Token(name, group, name[-2:], rate, x, s, e, c, f0, formants))
    return tuple(out)


# Half-width (s) of the window around the judges' steady-state time when
# comparing formants with Hillenbrand's, which were measured at that instant.
STEADY_HALF_WIDTH_S = 0.04

_MEASURED: dict[tuple, dict | None] = {}


def measure(token: Token, *options: str, at_steady_state: bool = False) -> dict | None:
    """newvoice-core's known-boundary vowel measurement.

    By default over the vowel nucleus (the middle half, as the app measures
    a prompted vowel); with `at_steady_state`, over a short window at the
    judges' steady-state time, to compare like with like.
    """
    key = (token.name, options, at_steady_state)
    if key not in _MEASURED:
        if at_steady_state:
            start, end = token.steady_s - STEADY_HALF_WIDTH_S, token.steady_s + STEADY_HALF_WIDTH_S
        else:
            start, end = token.start_s, token.end_s
        _MEASURED[key] = core.run_signal(
            token.name,
            token.signal,
            token.rate,
            "vowel",
            "--start",
            str(start),
            "--end",
            str(end),
            "--vowel",
            token.vowel,
            *options,
        )
    return _MEASURED[key]


def measure_all(*options: str, at_steady_state: bool = False) -> list[tuple[Token, dict | None]]:
    toks = tokens()
    core.build()
    with ThreadPoolExecutor(8) as ex:
        results = ex.map(lambda t: measure(t, *options, at_steady_state=at_steady_state), toks)
        return list(zip(toks, results, strict=True))


_F0: dict[tuple[str, str], float] = {}


def nucleus_f0(token: Token, algorithm: str) -> float:
    """Median F0 over the middle half of the nucleus (NaN if unvoiced)."""
    key = (token.name, algorithm)
    if key not in _F0:
        r = core.run_signal(
            token.name,
            token.signal,
            token.rate,
            "frames",
            "--no-formants",
            "--algorithm",
            algorithm,
        )
        mid, q = 0.5 * (token.start_s + token.end_s), 0.25 * (token.end_s - token.start_s)
        v = [f["f0_hz"] for f in r["frames"] if mid - q <= f["t"] <= mid + q and f["f0_hz"]]
        _F0[key] = float(np.median(v)) if v else float("nan")
    return _F0[key]


def f0_errors(algorithm: str) -> np.ndarray:
    """Relative error of the nucleus F0 against Hillenbrand's steady-state F0."""
    toks = [t for t in tokens() if t.f0_hz]
    core.build()
    with ThreadPoolExecutor(8) as ex:
        f0 = np.array(list(ex.map(lambda t: nucleus_f0(t, algorithm), toks)))
    return np.abs(f0 / np.array([t.f0_hz for t in toks]) - 1)


def formant_errors(results: list[tuple[Token, dict | None]]) -> np.ndarray:
    """Relative F1-F3 errors (rows = tokens, NaN where either side is missing)."""
    rows = []
    for t, m in results:
        ours = (
            [np.nan] * 3
            if m is None
            else [np.nan if v is None else v for v in m["formants_hz"][:3]]
        )
        ref = [np.nan if v is None else v for v in t.formants_hz[:3]]
        rows.append(np.abs(np.array(ours) / np.array(ref) - 1))
    return np.array(rows)
