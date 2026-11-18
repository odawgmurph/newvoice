"""Write the Stage 1 validation report for real recordings.

Usage (from harness/):
    uv run python -m validation.report_real

Writes docs/validation/stage1-real.md: the LibriSpeech subset (pitch against
Praat, clean and degraded) and the Hillenbrand (1995) vowels (formants, the
formant confidence, the resonance score and F0 against hand-checked values).
Rerun it after any change to the analysis core and commit the result.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from validation import core, corpus, hillenbrand, real, resonance
from validation.report import pct, table

OUTPUT = corpus.REPO_ROOT / "docs" / "validation" / "stage1-real.md"
ALGORITHMS = {"yin": "YIN", "mpm": "MPM", "pyin": "pYIN"}


def librispeech_section() -> str:
    rows = []
    for condition in real.CONDITIONS:
        cases = real.cases(condition)
        trackers = [("praat", "Praat")] if condition != "clean" else []
        trackers += list(ALGORITHMS.items())
        for key, label in trackers:
            results = [real.praat_on(c) if key == "praat" else real.compare(c, key) for c in cases]
            s = real.summary(results)
            rows.append(
                [
                    condition,
                    label,
                    pct(s["within_1pct"]),
                    f"{100 * s['gross']:.2f}",
                    pct(s["recall"]),
                    pct(s["false_voicing"]),
                ]
            )
    conditions = "\n".join(f"- `{k}`: {v}" for k, v in real.CONDITIONS.items())
    m = real.manifest()
    return (
        "## Pitch on read speech (LibriSpeech)\n\n"
        f"{len(m['utterances'])} utterances, 10 men and 10 women, 3.5–6 s each, from "
        "LibriSpeech dev-clean (CC BY 4.0, committed in `harness/corpus/librispeech/`). "
        "There is no ground truth, so Praat `To Pitch (ac)` on the clean recording is "
        "the reference; degraded copies are scored against it, and Praat's own row "
        "shows what each degradation costs a reference tracker.\n\n"
        f"{conditions}\n\n"
        "Within 1% and gross errors (>20% off, mostly octave jumps) are shares of "
        "frames both trackers call voiced; recall is the share of reference-voiced "
        "frames called voiced, false voicing the share of reference-unvoiced frames "
        "called voiced. Regression gates in `tests/test_real_speech.py`.\n\n"
        + table(
            [
                "Condition",
                "Tracker",
                "Within 1% (%)",
                "Gross (%)",
                "Recall (%)",
                "False voicing (%)",
            ],
            rows,
        )
        + "\n\nOn real speech the 1% frame-level match depends on more than "
        "accuracy: Praat agrees with its own clean track on only about 97% of "
        "frames once 20 dB of noise is added, and frames at voicing edges differ "
        "between any two trackers. Before decision D11 the 5-frame median filter "
        "cut YIN's within-1% share from 93% to 83% by clipping contour peaks; it "
        "now only replaces outliers. pYIN finds the most voiced frames and makes "
        "the fewest gross errors except at 10 dB SNR, where YIN, voicing far fewer "
        "frames, makes fewer; pYIN's extra frames are mostly at voicing edges "
        "(about two thirds within 50 ms of Praat-voiced speech), the rest "
        "low-level breath just above the −60 dBFS gate. The telephone channel "
        "removes most men's fundamentals, and every tracker, Praat included, "
        "makes about 10% gross errors there."
    )


def hillenbrand_section() -> str:
    steady = hillenbrand.measure_all(at_steady_state=True)
    nucleus = hillenbrand.measure_all()
    out = [
        "## Vowels with hand-checked formants (Hillenbrand 1995)\n",
        "540 tokens from 45 men and 576 from 48 women, h-V-d words at 16 kHz, with "
        "Hillenbrand's hand-corrected LPC formants and F0 at the judges' steady-state "
        "time. The recordings come from Santiago Barreda's mirror (hosted with Jim "
        "Hillenbrand's permission), pinned by SHA-256 and downloaded into "
        "`harness/.cache`; they are not committed. Gates in `tests/test_hillenbrand.py`.\n",
        "### Formants\n",
        "newvoice-core's sustained-vowel sweep with known boundaries, over 80 ms "
        "centred on the steady-state time (like for like), and over the middle half "
        "of the vowel nucleus (as the app measures a prompted vowel). Median error and "
        "share within 10%, F1 / F2 / F3.\n",
    ]
    rows = []
    for label, results in (("steady state", steady), ("nucleus", nucleus)):
        for group in ("men", "women"):
            res = [(t, m) for t, m in results if t.group == group and m is not None]
            e = hillenbrand.formant_errors(res)
            med = np.nanmedian(e, axis=0)
            within = np.nanmean(e <= 0.10, axis=0)
            rows.append(
                [
                    label,
                    group,
                    str(len(res)),
                    " / ".join(pct(v) for v in med),
                    " / ".join(pct(v) for v in within),
                ]
            )
    out.append(table(["Window", "Group", "Tokens", "Median error (%)", "Within 10% (%)"], rows))
    out.append(
        "\nThe gap between the two windows is mostly vowel-inherent spectral change "
        "(/ɪ e æ ʊ/ glide in American English), not tracking error: Hillenbrand "
        "measured one instant, the nucleus window takes a median over its middle "
        "half.\n"
    )

    out.append("### Bandwidth filter\n")
    rows = []
    for label, opts in (
        ("600 Hz", ("--max-bandwidth", "600")),
        ("1000 Hz (default)", ()),
        ("1500 Hz", ("--max-bandwidth", "1500")),
        ("none (Praat raw)", ("--raw-formants",)),
    ):
        res = [(t, m) for t, m in hillenbrand.measure_all(*opts) if m is not None]
        row = [label]
        for group in ("men", "women"):
            e = hillenbrand.formant_errors([(t, m) for t, m in res if t.group == group])
            row.append(" / ".join(pct(v) for v in np.nanmean(e <= 0.10, axis=0)))
        rows.append(row)
    out.append(
        "Share within 10% (F1 / F2 / F3) over the nucleus, with poles wider than the "
        "cutoff dropped before numbering (decision D8).\n\n"
        + table(["Cutoff", "Men", "Women"], rows)
        + "\n\nAny cutoff from 600 to 1500 Hz does about equally well; no filter "
        "loses 2–3 points on women's F2 and F3, where a wide pole takes a formant "
        "slot. The 1000 Hz default stays.\n"
    )

    res = [(t, m) for t, m in steady if m is not None]
    bad = np.nanmax(hillenbrand.formant_errors(res)[:, :2], axis=1) > 0.10
    conf = np.array([m["confidence"] for _, m in res])
    good, poor = conf[~bad], conf[bad]
    auc = np.mean(good[:, None] > poor[None, :]) + 0.5 * np.mean(good[:, None] == poor[None, :])
    bins = [(0.0, 0.8), (0.8, 0.9), (0.9, 0.95), (0.95, 1.01)]
    rows = []
    for lo, hi in bins:
        sel = (conf >= lo) & (conf < hi)
        if sel.any():
            rows.append(
                [
                    f"{lo:.2f}–{min(hi, 1):.2f}",
                    str(int(sel.sum())),
                    pct(1 - bad[sel].mean()),
                    f"{conf[sel].mean():.2f}",
                ]
            )
    out.append("### Formant confidence\n")
    out.append(
        "Fitted on these steady-state tokens (decision D11): a logistic curve in the "
        "wider of the F1/F2 bandwidths, times an F0 term from 250 Hz. A token is "
        f"good when F1 and F2 are both within 10%. AUC (good above poor) {auc:.2f}; "
        f"mean confidence {conf.mean():.2f} against {pct(1 - bad.mean())}% good.\n\n"
        + table(["Confidence", "Tokens", "Good (%)", "Mean confidence"], rows)
        + "\n"
    )

    from tests.test_hillenbrand import speaker_scores

    scores = speaker_scores(nucleus)
    rows = []
    for group in ("men", "women"):
        ours, hand = scores[group][:, 0], scores[group][:, 1]
        rows.append(
            [
                group,
                str(len(ours)),
                spread(ours),
                spread(hand),
                f"{np.median(np.abs(ours - hand)):.2f} / {np.abs(ours - hand).max():.2f}",
            ]
        )
    men, women = scores["men"][:, 0], scores["women"][:, 0]
    tokens_err = [
        m["resonance"]["score"] - h
        for t, m in nucleus
        if m is not None
        and m["resonance"] is not None
        and (h := resonance.score([(t.vowel, t.formants_hz[:3])])) is not None
    ]
    tokens_err = np.abs(tokens_err)
    out.append("### Resonance score\n")
    out.append(
        "Per speaker: the score over all their vowels, measured over the nucleus and "
        "weighted by formant confidence, against the same score from Hillenbrand's "
        "hand-checked formants. Median (10th–90th percentile), and the median / "
        "largest difference.\n\n"
        + table(["Group", "Speakers", "newvoice-core", "Hand-checked", "Difference"], rows)
        + f"\n\nThe groups separate almost completely (a woman scores above a man in "
        f"{pct(np.mean(women[:, None] > men[None, :]))}% of pairs), as the formula "
        "intends: this is the reference data the scale is built on, so it shows the "
        "measurement works, not that the score predicts perception. A single "
        f"token is much noisier (median error {np.median(tokens_err):.2f}, 90th "
        f"percentile {np.percentile(tokens_err, 90):.2f}), so exercises should score "
        "several vowels, as Unit 5's six-vowel criterion does.\n"
    )

    rows = []
    for key, label in ALGORITHMS.items():
        e = hillenbrand.f0_errors(key)
        rows.append([label, pct(np.median(e)), pct(np.mean(e <= 0.05)), pct2(np.mean(e > 0.2))])
    out.append("### F0\n")
    out.append(
        "Median F0 over the middle half of the nucleus against Hillenbrand's F0 at "
        "the steady-state instant (so some difference is real F0 movement).\n\n"
        + table(["Tracker", "Median error (%)", "Within 5% (%)", "Gross >20% (%)"], rows)
        + "\n\nThese vowels exposed a failure the synthetic traps missed: with H4 on "
        "F1 (men's /ɝ ʊ ɪ/), YIN and MPM read 3–4× the F0, because the octave guard "
        "only looked at the double period. Generalising it to every multiple "
        "(decision D11) cut YIN's gross errors here from 4.1% to under 2%. About a "
        "third of the remainder are tokens where newvoice-core agrees with Praat "
        "and the reference reads differently.\n"
    )
    return "\n".join(out)


def spread(v: np.ndarray) -> str:
    p10, p90 = np.percentile(v, [10, 90])
    return f"{np.median(v):.2f} ({p10:.2f}–{p90:.2f})"


def pct2(x: float) -> str:
    return f"{100 * x:.2f}"


LIMITATIONS = """## Known limitations

- **No children or voices above ~300 Hz.** The real vowels are adult men and
  women; formant confidence above 300 Hz follows the synthetic error curve.
- **No real ground truth for running speech.** LibriSpeech is scored against
  Praat; the hand-checked set is isolated h-V-d words.
- **pYIN's voicing** extends into voicing edges and some low-level breath;
  the app's minimum voiced duration and level gate should be kept for
  utterance scores.
- **The telephone channel** costs every tracker about 10% gross errors on
  men's voices; Bluetooth and narrowband capture need a warning (Stage 2).
- **Read American English only.** Both corpora are North American English;
  other languages and dialects need their own norms (Stage 10).
"""


def main() -> int:
    core.build()
    version = core.on_case(corpus.vowel_case("men", "ah", 120.0), "bench", "--repeat", "1")
    parts = [
        "# Stage 1 validation: real recordings\n",
        "Generated by `cd harness && uv run python -m validation.report_real` with "
        f"newvoice-core {version['core_version']}. Do not edit by hand. Synthetic-corpus "
        "results, with known ground truth, are in [`stage1-synthetic.md`](stage1-synthetic.md).\n",
        librispeech_section(),
        hillenbrand_section(),
        LIMITATIONS,
    ]
    OUTPUT.write_text("\n\n".join(p.strip() for p in parts) + "\n", encoding="utf-8")
    print(f"wrote {Path(OUTPUT).relative_to(corpus.REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
