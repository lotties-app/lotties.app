"""Weak population priors per age band (the "age-band median" baseline and the shrinkage model's prior).

These are rough, generic values in the spirit of the ranges quoted in docs/design/04-insights-delight.md (8-12 feeds a
day under 3 months; awake times of about 1h15-2h30 at 3-6 months; 11-16 h of sleep a day), not fitted to any data and
not medical guidance. Lengths: (median minutes, standard deviation of the natural log). Bed time: (minutes after local
noon, standard deviation in minutes).
"""

from __future__ import annotations

import math

import numpy as np
from scipy.stats import norm

from .heuristic import QUANTILES

PRIORS: dict[int, dict[str, tuple[float, float]]] = {
    0: {"feed": (150, 0.6), "diaper": (180, 0.7), "awake": (75, 0.5), "nap": (60, 0.8), "night": (600, 0.25), "bedtime": (540, 75)},
    1: {"feed": (180, 0.5), "diaper": (210, 0.6), "awake": (105, 0.4), "nap": (60, 0.7), "night": (660, 0.2), "bedtime": (480, 60)},
    2: {"feed": (210, 0.5), "diaper": (240, 0.6), "awake": (165, 0.35), "nap": (75, 0.6), "night": (690, 0.15), "bedtime": (465, 45)},
    3: {"feed": (240, 0.5), "diaper": (270, 0.6), "awake": (240, 0.35), "nap": (105, 0.5), "night": (690, 0.15), "bedtime": (465, 45)},
}

Z = norm.ppf(np.array(QUANTILES))


def prior(band: int, key: str) -> tuple[float, float]:
    return PRIORS[band][key]


def lognormal_quantiles(median_minutes: float, log_sd: float) -> np.ndarray:
    return np.exp(math.log(median_minutes) + Z * log_sd)


def truncated_clock_quantiles(mean: float, sd: float, now_clock: float, minimum: float = 5.0) -> np.ndarray:
    """Quantiles of (bed time - now) in minutes for a normal bed-time clock, conditioned on bed time after now."""
    lower = norm.cdf((now_clock - mean) / sd)
    levels = lower + np.array(QUANTILES) * (1 - lower)
    levels = np.clip(levels, 1e-6, 1 - 1e-6)
    clocks = mean + sd * norm.ppf(levels)
    return np.maximum(clocks - now_clock, minimum)
