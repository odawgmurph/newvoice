"""Reference measurements from Praat, through Parselmouth.

Praat and Parselmouth are GPL. They are used here, in test tooling, only;
nothing from them ships in the app (decision D5).
"""

from __future__ import annotations

import numpy as np
import parselmouth

from validation.corpus import Case

F0_MIN_HZ = 60.0
F0_MAX_HZ = 500.0


def sound(case: Case) -> parselmouth.Sound:
    return parselmouth.Sound(case.signal, sampling_frequency=case.rate)


def f0_at(case: Case, times: np.ndarray) -> np.ndarray:
    """Praat `To Pitch (ac)` F0 at the given times (NaN where unvoiced)."""
    pitch = sound(case).to_pitch_ac(time_step=0.01, pitch_floor=F0_MIN_HZ, pitch_ceiling=F0_MAX_HZ)
    return np.array([pitch.get_value_at_time(t) for t in times])


def formants_at(
    case: Case,
    times: np.ndarray,
    ceiling_hz: float,
    n: int = 4,
    max_bandwidth_hz: float | None = None,
) -> np.ndarray:
    """Praat `To Formant (burg)` F1..Fn in the frame nearest each time.

    With `max_bandwidth_hz`, poles wider than that are dropped before
    numbering, as newvoice-core does by default. Shape (len(times), n), NaN
    where a frame has fewer formants.
    """
    formant = sound(case).to_formant_burg(
        time_step=0.005, max_number_of_formants=5, maximum_formant=ceiling_hz
    )
    out = np.full((len(times), n), np.nan)
    for i, t in enumerate(times):
        frame = min(max(round(formant.get_frame_number_from_time(t)), 1), formant.n_frames)
        tf = formant.frame_number_to_time(frame)
        count = parselmouth.praat.call(formant, "Get number of formants", frame)
        found = []
        for k in range(1, count + 1):
            f = formant.get_value_at_time(k, tf)
            bw = formant.get_bandwidth_at_time(k, tf)
            if max_bandwidth_hz is None or bw <= max_bandwidth_hz:
                found.append(f)
        out[i, : min(n, len(found))] = found[:n]
    return out
