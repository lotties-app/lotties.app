"""Leak-free features for every decision point.

Every value is computed "as of" the decision instant ``t``: only events that started at or before ``t`` are visible,
and an end after ``t`` is unknown (the event is running). Outcome statistics of a target only use decision points
whose outcome had already happened by ``t``. ``tests/test_features.py`` checks this by recomputing the features on a
history truncated at ``t``.

No amount (ml) column exists in the export, so "last amounts" features are not available.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import heuristic
from .data import SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, Dataset, as_seen_at, local_date, local_seconds_of_day
from .targets import Samples, sleep_sessions

HOUR = SECONDS_PER_HOUR
NOON = 12 * HOUR
LOOK_BACK = heuristic.DEFAULT_OPTIONS.look_back


def _median(values: np.ndarray) -> float:
    return float(np.median(values)) if len(values) else math.nan


@dataclass
class OutcomeHistory:
    """Outcomes of one target that were known at ``t`` (time order of their decision points)."""

    t: np.ndarray
    y: np.ndarray

    @property
    def count(self) -> int:
        return len(self.y)


def known_outcomes(samples: Samples, t: float) -> OutcomeHistory:
    mask = samples.valid & (samples.outcome_at <= t)
    return OutcomeHistory(samples.t[mask], samples.y[mask])


def same_hour_values(history: OutcomeHistory, t: float, offset: float, window_minutes: float = 60.0) -> np.ndarray:
    """Known outcomes of the last 14 days whose decision time of day is within ``window_minutes`` of ``t``'s."""
    recent = history.t >= t - LOOK_BACK
    clock = local_seconds_of_day(t, offset)
    clocks = (history.t[recent] + offset) % SECONDS_PER_DAY
    distance = np.abs(clocks - clock)
    distance = np.minimum(distance, SECONDS_PER_DAY - distance)
    return history.y[recent][distance <= window_minutes * SECONDS_PER_MINUTE]


def evening_clock(instant: float, offset: float) -> float:
    """Local clock time as minutes after noon, with 00:00-04:00 counted as late evening.

    20:00 is 480, 01:00 is 780 and 07:00 is -300, so bed times and the instants they are asked at compare directly.
    """
    value = (local_seconds_of_day(instant, offset) - NOON) / SECONDS_PER_MINUTE
    return value + 1440 if value < -480 else value


class Timeline:
    """Sorted arrays of the whole history, sliced by bisect for as-of queries."""

    def __init__(self, dataset: Dataset):
        self.dataset = dataset
        self.offset = dataset.offset_seconds(dataset.last_start)
        events = dataset.events
        self.starts = [item.start for item in events]
        self.feeds = np.array(sorted(item.start for item in events if item.type_key == "feeding"))
        self.diapers = np.array(sorted(item.start for item in events if item.type_key == "diaper"))
        self.meds = np.array(sorted(item.start for item in events if item.type_key == "medication"))
        wakings = sorted((item.start, item.end or item.start) for item in events if item.kind == heuristic.NIGHT_WAKING)
        self.waking_starts = np.array([start for start, _ in wakings])
        self.woke_ups = np.array(sorted(item.start for item in events if item.kind == heuristic.WOKE_UP))
        sessions = sleep_sessions(dataset)
        self.session_start = np.array([session.start for session in sessions])
        self.session_end = np.array([session.end if session.end is not None else np.inf for session in sessions])
        self.session_night = np.array([session.kind == heuristic.NIGHT for session in sessions])
        self._heuristic_cache: dict[float, dict] = {}

    # ---- as-of views ---------------------------------------------------------------------------------------
    def window(self, t: float, look_back: float = LOOK_BACK) -> list:
        """Events started in [t - look_back, t] as seen at t (later ends unknown)."""
        low = bisect.bisect_left(self.starts, t - look_back)
        high = bisect.bisect_right(self.starts, t)
        return [as_seen_at(item, t) for item in self.dataset.events[low:high]]

    def heuristic_at(self, t: float) -> dict:
        """Heuristic port outputs at ``t`` (cached): next feed/diaper/sleep quantiles and the running sleep's wake."""
        cached = self._heuristic_cache.get(t)
        if cached is not None:
            return cached
        events = self.window(t)
        offset = self.dataset.offset_seconds(t)
        birth = self.dataset.birth_date
        predictions = heuristic.predict(events, birth, t, offset, type_keys=("feeding", "diaper", "sleep"))
        result = {
            "predictions": predictions,
            "wake": heuristic.wake_prediction(events, birth, t, offset),
            "wake_kind": heuristic.wake_prediction(events, birth, t, offset, kind_aware=True),
        }
        self._heuristic_cache[t] = result
        return result

    # ---- common features -----------------------------------------------------------------------------------
    @staticmethod
    def _count_between(values: np.ndarray, low: float, high: float) -> int:
        return int(np.searchsorted(values, high, side="right") - np.searchsorted(values, low, side="right"))

    @staticmethod
    def _last_two(values: np.ndarray, t: float) -> tuple[float, float]:
        index = int(np.searchsorted(values, t, side="right"))
        last = values[index - 1] if index >= 1 else math.nan
        unique_before = values[: index][values[: index] < last] if index >= 1 else values[:0]
        previous = unique_before[-1] if len(unique_before) else math.nan
        return last, previous

    def common(self, t: float) -> dict[str, float]:
        offset = self.dataset.offset_seconds(t)
        clock = local_seconds_of_day(t, offset) / HOUR
        day = local_date(t, offset)
        features: dict[str, float] = {
            "hour_sin": math.sin(2 * math.pi * clock / 24),
            "hour_cos": math.cos(2 * math.pi * clock / 24),
            "day_of_week": float(day.weekday()),
            "age_days": float((day - self.dataset.birth_date).days),
            "is_night": 1.0 if heuristic.day_phase(t, offset) == "night" else 0.0,
        }
        for name, values in (("feed", self.feeds), ("diaper", self.diapers)):
            last, previous = self._last_two(values, t)
            features[f"since_{name}"] = (t - last) / 60 if not math.isnan(last) else math.nan
            features[f"prev_{name}_gap"] = (last - previous) / 60 if not math.isnan(previous) else math.nan
            for hours in (6, 12, 24):
                features[f"{name}s_{hours}h"] = float(self._count_between(values, t - hours * HOUR, t))
        last_med, _ = self._last_two(self.meds, t)
        features["since_med_h"] = (t - last_med) / HOUR if not math.isnan(last_med) else math.nan
        features["wakings_12h"] = float(self._count_between(self.waking_starts, t - 12 * HOUR, t))
        features.update(self._sleep_features(t, offset))
        return features

    def _sleep_features(self, t: float, offset: float) -> dict[str, float]:
        started = self.session_start <= t
        start = self.session_start[started]
        end = np.where(self.session_end[started] <= t, self.session_end[started], np.inf)
        night = self.session_night[started]
        running = ~np.isfinite(end)
        finished = ~running
        features: dict[str, float] = {"asleep": 1.0 if running.any() else 0.0}
        features["since_sleep_start"] = (t - start.max()) / 60 if len(start) else math.nan
        features["since_wake"] = (t - end[finished].max()) / 60 if finished.any() else math.nan
        for label, mask in (("nap", ~night & finished), ("night", night & finished)):
            if mask.any():
                last = int(np.nonzero(mask)[0][np.argmax(end[mask])])
                features[f"last_{label}_min"] = (end[last] - start[last]) / 60
            else:
                features[f"last_{label}_min"] = math.nan
        # last completed awake window: a finished session's end to the next start, both before t
        features["last_awake_min"] = math.nan
        if finished.any():
            ends = np.sort(end[finished])
            for wake in ends[::-1]:
                later = start[start >= wake]
                if len(later):
                    features["last_awake_min"] = (later.min() - wake) / 60
                    break
        overlap_low = t - 24 * HOUR
        clipped = np.clip(np.minimum(end, t), overlap_low, t) - np.clip(start, overlap_low, t)
        features["sleep_min_24h"] = float(np.clip(clipped, 0, None).sum() / 60)
        features["naps_24h"] = float(((start > overlap_low) & ~night).sum())
        woke = self.woke_ups[self.woke_ups <= t]
        if len(woke) and t - woke[-1] <= 18 * HOUR:
            day_start = woke[-1]
        else:
            clock = local_seconds_of_day(t, offset)
            day_start = t - clock + 6 * HOUR if clock >= 6 * HOUR else t - clock - 18 * HOUR
        today = (start >= day_start) & ~night
        features["naps_today"] = float(today.sum())
        features["nap_min_today"] = float((np.minimum(end[today], t) - start[today]).sum() / 60) if today.any() else 0.0
        features["since_day_start"] = (t - day_start) / 60
        clocks = self.recent_bed_clocks(t, offset, 7)
        features["bed_clock_med7"] = _median(clocks)
        features["until_bed_med7"] = features["bed_clock_med7"] - evening_clock(t, offset) if len(clocks) else math.nan
        return features

    def recent_bed_clocks(self, t: float, offset: float, count: int) -> np.ndarray:
        """Evening clocks of the last ``count`` bed times known at ``t``."""
        bed_times = self.session_start[self.session_night & (self.session_start <= t)][-count:]
        return np.array([evening_clock(value, offset) for value in bed_times])

    # ---- target-specific features --------------------------------------------------------------------------
    def outcome_features(self, samples: Samples, t: float) -> dict[str, float]:
        history = known_outcomes(samples, t)
        offset = self.dataset.offset_seconds(t)
        y = history.y
        features = {
            "n_known": float(history.count),
            "prev_y1": y[-1] if len(y) >= 1 else math.nan,
            "prev_y2": y[-2] if len(y) >= 2 else math.nan,
            "prev_y3": y[-3] if len(y) >= 3 else math.nan,
            "base_last5": _median(y[-5:]),
            "base_last10": _median(y[-10:]),
            "base_global": _median(y),
        }
        same_hour = same_hour_values(history, t, offset)
        features["base_same_hour"] = _median(same_hour) if len(same_hour) >= 3 else features["base_last10"]
        return features

    def heuristic_features(self, target: str, t: float) -> dict[str, float]:
        """The port's prediction as features (stacking); for bed time, its next-sleep prediction."""
        quantiles = heuristic_quantiles(self, target, t)
        if quantiles is None:
            return {"heur_q25": math.nan, "heur_q50": math.nan, "heur_q75": math.nan}
        return {"heur_q25": quantiles[1], "heur_q50": quantiles[2], "heur_q75": quantiles[3]}

    def frame(self, target: str, samples: Samples) -> pd.DataFrame:
        rows = []
        for t in samples.t:
            row = self.common(float(t))
            row.update(self.outcome_features(samples, float(t)))
            row.update(self.heuristic_features(target, float(t)))
            rows.append(row)
        return pd.DataFrame(rows)


def heuristic_quantiles(timeline: Timeline, target: str, t: float, kind_aware: bool = False) -> np.ndarray | None:
    """The heuristic port's (q10, q25, q50, q75, q90) in minutes from ``t``, or ``None`` when it cannot predict.

    q50 and the q25..q75 window are exactly the C# output; q10/q90 are the documented extension. The C# engine has
    no bed-time prediction: for ``bedtime`` this is its next-sleep prediction, which is what the app shows after the
    last nap of the day. ``kind_aware`` selects the proposed v1.1 duration fix (only changes the duration targets).
    """
    state = timeline.heuristic_at(t)
    if target in ("feed", "diaper", "sleep_start", "bedtime"):
        key = {"feed": "feeding", "diaper": "diaper", "sleep_start": "sleep", "bedtime": "sleep"}[target]
        prediction = state["predictions"].get(key)
        if not isinstance(prediction, heuristic.TypePrediction):
            return None
        return np.array([(prediction.starts[q] - t) / 60 for q in heuristic.QUANTILES])
    if target in ("nap_duration", "night_duration"):
        wake = state["wake_kind" if kind_aware else "wake"]
        if wake is None or wake.duration is None:
            return None
        base = wake.session_start
        return np.array([max(base + wake.duration.quantiles[q], t) - t for q in heuristic.QUANTILES]) / 60
    return None
