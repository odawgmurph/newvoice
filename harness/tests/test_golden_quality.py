"""Golden voice-quality tests.

- Spectral measures (alpha ratio, Hammarberg, L/H) against the exact values
  computed from the synthetic vowels' harmonic amplitudes.
- H1-H2 and H1*-H2* against the source's known H1-H2.
- CPPS and HNR against Praat, on vowels with added noise.
- Jitter and shimmer against Praat, on sources with known perturbation.
"""

from collections import defaultdict

import pytest

from validation import corpus, praat
from validation.measure import quality

CLEAN = corpus.quality_cases()
NOISY = corpus.noisy_quality_cases()
PERTURBED = corpus.perturbation_cases()


@pytest.mark.parametrize("case", CLEAN, ids=[c.name for c in CLEAN])
def test_band_measures_match_the_exact_spectrum(case):
    q = quality(case)
    assert abs(q["alpha_ratio_db"] - case.truth["alpha_ratio_db"]) < 0.5
    assert abs(q["hammarberg_db"] - case.truth["hammarberg_db"]) < 1.0
    assert abs(q["lh_ratio_db"] - case.truth["lh_ratio_db"]) < 1.0


def far_from_f1(case, margin_hz=150.0) -> bool:
    f1 = case.formants[0]
    return all(abs(k * case.f0 - f1) >= margin_hz for k in (1, 2))


@pytest.mark.parametrize("case", CLEAN, ids=[c.name for c in CLEAN])
def test_h1c_h2c_recovers_the_source(case):
    # The Iseli-Alwan correction is accurate away from F1. With H1 or H2 on
    # F1 it can over-correct by several dB (documented in the report).
    q = quality(case)
    if far_from_f1(case):
        assert abs(q["h1c_h2c_db"] - case.source_h1_h2_db) < 1.0, q
    else:
        assert abs(q["h1c_h2c_db"] - case.source_h1_h2_db) < 5.0, q


def test_h1_h2_tracks_source_changes_exactly():
    # Within one vowel the formant boost is fixed, so uncorrected H1-H2
    # moves one-for-one with the source. The weight index relies on changes.
    groups = defaultdict(dict)
    for case in CLEAN:
        key = (case.name.split("-h1h2")[0], case.name.split("tilt")[1])
        groups[key][case.source_h1_h2_db] = quality(case)["h1_h2_db"]
    for key, by_source in groups.items():
        sources = sorted(by_source)
        for a, b in zip(sources, sources[1:], strict=False):
            change = by_source[b] - by_source[a]
            assert abs(change - (b - a)) < 0.3, (key, by_source)


@pytest.mark.parametrize("case", NOISY, ids=[c.name for c in NOISY])
def test_cpps_and_hnr_match_praat(case):
    q = quality(case)
    assert abs(q["praat_style"]["cpps_db"] - praat.cpps(case)) < 0.75
    assert abs(q["praat_style"]["hnr_db"] - praat.hnr(case)) < 0.5


def test_cpps_and_hnr_fall_with_noise():
    for group in ("men", "women"):
        series = [quality(c) for c in NOISY if f"-{group}-" in c.name]
        for kind in ("cpps_db", "hnr_db"):
            # NOISY lists each vowel at SNR 40, 25, 15, 8 dB in order.
            for i in range(0, len(series), 4):
                values = [q[kind] for q in series[i : i + 4]]
                assert values == sorted(values, reverse=True), (group, kind, values)


@pytest.mark.parametrize("case", PERTURBED, ids=[c.name for c in PERTURBED])
def test_jitter_and_shimmer_match_praat(case):
    q = quality(case)
    pj, ps = praat.jitter_shimmer(case)
    assert q["periods"] >= 0.95 * case.f0 * 1.0 - 5, q
    assert abs(q["jitter_local"] - pj) <= 0.1 * pj + 0.0003, (q["jitter_local"], pj)
    assert abs(q["shimmer_local"] - ps) <= 0.15 * ps + 0.002, (q["shimmer_local"], ps)


def test_jitter_and_shimmer_rise_with_perturbation():
    for f0 in (110.0, 200.0):
        cases = [c for c in PERTURBED if c.f0 == f0]
        measured = [quality(c) for c in cases]
        for kind, truth in (("jitter_local", "true_jitter"), ("shimmer_local", "true_shimmer")):
            pairs = sorted(
                (getattr(c, truth), q[kind]) for c, q in zip(cases, measured, strict=True)
            )
            values = [m for _, m in pairs]
            assert values == sorted(values), (f0, kind, pairs)
