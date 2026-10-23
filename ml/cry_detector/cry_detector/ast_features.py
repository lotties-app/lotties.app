"""Kaldi-style log-mel filter bank of the Audio Spectrogram Transformer, in numpy.

Mirrors the numpy path of the AST feature extractor (transformers 4.x `ASTFeatureExtractor` without torchaudio, and
Transformers.js `ASTFeatureExtractor`): 25 ms Hann frames (symmetric), 10 ms hop, no centring, DC removal,
pre-emphasis 0.97, 512-point power spectrum, 128 Kaldi mel bins 20-8000 Hz triangular in mel space, natural log with a
float32-epsilon floor, padded or cut to 1024 frames, then (x - mean) / (2 * std).
"""

from __future__ import annotations

import numpy as np

SAMPLE_RATE = 16_000
FRAME = 400
HOP = 160
N_FFT = 512
N_MELS = 128
MAX_FRAMES = 1024
MEAN = -4.2677393
STD = 4.5689974
MEL_FLOOR = 1.192092955078125e-07


def _kaldi_mel(f: np.ndarray | float) -> np.ndarray:
    return 1127.0 * np.log(1.0 + np.asarray(f, dtype=np.float64) / 700.0)


def mel_filters() -> np.ndarray:
    """(257, 128) triangular filters, Kaldi mel scale, triangles built in mel space (no normalisation)."""
    fft_mels = _kaldi_mel(np.linspace(0, SAMPLE_RATE / 2, N_FFT // 2 + 1))
    points = np.linspace(_kaldi_mel(20.0), _kaldi_mel(SAMPLE_RATE // 2), N_MELS + 2)
    lower, centre, upper = points[:-2], points[1:-1], points[2:]
    up = (fft_mels[:, None] - lower[None, :]) / (centre - lower)[None, :]
    down = (upper[None, :] - fft_mels[:, None]) / (upper - centre)[None, :]
    return np.maximum(0.0, np.minimum(up, down))


_FILTERS = mel_filters()
_WINDOW = np.hanning(FRAME)


def fbank(waveform: np.ndarray) -> np.ndarray:
    """(frames, 128) log-mel of a 16 kHz mono float waveform in [-1, 1]."""
    x = np.asarray(waveform, dtype=np.float64)
    if x.size < FRAME:
        x = np.pad(x, (0, FRAME - x.size))
    n = 1 + (x.size - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx]
    frames = frames - frames.mean(axis=1, keepdims=True)
    emphasised = np.empty_like(frames)
    emphasised[:, 1:] = frames[:, 1:] - 0.97 * frames[:, :-1]
    emphasised[:, 0] = frames[:, 0] * (1 - 0.97)
    spec = np.abs(np.fft.rfft(emphasised * _WINDOW, n=N_FFT, axis=1)) ** 2
    mel = spec @ _FILTERS
    return np.log(np.maximum(mel, MEL_FLOOR)).astype(np.float32)


def input_values(waveform: np.ndarray) -> np.ndarray:
    """(1, 1024, 128) normalised AST input for one window of audio (at most 10.24 s is used)."""
    feats = fbank(waveform)[:MAX_FRAMES]
    if feats.shape[0] < MAX_FRAMES:
        feats = np.pad(feats, ((0, MAX_FRAMES - feats.shape[0]), (0, 0)))
    return ((feats - MEAN) / (STD * 2))[None, :, :].astype(np.float32)
