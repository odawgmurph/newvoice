"""Strain-monitor test sessions (Stage 3, decision D18).

The strain monitor (`app/src/feedback/strain.ts`) watches utterance
summaries over a practice session and asks for a rest on the handbook's
warning signs (§2.4): rising jitter or shimmer, falling CPPS, F0 above the
user's comfortable 90th percentile, and self-reported effort ≥ 6/10. This
module builds the sessions it is tested on and writes their utterance
summaries, computed by the core exactly as the phone computes them
(`newvoice-cli utterances` streams the audio through the live analyser and
the utterance segmenter), to `app/src/feedback/fixtures/strain-sessions.json`.

- **Deliberately strained sessions (synthetic).** Twelve 2.2 s utterances
  of a voice with known per-cycle jitter and shimmer and aspiration noise.
  The first four are steady; from the fifth, one sign (or all of them)
  ramps up, or F0 is pushed above the comfortable p90. The monitor must
  ask for a rest before the session ends.
- **Healthy synthetic sessions.** The same voice with natural
  utterance-to-utterance variation, louder and softer, and a pitch rise that
  stays inside the comfortable range. The monitor must stay quiet.
- **Healthy real sessions.** Each LibriSpeech dev-clean speaker's first
  read utterances in order, one "session" per speaker (40 speakers). Read
  speech varies with its words far more than a practice session does, so
  this is a hard test of false alarms. It needs the pinned dev-clean
  tarball (`corpus.build_librispeech` downloads it to `.cache/`, 338 MB),
  so CI checks only the synthetic part of the fixture.

Run from `harness/`:

    uv run python -m validation.strain            # rewrite the fixture
    uv run python -m validation.strain --check    # synthetic part up to date?
    uv run python -m validation.strain --report   # docs/validation/stage3-strain.md
"""

from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import numpy as np
import parselmouth

from validation import core, synth
from validation.corpus import BANDWIDTHS, REPO_ROOT, vowel_formants

FIXTURE = REPO_ROOT / "app" / "src" / "feedback" / "fixtures" / "strain-sessions.json"
REPORT = REPO_ROOT / "docs" / "validation" / "stage3-strain.md"
EVAL_SCRIPT = REPO_ROOT / "harness" / "tools" / "strain-eval.mjs"
TARBALL = REPO_ROOT / "harness" / ".cache" / "dev-clean.tar.gz"

RATE = 44_100
UTTERANCES = 12
ONSET = 4  # first strained utterance (0-based)
VOICED_S = 2.2
GAP_S = 0.6
DECIMALS = 4

# Real sessions: this many read utterances per dev-clean speaker, in order.
REAL_FILES_PER_SPEAKER = 10

# Steady voice: about what Praat-style local measures give for a healthy
# sustained voice (jitter well under 1%, shimmer a few %), and aspiration
# noise 30 dB down.
J0, S0, SNR0 = 0.004, 0.025, 30.0


def st(hz: float) -> float:
    return 69 + 12 * np.log2(hz / 440)


# Two practice voices: a raised-pitch voice with a long vocal tract (a voice
# in transition) and a higher one with shorter-tract formants.
VOICES = {
    "A": {"group": "men", "f0": 180.0, "comfortable_p90_hz": 210.0},
    "B": {"group": "women", "f0": 215.0, "comfortable_p90_hz": 250.0},
}
VOWEL_CYCLE = ("ah", "iy", "ae", "uw")


def _ramp(i: int, start: float, end: float) -> float:
    """`start` before ONSET, then linear to `end` at the last utterance."""
    if i < ONSET:
        return start
    return start + (end - start) * (i - ONSET + 1) / (UTTERANCES - ONSET)


# name -> (voice, expect a rest prompt, per-utterance parameter function).
# Each function maps the utterance index to overrides of
# {jitter, shimmer, snr_db, f0_scale, gain}.
SYNTHETIC = {
    "healthy-steady-A": ("A", False, lambda i: {}),
    "healthy-steady-B": ("B", False, lambda i: {}),
    "healthy-loudness-A": ("A", False, lambda i: {"gain": 10 ** ((-12 if i % 2 else 0) / 20)}),
    # Up 1.5 ST over the session, peaking just under the comfortable p90.
    "healthy-pitch-rise-A": ("A", False, lambda i: {"f0_scale": 2 ** (1.5 * i / 11 / 12)}),
    "strained-jitter-A": ("A", True, lambda i: {"jitter": _ramp(i, J0, 0.025)}),
    "strained-jitter-B": ("B", True, lambda i: {"jitter": _ramp(i, J0, 0.025)}),
    "strained-shimmer-A": ("A", True, lambda i: {"shimmer": _ramp(i, S0, 0.12)}),
    "strained-shimmer-B": ("B", True, lambda i: {"shimmer": _ramp(i, S0, 0.12)}),
    "strained-noise-A": ("A", True, lambda i: {"snr_db": _ramp(i, SNR0, 6.0)}),
    "strained-noise-B": ("B", True, lambda i: {"snr_db": _ramp(i, SNR0, 6.0)}),
    "strained-combined-B": (
        "B",
        True,
        lambda i: {
            "jitter": _ramp(i, J0, 0.015),
            "shimmer": _ramp(i, S0, 0.08),
            "snr_db": _ramp(i, SNR0, 12.0),
        },
    ),
    # From the fifth utterance, F0 jumps 2 ST above the comfortable p90.
    "strained-above-p90-A": (
        "A",
        True,
        lambda i: {"f0_scale": 2 ** ((st(210.0) + 2 - st(180.0)) / 12) if i >= ONSET else 1.0},
    ),
}


def utterance(seed: int, voice: dict, vowel: str, **p) -> np.ndarray:
    """One utterance: a perturbed glottal source with aspiration noise,
    through the vowel's formants, with a gentle falling F0 (declination)."""
    rng = np.random.default_rng(seed)
    jitter = p.get("jitter", J0) * rng.uniform(0.85, 1.15)
    shimmer = p.get("shimmer", S0) * rng.uniform(0.85, 1.15)
    snr_db = p.get("snr_db", SNR0) + rng.uniform(-2, 2)
    f0 = voice["f0"] * p.get("f0_scale", 1.0) * 2 ** (rng.uniform(-0.5, 0.5) / 12)
    # Cycle by cycle along a 1.5 ST declination.
    periods, t = [], 0.0
    while t < VOICED_S:
        f = f0 * 2 ** (-1.5 * t / VOICED_S / 12)
        periods.append((1 + 1.5 * jitter * rng.uniform(-1, 1)) / f)
        t += periods[-1]
    periods = np.array(periods)
    amps = 1 + 1.5 * shimmer * rng.uniform(-1, 1, len(periods))
    x = synth.perturbed_source(periods, amps, RATE)
    noise = rng.standard_normal(len(x))
    noise *= np.sqrt(np.mean(x**2) / np.mean(noise**2)) / 10 ** (snr_db / 20)
    pairs = list(zip(vowel_formants(voice["group"], vowel), BANDWIDTHS, strict=True))
    y = synth.resonate(x + noise, pairs, RATE)
    # 30 ms fades so the edges don't click.
    fade = int(0.03 * RATE)
    ramp = np.linspace(0, 1, fade)
    y[:fade] *= ramp
    y[-fade:] *= ramp[::-1]
    return 0.3 * p.get("gain", 1.0) * y / np.abs(y).max()


def synthetic_session(name: str) -> tuple[np.ndarray, dict]:
    voice_key, strained, params = SYNTHETIC[name]
    voice = VOICES[voice_key]
    seed0 = sum(map(ord, name)) * 1000
    gap = np.zeros(int(GAP_S * RATE))
    parts = [gap]
    for i in range(UTTERANCES):
        vowel = VOWEL_CYCLE[i % len(VOWEL_CYCLE)]
        parts += [utterance(seed0 + i, voice, vowel, **params(i)), gap]
    x = np.concatenate(parts)
    # A quiet room: noise floor about 70 dB under the voice.
    x += 1e-4 * np.random.default_rng(seed0).standard_normal(len(x))
    meta = {
        "name": name,
        "source": "synthetic",
        "expectRest": strained,
        "onsetUtterance": ONSET if strained else None,
        "comfortableP90St": round(st(voice["comfortable_p90_hz"]), DECIMALS),
    }
    return x, meta


_CAMEL = re.compile(r"_([a-z0-9])")


def _camel(key: str) -> str:
    key = key.replace("_5_95_", "5to95_")
    return _CAMEL.sub(lambda m: m.group(1).upper(), key)


def _tidy(v):
    if isinstance(v, dict):
        return {_camel(k): _tidy(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_tidy(x) for x in v]
    if isinstance(v, float):
        return round(v, DECIMALS)
    return v


def summaries(x: np.ndarray, rate: int) -> list[dict]:
    """Utterance summaries as the phone computes them, in the app's shape."""
    out = core.run_signal("session", x, rate, "utterances")
    return [_tidy(u) for u in out["utterances"]]


def synthetic_sessions() -> list[dict]:
    sessions = []
    for name in SYNTHETIC:
        x, meta = synthetic_session(name)
        sessions.append({**meta, "utterances": summaries(x, RATE)})
    return sessions


def real_sessions(tarball: Path = TARBALL) -> list[dict]:
    """One healthy session per dev-clean speaker: their first read
    utterances in order, each streamed separately."""
    sessions = []
    with tarfile.open(tarball) as tar:
        members = {m.name: m for m in tar.getmembers() if m.isfile()}
        sexes = {}
        speakers_txt = tar.extractfile(members["LibriSpeech/SPEAKERS.TXT"]).read().decode()
        for line in speakers_txt.splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 3 and parts[2] == "dev-clean":
                sexes[parts[0]] = parts[1]
        for spk in sorted(sexes, key=int):
            flacs = sorted(
                n
                for n in members
                if n.startswith(f"LibriSpeech/dev-clean/{spk}/") and n.endswith(".flac")
            )[:REAL_FILES_PER_SPEAKER]
            utts = []
            for name in flacs:
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "x.flac"
                    path.write_bytes(tar.extractfile(members[name]).read())
                    snd = parselmouth.Sound(str(path))
                utts += summaries(snd.values[0], int(snd.sampling_frequency))
            sessions.append(
                {
                    "name": f"librispeech-{spk}-{sexes[spk]}",
                    "source": "librispeech",
                    "expectRest": False,
                    "onsetUtterance": None,
                    "comfortableP90St": None,
                    "utterances": utts,
                }
            )
    return sessions


def _header() -> dict:
    return {
        "generator": "harness/validation/strain.py",
        "coreVersion": core.run_signal("probe", np.zeros(4410), RATE, "utterances")["core_version"],
    }


def write(include_real: bool) -> dict:
    existing = json.loads(FIXTURE.read_text()) if FIXTURE.exists() else {"sessions": []}
    if include_real:
        real = real_sessions()
    else:
        real = [s for s in existing["sessions"] if s["source"] == "librispeech"]
    data = {**_header(), "sessions": synthetic_sessions() + real}
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    return data


def check() -> list[str]:
    """Names of synthetic sessions whose committed summaries differ from a
    fresh run (beyond rounding)."""
    committed = {s["name"]: s for s in json.loads(FIXTURE.read_text())["sessions"]}
    stale = []
    for fresh in synthetic_sessions():
        old = committed.get(fresh["name"])
        if old is None or not _close(old, fresh):
            stale.append(fresh["name"])
    return stale


def _close(a, b, tol: float = 2 * 10**-DECIMALS) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k], tol) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y, tol) for x, y in zip(a, b, strict=True))
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, int | float) and isinstance(b, int | float) and abs(a - b) <= tol
    return a == b


def evaluate() -> dict:
    """Runs the app's strain monitor on the fixture (Node, type stripping)."""
    out = subprocess.run(
        ["node", "--no-warnings", "--experimental-strip-types", str(EVAL_SCRIPT), str(FIXTURE)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def report() -> str:
    data = json.loads(FIXTURE.read_text())
    ev = evaluate()
    by_name = {r["name"]: r for r in ev["sessions"]}
    buf = io.StringIO()
    w = buf.write
    w("# Stage 3 validation: the strain monitor\n\n")
    w(
        "Generated by `harness/validation/strain.py --report` from "
        "`app/src/feedback/fixtures/strain-sessions.json` "
        f"(core {data['coreVersion']}). Decision D18.\n\n"
    )
    w(
        "The monitor asks for a rest on any one of the handbook's warning signs "
        "(§2.4): jitter or shimmer rising over the session, CPPS falling, an "
        "utterance's median F0 above the comfortable p90, or effort ≥ 6/10. Trends "
        "compare the median of the last "
        f"{ev['rules']['window']} scored utterances with the median of the session's "
        f"first {ev['rules']['window']}. Thresholds: jitter ×{ev['rules']['jitterRatio']} "
        f"and +{100 * ev['rules']['jitterRise']:.2g} points; shimmer "
        f"×{ev['rules']['shimmerRatio']} and +{100 * ev['rules']['shimmerRise']:.2g} points; "
        f"CPPS −{ev['rules']['cppsDropDb']} dB.\n\n"
    )
    w("## Deliberately strained and healthy synthetic sessions\n\n")
    w(
        f"{UTTERANCES} utterances of {VOICED_S} s each. In strained sessions, utterances "
        f"1–{ONSET} are steady and the sign ramps from utterance {ONSET + 1}. "
        "*Rest at* is the 1-based utterance after which the monitor asked for a rest.\n\n"
    )
    w(
        "| Session | Expect rest | Rest at | Reasons "
        "| Median jitter / shimmer / CPPS, first → last 3 |\n"
    )
    w("|---|---|---|---|---|\n")
    for s in data["sessions"]:
        if s["source"] != "synthetic":
            continue
        r = by_name[s["name"]]
        w(
            f"| {s['name']} | {'yes' if s['expectRest'] else 'no'} | "
            f"{r['firstRestAt'] if r['firstRestAt'] is not None else '—'} | "
            f"{', '.join(r['reasons']) or '—'} | {_trend(s)} |\n"
        )
    real = [s for s in data["sessions"] if s["source"] == "librispeech"]
    if real:
        rests = [by_name[s["name"]] for s in real if by_name[s["name"]]["firstRestAt"] is not None]
        n_utts = sum(len([u for u in s["utterances"] if u["scored"]]) for s in real)
        w("\n## Healthy real speech (LibriSpeech dev-clean)\n\n")
        w(
            f"{len(real)} speakers, their first {REAL_FILES_PER_SPEAKER} read utterances each "
            f"({n_utts} scored utterances). No comfortable range is known, so only the trend "
            "rules apply. Read speech changes words every utterance, so it varies more "
            "than practice on fixed material.\n\n"
        )
        w(f"- Sessions with a rest prompt: **{len(rests)} of {len(real)}**")
        if rests:
            w(" (" + "; ".join(f"{r['name']}: {', '.join(r['reasons'])}" for r in rests) + ")")
        w(".\n")
        ratios = ev["healthyRatios"]
        w(
            "- Largest last-3 / first-3 ratios seen: jitter "
            f"×{ratios['jitter']:.2f}, shimmer ×{ratios['shimmer']:.2f}; largest CPPS drop "
            f"{ratios['cppsDrop']:.2f} dB.\n"
        )
    w(
        "\n## Limits\n\n"
        "- The strained voices are synthetic: per-cycle jitter and shimmer and "
        "aspiration noise, not real hyperfunction or false-fold constriction. No "
        "recordings of strained trans voices are available (handbook §4.5), and "
        "asking someone to strain on purpose conflicts with the safety rules.\n"
        "- Trend rules need six scored utterances (1 s voiced each), so the first "
        "minute of a session is covered only by the F0 and effort rules.\n"
    )
    return buf.getvalue()


def _trend(s: dict) -> str:
    scored = [u for u in s["utterances"] if u["scored"]]

    def med(key: str, part: list[dict]) -> float:
        v = [u[key] for u in part if u.get(key) is not None]
        return float(np.median(v)) if v else float("nan")

    first, last = scored[:3], scored[-3:]
    return (
        f"{100 * med('jitterLocal', first):.2f}% / {100 * med('shimmerLocal', first):.1f}% / "
        f"{med('cppsDb', first):.1f} → {100 * med('jitterLocal', last):.2f}% / "
        f"{100 * med('shimmerLocal', last):.1f}% / {med('cppsDb', last):.1f}"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the synthetic part is stale")
    ap.add_argument("--report", action="store_true", help="write the validation report")
    ap.add_argument("--real", action="store_true", help="recompute LibriSpeech sessions too")
    args = ap.parse_args(argv)
    if args.check:
        stale = check()
        if stale:
            print("stale strain fixture sessions: " + ", ".join(stale), file=sys.stderr)
            print("rerun: uv run python -m validation.strain", file=sys.stderr)
            return 1
        return 0
    if args.report:
        REPORT.write_text(report())
        return 0
    write(include_real=args.real)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
