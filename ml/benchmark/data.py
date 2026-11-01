"""Loading the anonymised events export and the timeline helpers shared by targets and features.

The CSV lives outside the repository (path in ``BR_ML_DATA``). Columns: ``baby, type_key, started_at_utc,
ended_at_utc, kind, method, content, side, birth_date``. Napper-imported semantics: ``bed_time`` and ``woke_up`` are
instant markers, ``nap`` and ``night_waking`` have durations, feeds are mostly instants (bottle), diapers and
medication are instants.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

DEFAULT_TIME_ZONE = "America/Sao_Paulo"
SECONDS_PER_MINUTE = 60.0
SECONDS_PER_HOUR = 3600.0
SECONDS_PER_DAY = 86400.0
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class Event:
    """One logged event. ``end`` is ``None`` while running (only in as-of views)."""

    type_key: str
    start: float
    end: float | None
    kind: str | None = None
    method: str | None = None
    content: str | None = None


@dataclass(frozen=True)
class Dataset:
    """All events of one baby, sorted by start, with the birth date and the family's time zone."""

    events: tuple[Event, ...]
    birth_date: date
    time_zone: str = DEFAULT_TIME_ZONE

    @property
    def first_start(self) -> float:
        return self.events[0].start

    @property
    def last_start(self) -> float:
        return self.events[-1].start

    def offset_seconds(self, instant: float) -> float:
        """UTC offset of the family's time zone at ``instant`` (seconds, negative west of UTC)."""
        moment = EPOCH + timedelta(seconds=instant)
        offset = moment.astimezone(ZoneInfo(self.time_zone)).utcoffset()
        return offset.total_seconds() if offset is not None else 0.0

    def as_of(self, now: float) -> list[Event]:
        """The events a server would have seen at ``now``: started at or before it, ends after it unknown (running)."""
        return [as_seen_at(item, now) for item in self.events if item.start <= now]


def as_seen_at(item: Event, now: float) -> Event:
    if item.end is not None and item.end > now:
        return Event(item.type_key, item.start, None, item.kind, item.method, item.content)
    return item


def _clean(value: object) -> str | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def _seconds(series: pd.Series) -> np.ndarray:
    parsed = pd.to_datetime(series, utc=True, format="ISO8601", errors="coerce")
    return (parsed - pd.Timestamp(0, tz="UTC")).dt.total_seconds().to_numpy()


def load_events(path: str | None = None, baby: str | None = None, time_zone: str = DEFAULT_TIME_ZONE) -> Dataset:
    """Loads one baby's events from the CSV at ``path`` (default: ``$BR_ML_DATA``)."""
    path = path or os.environ.get("BR_ML_DATA")
    if not path:
        raise SystemExit("Set BR_ML_DATA to the events CSV (kept outside the repository) or pass --data.")
    frame = pd.read_csv(path)
    required = {"baby", "type_key", "started_at_utc", "ended_at_utc", "kind", "birth_date"}
    missing = required - set(frame.columns)
    if missing:
        raise SystemExit(f"Events CSV is missing columns: {sorted(missing)}")
    babies = frame["baby"].dropna().unique()
    chosen = baby if baby is not None else babies[0]
    frame = frame[frame["baby"] == chosen].copy()
    frame["start"] = _seconds(frame["started_at_utc"])
    frame["end"] = _seconds(frame["ended_at_utc"])
    frame = frame[np.isfinite(frame["start"])].sort_values(["start", "type_key"], kind="stable")
    events = tuple(
        Event(
            type_key=str(row.type_key),
            start=float(row.start),
            end=float(row.end) if np.isfinite(row.end) else None,
            kind=_clean(row.kind),
            method=_clean(getattr(row, "method", None)),
            content=_clean(getattr(row, "content", None)),
        )
        for row in frame.itertuples(index=False)
    )
    birth = pd.to_datetime(frame["birth_date"].iloc[0]).date()
    return Dataset(events=events, birth_date=birth, time_zone=time_zone)


def local_date(instant: float, offset_seconds: float) -> date:
    return date(1970, 1, 1) + timedelta(days=int((instant + offset_seconds) // SECONDS_PER_DAY))


def local_seconds_of_day(instant: float, offset_seconds: float) -> float:
    return (instant + offset_seconds) % SECONDS_PER_DAY


def local_midnight(day: date, offset_seconds: float) -> float:
    """UTC instant (seconds) of 00:00 local on ``day``."""
    return (day - date(1970, 1, 1)).days * SECONDS_PER_DAY - offset_seconds
