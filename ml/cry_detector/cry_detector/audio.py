"""Synthetic acoustics: levels, beds (room tone, white, pink, fan), synthetic music, another-room filter, mixing.

All levels are dBFS of the RMS over the "active" part of a signal (frames within 25 dB of its loudest frames), so a
cry with breath gaps and a continuous noise bed are compared fairly. Every function takes a numpy Generator: the same
seed gives the same audio.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

from . import SAMPLE_RATE as SR

FRAME = 160  # 10 ms


def frame_energy_db(x: np.ndarray, frame: int = FRAME) -> np.ndarray:
    n = len(x) // frame
    if n == 0:
        return np.array([-120.0])
    e = np.mean(x[: n * frame].reshape(n, frame).astype(np.float64) ** 2, axis=1)
    return 10 * np.log10(e + 1e-12)


def activity(x: np.ndarray, rel_db: float = 25.0, floor_db: float = -80.0) -> np.ndarray:
    """Boolean per 10 ms frame: within rel_db of the 95th percentile frame energy and above floor_db."""
    e = frame_energy_db(x)
    ref = np.percentile(e, 95)
    return (e >= ref - rel_db) & (e >= floor_db)


def active_rms_db(x: np.ndarray) -> float:
    e = frame_energy_db(x)
    act = activity(x)
    if not act.any():
        return float(10 * np.log10(np.mean(x.astype(np.float64) ** 2) + 1e-12))
    return float(10 * np.log10(np.mean(10 ** (e[act] / 10)) + 1e-12))


def set_level(x: np.ndarray, target_db: float) -> np.ndarray:
    return (x * 10 ** ((target_db - active_rms_db(x)) / 20)).astype(np.float32)


def white(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.standard_normal(n).astype(np.float32)


def _shaped(n: int, rng: np.random.Generator, exponent: float) -> np.ndarray:
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    spec *= f ** (-exponent / 2)
    y = np.fft.irfft(spec, n)
    return (y / (np.std(y) + 1e-12)).astype(np.float32)


def pink(n: int, rng: np.random.Generator) -> np.ndarray:
    return _shaped(n, rng, 1.0)


def fan(n: int, rng: np.random.Generator) -> np.ndarray:
    """Fan or air conditioner: low-passed broadband noise, mains hum harmonics (60 Hz, Brazil) and blade-pass beat."""
    t = np.arange(n) / SR
    body = sosfilt(butter(2, 900, "low", fs=SR, output="sos"), _shaped(n, rng, 1.5))
    hum = sum(rng.uniform(0.1, 0.4) / k * np.sin(2 * np.pi * 60 * k * t + rng.uniform(0, 6.3)) for k in range(1, 6))
    beat = 1 + 0.15 * np.sin(2 * np.pi * rng.uniform(8, 25) * t)
    y = body / (np.std(body) + 1e-12) * beat + hum
    return (y / (np.std(y) + 1e-12)).astype(np.float32)


BEDS = {
    "quiet": pink,  # room tone at a low level
    "white": white,  # white-noise machine
    "pink": pink,  # "rain" sound machine
    "fan": fan,
}


def bed(kind: str, n: int, level_db: float, rng: np.random.Generator) -> np.ndarray:
    y = BEDS[kind](n, rng)
    return (y / (np.sqrt(np.mean(y.astype(np.float64) ** 2)) + 1e-12) * 10 ** (level_db / 20)).astype(np.float32)


def _note(freq: float, dur: float, rng: np.random.Generator, harmonics: int, vibrato: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    phase = 2 * np.pi * freq * (t + vibrato * np.sin(2 * np.pi * rng.uniform(4.5, 6.5) * t) / (2 * np.pi * 5.5))
    tone = sum(np.sin(k * phase) / k**1.3 for k in range(1, harmonics + 1))
    attack = min(n, int(0.02 * SR))
    env = np.exp(-t / max(0.15, dur * rng.uniform(0.4, 1.0)))
    env[:attack] *= np.linspace(0, 1, attack)
    return tone * env


def music(n: int, rng: np.random.Generator) -> np.ndarray:
    """Synthetic tonal music: chords, a melody with vibrato in the cry pitch range, optional drums (lullaby to pop)."""
    y = np.zeros(n)
    bpm = rng.uniform(60, 140)
    beat = 60 / bpm
    root = 220 * 2 ** (rng.integers(-5, 7) / 12)
    scale = np.array([0, 2, 4, 5, 7, 9, 11, 12, 14, 16])
    progression = [0, 7, 9, 5]  # I V vi IV
    drums = rng.random() < 0.5
    harmonics = int(rng.integers(3, 8))
    t = 0.0
    bar = 0
    while t < n / SR:
        chord_root = root * 2 ** (progression[bar % 4] / 12) / 2
        start = int(t * SR)
        for interval in (0, 4, 7):
            note = 0.25 * _note(chord_root * 2 ** (interval / 12), 4 * beat, rng, harmonics, 0.0)
            end = min(n, start + len(note))
            y[start:end] += note[: end - start]
        for b in range(4):
            if rng.random() < 0.8:
                f = root * 2 ** (scale[rng.integers(0, len(scale))] / 12)
                note = 0.5 * _note(f, beat * rng.choice([0.5, 1.0]), rng, harmonics, rng.uniform(0.0, 0.02))
                s = int((t + b * beat) * SR)
                e = min(n, s + len(note))
                if s < n:
                    y[s:e] += note[: e - s]
            if drums:
                s = int((t + b * beat) * SR)
                hit = int(0.12 * SR)
                e = min(n, s + hit)
                if s < n:
                    k = np.arange(e - s) / SR
                    y[s:e] += 0.6 * np.sin(2 * np.pi * 55 * k) * np.exp(-k / 0.05)
                    hat = rng.standard_normal(e - s) * np.exp(-k / 0.01) * 0.2
                    y[s:e] += sosfilt(butter(2, 6000, "high", fs=SR, output="sos"), hat)
        t += 4 * beat
        bar += 1
    return (y / (np.std(y) + 1e-12)).astype(np.float32)


def other_room(x: np.ndarray, rng: np.random.Generator, rt60: float = 0.6, wall: bool = True) -> np.ndarray:
    """Cry heard from another room. With `wall`: through a closed door or wall, a mass-law-like low-pass (6 dB/oct
    from 400 Hz, steeper above 2.5 kHz); without: through an open door (no filter). Both get a synthetic
    exponential-decay reverb (wet 50 %). The level is set by the caller."""
    lp = x.astype(np.float64)
    if wall:
        lp = sosfilt(butter(1, 400, "low", fs=SR, output="sos"), lp)
        lp = sosfilt(butter(2, 2500, "low", fs=SR, output="sos"), lp)
    n = int(rt60 * 1.3 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.91 * t / rt60)
    ir /= np.sqrt(np.sum(ir**2))
    wet = fftconvolve(lp, ir)[: len(lp)]
    y = 0.5 * lp / (np.std(lp) + 1e-12) + 0.5 * wet / (np.std(wet) + 1e-12)
    return y.astype(np.float32)


def concat(pieces: list[np.ndarray], gaps_s: list[float]) -> np.ndarray:
    out = []
    for piece, gap in zip(pieces, gaps_s):
        out.append(piece)
        out.append(np.zeros(int(gap * SR), dtype=np.float32))
    return np.concatenate(out) if out else np.zeros(0, dtype=np.float32)
