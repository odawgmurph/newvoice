"""The streaming analyser must fit comfortably inside the 10 ms hop.

This checks the CI machine. The build plan's real target is a low-end ARM
phone, measured in Stage 2 with the same `newvoice-cli bench` command.
"""

from validation import core, corpus

# Per-frame cost must be under this share of the hop on the CI machine.
BUDGET_SHARE = 0.25


def test_stream_cost_per_frame_fits_the_hop():
    case = corpus.vowel_case("women", "ae", 200.0, rate=48_000, seconds=3.0)
    r = core.on_case(case, "bench", "--chunk", "480")
    assert r["us_per_frame"] < BUDGET_SHARE * r["hop_us"], r
    assert r["latency_s"] < 0.1, r
