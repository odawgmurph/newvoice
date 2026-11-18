"""An independent Python implementation of the resonance score (handbook
§3.3), straight from content/norms/reference_norms.json.

The golden tests use it two ways: to check that the core's generated norms
table and formula give the same positions for the same formants, and to
compute the true score of a synthetic vowel from its known formants.
"""

from __future__ import annotations

import math

from validation import corpus

MIN_SEPARATION = 1.0
FORMANT_WEIGHTS = (1.0, 2.0, 1.0)
FORMANTS = ("f1", "f2", "f3")


def _log_norms(group: str, vowel: str, k: int) -> tuple[float, float]:
    m = corpus.norms()["groups"][group]["vowels"][vowel]["measures_hz"][FORMANTS[k]]
    return m["log_mean"], m["log_sd"]


def scored(vowel: str, k: int) -> bool:
    (ma, sa), (mb, sb) = _log_norms("men", vowel, k), _log_norms("women", vowel, k)
    return (mb - ma) / math.sqrt(0.5 * (sa * sa + sb * sb)) >= MIN_SEPARATION


def positions(vowel: str, formants_hz) -> list[float | None]:
    """Per-formant positions (0 = men's geometric mean, 1 = women's)."""
    out = []
    for k in range(3):
        f = formants_hz[k] if k < len(formants_hz) else None
        if f is None or f <= 0 or not scored(vowel, k):
            out.append(None)
            continue
        ma, _ = _log_norms("men", vowel, k)
        mb, _ = _log_norms("women", vowel, k)
        out.append((math.log(f) - ma) / (mb - ma))
    return out


def weighted_median(pairs: list[tuple[float, float]]) -> float | None:
    pairs = sorted(p for p in pairs if p[1] > 0)
    total = sum(w for _, w in pairs)
    if total <= 0:
        return None
    acc = 0.0
    for i, (z, w) in enumerate(pairs):
        acc += w
        if math.isclose(acc, total / 2, rel_tol=1e-12):
            return 0.5 * (z + pairs[i + 1][0]) if i + 1 < len(pairs) else z
        if acc > total / 2:
            return z
    return pairs[-1][0]


def score(tokens: list[tuple], weights: list[float] | None = None) -> float | None:
    """Score of (vowel, formants) tokens, weighted equally unless `weights`
    gives each token's weight."""
    pairs = []
    for i, (vowel, formants) in enumerate(tokens):
        w = 1.0 if weights is None else weights[i]
        for k, z in enumerate(positions(vowel, formants)):
            if z is not None:
                pairs.append((z, w * FORMANT_WEIGHTS[k]))
    return weighted_median(pairs)
