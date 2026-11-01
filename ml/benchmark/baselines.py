"""Baselines: global / last-5 / last-10 / same-hour medians of known outcomes, age-band prior, and the C# port.

Each returns the quantiles (q10, q25, q50, q75, q90) in minutes from the decision instant, or ``None`` when it has no
data; the backtest then falls back to the age-band prior and counts the fallback.
"""

from __future__ import annotations

import numpy as np

from .features import Timeline, evening_clock, heuristic_quantiles, known_outcomes, same_hour_values
from .heuristic import QUANTILES, age_band
from .data import local_date
from .priors import lognormal_quantiles, prior, truncated_clock_quantiles
from .targets import Samples

BASELINES = (
    "global_median",
    "last5_median",
    "last10_median",
    "same_hour_median",
    "age_band_prior",
    "heuristic",
    "heuristic_kind",
)
LEVELS = np.array(QUANTILES)


def _empirical(values: np.ndarray) -> np.ndarray | None:
    return np.quantile(values, LEVELS) if len(values) else None


def age_band_prior(timeline: Timeline, samples: Samples, t: float) -> np.ndarray:
    offset = timeline.dataset.offset_seconds(t)
    band = age_band(timeline.dataset.birth_date, local_date(t, offset))
    center, spread = prior(band, samples.spec.prior_key)
    if samples.spec.name == "bedtime":
        return truncated_clock_quantiles(center, spread, evening_clock(t, offset))
    return lognormal_quantiles(center, spread)


def bedtime_same_hour(timeline: Timeline, t: float, nights: int = 14) -> np.ndarray | None:
    """Recent bed-time clocks later than now, as minutes from now (the clock analogue of the same-hour median)."""
    offset = timeline.dataset.offset_seconds(t)
    now_clock = evening_clock(t, offset)
    clocks = timeline.recent_bed_clocks(t, offset, nights)
    if len(clocks) < 3:
        return None
    later = clocks[clocks > now_clock]
    if len(later) == 0:
        return np.full(len(LEVELS), 15.0)
    return np.quantile(later, LEVELS) - now_clock


def baseline_quantiles(name: str, timeline: Timeline, samples: Samples, t: float) -> np.ndarray | None:
    if name in ("heuristic", "heuristic_kind"):
        return heuristic_quantiles(timeline, samples.spec.name, t, kind_aware=name == "heuristic_kind")
    if name == "age_band_prior":
        return age_band_prior(timeline, samples, t)
    if name == "same_hour_median" and samples.spec.name == "bedtime":
        return bedtime_same_hour(timeline, t)
    history = known_outcomes(samples, t)
    if name == "global_median":
        return _empirical(history.y)
    if name == "last5_median":
        return _empirical(history.y[-5:])
    if name == "last10_median":
        return _empirical(history.y[-10:])
    if name == "same_hour_median":
        values = same_hour_values(history, t, timeline.dataset.offset_seconds(t))
        return _empirical(values) if len(values) >= 3 else _empirical(history.y[-10:])
    raise ValueError(f"Unknown baseline {name}")
