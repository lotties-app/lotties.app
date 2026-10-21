"""Synthetic, Napper-shaped histories for tests (never real data).

A day: wake-up around 07:00 (woke_up marker), naps after jittered awake windows until bed time around 20:00
(bed_time marker), night wakings inside the night, feeds every ~2.5 h by day and ~3.5 h by night (instants), diapers
every ~3.5 h (instants).
"""

from __future__ import annotations

import random
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
