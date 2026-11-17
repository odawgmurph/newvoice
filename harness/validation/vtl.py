"""Apparent vocal tract length, using the same formula as the norms tooling."""

from norms.build_norms import SPEED_OF_SOUND_CM_S, formant_dispersion


def avtl_cm(formants_hz) -> float:
    return SPEED_OF_SOUND_CM_S / (2 * formant_dispersion(list(formants_hz)))
