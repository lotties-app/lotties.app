"""Synthetic, Napper-shaped histories for tests (never real data).

A day: wake-up around 07:00 (woke_up marker), naps after jittered awake windows until bed time around 20:00
(bed_time marker), night wakings inside the night, feeds every ~2.5 h by day and ~3.5 h by night (instants), diapers
every ~3.5 h (instants).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from .data import SECONDS_PER_MINUTE, Dataset, Event

LOCAL_OFFSET = -3 * 3600.0


def _instant(day: date, minutes_after_midnight: float) -> float:
    midnight = datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() - LOCAL_OFFSET
    return midnight + minutes_after_midnight * SECONDS_PER_MINUTE


def generate(days: int = 35, seed: int = 1, first_day: date = date(2026, 1, 5), birth: date = date(2025, 12, 1), noise: float = 1.0) -> Dataset:
    rng = random.Random(seed)
    jitter = lambda spread: rng.uniform(-spread, spread) * noise  # noqa: E731
    events: list[Event] = []
    for offset in range(days):
        day = first_day + timedelta(days=offset)
        wake = _instant(day, 7 * 60 + jitter(30))
        bed = _instant(day, 20 * 60 + jitter(30))
        events.append(Event("sleep", wake, wake, "woke_up"))
        cursor = wake
        while True:
            nap_start = cursor + (80 + jitter(15)) * SECONDS_PER_MINUTE
            nap_end = nap_start + (55 + jitter(20)) * SECONDS_PER_MINUTE
            if nap_end > bed - 45 * SECONDS_PER_MINUTE:
                break
            events.append(Event("sleep", nap_start, nap_end, "nap"))
            cursor = nap_end
        events.append(Event("sleep", bed, bed, "bed_time"))
        for hours in (3.0, 6.5):
            waking = bed + (hours * 60 + jitter(30)) * SECONDS_PER_MINUTE
            events.append(Event("sleep", waking, waking + (25 + jitter(10)) * SECONDS_PER_MINUTE, "night_waking"))
        feed = wake
        next_wake = _instant(day + timedelta(days=1), 7 * 60)
        while feed < next_wake:
            events.append(Event("feeding", feed, feed, None, "bottle"))
            night = feed > bed
            feed += ((210 if night else 150) + jitter(20)) * SECONDS_PER_MINUTE
        diaper = wake + 10 * SECONDS_PER_MINUTE
        while diaper < bed:
            events.append(Event("diaper", diaper, diaper, None, None, "WET"))
            diaper += (210 + jitter(30)) * SECONDS_PER_MINUTE
    events.sort(key=lambda item: (item.start, item.type_key))
    return Dataset(tuple(events), birth)


# ---------------------------------------------------------------------------------------------------------------
# Synthetic cohorts for the night-window evaluation (benchmark/night_window.py; docs/design/28-age-norms.md section 15.4)
#
# Each baby gets its own usual bed time and night length, drawn from a cohort distribution, and keeps them with
# night-to-night jitter. SOURCED (code/api/data/age-norms.json): the Brazilian cohort's bed time (Pelotas 2004, Netsi
# 2017: median 22:00, 2.5th-97.5th percentile 20:00-01:00), night length (median 9.5 h at 3 months, 10 h at 12 months,
# 10.5 h at 24 months) and night wakings (median 1, range 0-4); the Swiss control's bed time (Iglowstein 2003: means
# 19:46-20:16) and night length (11.0-11.7 h). UNSOURCED (no published norm, docs/design/28 section 9): awake windows,
# nap lengths, the day feed gap, feeding only at night wakings, and every jitter. Synthetic data cannot prove a
# real-world gain: it only shows what a rule does when babies behave like this.


@dataclass(frozen=True)
class Cohort:
    name: str
    bedtime_median_minutes: float
    """Local clock, minutes after midnight (22:00 = 1320); the cohort's median of the babies' usual bed times."""
    bedtime_sd_minutes: float
    bedtime_range: tuple[float, float]
    night_hours_by_age: tuple[tuple[int, float], ...]
    """(age in days, median night length in hours), interpolated linearly between the points."""
    night_sd_hours: float
    night_range: tuple[float, float]
    wakings_per_night: float


BRAZIL = Cohort(
    name="brazil",
    bedtime_median_minutes=22 * 60,
    bedtime_sd_minutes=70,
    bedtime_range=(20 * 60, 25 * 60),
    night_hours_by_age=((91, 9.5), (365, 10.0), (731, 10.5)),
    night_sd_hours=1.0,
    night_range=(7.5, 12.5),
    wakings_per_night=1.0,
)

SWISS = Cohort(
    name="swiss_control",
    bedtime_median_minutes=20 * 60,
    bedtime_sd_minutes=30,
    bedtime_range=(19 * 60, 21.5 * 60),
    night_hours_by_age=((183, 11.0), (365, 11.7), (731, 11.5)),
    night_sd_hours=0.6,
    night_range=(9.5, 12.5),
    wakings_per_night=1.0,
)

COHORTS = {cohort.name: cohort for cohort in (BRAZIL, SWISS)}

# Unsourced day-rhythm parameters by heuristic age band (0-3 m, 3-6 m, 6-12 m, 12 m+): awake window and nap length
# in minutes. The same values as the benchmark's unsourced priors (priors.UNSOURCED_AWAKE / UNSOURCED_NAP).
UNSOURCED_AWAKE_MINUTES = (75, 105, 165, 240)
UNSOURCED_NAP_MINUTES = (60, 60, 75, 105)
UNSOURCED_DAY_FEED_GAP_MINUTES = 180


def _interpolate(points: tuple[tuple[int, float], ...], age_days: float) -> float:
    if age_days <= points[0][0]:
        return points[0][1]
    for (a_days, a_value), (b_days, b_value) in zip(points, points[1:]):
        if age_days <= b_days:
            return a_value + (b_value - a_value) * (age_days - a_days) / (b_days - a_days)
    return points[-1][1]


def _band(age_days: float) -> int:
    months = age_days / 30.4375
    return 0 if months < 3 else 1 if months < 6 else 2 if months < 12 else 3


def cohort_baby(cohort: Cohort, seed: int, days: int = 35, first_day: date = date(2026, 3, 2), bedtime_feed_lead: float = 15) -> Dataset:
    """One synthetic baby of ``cohort``: age 4 to 20 months on the first day, its own usual bed time and night length.
    ``bedtime_feed_lead``: minutes between the last (bedtime) feed and the bed time (unsourced)."""
    rng = random.Random(f"{cohort.name}-{seed}")
    age_days = rng.uniform(122, 610)
    birth = first_day - timedelta(days=int(age_days))
    usual_bed = min(max(rng.gauss(cohort.bedtime_median_minutes, cohort.bedtime_sd_minutes), cohort.bedtime_range[0]), cohort.bedtime_range[1])
    night_median = _interpolate(cohort.night_hours_by_age, age_days)
    usual_night = min(max(rng.gauss(night_median, cohort.night_sd_hours), cohort.night_range[0]), cohort.night_range[1])
    band = _band(age_days)
    awake, nap = UNSOURCED_AWAKE_MINUTES[band], UNSOURCED_NAP_MINUTES[band]
    jitter = lambda spread: rng.uniform(-spread, spread)  # noqa: E731
    events: list[Event] = []
    wake = _instant(first_day, usual_bed + usual_night * 60 - 24 * 60 + jitter(30))
    for offset in range(days):
        day = first_day + timedelta(days=offset)
        bed = _instant(day, usual_bed + jitter(30))
        events.append(Event("sleep", wake, wake, "woke_up"))
        cursor = wake
        while True:
            nap_start = cursor + (awake + jitter(20)) * SECONDS_PER_MINUTE
            nap_end = nap_start + (nap + jitter(20)) * SECONDS_PER_MINUTE
            if nap_end > bed - 0.6 * awake * SECONDS_PER_MINUTE:
                break
            events.append(Event("sleep", nap_start, nap_end, "nap"))
            cursor = nap_end
        feed = wake + 10 * SECONDS_PER_MINUTE
        while feed < bed - (bedtime_feed_lead + 45) * SECONDS_PER_MINUTE:
            events.append(Event("feeding", feed, feed, None, "bottle"))
            feed += (UNSOURCED_DAY_FEED_GAP_MINUTES + jitter(25)) * SECONDS_PER_MINUTE
        last_feed = bed - bedtime_feed_lead * SECONDS_PER_MINUTE
        events.append(Event("feeding", last_feed, last_feed, None, "bottle"))
        events.append(Event("sleep", bed, bed, "bed_time"))
        next_wake = bed + (usual_night * 60 + jitter(30)) * SECONDS_PER_MINUTE
        wakings = min(4, _poisson(rng, cohort.wakings_per_night))
        for index in range(wakings):
            at = bed + (next_wake - bed) * (index + 1) / (wakings + 1) + jitter(40) * SECONDS_PER_MINUTE
            events.append(Event("sleep", at, at + (20 + jitter(8)) * SECONDS_PER_MINUTE, "night_waking"))
            events.append(Event("feeding", at + 2 * SECONDS_PER_MINUTE, at + 2 * SECONDS_PER_MINUTE, None, "bottle"))
        wake = next_wake
    events.sort(key=lambda item: (item.start, item.type_key))
    return Dataset(tuple(events), birth)


def _poisson(rng: random.Random, mean: float) -> int:
    threshold, count, product = pow(2.718281828459045, -mean), 0, rng.random()
    while product > threshold:
        count += 1
        product *= rng.random()
    return count
