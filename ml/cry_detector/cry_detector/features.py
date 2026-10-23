"""Hand-made features of the energy and spectral baseline, one row per 0.975 s window (the YAMNet windows).

The lower bound: infant cry is loud, voiced, with a fundamental of about 300-600 Hz and strong harmonics up to 5 kHz,
in bursts of about a second. The features say that and nothing more: band energies (50-250, 250-700, 1000-5000 Hz and
100-7000 Hz), band ratios, spectral flatness and centroid, voicing (normalised autocorrelation peak for a fundamental of
250-700 Hz), the share of voiced frames, the median fundamental and the frame energy spread. A logistic regression on
them is the "simple classifier" (scorers.BaselineModel).
"""

from __future__ import annotations

import numpy as np

from . import SAMPLE_RATE as SR, WINDOW

FRAME = 400
HOP = 160
N_FFT = 512
FREQS = np.fft.rfftfreq(N_FFT, 1 / SR)
LAG_MIN = int(SR / 700)  # 22
LAG_MAX = int(SR / 250)  # 64
NAMES = [
    "log_e_total",
    "log_e_low",
    "log_e_f0",
    "log_e_harm",
    "ratio_low",
    "ratio_f0",
    "ratio_harm",
    "flatness",
    "centroid_mean",
    "centroid_std",
    "voicing_mean",
    "voiced_share",
    "f0_median",
    "energy_std",
]


def _band(spec: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sel = (FREQS >= lo) & (FREQS < hi)
    return spec[:, sel].sum(axis=1)


def window_features(x: np.ndarray) -> np.ndarray:
    """(14,) features of one window of WINDOW samples."""
    n = 1 + (len(x) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx].astype(np.float64)
    frames = frames - frames.mean(axis=1, keepdims=True)
    spec = np.abs(np.fft.rfft(frames * np.hanning(FRAME), n=N_FFT, axis=1)) ** 2 + 1e-12
    total = _band(spec, 100, 7000)
    low = _band(spec, 50, 250)
    f0 = _band(spec, 250, 700)
    harm = _band(spec, 1000, 5000)
    lt = np.log10(total)
    sel = (FREQS >= 250) & (FREQS < 5000)
    s = spec[:, sel]
    flatness = np.exp(np.mean(np.log(s), axis=1)) / np.mean(s, axis=1)
    centroid = (spec * FREQS).sum(axis=1) / spec.sum(axis=1)
    # Voicing: normalised autocorrelation peak in the lag range of a 250-700 Hz fundamental.
    ac = np.fft.irfft(np.abs(np.fft.rfft(frames, n=1024, axis=1)) ** 2, axis=1)
    ac = ac / (ac[:, :1] + 1e-12)
    seg = ac[:, LAG_MIN : LAG_MAX + 1]
    peak = seg.max(axis=1)
    lag = LAG_MIN + seg.argmax(axis=1)
    voiced = peak > 0.5
    f0_median = float(np.median(SR / lag[voiced])) / 1000 if voiced.any() else 0.0
    return np.array(
        [
            lt.mean(),
            np.log10(low).mean(),
            np.log10(f0).mean(),
            np.log10(harm).mean(),
            (np.log10(low) - lt).mean(),
            (np.log10(f0) - lt).mean(),
            (np.log10(harm) - lt).mean(),
            flatness.mean(),
            centroid.mean() / 1000,
            centroid.std() / 1000,
            peak.mean(),
            voiced.mean(),
            f0_median,
            lt.std(),
        ],
        dtype=np.float32,
    )


def features(x: np.ndarray) -> np.ndarray:
    """(windows, 14) for consecutive non-overlapping windows; the last partial window is zero-padded (as MediaPipe)."""
    n = max(1, int(np.ceil(len(x) / WINDOW)))
    padded = np.zeros(n * WINDOW, dtype=np.float32)
    padded[: len(x)] = x
    return np.stack([window_features(padded[i * WINDOW : (i + 1) * WINDOW]) for i in range(n)])
