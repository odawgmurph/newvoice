"""Build content/norms/reference_norms.json from Hillenbrand et al. (1995).

Downloads the per-token vowel data (pinned by commit and SHA-256), computes
group statistics for adult men and women, and writes versioned JSON. Only the
derived statistics are committed; the raw data is not redistributed.

It also renders the formant and ΔF log-statistics the analysis core needs
for the resonance score as a Rust table, so the core reads exactly the
committed JSON without a JSON parser, and the chart data the app's feedback
views need (vowel F1/F2 means and covariances, F0 and ΔF) as a TypeScript
module. The TypeScript names the two reference groups by their end of the
resonance scale ("low" = adult men, "high" = adult women), so the app's
source carries no gendered words outside the opt-in labels (decision D2).

Usage (from harness/):
    uv run python -m norms.build_norms           # regenerate both outputs
    uv run python -m norms.build_norms --check   # fail if any output is stale
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

GENERATOR_VERSION = "1.0.0"
SCHEMA_VERSION = 1

SOURCE_COMMIT = "0787a1ab4007217f0ad2a756e0d1c4385f676fd2"
SOURCE_URL = (
    "https://raw.githubusercontent.com/kleinschmidt/hdp-bayes-vowels/"
    f"{SOURCE_COMMIT}/hillenbrand-data/vowdata.dat"
)
SOURCE_SHA256 = "05a4a69e2c6b0f444077245b1427d12bc86f8d7a32ae7a4b63f7e06e5712e4b1"

HARNESS_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = HARNESS_DIR.parent
CACHE_PATH = HARNESS_DIR / ".cache" / "vowdata.dat"
OUTPUT_PATH = REPO_ROOT / "content" / "norms" / "reference_norms.json"
RUST_OUTPUT_PATH = REPO_ROOT / "core" / "newvoice-core" / "src" / "reference_norms.rs"
TS_OUTPUT_PATH = REPO_ROOT / "app" / "src" / "feedback" / "referenceNorms.ts"

# Speed of sound used for apparent vocal tract length, in cm/s (warm, humid air).
SPEED_OF_SOUND_CM_S = 35_000.0

GROUPS = {"m": "men", "w": "women"}  # children (b, g) are excluded

# Hillenbrand vowel codes -> (IPA, h_d word). Order is the output order.
VOWELS = {
    "iy": ("i", "heed"),
    "ih": ("ɪ", "hid"),
    "ei": ("e", "haid"),
    "eh": ("ɛ", "head"),
    "ae": ("æ", "had"),
    "ah": ("ɑ", "hod"),
    "aw": ("ɔ", "hawed"),
    "oa": ("o", "hoed"),
    "oo": ("ʊ", "hood"),
    "uw": ("u", "who'd"),
    "uh": ("ʌ", "hud"),
    "er": ("ɝ", "heard"),
}

MEASURES = ("f0", "f1", "f2", "f3", "f4")  # steady-state values, columns 3-7


@dataclass(frozen=True)
class Token:
    group: str  # "men" | "women"
    speaker: str  # e.g. "m01"
    vowel: str  # Hillenbrand code, e.g. "iy"
    values: dict[str, float | None]  # measure -> Hz, None when not measurable


def fetch_source(cache: Path = CACHE_PATH) -> str:
    """Return the source text, downloading it once and verifying its hash."""
    if cache.exists():
        data = cache.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as resp:
            data = resp.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(f"vowdata.dat hash mismatch: got {digest}, want {SOURCE_SHA256}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data.decode("ascii")


def parse(text: str) -> list[Token]:
    """Parse adult tokens from vowdata.dat. Zero means 'not measurable'."""
    tokens = []
    for line in text.splitlines():
        cols = line.split()
        if len(cols) != 16 or len(cols[0]) != 5 or not cols[1].isdigit():
            continue  # header and comment lines
        name = cols[0]
        group = GROUPS.get(name[0])
        if group is None or name[3:5] not in VOWELS:
            continue
        values = {}
        for measure, raw in zip(MEASURES, cols[2:7], strict=True):
            hz = float(raw)
            values[measure] = hz if hz > 0 else None
        tokens.append(Token(group, name[:3], name[3:5], values))
    return tokens


def r(x: float, places: int = 2) -> float:
    return round(x, places)


def describe(values: list[float]) -> dict:
    """Summary statistics in Hz plus natural-log Hz (for log-scale scoring)."""
    vs = sorted(values)
    logs = [math.log(v) for v in vs]
    deciles = statistics.quantiles(vs, n=10, method="inclusive")
    return {
        "n": len(vs),
        "mean": r(statistics.fmean(vs)),
        "sd": r(statistics.stdev(vs)),
        "median": r(statistics.median(vs)),
        "p10": r(deciles[0]),
        "p90": r(deciles[-1]),
        "log_mean": r(statistics.fmean(logs), 5),
        "log_sd": r(statistics.stdev(logs), 5),
    }


def covariance(xs: list[float], ys: list[float]) -> list[list[float]]:
    return [
        [statistics.variance(xs), statistics.covariance(xs, ys)],
        [statistics.covariance(xs, ys), statistics.variance(ys)],
    ]


def f1_f2_ellipse(tokens: list[Token]) -> dict:
    """F1xF2 covariance (Hz and log Hz) for drawing reference ellipses."""
    pairs = [(t.values["f1"], t.values["f2"]) for t in tokens]
    pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
    f1, f2 = [p[0] for p in pairs], [p[1] for p in pairs]
    lf1, lf2 = [math.log(v) for v in f1], [math.log(v) for v in f2]
    return {
        "n": len(pairs),
        "mean_hz": [r(statistics.fmean(f1)), r(statistics.fmean(f2))],
        "cov_hz": [[r(v) for v in row] for row in covariance(f1, f2)],
        "mean_log": [r(statistics.fmean(lf1), 5), r(statistics.fmean(lf2), 5)],
        "cov_log": [[r(v, 7) for v in row] for row in covariance(lf1, lf2)],
    }


def formant_dispersion(formants: list[float]) -> float:
    """Delta-F by zero-intercept regression of F_i on (2i - 1) / 2."""
    xs = [(2 * i - 1) / 2 for i in range(1, len(formants) + 1)]
    return sum(x * f for x, f in zip(xs, formants, strict=True)) / sum(x * x for x in xs)


def speaker_level(tokens: list[Token]) -> dict:
    """Per-speaker summaries, so each talker counts once (not once per vowel)."""
    by_speaker: dict[str, list[Token]] = defaultdict(list)
    for t in tokens:
        by_speaker[t.speaker].append(t)

    f0_medians, delta_fs = [], []
    for toks in by_speaker.values():
        f0s = [t.values["f0"] for t in toks if t.values["f0"] is not None]
        if f0s:
            f0_medians.append(statistics.median(f0s))
        # Delta-F needs all of F1-F4; average over the speaker's vowels because
        # any single vowel is biased by its articulation.
        dfs = [
            formant_dispersion([t.values[m] for m in ("f1", "f2", "f3", "f4")])
            for t in toks
            if all(t.values[m] is not None for m in ("f1", "f2", "f3", "f4"))
        ]
        if len(dfs) >= 6:
            delta_fs.append(statistics.fmean(dfs))

    return {
        "n_speakers": len(by_speaker),
        "f0_speaker_median_hz": describe(f0_medians),
        "delta_f_hz": describe(delta_fs),
        "avtl_cm": describe([SPEED_OF_SOUND_CM_S / (2 * d) for d in delta_fs]),
    }


def build(tokens: list[Token]) -> dict:
    groups = {}
    for group in GROUPS.values():
        gt = [t for t in tokens if t.group == group]
        vowels = {}
        for code, (ipa, word) in VOWELS.items():
            vt = [t for t in gt if t.vowel == code]
            measures = {}
            for m in MEASURES:
                vals = [t.values[m] for t in vt if t.values[m] is not None]
                measures[m] = describe(vals)
            vowels[code] = {
                "ipa": ipa,
                "word": word,
                "measures_hz": measures,
                "f1_f2": f1_f2_ellipse(vt),
            }
        groups[group] = {**speaker_level(gt), "vowels": vowels}

    return {
        "schema_version": SCHEMA_VERSION,
        "generator": "harness/norms/build_norms.py",
        "generator_version": GENERATOR_VERSION,
        "source": {
            "citation": (
                "Hillenbrand, J., Getty, L. A., Clark, M. J., & Wheeler, K. (1995). "
                "Acoustic characteristics of American English vowels. "
                "JASA 97(5), 3099-3111."
            ),
            "data": "vowdata.dat, (c) 1995 James Hillenbrand",
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
            "note": "Derived statistics only; the per-token data is not redistributed.",
        },
        "method": {
            "groups": "Adult men and women; children excluded.",
            "measures": "Steady-state values (vowdata.dat columns 3-7). Zeros "
            "(not measurable) are excluded per measure, so n varies.",
            "log": "log_* fields use natural log of Hz.",
            "quantiles": "p10/p90 use statistics.quantiles(method='inclusive').",
            "f0_speaker_median_hz": "Median F0 across each speaker's vowels, "
            "then summarised across speakers.",
            "delta_f_hz": "Zero-intercept regression of F1-F4 on (2i-1)/2 per "
            "token, averaged per speaker (speakers with >=6 complete tokens), "
            "then summarised across speakers.",
            "avtl_cm": f"c / (2 * delta_f) with c = {SPEED_OF_SOUND_CM_S:.0f} cm/s.",
            "f1_f2": "Token-level F1/F2 means and sample covariance, for ellipses.",
        },
        "groups": groups,
    }


def render(norms: dict) -> str:
    return json.dumps(norms, indent=2, ensure_ascii=False) + "\n"


def render_rust(norms: dict) -> str:
    """The resonance-score inputs as Rust: per vowel, the natural-log mean
    and SD of F1-F3 for each group, and the speaker-level ΔF."""

    def stat(m: dict) -> str:
        return f"LogNorm {{ mean: {m['log_mean']!r}, sd: {m['log_sd']!r} }}"

    def group(g: str, code: str) -> str:
        m = norms["groups"][g]["vowels"][code]["measures_hz"]
        return "[" + ", ".join(stat(m[f]) for f in ("f1", "f2", "f3")) + "]"

    lines = [
        "// @generated by harness/norms/build_norms.py from",
        "// content/norms/reference_norms.json. Do not edit; rerun the script.",
        "",
        "use crate::resonance::{LogNorm, VowelNorm};",
        "",
        f"pub const NORMS_SCHEMA_VERSION: u32 = {norms['schema_version']};",
        f'pub const NORMS_GENERATOR_VERSION: &str = "{norms["generator_version"]}";',
        "",
        "/// Speaker-level formant dispersion, [men, women].",
        "#[rustfmt::skip]",
        "pub const DELTA_F: [LogNorm; 2] = ["
        + ", ".join(stat(norms["groups"][g]["delta_f_hz"]) for g in ("men", "women"))
        + "];",
        "",
        "/// Hillenbrand (1995) vowels: F1-F3 per group.",
        "#[rustfmt::skip]",
        f"pub const VOWELS: [VowelNorm; {len(VOWELS)}] = [",
    ]
    for code, (ipa, word) in VOWELS.items():
        lines.append(
            f'    VowelNorm {{ code: "{code}", ipa: "{ipa}", word: "{word}", '
            f"men: {group('men', code)}, women: {group('women', code)} }},"
        )
    lines.append("];")
    return "\n".join(lines) + "\n"


def render_ts(norms: dict) -> str:
    """Chart data for the app: per vowel and reference group, F1/F2 means and
    covariance (Hz) plus the F1-F3 log means; per group, speaker-level F0
    and ΔF. Groups are keyed by scale end: low = men, high = women."""
    ends = {"low": "men", "high": "women"}

    def stats(m: dict) -> dict:
        return {"mean": m["mean"], "sd": m["sd"], "logMean": m["log_mean"], "logSd": m["log_sd"]}

    def vowel(code: str, g: str) -> dict:
        v = norms["groups"][g]["vowels"][code]
        e = v["f1_f2"]
        m = v["measures_hz"]
        return {
            "f1f2MeanHz": e["mean_hz"],
            "f1f2CovHz": e["cov_hz"],
            "logMean": [m[f]["log_mean"] for f in ("f1", "f2", "f3")],
        }

    data = {
        "schemaVersion": norms["schema_version"],
        "generatorVersion": norms["generator_version"],
        "groups": {
            end: {
                "f0SpeakerMedianHz": stats(norms["groups"][g]["f0_speaker_median_hz"]),
                "deltaFHz": stats(norms["groups"][g]["delta_f_hz"]),
            }
            for end, g in ends.items()
        },
        "vowels": {
            code: {
                "ipa": ipa,
                "word": word,
                **{end: vowel(code, g) for end, g in ends.items()},
            }
            for code, (ipa, word) in VOWELS.items()
        },
    }
    body = json.dumps(data, indent=2, ensure_ascii=False)
    return (
        "// @generated by harness/norms/build_norms.py from\n"
        "// content/norms/reference_norms.json. Do not edit; rerun the script.\n"
        "// Hillenbrand et al. (1995) adult reference groups, keyed by their end of\n"
        "// the resonance scale: low = 0, high = 1 (decision D11).\n\n"
        "export type GroupStats = { mean: number; sd: number; logMean: number; logSd: number };\n"
        "export type VowelGroupNorm = {\n"
        "  f1f2MeanHz: [number, number];\n"
        "  f1f2CovHz: [[number, number], [number, number]];\n"
        "  /** Natural-log means of F1, F2, F3. */\n"
        "  logMean: [number, number, number];\n"
        "};\n"
        "export type VowelNorm = {\n"
        "  ipa: string;\n"
        "  word: string;\n"
        "  low: VowelGroupNorm;\n"
        "  high: VowelGroupNorm;\n"
        "};\n"
        "export type ReferenceNorms = {\n"
        "  schemaVersion: number;\n"
        "  generatorVersion: string;\n"
        "  groups: Record<\n"
        "    'low' | 'high',\n"
        "    { f0SpeakerMedianHz: GroupStats; deltaFHz: GroupStats }\n"
        "  >;\n"
        "  vowels: Record<string, VowelNorm>;\n"
        "};\n\n"
        f"export const REFERENCE_NORMS: ReferenceNorms = {body};\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check", action="store_true", help="exit 1 if the committed JSON is out of date"
    )
    args = parser.parse_args(argv)

    norms = build(parse(fetch_source()))
    outputs = {
        OUTPUT_PATH: render(norms),
        RUST_OUTPUT_PATH: render_rust(norms),
        TS_OUTPUT_PATH: render_ts(norms),
    }
    if args.check:
        stale = [
            path
            for path, text in outputs.items()
            if (path.read_text(encoding="utf-8") if path.exists() else "") != text
        ]
        for path in stale:
            print(f"{path} is stale; run: uv run python -m norms.build_norms")
        if not stale:
            print("reference norms are up to date")
        return 1 if stale else 0

    for path, text in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
