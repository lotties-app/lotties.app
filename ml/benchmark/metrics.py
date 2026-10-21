"""Scores of quantile predictions and a day-block bootstrap of the improvement over a reference method."""

from __future__ import annotations

import numpy as np

from .heuristic import QUANTILES

Q10, Q25, Q50, Q75, Q90 = range(5)


def pinball(y: np.ndarray, prediction: np.ndarray, level: float) -> float:
    diff = y - prediction
    return float(np.mean(np.maximum(level * diff, (level - 1) * diff)))


def scores(y: np.ndarray, quantiles: np.ndarray) -> dict[str, float]:
    """MAE/median AE of the median, pinball at q10/q50/q90, interval coverage and hit rates (minutes)."""
    error = quantiles[:, Q50] - y
    absolute = np.abs(error)
    return {
        "n": int(len(y)),
        "mae": float(absolute.mean()),
        "median_ae": float(np.median(absolute)),
        "bias": float(error.mean()),
        "pinball_q10": pinball(y, quantiles[:, Q10], QUANTILES[Q10]),
        "pinball_q50": pinball(y, quantiles[:, Q50], QUANTILES[Q50]),
        "pinball_q90": pinball(y, quantiles[:, Q90], QUANTILES[Q90]),
        "pinball_mean": float(np.mean([pinball(y, quantiles[:, i], QUANTILES[i]) for i in (Q10, Q50, Q90)])),
        "coverage80": float(np.mean((quantiles[:, Q10] <= y) & (y <= quantiles[:, Q90]))),
        "coverage50": float(np.mean((quantiles[:, Q25] <= y) & (y <= quantiles[:, Q75]))),
        "width80": float(np.median(quantiles[:, Q90] - quantiles[:, Q10])),
        "within15": float(np.mean(absolute <= 15)),
        "within30": float(np.mean(absolute <= 30)),
    }


def _per_day(days: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    unique, index = np.unique(days, return_inverse=True)
    sums = np.bincount(index, weights=values, minlength=len(unique))
    counts = np.bincount(index, minlength=len(unique)).astype(float)
    return sums, counts


def bootstrap_improvement(
    y: np.ndarray,
    model: np.ndarray,
    reference: np.ndarray,
    days: np.ndarray,
    resamples: int = 2000,
    seed: int = 7,
) -> dict[str, float]:
    """Relative improvement 1 - loss(model)/loss(reference) for MAE and mean pinball, resampling whole days.

    Positive means the model is better. Returns the point estimate, a 95 % percentile interval and the share of
    resamples where the model is better.
    """
    rng = np.random.default_rng(seed)
    out: dict[str, float] = {}
    losses = {
        "mae": (np.abs(model[:, Q50] - y), np.abs(reference[:, Q50] - y)),
        "pinball": (_pinball_rows(y, model), _pinball_rows(y, reference)),
    }
    for name, (model_loss, reference_loss) in losses.items():
        model_sum, counts = _per_day(days, model_loss)
        reference_sum, _ = _per_day(days, reference_loss)
        point = 1 - model_sum.sum() / reference_sum.sum()
        draws = rng.integers(0, len(counts), size=(resamples, len(counts)))
        ratio = 1 - model_sum[draws].sum(axis=1) / reference_sum[draws].sum(axis=1)
        out[f"{name}_rel"] = float(point)
        out[f"{name}_rel_lo"] = float(np.quantile(ratio, 0.025))
        out[f"{name}_rel_hi"] = float(np.quantile(ratio, 0.975))
        out[f"{name}_p_better"] = float(np.mean(ratio > 0))
    return out


def _pinball_rows(y: np.ndarray, quantiles: np.ndarray) -> np.ndarray:
    rows = []
    for i in (Q10, Q50, Q90):
        diff = y - quantiles[:, i]
        level = QUANTILES[i]
        rows.append(np.maximum(level * diff, (level - 1) * diff))
    return np.mean(rows, axis=0)
