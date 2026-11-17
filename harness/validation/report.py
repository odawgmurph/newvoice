"""Write the Stage 1 validation report for the synthetic corpus.

Usage (from harness/):
    uv run python -m validation.report

Writes docs/validation/stage1-synthetic.md. Rerun it after any change to the
analysis core and commit the result with the change.
"""

from __future__ import annotations

import platform
from collections import defaultdict
from pathlib import Path

import numpy as np

from validation import core, corpus, praat
from validation.measure import (
    compare_pitch,
    group_ceiling,
    ours_fixed_formants,
    ours_vowel,
    praat_fixed_formants,
    quality,
    relative_error,
)
from validation.vtl import avtl_cm

OUTPUT = corpus.REPO_ROOT / "docs" / "validation" / "stage1-synthetic.md"
OTHER_CEILING_HZ = {"men": 5500.0, "women": 5000.0}


def pct(x: float) -> str:
    return "—" if np.isnan(x) else f"{100 * x:.1f}"


def pct2(x: float) -> str:
    return "—" if np.isnan(x) else f"{100 * x:.2f}"


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def pitch_section() -> str:
    rows = []
    for case in corpus.pitch_cases():
        row = [f"`{case.name}`"]
        for algorithm in ("yin", "mpm"):
            c = compare_pitch(case, algorithm)
            p, t = c.error_vs_praat(), c.error_vs_truth()
            row += [pct2(np.median(p)), pct2(p.max()), pct2(t.max())]
        rows.append(row)
    header = ["Signal"] + [
        f"{a} {m}"
        for a in ("YIN", "MPM")
        for m in ("median vs Praat", "max vs Praat", "max vs truth")
    ]
    traps = []
    for case in corpus.octave_trap_cases():
        row = [f"`{case.name}`"]
        for algorithm in ("yin", "mpm"):
            c = compare_pitch(case, algorithm)
            voiced = c.inner & ~np.isnan(c.ours)
            err = np.abs(c.ours[voiced] / c.truth[voiced] - 1)
            row += [pct(c.voiced_share("ours")), pct(np.mean(err <= 0.05))]
        praat_f0 = c.praat[c.inner & ~np.isnan(c.praat)]
        row.append(pct(np.mean(np.abs(praat_f0 / case.f0_start - 1) <= 0.05)))
        traps.append(row)
    return (
        "## Pitch\n\n"
        "Relative F0 error (%) on frames at least 50 ms inside the voiced part. "
        "Praat is `To Pitch (ac)` with a 60–500 Hz range. The gate is 1%.\n\n"
        + table(header, rows)
        + "\n\n### Octave traps\n\n"
        "Signals that provoke octave errors: a weak fundamental with H2 on F1 "
        "(H1 18 dB below H2), which made both estimators read an octave high "
        "until the octave-up guard was added, and per-cycle jitter, which can "
        "produce sub-harmonics. Share (%) of inner frames that are voiced, and "
        "of voiced frames within 5% of the true F0. The gate is 95% voiced and "
        "99% within 5%.\n\n"
        + table(
            [
                "Signal",
                "YIN voiced",
                "YIN within 5%",
                "MPM voiced",
                "MPM within 5%",
                "Praat within 5%",
            ],
            traps,
        )
    )


def formant_section() -> str:
    f0s = corpus.GATED_F0_HZ + corpus.HIGH_F0_HZ
    by_f0: dict[float, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    equivalence = []
    vtl = defaultdict(list)
    for case in corpus.formant_cases(f0s):
        truth = case.formants[:3]
        ceiling = group_ceiling(case)
        ours_clean = ours_fixed_formants(case, ceiling)
        equivalence.append(np.abs(ours_clean / praat_fixed_formants(case, ceiling, True) - 1))
        m = ours_vowel(case)
        cell = by_f0[case.f0_start]
        cell["sweep"].append(relative_error(m["formants_hz"][:3], truth))
        cell["fixed"].append(relative_error(ours_clean, truth))
        cell["other"].append(
            relative_error(ours_fixed_formants(case, OTHER_CEILING_HZ[case.group]), truth)
        )
        cell["praat_raw"].append(
            relative_error(praat_fixed_formants(case, ceiling, clean=False), truth)
        )
        cell["confidence"].append(m["confidence"])
        if m["avtl_cm"] is not None:
            vtl[case.vowel].append(abs(m["avtl_cm"] / avtl_cm(case.formants[:4]) - 1))

    worst = np.nanmax(np.array(equivalence), axis=0)
    out = [
        "## Formants\n",
        "### Same algorithm as Praat\n",
        "newvoice-core against Praat `To Formant (burg)` (5 formants, 25 ms, 50 Hz "
        "pre-emphasis) at the same ceiling, with poles wider than 1000 Hz dropped on "
        "both sides. Median over the steady-state middle half of each vowel, worst "
        f"case over all {len(equivalence)} vowels at every F0. The gate is 5%.\n",
        table(
            ["", "F1", "F2", "F3"],
            [["Worst difference (%)"] + [pct2(w) for w in worst]],
        ),
        "\n### Error against the true formants, by F0\n",
        "Relative error (%) against the formants the vowels were synthesised with "
        "(Hillenbrand men's and women's means for /i æ ɑ u ɝ/), median and worst case "
        "per F0. Columns:\n",
        "- **Sweep**: what the app uses for vowels: the multi-ceiling sweep with the "
        "bandwidth filter.",
        "- **Fixed**: one ceiling, the conventional one for the group (5000 Hz men, "
        "5500 Hz women), with the bandwidth filter.",
        "- **Other ceiling**: the other group's ceiling. This is the risk for a voice "
        "in transition analysed with a fixed ceiling.",
        "- **Praat raw**: Praat at the conventional ceiling, all poles kept, as "
        "Praat is usually used. Tilt poles often take the F2 slot.\n",
    ]
    rows = []
    for f0 in f0s:
        cell = by_f0[f0]
        row = [f"{f0:.0f}" + (" (not gated)" if f0 in corpus.HIGH_F0_HZ else "")]
        for key in ("sweep", "fixed", "other", "praat_raw"):
            e = np.array(cell[key])
            med, mx = np.nanmedian(e, axis=0), np.nanmax(e, axis=0)
            row.append(" / ".join(f"{pct(a)}–{pct(b)}" for a, b in zip(med, mx, strict=True)))
        row.append(f"{np.mean(cell['confidence']):.2f}")
        rows.append(row)
    out.append(
        table(
            [
                "F0 (Hz)",
                "Sweep F1 / F2 / F3",
                "Fixed",
                "Other ceiling",
                "Praat raw",
                "Mean confidence",
            ],
            rows,
        )
    )
    out.append(
        "\nEach cell is median–worst for F1 / F2 / F3. Confidence is the provisional "
        "heuristic in `analysis::formant_confidence`.\n"
    )
    out.append("### Apparent vocal tract length\n")
    out.append(
        "Relative error (%) of aVTL (from ΔF over F1–F4) against the value implied by "
        "the true formants, over F0 100–400 Hz.\n"
    )
    out.append(
        table(
            ["Vowel", "Median", "Worst", "Measured"],
            [
                [f"/{corpus.norms()['groups']['men']['vowels'][v]['ipa']}/"]
                + [pct(np.median(vtl[v])), pct(np.max(vtl[v])), str(len(vtl[v]))]
                for v in corpus.FORMANT_VOWELS
            ],
        )
    )
    return "\n".join(out)


def db(x) -> str:
    return "—" if x is None or np.isnan(x) else f"{x:+.2f}"


def quality_section() -> str:
    out = ["## Voice quality\n"]

    # Spectral measures against the exact spectrum, and H1*-H2* against the source.
    rows = []
    groups: dict[str, list] = defaultdict(list)
    for case in corpus.quality_cases():
        groups[case.name.split("-h1h2")[0]].append(case)
    for name, cases in groups.items():
        errs = defaultdict(list)
        near_f1 = False
        for case in cases:
            q = quality(case)
            for k in ("alpha_ratio_db", "hammarberg_db", "lh_ratio_db"):
                errs[k].append(abs(q[k] - case.truth[k]))
            errs["h1c"].append(abs(q["h1c_h2c_db"] - case.source_h1_h2_db))
            f1 = case.formants[0]
            near_f1 = any(abs(k * case.f0 - f1) < 150 for k in (1, 2))
        rows.append(
            [f"`{name}`" + (" (H1 or H2 near F1)" if near_f1 else "")]
            + [
                f"{max(errs[k]):.2f}"
                for k in ("alpha_ratio_db", "hammarberg_db", "lh_ratio_db", "h1c")
            ]
        )
    out += [
        "### Spectral measures\n",
        "Worst absolute error (dB) over source H1−H2 of −3, +3 and +9 dB and source "
        "tilts of 1/k and 1/k^1.6, against values computed exactly from each "
        "vowel's harmonic amplitudes after the resonators. H1*−H2* is compared with "
        "the source's H1−H2. Gates: alpha 0.5 dB, Hammarberg and L/H 1 dB, "
        "H1*−H2* 1 dB away from F1.\n",
        table(["Vowel", "Alpha ratio", "Hammarberg", "L/H ratio", "H1*−H2*"], rows),
        "\nUncorrected H1−H2 moves one-for-one with the source within a vowel "
        "(gate 0.3 dB), which is what baseline-relative scores rely on.\n",
    ]

    # CPPS and HNR against Praat.
    rows = []
    for case in corpus.noisy_quality_cases():
        q = quality(case)["praat_style"]
        pc, ph = praat.cpps(case), praat.hnr(case)
        rows.append(
            [
                f"`{case.name}`",
                f"{q['cpps_db']:.2f}",
                f"{pc:.2f}",
                db(q["cpps_db"] - pc),
                f"{q['hnr_db']:.2f}",
                f"{ph:.2f}",
                db(q["hnr_db"] - ph),
            ]
        )
    out += [
        "\n### CPPS and HNR\n",
        "Whole-signal means against Praat 6.1 (`To PowerCepstrogram` + `Get CPPS` "
        "with default settings; `To Harmonicity (ac)`), on vowels with white noise "
        "added at 40, 25, 15 and 8 dB SNR. Gates: CPPS 0.75 dB, HNR 0.5 dB.\n",
        table(["Signal", "CPPS ours", "CPPS Praat", "Δ", "HNR ours", "HNR Praat", "Δ"], rows),
    ]

    # Jitter and shimmer.
    rows = []
    for case in corpus.perturbation_cases():
        q = quality(case)
        pj, ps = praat.jitter_shimmer(case)
        rows.append(
            [
                f"`{case.name}`",
                pct2(case.true_jitter),
                pct2(q["jitter_local"]),
                pct2(pj),
                pct2(case.true_shimmer),
                pct2(q["shimmer_local"]),
                pct2(ps),
                str(q["periods"]),
            ]
        )
    out += [
        "\n### Jitter and shimmer\n",
        "Local jitter and shimmer (%) of sources with known per-cycle period and "
        'amplitude perturbation, filtered by /ɑ/ resonators. "Source" is the '
        "perturbation put in; the resonators ring across cycle boundaries and "
        "smooth some of it away, so both analysers read jitter about 15% low. The "
        "gate is agreement with Praat: 10% (+0.03 pp) for jitter, 15% (+0.2 pp) "
        "for shimmer.\n",
        table(
            [
                "Signal",
                "Jitter source",
                "ours",
                "Praat",
                "Shimmer source",
                "ours",
                "Praat",
                "Periods",
            ],
            rows,
        ),
    ]
    return "\n".join(out)


def realtime_section() -> str:
    case = corpus.vowel_case("women", "ae", 200.0, rate=48_000, seconds=3.0)
    r = core.on_case(case, "bench", "--chunk", "480", "--repeat", "5")
    return (
        "## Real-time cost\n\n"
        "Streaming analysis (pitch, formants at one ceiling and the per-frame "
        "spectral measures) of 3 s at 48 kHz "
        "in 10 ms chunks, best of 5 runs, on the machine that generated this report "
        f"({platform.machine()}). The low-end ARM measurement is a Stage 2 task.\n\n"
        + table(
            ["Per frame", "Hop", "Share of hop", "Latency"],
            [
                [
                    f"{r['us_per_frame']:.0f} µs",
                    f"{r['hop_us'] / 1000:.0f} ms",
                    f"{100 * r['us_per_frame'] / r['hop_us']:.1f}%",
                    f"{1000 * r['latency_s']:.0f} ms",
                ]
            ],
        )
    )


LIMITATIONS = """## Known limitations

- **Synthetic audio only.** These vowels come from a harmonic source and Klatt
  resonators, which is cleaner than speech. Real recordings (Hillenbrand
  tokens, VCTK, LibriSpeech) and codec/noise degradations are still to be
  added to the corpus.
- **F1 at high F0.** From about 200 Hz up, F1 error grows as LPC peaks snap
  to the sparse harmonics, for Praat and newvoice-core alike. Formant
  readouts must be confidence-gated there (handbook §3.3).
- **F4 on /ɝ/.** With F2 and F3 close together, F4, and so aVTL, is
  unreliable on /ɝ/ (see its row above). Baseline aVTL uses /a i u/ instead.
- **The sweep above 300 Hz** occasionally picks a ceiling that misses F2.
  Confidence is already low there.
- **Formant confidence is provisional.** It is a hand-set heuristic, to be
  fitted to these error measurements and to real recordings.
- **H1*−H2* near F1.** When H1 or H2 sits on F1 (for example /i/ or /u/ at
  higher F0), the Iseli–Alwan correction can be several dB off. Within one
  vowel, changes are still tracked; compare a user only with their own
  baseline on the same vowel.
- **CPPS on perfectly clean signals** reads about 1.5 dB above Praat: the
  noiseless gaps between harmonics make the log spectrum depend on resampler
  details. Every real recording has a noise floor, where the two agree.
- **Pitch on strongly jittered voices.** Beyond about 2% jitter at higher F0,
  YIN (the default) gives sub-harmonic frames that the jump guard then
  drops; MPM degrades less. Healthy voices are well below this.
- **The weight index is unvalidated.** It is a baseline-relative heuristic
  (handbook §3.4) until the Stage 10 listener study.
"""


def main() -> int:
    core.build()
    version = core.on_case(corpus.vowel_case("men", "ah", 120.0), "bench", "--repeat", "1")
    parts = [
        "# Stage 1 validation: synthetic corpus\n",
        "Generated by `cd harness && uv run python -m validation.report` with "
        f"newvoice-core {version['core_version']}. Do not edit by hand. The same "
        "comparisons gate CI in `harness/tests/test_golden_*.py`.\n",
        pitch_section(),
        formant_section(),
        quality_section(),
        realtime_section(),
        LIMITATIONS,
    ]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n\n".join(p.strip() for p in parts) + "\n", encoding="utf-8")
    print(f"wrote {Path(OUTPUT).relative_to(corpus.REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
