"""Synthetic acoustics, the baseline features and the AST filter bank (no dataset needed)."""

import numpy as np

from cry_detector import SAMPLE_RATE as SR, WINDOW
from cry_detector import audio as A
from cry_detector.ast_features import MAX_FRAMES, fbank, input_values, mel_filters
from cry_detector.features import NAMES, features


def harmonic_cry(seconds=3.0, f0=450.0, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    f = f0 * (1 + 0.05 * np.sin(2 * np.pi * 3 * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = sum(np.sin(k * phase) / k for k in range(1, 10))
    burst = (np.sin(2 * np.pi * 0.8 * t) > -0.3).astype(float)
    return (x * burst + 0.01 * rng.standard_normal(t.size)).astype(np.float32)


def test_set_level_hits_target_active_rms():
    x = harmonic_cry()
    y = A.set_level(x, -35.0)
    assert abs(A.active_rms_db(y) - (-35.0)) < 0.5


def test_beds_have_the_requested_rms_and_are_seeded():
    for kind in A.BEDS:
        a = A.bed(kind, SR * 5, -40.0, np.random.default_rng(1))
        b = A.bed(kind, SR * 5, -40.0, np.random.default_rng(1))
        np.testing.assert_array_equal(a, b)
        assert abs(10 * np.log10(np.mean(a.astype(np.float64) ** 2)) + 40.0) < 0.5


def test_wall_filter_removes_high_frequencies():
    x = harmonic_cry()
    y = A.other_room(x, np.random.default_rng(0), wall=True)
    spec = lambda s: np.abs(np.fft.rfft(s)) ** 2  # noqa: E731
    f = np.fft.rfftfreq(len(x), 1 / SR)
    hi = f > 3000
    ratio_x = spec(x)[hi].sum() / spec(x).sum()
    ratio_y = spec(y)[hi].sum() / spec(y).sum()
    assert ratio_y < ratio_x / 10


def test_music_is_deterministic_and_normalised():
    a = A.music(SR * 4, np.random.default_rng(3))
    b = A.music(SR * 4, np.random.default_rng(3))
    np.testing.assert_array_equal(a, b)
    assert abs(np.std(a) - 1) < 1e-3


def test_baseline_features_see_a_voiced_cry_in_its_pitch_range():
    cry = features(A.set_level(harmonic_cry(), -30))
    noise = features(A.bed("pink", SR * 3, -30, np.random.default_rng(0)))
    assert cry.shape == (int(np.ceil(3 * SR / WINDOW)), len(NAMES))
    v, f0 = NAMES.index("voiced_share"), NAMES.index("f0_median")
    assert cry[:, v].mean() > 0.5 > noise[:, v].mean()
    assert 0.35 < np.median(cry[:, f0]) < 0.55  # kHz


def test_ast_filter_bank_shape_and_padding():
    filters = mel_filters()
    assert filters.shape == (257, 128) and (filters >= 0).all()
    # 128 Kaldi bins over 257 FFT bins: the narrowest low bins can miss every FFT bin centre, exactly as in the
    # reference implementations (which warn about all-zero mel filters); the rest must be non-empty.
    assert (filters.sum(axis=0) > 0).sum() >= 120
    assert (filters[:, 20:].sum(axis=0) > 0).all()
    x = harmonic_cry(2.0)
    assert fbank(x).shape == (1 + (len(x) - 400) // 160, 128)
    iv = input_values(x)
    assert iv.shape == (1, MAX_FRAMES, 128)
    np.testing.assert_allclose(iv[0, -1], (0 - -4.2677393) / (4.5689974 * 2), rtol=1e-6)  # zero padding, normalised
