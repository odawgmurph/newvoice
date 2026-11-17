"""Synthetic test signals with known F0 and formants."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

VIBRATO_HZ = 5.0


def f0_contour(f0_start: float, f0_end: float, n: int, rate: float, vibrato_st: float = 0.0):
    """Per-sample F0: an exponential glide from start to end plus 5 Hz vibrato."""
    t = np.arange(n) / rate
    glide = f0_start * (f0_end / f0_start) ** (np.arange(n) / max(n - 1, 1))
    return glide * 2.0 ** (vibrato_st * np.sin(2 * np.pi * VIBRATO_HZ * t) / 12.0)


def harmonic_source(f0: np.ndarray, rate: float, slope: float = 1.0) -> np.ndarray:
    """Sum of harmonics with 1/k^slope amplitudes, all below 0.45 × rate."""
    phase = np.cumsum(2 * np.pi * f0 / rate)
    harmonics = int(0.45 * rate / f0.max())
    out = np.zeros_like(phase)
    for k in range(1, harmonics + 1):
        out += np.sin(k * phase) / k**slope
    return out


def sine(f0: np.ndarray, rate: float) -> np.ndarray:
    return np.sin(np.cumsum(2 * np.pi * f0 / rate))


def resonate(x: np.ndarray, formants: list[tuple[float, float]], rate: float) -> np.ndarray:
    """Klatt cascade resonators at (frequency, bandwidth) pairs."""
    t = 1.0 / rate
    for f, bw in formants:
        c = -np.exp(-2 * np.pi * bw * t)
        b = 2 * np.exp(-np.pi * bw * t) * np.cos(2 * np.pi * f * t)
        a = 1.0 - b - c
        x = lfilter([a], [1.0, -b, -c], x)
    return x


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def normalise(x: np.ndarray, peak: float = 0.5) -> np.ndarray:
    return peak * x / np.abs(x).max()


def add_noise(x: np.ndarray, snr_db: float, seed: int) -> np.ndarray:
    n = noise(len(x), seed)
    n *= np.sqrt(np.mean(x**2) / np.mean(n**2)) / 10 ** (snr_db / 20)
    return x + n


def pad(x: np.ndarray, rate: float, seconds: float) -> np.ndarray:
    z = np.zeros(int(seconds * rate))
    return np.concatenate([z, x, z])


def write_wav(path: Path, x: np.ndarray, rate: int) -> None:
    """Mono 32-bit float WAV."""
    data = np.asarray(x, dtype="<f4").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 3, 1, rate, rate * 4, 4, 32)
    path.write_bytes(header + fmt + b"data" + struct.pack("<I", len(data)) + data)
