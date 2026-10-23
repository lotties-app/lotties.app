"""Weak population priors per age band (the "age-band median" baseline and the shrinkage model's prior).

Bands as ``heuristic.age_band``: 0 = under 3 months, 1 = 3-6 m, 2 = 6-12 m, 3 = 12 m+. Lengths: (median minutes,
standard deviation of the natural log). Bed time: (minutes after local noon, standard deviation in minutes). Not
medical guidance.

SOURCED (code/api/data/age-norms.json, docs/design/28-age-norms.md section 7.2): bed time and night length from 3
months, from the Brazilian Pelotas 2004 cohort (``pelotas-2017``, Netsi 2017, CC BY 4.0): bed time median 22:00 at 3, 12
and 24 months with a 2.5th-97.5th percentile range of 20:00-01:00 (sd = 300 min / 3.92 = 77 min); night length median
9.5 h at 3 months (6-12.78 h) and 10 h at 12 months (7.48-13.6 h), log sd = ln(p97.5 / median) / 1.96. The 6-12 month
band has no Brazilian measurement of its own: it takes the midpoint of the 3 and 12 month medians (bed time 22:00 at
both). Under 3 months no source publishes a bed time or a night length, so band 0 keeps the old guesses, marked
unsourced.

UNSOURCED (no published norm, docs/design/28 section 9): awake windows and nap lengths (only naps per day and daytime
sleep per day are published), the feed and diaper gaps (published gaps exist only up to 2 months, 120-240 min, which
the band-0 feed gap of 150 min fits), and the band-0 bed time and night. They are rough values in the spirit of
docs/design/04-insights-delight.md, kept so the benchmark runs; never ship them as defaults.

``LEGACY_PRIORS`` is the table before 2026-10-23 (bed times 21:00/20:00/19:45/19:45, nights 10/11/11.5/11.5 h), kept so
the before/after comparison (``benchmark.prior_check``, ``run --legacy-priors``) stays reproducible.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.stats import norm

from .heuristic import QUANTILES

# Unsourced, by band (0-3 m, 3-6 m, 6-12 m, 12 m+).
UNSOURCED_FEED_GAP: dict[int, tuple[float, float]] = {0: (150, 0.6), 1: (180, 0.5), 2: (210, 0.5), 3: (240, 0.5)}
UNSOURCED_DIAPER_GAP: dict[int, tuple[float, float]] = {0: (180, 0.7), 1: (210, 0.6), 2: (240, 0.6), 3: (270, 0.6)}
UNSOURCED_AWAKE: dict[int, tuple[float, float]] = {0: (75, 0.5), 1: (105, 0.4), 2: (165, 0.35), 3: (240, 0.35)}
UNSOURCED_NAP: dict[int, tuple[float, float]] = {0: (60, 0.8), 1: (60, 0.7), 2: (75, 0.6), 3: (105, 0.5)}
UNSOURCED_NIGHT_UNDER_3M: tuple[float, float] = (600, 0.25)
UNSOURCED_BEDTIME_UNDER_3M: tuple[float, float] = (540, 75)

# Sourced (pelotas-2017), from 3 months.
_BEDTIME_SD = 300 / 3.92
PUBLISHED_BEDTIME: dict[int, tuple[float, float]] = {1: (600, _BEDTIME_SD), 2: (600, _BEDTIME_SD), 3: (600, _BEDTIME_SD)}
_NIGHT_3M = (9.5 * 60, math.log(12.78 / 9.5) / 1.96)
_NIGHT_12M = (10.0 * 60, math.log(13.6 / 10.0) / 1.96)
PUBLISHED_NIGHT: dict[int, tuple[float, float]] = {
    1: _NIGHT_3M,
    2: ((_NIGHT_3M[0] + _NIGHT_12M[0]) / 2, (_NIGHT_3M[1] + _NIGHT_12M[1]) / 2),
    3: _NIGHT_12M,
}


def _band_priors(band: int) -> dict[str, tuple[float, float]]:
    return {
        "feed": UNSOURCED_FEED_GAP[band],
        "diaper": UNSOURCED_DIAPER_GAP[band],
        "awake": UNSOURCED_AWAKE[band],
        "nap": UNSOURCED_NAP[band],
        "night": PUBLISHED_NIGHT.get(band, UNSOURCED_NIGHT_UNDER_3M),
        "bedtime": PUBLISHED_BEDTIME.get(band, UNSOURCED_BEDTIME_UNDER_3M),
    }


PRIORS: dict[int, dict[str, tuple[float, float]]] = {band: _band_priors(band) for band in range(4)}

LEGACY_PRIORS: dict[int, dict[str, tuple[float, float]]] = {
    0: {"feed": (150, 0.6), "diaper": (180, 0.7), "awake": (75, 0.5), "nap": (60, 0.8), "night": (600, 0.25), "bedtime": (540, 75)},
    1: {"feed": (180, 0.5), "diaper": (210, 0.6), "awake": (105, 0.4), "nap": (60, 0.7), "night": (660, 0.2), "bedtime": (480, 60)},
    2: {"feed": (210, 0.5), "diaper": (240, 0.6), "awake": (165, 0.35), "nap": (75, 0.6), "night": (690, 0.15), "bedtime": (465, 45)},
    3: {"feed": (240, 0.5), "diaper": (270, 0.6), "awake": (240, 0.35), "nap": (105, 0.5), "night": (690, 0.15), "bedtime": (465, 45)},
}

_active: dict[int, dict[str, tuple[float, float]]] = PRIORS

Z = norm.ppf(np.array(QUANTILES))


def use_legacy_priors(legacy: bool = True) -> None:
    """Switches every method to the pre-2026-10-23 table (``True``) or back to the current one (before/after runs)."""
    global _active
    _active = LEGACY_PRIORS if legacy else PRIORS


def prior(band: int, key: str) -> tuple[float, float]:
    return _active[band][key]


def lognormal_quantiles(median_minutes: float, log_sd: float) -> np.ndarray:
    return np.exp(math.log(median_minutes) + Z * log_sd)


def truncated_clock_quantiles(mean: float, sd: float, now_clock: float, minimum: float = 5.0) -> np.ndarray:
    """Quantiles of (bed time - now) in minutes for a normal bed-time clock, conditioned on bed time after now."""
    lower = norm.cdf((now_clock - mean) / sd)
    levels = lower + np.array(QUANTILES) * (1 - lower)
    levels = np.clip(levels, 1e-6, 1 - 1e-6)
    clocks = mean + sd * norm.ppf(levels)
    return np.maximum(clocks - now_clock, minimum)
