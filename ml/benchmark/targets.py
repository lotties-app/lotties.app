"""Decision points and outcomes of each prediction target.

A decision point is the instant a prediction would be shown right after an event of the relevant kind; the outcome
is the time (minutes) until the predicted event. Sleep sessions are built with the same rules as the C# engine
(``build_sleep_sessions``) over the whole history.

Outcomes longer than the target's ``cap`` are logging gaps (an evening nobody logged, a forgotten timer) and are
excluded from training and scoring for every method alike; so are outcomes under one minute (duplicates).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .data import SECONDS_PER_MINUTE, Dataset
from .heuristic import DEFAULT_OPTIONS, NAP, NIGHT, build_sleep_sessions


@dataclass(frozen=True)
class TargetSpec:
    name: str
    description: str
    cap_minutes: float
    prior_key: str


TARGETS: dict[str, TargetSpec] = {
    spec.name: spec
    for spec in (
        TargetSpec("feed", "next feed start, asked right after each feed", 8 * 60, "feed"),
        TargetSpec("diaper", "next diaper change, asked right after each change", 12 * 60, "diaper"),
        TargetSpec("sleep_start", "next sleep start (awake window), asked at each wake-up", 8 * 60, "awake"),
        TargetSpec("nap_duration", "wake-up from a nap, asked when the nap starts", 6 * 60, "nap"),
        TargetSpec("night_duration", "morning wake-up, asked at bed time", 16 * 60, "night"),
        TargetSpec("bedtime", "tonight's bed time, asked at every daytime wake-up", 16 * 60, "bedtime"),
    )
}


@dataclass
class Samples:
    """Decision points of one target in time order (arrays of equal length)."""

    spec: TargetSpec
    t: np.ndarray
    y: np.ndarray
    outcome_at: np.ndarray
    subset: np.ndarray
    valid: np.ndarray

    def __len__(self) -> int:
        return len(self.t)


def _samples(spec: TargetSpec, rows: list[tuple[float, float | None, str]]) -> Samples:
    rows.sort(key=lambda row: row[0])
    t = np.array([row[0] for row in rows], dtype=float)
    outcome = np.array([row[1] if row[1] is not None else np.inf for row in rows], dtype=float)
    y = np.where(np.isfinite(outcome), (outcome - t) / SECONDS_PER_MINUTE, np.nan)
    valid = np.isfinite(y) & (y >= 1.0) & (y <= spec.cap_minutes)
    subset = np.array([row[2] for row in rows], dtype=object)
    return Samples(spec, t, y, outcome, subset, valid)


def sleep_sessions(dataset: Dataset) -> list:
    sleep = [item for item in dataset.events if item.type_key == "sleep"]
    sessions = build_sleep_sessions(sleep, dataset.last_start, DEFAULT_OPTIONS.max_night_session_length)
    return sorted(sessions, key=lambda item: (item.start, item.end if item.end is not None else np.inf))


def _start_interval_rows(dataset: Dataset, type_key: str) -> list[tuple[float, float | None, str]]:
    starts = sorted({item.start for item in dataset.events if item.type_key == type_key})
    return [(start, starts[index + 1] if index + 1 < len(starts) else None, "all") for index, start in enumerate(starts)]


def _wake_points(sessions: list) -> list[tuple[int, float]]:
    """Session ends that are real wake-ups: not inside another session that is still running."""
    points = []
    for index, session in enumerate(sessions):
        if session.end is None:
            continue
        wake = session.end
        inside = any(
            other_index != index and other.start < wake and (other.end is None or other.end > wake)
            for other_index, other in enumerate(sessions)
        )
        if not inside:
            points.append((index, wake))
    return points


def build_targets(dataset: Dataset) -> dict[str, Samples]:
    sessions = sleep_sessions(dataset)
    starts = np.array([session.start for session in sessions])
    kinds = [session.kind if session.kind == NIGHT else NAP for session in sessions]
    targets: dict[str, Samples] = {
        "feed": _samples(TARGETS["feed"], _start_interval_rows(dataset, "feeding")),
        "diaper": _samples(TARGETS["diaper"], _start_interval_rows(dataset, "diaper")),
    }

    sleep_rows, bedtime_rows = [], []
    for index, wake in _wake_points(sessions):
        later = [j for j in np.nonzero(starts >= wake)[0] if j != index]
        following = later[0] if later else None
        next_kind = kinds[following] if following is not None else "none"
        sleep_rows.append((wake, sessions[following].start if following is not None else None, next_kind))
        nights = [j for j in later if kinds[j] == NIGHT]
        bedtime_rows.append(
            (wake, sessions[nights[0]].start if nights else None, "last_wake" if next_kind == NIGHT else "earlier")
        )
    targets["sleep_start"] = _samples(TARGETS["sleep_start"], sleep_rows)

    nap_rows, night_rows = [], []
    for session, kind in zip(sessions, kinds):
        row = (session.start, session.end, kind)
        (night_rows if kind == NIGHT else nap_rows).append(row)
    targets["nap_duration"] = _samples(TARGETS["nap_duration"], nap_rows)
    targets["night_duration"] = _samples(TARGETS["night_duration"], night_rows)
    targets["bedtime"] = _samples(TARGETS["bedtime"], bedtime_rows)
    return targets
