"""Parity tests: the Python port must reproduce the C# heuristic v1 test expectations
(code/api/tests/BabyRoutine.Domain.Tests/Predictions/PredictionEngineTests.cs and SleepSessionTests.cs)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from benchmark import heuristic
from benchmark.data import Event

HOUR = 3600.0
MINUTE = 60.0
DAY = 86400.0
BIRTH = date(2025, 11, 1)
BRASILIA = -3 * HOUR
NOW = datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc).timestamp()


def every(key: str, interval: float, first: float, last: float, duration: float = 0.0, kind: str | None = None) -> list[Event]:
    events, start = [], first
    while start <= last:
        events.append(Event(key, start, start + duration, kind))
        start += interval
    return events


def predict(events, now=NOW, offset=0.0, birth=BIRTH):
    return heuristic.predict(events, birth, now, offset)


def single(result):
    predictions = [value for value in result.values() if isinstance(value, heuristic.TypePrediction)]
    assert len(predictions) == 1
    return predictions[0]


def test_one_event_reports_insufficient_data():
    result = predict([Event("tummy_time", NOW - HOUR, NOW - 50 * MINUTE)])
    assert result == {"tummy_time": heuristic.Insufficient("tummy_time", 0)}


def test_three_intervals_predicts_with_low_confidence():
    prediction = single(predict(every("tummy_time", 4 * HOUR, NOW - 13 * HOUR, NOW - HOUR)))
    assert prediction.sample_count == 3
    assert prediction.confidence == "Low"
    assert prediction.expected == NOW + 3 * HOUR


@pytest.mark.parametrize("intervals, confidence", [(3, "Low"), (9, "Low"), (10, "Medium"), (29, "Medium"), (30, "High")])
def test_sample_count_sets_confidence(intervals, confidence):
    prediction = single(predict(every("tummy_time", 4 * HOUR, NOW - 4 * HOUR * intervals, NOW)))
    assert prediction.sample_count == intervals
    assert prediction.confidence == confidence


def test_feeding_every_three_hours():
    prediction = single(predict(every("feeding", 3 * HOUR, NOW - 14 * DAY, NOW - HOUR, 20 * MINUTE)))
    assert (prediction.earliest, prediction.expected, prediction.latest) == (NOW, NOW, NOW)
    assert prediction.duration.median == 20 * MINUTE
    assert prediction.confidence == "High"
    assert prediction.basis == "StartInterval"
    assert prediction.phase == "day"
    assert prediction.age_band == 0


def local_daily_feeds(now: float, offset: float, hours: list[int]) -> list[Event]:
    local_now = datetime.fromtimestamp(now + offset, tz=timezone.utc)
    today = local_now.date()
    events = []
    for days_back in range(15):
        day = today - timedelta(days=days_back)
        for hour in hours:
            start = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc).timestamp() - offset
            if start <= now:
                events.append(Event("feeding", start, start + 20 * MINUTE))
    return events


@pytest.mark.parametrize("local_hour, expected_hour, phase", [(21, 23, "night"), (11, 13, "day")])
def test_feeding_uses_phase_of_last_feed(local_hour, expected_hour, phase):
    now = datetime(2026, 1, 10, local_hour, tzinfo=timezone.utc).timestamp() - BRASILIA
    events = local_daily_feeds(now, BRASILIA, [3, 7, 10, 13, 16, 19, 23])
    prediction = single(predict(events, now, BRASILIA))
    assert prediction.expected == datetime(2026, 1, 10, expected_hour, tzinfo=timezone.utc).timestamp() - BRASILIA
    assert prediction.phase == phase


def test_too_few_samples_in_phase_falls_back_to_whole_day():
    now = datetime(2026, 1, 10, 21, tzinfo=timezone.utc).timestamp()
    events = local_daily_feeds(now, 0.0, [9, 12, 15, 18]) + [Event("feeding", now - HOUR, now - 40 * MINUTE)]
    prediction = single(predict(events, now, 0.0))
    assert prediction.phase is None
    assert prediction.expected == now + 2 * HOUR


def test_sleep_naps_predict_from_last_wake_plus_awake_window():
    events = every("sleep", 3.5 * HOUR, NOW - 14 * DAY, NOW - 2 * HOUR, 1.5 * HOUR)
    prediction = single(predict(events))
    assert prediction.basis == "AwakeWindow"
    assert prediction.expected == events[-1].end + 2 * HOUR
    assert prediction.duration.median == 1.5 * HOUR


def test_sleep_in_progress_measures_from_expected_wake():
    events = every("sleep", 3.5 * HOUR, NOW - 14 * DAY, NOW - 2 * HOUR, 1.5 * HOUR) + [Event("sleep", NOW - 30 * MINUTE, None)]
    prediction = single(predict(events))
    assert prediction.expected == NOW + 3 * HOUR
    assert prediction.from_event_in_progress
    wake = heuristic.wake_prediction(events, BIRTH, NOW, 0.0)
    assert wake.expected_wake == NOW + HOUR


def test_sleep_in_progress_longer_than_typical_measures_from_now():
    events = every("sleep", 3.5 * HOUR, NOW - 14 * DAY, NOW - 6 * HOUR, 1.5 * HOUR) + [Event("sleep", NOW - 3 * HOUR, None)]
    assert single(predict(events)).expected == NOW + 2 * HOUR


def test_duplicate_timestamps_ignore_zero_intervals():
    once = every("tummy_time", 4 * HOUR, NOW - 14 * DAY, NOW - HOUR, 10 * MINUTE)
    prediction = single(predict(once + once))
    assert prediction.sample_count == len(once) - 1
    assert prediction.expected == NOW


def test_instant_events_have_no_duration():
    assert single(predict(every("diaper", 3 * HOUR, NOW - 2 * DAY, NOW - HOUR))).duration is None


def test_logging_gap_is_excluded_as_outlier():
    events = every("tummy_time", 3 * HOUR, NOW - 4 * DAY, NOW - HOUR)
    del events[10:13]
    prediction = single(predict(events))
    assert prediction.sample_count == 27
    assert prediction.latest == events[-1].start + 3 * HOUR


def test_recent_rhythm_weighs_more():
    older = every("tummy_time", 4 * HOUR, NOW - 14 * DAY, NOW - 4 * DAY)
    recent = every("tummy_time", 2 * HOUR, NOW - 4 * DAY + 2 * HOUR, NOW - HOUR)
    prediction = single(predict(older + recent))
    assert len(older) > len(recent)
    assert prediction.median_gap == 2 * HOUR
    assert prediction.expected == NOW


def test_enough_samples_in_current_age_band_uses_only_that_band():
    birthday = datetime(2026, 1, 6, tzinfo=timezone.utc).timestamp()
    events = every("tummy_time", 2 * HOUR, NOW - 14 * DAY, birthday - HOUR) + every("tummy_time", 3 * HOUR, birthday, NOW - HOUR)
    prediction = single(predict(events, birth=date(2025, 10, 6)))
    assert prediction.age_band == 1
    assert prediction.median_gap == 3 * HOUR


def test_events_outside_look_back_or_in_future_are_ignored():
    in_window = every("tummy_time", 4 * HOUR, NOW - 14 * DAY, NOW - HOUR)
    events = every("tummy_time", HOUR, NOW - 20 * DAY, NOW - 14 * DAY - HOUR) + in_window + every("tummy_time", 30 * MINUTE, NOW + HOUR, NOW + 5 * HOUR)
    prediction = single(predict(events))
    assert prediction.sample_count == len(in_window) - 1
    assert prediction.expected == NOW


# --- SleepSessionTests ---------------------------------------------------------------------------------------

TODAY = datetime(2026, 1, 10, tzinfo=timezone.utc).timestamp() - BRASILIA


def at(day: int, hour: int, minute: int = 0) -> float:
    return TODAY + day * DAY + hour * HOUR + minute * MINUTE


def marker(kind: str, instant: float) -> Event:
    return Event("sleep", instant, instant, kind)


def logged(kind, start, end) -> Event:
    return Event("sleep", start, end, kind)


def fixture_days(now: float) -> list[Event]:
    events = []
    for day in range(-7, 1):
        events += [
            marker("woke_up", at(day, 6, 30)),
            logged("nap", at(day, 9), at(day, 10)),
            logged("nap", at(day, 12, 30), at(day, 14)),
            logged("nap", at(day, 16), at(day, 17)),
            marker("bed_time", at(day, 20)),
            logged("night_waking", at(day + 1, 2), at(day + 1, 2, 20)),
        ]
    return [item for item in events if (item.end if item.end is not None else item.start) <= now]


def sleep_prediction(events, now):
    return heuristic.predict(events, BIRTH, now, BRASILIA)["sleep"]


def test_evening_awake_window_ignores_night_wakings():
    now = at(0, 18)
    prediction = sleep_prediction(fixture_days(now), now)
    assert prediction.median_gap == 2.5 * HOUR
    assert prediction.expected == at(0, 19, 30)
    assert prediction.duration.median == 10.5 * HOUR


def test_after_bed_time_the_night_is_in_progress():
    now = at(0, 23)
    prediction = sleep_prediction(fixture_days(now), now)
    assert prediction.from_event_in_progress
    assert prediction.expected == at(1, 9)
    assert prediction.duration.median == HOUR


def test_morning_measures_from_wake_up():
    now = at(0, 8)
    prediction = sleep_prediction(fixture_days(now), now)
    assert not prediction.from_event_in_progress
    assert prediction.median_gap == 2.5 * HOUR
    assert prediction.expected == at(0, 9)


@pytest.mark.parametrize("night_hours, gaps", [(15, 4), (16, 4), (17, 0)])
def test_bed_time_to_wake_up_forms_a_night_within_sixteen_hours(night_hours, gaps):
    events = []
    for day in range(1, 6):
        events += [marker("bed_time", at(-day, 6)), marker("woke_up", at(-day, 6 + night_hours))]
    result = sleep_prediction(events, at(0, 23))
    assert result.sample_count == gaps


def test_bed_time_followed_by_another_bed_time_ignores_the_first():
    events = []
    for day in range(1, 6):
        events += [marker("bed_time", at(-day, 19)), marker("bed_time", at(-day, 20)), marker("woke_up", at(-day + 1, 6))]
    prediction = sleep_prediction(events, at(0, 12))
    assert prediction.duration.median == 10 * HOUR
    assert prediction.median_gap == 14 * HOUR


def test_fell_asleep_marker_with_night_timer_counts_the_night_once():
    events = []
    for day in range(1, 8):
        d = -day
        events += [
            marker("bed_time", at(d, 20)),
            marker("fell_asleep", at(d, 20, 25)),
            logged("night", at(d, 20, 25), at(d + 1, 6, 30)),
            logged("night_waking", at(d + 1, 2), at(d + 1, 2, 20)),
            marker("woke_up", at(d + 1, 6, 30)),
        ]
    prediction = sleep_prediction(events, at(0, 18))
    assert prediction.duration.median == 10.5 * HOUR
    assert prediction.median_gap == 13.5 * HOUR
    assert prediction.sample_count == 6


def test_round_to_minute_is_away_from_zero():
    assert heuristic.round_to_minute(90.0) == 120.0
    assert heuristic.round_to_minute(89.0) == 60.0
    assert heuristic.round_to_minute(-90.0) == -120.0
