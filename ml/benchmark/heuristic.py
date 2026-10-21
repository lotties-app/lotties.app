"""Faithful Python port of the C# heuristic v1 (``code/api/src/BabyRoutine.Domain/Predictions``).

Mirrors ``PredictionEngine``, ``TypePredictor``, ``AwakeWindowStrategy`` / ``StartIntervalStrategy``,
``SampleSelector``, ``WeightedStatistics``, ``SleepSessions``, ``AgeBands`` and ``DayPhases`` with
``PredictionOptions.Default``. Times are float seconds (UTC); the C# code uses ``TimeSpan`` ticks, which only matters
for equality at sub-second precision (the data has whole seconds).

Extensions that are NOT in the C# engine (used only for interval metrics, never for the median):
- ``gap_quantiles`` / ``duration_quantiles`` also report q10 and q90 of the very same selected, recency-weighted
  samples, so an 80 % interval can be scored. The C# window is q25..q75 (the 50 % interval) and is reported as is.
- ``wake_prediction`` exposes the expected wake of a running sleep (the C# ``FindAnchor`` of the awake-window
  strategy) together with the same quantiles of the selected durations.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date
from itertools import accumulate
from typing import Iterable, Sequence

from .data import SECONDS_PER_DAY, SECONDS_PER_MINUTE, Event, local_date, local_seconds_of_day

NAP = "nap"
NIGHT = "night"
NIGHT_WAKING = "night_waking"
BED_TIME = "bed_time"
WOKE_UP = "woke_up"
FELL_ASLEEP = "fell_asleep"
FELL_ASLEEP_TIMER_WINDOW = 5 * SECONDS_PER_MINUTE

QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9)


@dataclass(frozen=True)
class Options:
    """``PredictionOptions.Default`` (lengths in seconds, local clock times in seconds after midnight)."""

    look_back: float = 14 * SECONDS_PER_DAY
    recency_half_life: float = 4 * SECONDS_PER_DAY
    minimum_samples: int = 3
    minimum_bucket_samples: int = 5
    medium_confidence_samples: int = 10
    high_confidence_samples: int = 30
    minimum_sample_length: float = 1 * SECONDS_PER_MINUTE
    outlier_factor: float = 3.0
    window_lower_quantile: float = 0.25
    window_upper_quantile: float = 0.75
    night_starts_at: float = 19 * 3600.0
    night_ends_at: float = 7 * 3600.0
    day_night_type_keys: frozenset[str] = field(default_factory=lambda: frozenset({"feeding", "sleep"}))
    awake_window_type_key: str = "sleep"
    max_night_session_length: float = 16 * 3600.0


DEFAULT_OPTIONS = Options()


@dataclass(frozen=True)
class TimedSample:
    length: float
    at: float


@dataclass(frozen=True)
class Selection:
    samples: tuple[TimedSample, ...]
    age_band: int | None
    phase: str | None


@dataclass(frozen=True)
class DurationEstimate:
    median: float
    sample_count: int
    quantiles: dict[float, float]


@dataclass(frozen=True)
class TypePrediction:
    """One type's prediction: ``expected`` is the C# ``NextStart.Expected``; ``starts`` holds anchor + quantiles."""

    type_key: str
    anchor: float
    from_event_in_progress: bool
    earliest: float
    expected: float
    latest: float
    starts: dict[float, float]
    sample_count: int
    confidence: str
    basis: str
    median_gap: float
    age_band: int | None
    phase: str | None
    duration: DurationEstimate | None


@dataclass(frozen=True)
class Insufficient:
    type_key: str
    sample_count: int


# ---------------------------------------------------------------------------------------------------------------
# Rounding, age bands, day phases, weighted statistics


def round_to_minute(seconds: float) -> float:
    """``Math.Round(totalMinutes, MidpointRounding.AwayFromZero)`` back in seconds."""
    minutes = seconds / SECONDS_PER_MINUTE
    rounded = math.floor(abs(minutes) + 0.5)
    return math.copysign(rounded, minutes) * SECONDS_PER_MINUTE if rounded else 0.0


def completed_months(birth: date, day: date) -> int:
    months = (day.year - birth.year) * 12 + day.month - birth.month
    return months - 1 if day.day < birth.day else months


def age_band(birth: date, day: date) -> int:
    """0 = under 3 months, 1 = 3-6 m, 2 = 6-12 m, 3 = 12 m+ (``AgeBands.At``)."""
    months = completed_months(birth, day)
    if months < 3:
        return 0
    if months < 6:
        return 1
    if months < 12:
        return 2
    return 3


AGE_BAND_LABELS = ("0-3m", "3-6m", "6-12m", "12m+")


def day_phase(instant: float, offset_seconds: float, options: Options = DEFAULT_OPTIONS) -> str:
    """``TimeOnly.IsBetween(NightStartsAt, NightEndsAt)``: start inclusive, end exclusive, wraps midnight."""
    local = local_seconds_of_day(instant, offset_seconds)
    start, end = options.night_starts_at, options.night_ends_at
    inside = start <= local < end if start <= end else (local >= start or local < end)
    return "night" if inside else "day"


def recency_weight(at: float, now: float, half_life: float) -> float:
    return math.pow(0.5, max(0.0, (now - at) / SECONDS_PER_DAY) / (half_life / SECONDS_PER_DAY))


def weighted_quantile(samples: Sequence[TimedSample], quantile: float, now: float, half_life: float) -> float:
    """Smallest length whose cumulative recency weight reaches ``quantile`` of the total (``WeightedStatistics``)."""
    if not samples:
        raise ValueError("At least one sample is required.")
    ordered = sorted(samples, key=lambda sample: (sample.length, sample.at))
    cumulative = list(accumulate(recency_weight(sample.at, now, half_life) for sample in ordered))
    target = cumulative[-1] * quantile
    for index, weight in enumerate(cumulative):
        if weight >= target:
            return ordered[index].length
    return ordered[-1].length


def plain_median(samples: Sequence[TimedSample]) -> float:
    ordered = sorted(sample.length for sample in samples)
    return ordered[(len(ordered) - 1) // 2]


# ---------------------------------------------------------------------------------------------------------------
# Sleep sessions


def _is_marker(item: Event) -> bool:
    return item.kind in (BED_TIME, WOKE_UP)


def _is_logged_session(item: Event) -> bool:
    return item.kind not in (NIGHT_WAKING, BED_TIME, WOKE_UP, FELL_ASLEEP)


def _night_or_none(marker: Event, following: Event | None, now: float, max_night: float) -> Event | None:
    if marker.kind != BED_TIME:
        return None
    if following is None:
        return replace(marker, end=None, kind=NIGHT) if now - marker.start <= max_night else None
    if following.kind == WOKE_UP and following.start - marker.start <= max_night:
        return replace(marker, end=following.start, kind=NIGHT)
    return None


def build_sleep_sessions(sleep_events: Sequence[Event], now: float, max_night: float) -> list[Event]:
    """``SleepSessions.Build``: logged sessions (not absorbed by a night) followed by bed_time nights."""
    fell_asleep = [item for item in sleep_events if item.kind == FELL_ASLEEP]
    markers = sorted(
        (item for item in sleep_events if _is_marker(item)),
        key=lambda item: (item.start, 1 if item.kind == BED_TIME else 0),
    )
    nights = []
    for index, marker in enumerate(markers):
        following = markers[index + 1] if index + 1 < len(markers) else None
        night = _night_or_none(marker, following, now, max_night)
        if night is not None:
            nights.append(night)

    def absorbed(timer: Event) -> bool:
        right_after = any(
            timer.start >= marker.start and timer.start - marker.start <= FELL_ASLEEP_TIMER_WINDOW
            for marker in fell_asleep
        )
        inside = any(
            timer.start >= night.start and timer.start < (night.end if night.end is not None else now)
            for night in nights
        )
        return right_after and inside

    logged = [item for item in sleep_events if _is_logged_session(item) and not absorbed(item)]
    return logged + nights


# ---------------------------------------------------------------------------------------------------------------
# Selection and prediction


class SampleSelector:
    """Narrows to the current age band, then (feeding/sleep) to the phase of the reference; drops short and outliers."""

    def __init__(self, birth: date, now: float, offset: float, options: Options, splits_day_and_night: bool):
        self._birth = birth
        self._offset = offset
        self._options = options
        self._splits = splits_day_and_night
        self._band = age_band(birth, local_date(now, offset))

    def select(self, candidates: Iterable[TimedSample], reference: float) -> Selection:
        usable = [sample for sample in candidates if sample.length >= self._options.minimum_sample_length]
        in_band = [sample for sample in usable if age_band(self._birth, local_date(sample.at, self._offset)) == self._band]
        if len(in_band) >= self._options.minimum_bucket_samples:
            samples, band = in_band, self._band
        else:
            samples, band = usable, None
        phase = None
        if self._splits:
            reference_phase = day_phase(reference, self._offset, self._options)
            in_phase = [sample for sample in samples if day_phase(sample.at, self._offset, self._options) == reference_phase]
            if len(in_phase) >= self._options.minimum_bucket_samples:
                samples, phase = in_phase, reference_phase
        if samples:
            limit = plain_median(samples) * self._options.outlier_factor
            samples = [sample for sample in samples if sample.length <= limit]
        return Selection(tuple(samples), band, phase)


def _chronological(events: Iterable[Event]) -> list[Event]:
    return sorted(events, key=lambda item: (item.start, item.end if item.end is not None else math.inf))


class _TypePredictor:
    def __init__(self, type_key: str, chronological: list[Event], birth: date, now: float, offset: float, options: Options):
        self.type_key = type_key
        self.events = chronological
        self.now = now
        self.options = options
        self.awake_window = type_key == options.awake_window_type_key
        self.selector = SampleSelector(birth, now, offset, options, type_key in options.day_night_type_keys)

    def quantile(self, samples: Sequence[TimedSample], quantile: float) -> float:
        return round_to_minute(weighted_quantile(samples, quantile, self.now, self.options.recency_half_life))

    def estimate_duration(self, start: float, kind_group: str | None = None) -> DurationEstimate | None:
        """Median of finished durations; ``kind_group`` ('nap'/'night') is the proposed v1.1 fix, not in the C# code."""
        durations = [
            TimedSample(item.end - item.start, item.start)
            for item in self.events
            if item.end is not None and (kind_group is None or session_group(item) == kind_group)
        ]
        selection = self.selector.select(durations, start)
        if len(selection.samples) < self.options.minimum_samples:
            return None
        quantiles = {q: self.quantile(selection.samples, q) for q in QUANTILES}
        return DurationEstimate(quantiles[0.5], len(selection.samples), quantiles)

    def collect_gaps(self) -> list[TimedSample]:
        pairs = zip(self.events, self.events[1:])
        if self.awake_window:
            return [TimedSample(second.start - first.end, first.end) for first, second in pairs if first.end is not None]
        return [TimedSample(second.start - first.start, first.start) for first, second in pairs]

    def find_anchor(self) -> tuple[float, bool]:
        last = self.events[-1]
        if not self.awake_window:
            return last.start, False
        if last.end is not None:
            return last.end, False
        typical = self.estimate_duration(last.start)
        expected_wake = last.start + (typical.median if typical is not None else 0.0)
        return (expected_wake if expected_wake > self.now else self.now), True

    def confidence(self, count: int) -> str:
        if count >= self.options.high_confidence_samples:
            return "High"
        if count >= self.options.medium_confidence_samples:
            return "Medium"
        return "Low"

    def predict(self) -> TypePrediction | Insufficient:
        anchor, in_progress = self.find_anchor()
        gaps = self.selector.select(self.collect_gaps(), anchor)
        count = len(gaps.samples)
        if count < self.options.minimum_samples:
            return Insufficient(self.type_key, count)
        quantiles = {q: self.quantile(gaps.samples, q) for q in QUANTILES}
        starts = {q: anchor + value for q, value in quantiles.items()}
        expected = starts[0.5]
        return TypePrediction(
            type_key=self.type_key,
            anchor=anchor,
            from_event_in_progress=in_progress,
            earliest=anchor + quantiles[self.options.window_lower_quantile],
            expected=expected,
            latest=anchor + quantiles[self.options.window_upper_quantile],
            starts=starts,
            sample_count=count,
            confidence=self.confidence(count),
            basis="AwakeWindow" if self.awake_window else "StartInterval",
            median_gap=quantiles[0.5],
            age_band=gaps.age_band,
            phase=gaps.phase,
            duration=self.estimate_duration(expected),
        )


def _in_window(events: Iterable[Event], now: float, options: Options) -> list[Event]:
    window_start = now - options.look_back
    return [item for item in events if window_start <= item.start <= now]


def _type_events(events: list[Event], type_key: str, now: float, options: Options) -> list[Event]:
    of_type = [item for item in events if item.type_key == type_key]
    if type_key == options.awake_window_type_key:
        of_type = build_sleep_sessions(of_type, now, options.max_night_session_length)
    return _chronological(of_type)


def predict(
    events: Iterable[Event],
    birth: date,
    now: float,
    offset_seconds: float,
    options: Options = DEFAULT_OPTIONS,
    type_keys: Iterable[str] | None = None,
) -> dict[str, TypePrediction | Insufficient]:
    """``PredictionEngine.Predict`` for the given types (default: every type in the window)."""
    in_window = _in_window(events, now, options)
    keys = sorted(set(type_keys) if type_keys is not None else {item.type_key for item in in_window})
    result: dict[str, TypePrediction | Insufficient] = {}
    for key in keys:
        chronological = _type_events(in_window, key, now, options)
        if not chronological:
            if any(item.type_key == key for item in in_window):
                result[key] = Insufficient(key, 0)
            continue
        result[key] = _TypePredictor(key, chronological, birth, now, offset_seconds, options).predict()
    return result


@dataclass(frozen=True)
class WakePrediction:
    """Expected wake of the running sleep session (C# awake-window anchor) and duration quantiles behind it."""

    expected_wake: float
    session_start: float
    duration: DurationEstimate | None


def session_group(item: Event) -> str:
    """'night' for bed_time nights and night timers, 'nap' for every other sleep session."""
    return NIGHT if item.kind == NIGHT else NAP


def wake_prediction(
    events: Iterable[Event],
    birth: date,
    now: float,
    offset_seconds: float,
    options: Options = DEFAULT_OPTIONS,
    kind_aware: bool = False,
) -> WakePrediction | None:
    """The anchor ``FindAnchor`` computes while the last sleep session is running, or ``None`` when none runs.

    ``kind_aware`` is the proposed v1.1 fix (not in the C# code): the typical duration comes only from finished
    sessions of the running session's group (naps for a nap, nights for a night) instead of all sessions of the same
    day/night phase.
    """
    in_window = _in_window(events, now, options)
    sessions = _type_events(in_window, options.awake_window_type_key, now, options)
    if not sessions or sessions[-1].end is not None:
        return None
    predictor = _TypePredictor(options.awake_window_type_key, sessions, birth, now, offset_seconds, options)
    running = sessions[-1]
    if not kind_aware:
        anchor, _ = predictor.find_anchor()
        return WakePrediction(anchor, running.start, predictor.estimate_duration(running.start))
    duration = predictor.estimate_duration(running.start, session_group(running))
    expected = running.start + (duration.median if duration is not None else 0.0)
    return WakePrediction(max(expected, now), running.start, duration)
