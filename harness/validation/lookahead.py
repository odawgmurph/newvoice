"""Live look-ahead: how the streamed pitch track differs from batch analysis.

Usage (from harness/):
    uv run python -m validation.lookahead

The live analyser holds each frame for `lookahead_frames` hops before
emitting it, so the jump guard can see whether a run entered by a large jump
lasts 50 ms (handbook §3.2). With less look-ahead the live trace is drawn
sooner but can show short jumps that batch analysis (and so every stored
recording) rejects. This measures that trade on the LibriSpeech subset,
clean and degraded, and writes docs/validation/live-lookahead.md (decision
D16). Rerun it after any change to the jump guard or median filter.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from validation import core, corpus, real
from validation.report import pct, pct2, table

OUTPUT = corpus.REPO_ROOT / "docs" / "validation" / "live-lookahead.md"
LOOKAHEADS = (2, 3, 4, 5)
HOP_S = 0.01
# Window reach plus everything outside the analyser, from the first iPhone
# clip (D13): 104 ms median mic-to-screen with 5 frames of look-ahead.
MEASURED_MIC_TO_SCREEN_MS = 104.0
MEASURED_LOOKAHEAD = 5
# A streamed frame this far from the batch frame (semitones) is a visible
# disagreement: more than the median filter's own 1 ST outlier rule.
DIFFERENT_ST = 1.0


def track(result: dict) -> np.ndarray:
    return np.array([np.nan if f["f0_hz"] is None else f["f0_hz"] for f in result["frames"]])


def live_track(case: real.RealCase, lookahead: int) -> np.ndarray:
    r = core.on_case(case, "frames", "--no-formants", "--stream", "--lookahead", str(lookahead))
    return track(r)


def batch_track(case: real.RealCase) -> np.ndarray:
    return track(real.ours_track(case, "yin"))


@dataclass
class Disagreement:
    """Streamed vs batch on one case."""

    frames: int  # frames voiced in either track
    extra: int  # voiced live, rejected by batch
    missing: int  # voiced in batch, rejected live
    different: int  # both voiced, more than DIFFERENT_ST apart
    events: int  # runs of consecutive disagreeing frames
    longest: int  # longest such run, in frames


def disagreement(live: np.ndarray, batch: np.ndarray) -> Disagreement:
    n = min(len(live), len(batch))
    live, batch = live[:n], batch[:n]
    lv, bv = ~np.isnan(live), ~np.isnan(batch)
    both = lv & bv
    apart = np.zeros(n, dtype=bool)
    apart[both] = np.abs(12 * np.log2(live[both] / batch[both])) > DIFFERENT_ST
    bad = (lv & ~bv) | (~lv & bv) | apart
    runs, run, longest = 0, 0, 0
    for b in bad:
        if b:
            run += 1
            longest = max(longest, run)
            if run == 1:
                runs += 1
        else:
            run = 0
    return Disagreement(
        frames=int(np.sum(lv | bv)),
        extra=int(np.sum(lv & ~bv)),
        missing=int(np.sum(~lv & bv)),
        different=int(np.sum(apart)),
        events=runs,
        longest=longest,
    )


def pooled(rows: list[Disagreement], seconds: float) -> dict:
    frames = sum(r.frames for r in rows)
    bad = sum(r.extra + r.missing + r.different for r in rows)
    return {
        "frames": frames,
        "share": bad / frames if frames else 0.0,
        "extra": sum(r.extra for r in rows) / frames if frames else 0.0,
        "missing": sum(r.missing for r in rows) / frames if frames else 0.0,
        "different": sum(r.different for r in rows) / frames if frames else 0.0,
        "events_per_min": 60 * sum(r.events for r in rows) / seconds,
        "longest_ms": 1000 * HOP_S * max((r.longest for r in rows), default=0),
    }


def measure() -> dict[tuple[str, int], dict]:
    """(condition, lookahead) -> pooled disagreement and accuracy vs Praat."""
    out = {}
    for condition in real.CONDITIONS:
        cases = real.cases(condition)
        seconds = sum(len(c.signal) / c.rate for c in cases)
        batches = {c.name: batch_track(c) for c in cases}
        for la in LOOKAHEADS:
            rows, accuracy = [], []
            for c in cases:
                live = live_track(c, la)
                rows.append(disagreement(live, batches[c.name]))
                clean_name = c.name.rsplit("-", 1)[0] + "-clean"
                accuracy.append(
                    real.RealPitch(ours=live, ref=real.reference_f0(clean_name, len(live)))
                )
            out[(condition, la)] = pooled(rows, seconds) | {"accuracy": real.summary(accuracy)}
    return out


def mic_to_screen_ms(lookahead: int) -> float:
    return MEASURED_MIC_TO_SCREEN_MS - 1000 * HOP_S * (MEASURED_LOOKAHEAD - lookahead)


def render(results: dict[tuple[str, int], dict]) -> str:
    rows = []
    for (condition, la), r in results.items():
        a = r["accuracy"]
        rows.append(
            [
                condition,
                str(la),
                f"~{mic_to_screen_ms(la):.0f}",
                pct2(r["share"]),
                pct2(r["extra"]),
                pct2(r["missing"]),
                pct2(r["different"]),
                f"{r['events_per_min']:.1f}",
                f"{r['longest_ms']:.0f}",
                pct(a["within_1pct"]),
                f"{100 * a['gross']:.2f}",
            ]
        )
    m = real.manifest()
    return (
        "# Live look-ahead: streamed vs batch pitch\n\n"
        "Generated by `uv run python -m validation.lookahead` (harness/). "
        "Evidence for decision D16.\n\n"
        "The live analyser emits a frame after `lookahead_frames` hops, so the jump "
        "guard (handbook §3.2: reject jumps over 7 ST unless sustained over 50 ms) "
        "can confirm a run before it is drawn. Stored recordings go through batch "
        "analysis, which always sees the whole run. With less look-ahead the trace "
        "appears sooner, and a short jump the batch track rejects can briefly be drawn.\n\n"
        f"Corpus: the {len(m['utterances'])} LibriSpeech utterances of "
        "[stage1-real.md](stage1-real.md), clean and degraded, YIN (the live default). "
        "Each row streams every utterance through `StreamAnalyser` "
        "(`newvoice-cli frames --stream --lookahead N`) and compares it with the "
        "batch track frame by frame.\n\n"
        "- *Mic→screen* is the first iPhone clip's 104 ms median (D13, 5 frames) "
        "less 10 ms per frame removed; it is an estimate, not a measurement.\n"
        "- *Differs* is the share of frames voiced in either track where they disagree: "
        "*extra* (live draws F0, batch rejects it), *missing* (batch has F0, live "
        f"rejects it), or *apart* (both voiced, more than {DIFFERENT_ST:g} ST apart).\n"
        "- *Events/min* counts runs of consecutive disagreeing frames per minute of "
        "audio; *longest* is the longest such run.\n"
        "- *Within 1%* and *gross* score the live track against Praat on the clean "
        "audio, as in stage1-real.md.\n\n"
        + table(
            [
                "Condition",
                "Look-ahead",
                "Mic→screen ms",
                "Differs",
                "Extra",
                "Missing",
                "Apart",
                "Events/min",
                "Longest ms",
                "Within 1%",
                "Gross %",
            ],
            rows,
        )
        + "\n"
    )


def main() -> None:
    core.build()
    OUTPUT.write_text(render(measure()), encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
