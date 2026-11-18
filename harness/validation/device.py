"""Device matrix: score a test clip exported from the app.

The app's *Record test clip* + *Export diagnostics* produce a pair of files,
`nv-<model>-<route>-<time>.json` and `.wav`. The WAV holds exactly the samples
the phone's live analyser received, from capture start, so frame k of the
phone and frame k of any analysis of the WAV sit at the same time. Each clip
answers three questions:

1. **Does the phone compute what the core computes?** The desktop core runs
   on the same WAV. Streaming and batch analysis give identical frames
   (`streaming_matches_batch_for_any_chunking`), so any difference comes from
   the phone build or from capture: ARM floating point, FFI marshalling, or
   samples dropped before analysis.
2. **How close are the live readings to Praat on the same audio?** This is
   the handbook's golden-file comparison (handbook "Testing DSP": F0 ±1%,
   F1/F2 ±5–8%) on real capture. Praat sees the same audio, so it measures
   the tracker on this phone's signal; whether the mic itself colours the
   signal shows up in comparisons *between* devices and routes in the
   matrix, with the same speaker and material.
3. **Does it meet the Stage 2 budget?** Mic-to-screen under 100 ms, a steady
   60 fps, per-frame cost well inside the 10 ms hop, and no dropped samples.

Usage (from harness/):

    uv run python -m validation.device path/to/nv-*.json [...]

prints a Markdown section per clip and a row for
`docs/validation/device-matrix.md`.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import parselmouth

from validation import core, praat
from validation.measure import MAX_BANDWIDTH_HZ
from validation.real import FINE_TOLERANCE, GROSS_ERROR

FORMAT = "newvoice-diagnostics"
FORMAT_VERSION = 1

# Stage 2 exit criteria (docs/build-plan.md).
MAX_MIC_TO_SCREEN_MS = 100.0
MIN_UI_FPS = 58.0
# Same share of the hop the CI machine must meet (tests/test_realtime.py).
BUDGET_SHARE = 0.25

# Phone and desktop count as agreeing on a frame's F0 within this.
CORE_TOLERANCE = 0.001
# Formants are compared where the app would show them (App.tsx).
MIN_FORMANT_CONFIDENCE = 0.5


def _array(values) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=float)


@dataclass
class Export:
    path: Path
    report: dict
    signal: np.ndarray = field(repr=False)
    rate: int
    # Phone frames as columns: t, f0Hz, f1Hz, f2Hz, f3Hz, formantConfidence, ...
    frames: dict[str, np.ndarray] = field(repr=False)

    @property
    def name(self) -> str:
        return self.path.stem

    @property
    def wav(self) -> Path:
        return self.path.with_name(self.report["wav"])


def load(path: Path) -> Export:
    report = json.loads(path.read_text(encoding="utf-8"))
    if report.get("format") != FORMAT or report.get("formatVersion") != FORMAT_VERSION:
        raise ValueError(
            f"{path.name}: expected {FORMAT} v{FORMAT_VERSION}, got "
            f"{report.get('format')} v{report.get('formatVersion')}"
        )
    wav = path.with_name(report["wav"])
    sound = parselmouth.Sound(str(wav))
    frames = {k: _array(v) for k, v in report["frames"].items()}
    return Export(
        path=path,
        report=report,
        signal=sound.values[0].astype(float),
        rate=int(sound.sampling_frequency),
        frames=frames,
    )


# ---------------------------------------------------------------------------
# 1. Phone vs desktop core


def core_agreement(e: Export) -> dict:
    """Frame-by-frame agreement between the phone and the desktop core."""
    options: list[str] = []
    ceiling = e.report["settings"].get("formantCeilingHz")
    if ceiling is None:
        options.append("--no-formants")
    else:
        options += ["--ceiling", str(ceiling)]
    algorithm = str(e.report["settings"].get("pitchAlgorithm", "yin")).lower()
    options += ["--algorithm", algorithm]
    desk = core.run("frames", e.wav, *options)
    d = desk["frames"]

    phone_t = e.frames["t"]
    n = min(len(phone_t), len(d))
    desk_t = np.array([f["t"] for f in d[:n]])
    aligned = bool(np.allclose(phone_t[:n], desk_t, atol=1e-6))

    ours = e.frames["f0Hz"][:n]
    theirs = _array([f["f0_hz"] for f in d[:n]])
    voicing = np.isnan(ours) == np.isnan(theirs)
    both = ~np.isnan(ours) & ~np.isnan(theirs)
    rel = np.abs(ours[both] / theirs[both] - 1)

    f2_phone = e.frames["f2Hz"][:n]
    f2_desk = _array([f["formants"][1][0] if len(f["formants"] or []) > 1 else None for f in d[:n]])
    f2_both = ~np.isnan(f2_phone) & ~np.isnan(f2_desk)
    f2_rel = np.abs(f2_phone[f2_both] / f2_desk[f2_both] - 1)

    return {
        "desktop_core_version": desk["core_version"],
        "frames": n,
        "times_aligned": aligned,
        "voicing_agreement": float(np.mean(voicing)) if n else float("nan"),
        "f0_agreement": float(np.mean(rel <= CORE_TOLERANCE)) if rel.size else float("nan"),
        "f0_max_rel_diff": float(rel.max()) if rel.size else float("nan"),
        "f2_agreement": float(np.mean(f2_rel <= CORE_TOLERANCE)) if f2_rel.size else float("nan"),
    }


# ---------------------------------------------------------------------------
# 2. Phone vs Praat


@dataclass(frozen=True)
class _Clip:
    """What validation.praat needs from a case."""

    signal: np.ndarray
    rate: int


def pitch_vs_praat(e: Export) -> dict:
    """The phone's live F0 against Praat `To Pitch (ac)` on the same audio,
    scored like the LibriSpeech real-speech tests (validation/real.py)."""
    t = e.frames["t"]
    ref = praat.f0_at(_Clip(e.signal, e.rate), t)
    ours = e.frames["f0Hz"]
    both = ~np.isnan(ours) & ~np.isnan(ref)
    err = np.abs(ours[both] / ref[both] - 1)
    voiced = ~np.isnan(ref)
    unvoiced = ~voiced
    return {
        "frames": int(both.sum()),
        "praat_voiced_s": float(voiced.sum() * 0.01),
        "within_1pct": float(np.mean(err <= FINE_TOLERANCE)) if err.size else float("nan"),
        "gross": float(np.mean(err > GROSS_ERROR)) if err.size else float("nan"),
        "recall": float(np.mean(~np.isnan(ours[voiced]))) if voiced.any() else float("nan"),
        "false_voicing": float(np.mean(~np.isnan(ours[unvoiced]))) if unvoiced.any() else 0.0,
    }


def formants_vs_praat(e: Export) -> dict:
    """The phone's F1/F2, where the app would show them, against Praat
    `To Formant (burg)` at the same ceiling and bandwidth filter."""
    ceiling = e.report["settings"].get("formantCeilingHz")
    if ceiling is None:
        return {"frames": 0}
    f = e.frames
    shown = (
        ~np.isnan(f["f0Hz"])
        & ~np.isnan(f["f2Hz"])
        & (f["formantConfidence"] >= MIN_FORMANT_CONFIDENCE)
    )
    if not shown.any():
        return {"frames": 0}
    ref = praat.formants_at(
        _Clip(e.signal, e.rate), f["t"][shown], ceiling, n=2, max_bandwidth_hz=MAX_BANDWIDTH_HZ
    )
    out: dict = {"frames": int(shown.sum()), "ceiling_hz": ceiling}
    for k, key in enumerate(("f1Hz", "f2Hz")):
        ours = f[key][shown]
        ok = ~np.isnan(ours) & ~np.isnan(ref[:, k])
        err = np.abs(ours[ok] / ref[ok, k] - 1)
        label = key[:2].lower()
        out[f"{label}_median_err"] = float(np.median(err)) if err.size else float("nan")
        out[f"{label}_within_5pct"] = float(np.mean(err <= 0.05)) if err.size else float("nan")
        out[f"{label}_within_10pct"] = float(np.mean(err <= 0.10)) if err.size else float("nan")
    return out


# ---------------------------------------------------------------------------
# 3. Budget


def _stat(stats: dict | None, key: str) -> float:
    return float("nan") if not stats or stats.get(key) is None else float(stats[key])


def budget(e: Export) -> dict:
    r = e.report
    app = r.get("app", {})
    bench = r.get("benchmark", {})
    hop_us = float(bench.get("hopUs", 10_000))
    bench_us = _stat(bench, "usPerFrame")
    m2s_p95 = _stat(app.get("micToScreenMs"), "p95")
    fps = _stat(app.get("uiFps"), "median")
    dropped = int(r["clip"]["droppedSamples"])
    start, end = r["captureAtStart"], r["captureAtEnd"]
    return {
        "mic_to_screen_median_ms": _stat(app.get("micToScreenMs"), "median"),
        "mic_to_screen_p95_ms": m2s_p95,
        "ui_fps_median": fps,
        "bench_us_per_frame": bench_us,
        "live_us_per_frame": _stat(r.get("liveCost"), "usPerFrame"),
        "live_max_tick_us": _stat(r.get("liveCost"), "maxTickUs"),
        "dropped_samples": dropped,
        "measurement_mode": bool(start.get("measurementMode")) and bool(end.get("measurementMode")),
        "route_changed": start.get("inputs") != end.get("inputs"),
        "passes": {
            "latency": m2s_p95 < MAX_MIC_TO_SCREEN_MS,
            "fps": fps >= MIN_UI_FPS,
            "cost": bench_us < BUDGET_SHARE * hop_us,
            "no_drops": dropped == 0,
        },
    }


# ---------------------------------------------------------------------------
# Report


def evaluate(e: Export) -> dict:
    return {
        "name": e.name,
        "device": e.report["device"],
        "route": ", ".join(
            f"{i['name']} ({i['type']})" for i in e.report["captureAtStart"].get("inputs", [])
        ),
        "clip_s": e.report["clip"]["seconds"],
        "core": core_agreement(e),
        "pitch": pitch_vs_praat(e),
        "formants": formants_vs_praat(e),
        "budget": budget(e),
    }


def _pct(v: float) -> str:
    return "—" if v != v else f"{100 * v:.1f}%"


def _num(v: float, digits: int = 0) -> str:
    return "—" if v != v else f"{v:.{digits}f}"


def _mark(ok: bool) -> str:
    return "✓" if ok else "✗"


TABLE_HEADER = (
    "| Device | OS | Input | Meas. mode | Mic→screen p95 | UI fps | µs/frame | Dropped "
    "| F0 ≤1% vs Praat | F0 gross | F2 ≤10% vs Praat | Phone = core |\n"
    "|---|---|---|---|---|---|---|---|---|---|---|---|"
)


def table_row(r: dict) -> str:
    b, p, f, c = r["budget"], r["pitch"], r["formants"], r["core"]
    ok = b["passes"]
    return (
        f"| {r['device']['model']} | {r['device']['system']} | {r['route']} "
        f"| {'yes' if b['measurement_mode'] else '**no**'} "
        f"| {_num(b['mic_to_screen_p95_ms'])} ms {_mark(ok['latency'])} "
        f"| {_num(b['ui_fps_median'])} {_mark(ok['fps'])} "
        f"| {_num(b['bench_us_per_frame'])} {_mark(ok['cost'])} "
        f"| {b['dropped_samples']} {_mark(ok['no_drops'])} "
        f"| {_pct(p['within_1pct'])} | {_pct(p['gross'])} "
        f"| {_pct(f.get('f2_within_10pct', float('nan')))} "
        f"| {_pct(c['f0_agreement'])} |"
    )


def markdown(r: dict) -> str:
    b, p, f, c = r["budget"], r["pitch"], r["formants"], r["core"]
    lines = [
        f"### {r['name']}",
        "",
        f"- **Device:** {r['device']['model']}, {r['device']['system']}; "
        f"input {r['route']}; clip {r['clip_s']:.1f} s.",
        f"- **Budget:** mic→screen median {_num(b['mic_to_screen_median_ms'])} ms, "
        f"p95 {_num(b['mic_to_screen_p95_ms'])} ms; UI {_num(b['ui_fps_median'])} fps; "
        f"{_num(b['bench_us_per_frame'])} µs/frame benchmarked, "
        f"{_num(b['live_us_per_frame'])} µs/frame live (worst tick "
        f"{_num(b['live_max_tick_us'])} µs); {b['dropped_samples']} dropped samples.",
        f"- **Capture:** measurement mode {'held' if b['measurement_mode'] else '**not held**'}"
        + ("; **route changed during the clip**" if b["route_changed"] else "")
        + ".",
        f"- **F0 vs Praat:** {_pct(p['within_1pct'])} within 1%, {_pct(p['gross'])} gross "
        f"errors over {p['frames']} frames; voicing recall {_pct(p['recall'])}, "
        f"false voicing {_pct(p['false_voicing'])}.",
    ]
    if f.get("frames"):
        lines.append(
            f"- **Formants vs Praat** ({f['frames']} shown frames, ceiling "
            f"{f['ceiling_hz']:.0f} Hz): F1 median error {_pct(f['f1_median_err'])}, "
            f"{_pct(f['f1_within_10pct'])} within 10%; F2 median error "
            f"{_pct(f['f2_median_err'])}, {_pct(f['f2_within_10pct'])} within 10%."
        )
    else:
        lines.append("- **Formants vs Praat:** no frames confident enough to show.")
    lines.append(
        f"- **Phone vs desktop core** ({c['desktop_core_version']}): F0 agrees on "
        f"{_pct(c['f0_agreement'])} of frames (max difference {_pct(c['f0_max_rel_diff'])}), "
        f"voicing on {_pct(c['voicing_agreement'])}, F2 on {_pct(c['f2_agreement'])}"
        + ("" if c["times_aligned"] else "; **frame times are misaligned**")
        + "."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("reports", nargs="+", type=Path, help="exported nv-*.json files")
    ap.add_argument("--json", action="store_true", help="print raw results as JSON")
    args = ap.parse_args(argv)
    results = [evaluate(load(p)) for p in args.reports]
    if args.json:
        print(json.dumps(results, indent=2, default=float))
        return 0
    for r in results:
        print(markdown(r))
        print()
    print(TABLE_HEADER)
    for r in results:
        print(table_row(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
