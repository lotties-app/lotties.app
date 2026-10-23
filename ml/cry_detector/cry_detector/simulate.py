"""24 h days composed from the scored library: score timelines with known cry episodes and negative segments.

A day is a sequence of library items (cry episodes, negative stretches) separated by stretches of its noise bed
(random slices of a scored bed item). Gaps next to an episode are at least 10 minutes, so two episodes never merge.
Counts per day are Poisson draws around the plan's means. Everything is seeded.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import HOP_S
from .library import NEGATIVE_BEDS, POSITIVE_CONDITIONS, Item

DAY_WINDOWS = int(round(24 * 3600 / HOP_S))
MIN_EPISODE_GAP = int(round(600 / HOP_S))
EPISODES_PER_DAY = 8

# Negative stretches per 24 h. "household" is a guess at a busy home with a baby (stated as such in the report); the
# others are stress days of one type, many times more than a real day, to estimate a rate per type.
MIXES: dict[str, dict[str, int]] = {
    "none": {},
    "household": {"speech": 40, "music": 15, "domestic": 120, "human": 60, "animals": 20, "natural": 20, "urban": 30},
    "speech": {"speech": 200},
    "music": {"music": 150},
    "animals": {"animals": 400},
    "natural": {"natural": 400},
    "human": {"human": 400},
    "domestic": {"domestic": 400},
    "urban": {"urban": 400},
}


@dataclass(frozen=True)
class Segment:
    start: int
    end: int
    kind: str
    type: str
    category: str


@dataclass
class Day:
    name: str
    bed: str
    mix: str
    condition: str | None
    scores: dict[str, np.ndarray]
    episodes: list[tuple[float, float]]
    segments: list[Segment]


def bed_key(bed: str, db: float) -> str:
    return f"{bed}@{db:g}"


class Composer:
    def __init__(self, items: list[Item], scores: dict[str, list[np.ndarray]]):
        self.items = items
        self.scores = scores
        self.models = list(scores)
        self.beds = {it.condition: k for k, it in enumerate(items) if it.kind == "bed"}

    def _pick(self, rng: np.random.Generator, pred, count: int, replace: bool) -> list[int]:
        pool = [k for k, it in enumerate(self.items) if pred(it)]
        if not pool or count <= 0:
            return []
        return [int(k) for k in rng.choice(pool, size=count, replace=replace or count > len(pool))]

    def day(self, name: str, bed: str, bed_db: float, mix: str, condition: str | None, seed: int) -> Day:
        rng = np.random.default_rng(seed)
        chosen: list[int] = []
        if condition:
            chosen += self._pick(rng, lambda it: it.kind == "episode" and it.condition == condition, EPISODES_PER_DAY, False)
        neg_bed = bed if bed in NEGATIVE_BEDS and NEGATIVE_BEDS[bed] == bed_db else None
        for kind, mean in MIXES[mix].items():
            if neg_bed is None:
                raise ValueError(f"negatives exist only on the negative beds, not {bed}@{bed_db}")
            chosen += self._pick(
                rng, lambda it, k=kind: it.kind == "negative" and it.bed == neg_bed and it.type == k, int(rng.poisson(mean)), True
            )
        rng.shuffle(chosen)
        lengths = [len(self.items[k].labels) for k in chosen]
        while chosen and sum(lengths) > 0.9 * DAY_WINDOWS:  # drop negatives first if a stress day overflows
            drop = next((i for i in range(len(chosen) - 1, -1, -1) if self.items[chosen[i]].kind != "episode"), len(chosen) - 1)
            chosen.pop(drop)
            lengths.pop(drop)
        n_gaps = len(chosen) + 1
        rest = DAY_WINDOWS - sum(lengths)
        minimum = np.zeros(n_gaps, dtype=int)
        for i, k in enumerate(chosen):
            if self.items[k].kind == "episode":
                minimum[i] = max(minimum[i], MIN_EPISODE_GAP)
                minimum[i + 1] = max(minimum[i + 1], MIN_EPISODE_GAP)
        if minimum.sum() > rest:
            minimum = (minimum * rest // max(1, minimum.sum())).astype(int)
        free = rest - minimum.sum()
        share = rng.dirichlet(np.ones(n_gaps))
        gaps = minimum + np.floor(share * free).astype(int)
        gaps[-1] += rest - gaps.sum()

        bed_item = self.beds[bed_key(bed, bed_db)]
        bed_len = len(self.items[bed_item].labels)
        pieces: dict[str, list[np.ndarray]] = {m: [] for m in self.models}
        segments, episodes = [], []
        pos = 0

        def add_bed(g: int) -> None:
            nonlocal pos
            if g <= 0:
                return
            idx = (int(rng.integers(bed_len)) + np.arange(g)) % bed_len
            for m in self.models:
                pieces[m].append(self.scores[m][bed_item][idx])
            pos += g

        for i, k in enumerate(chosen):
            add_bed(int(gaps[i]))
            it = self.items[k]
            n = len(it.labels)
            for m in self.models:
                pieces[m].append(self.scores[m][k])
            segments.append(Segment(pos, pos + n, it.kind, it.type, it.category))
            if it.truth:
                episodes.append(((pos + it.truth[0]) * HOP_S, (pos + it.truth[1]) * HOP_S))
            pos += n
        add_bed(int(gaps[-1]))
        scores = {m: np.concatenate(pieces[m]).astype(np.float32) for m in self.models}
        return Day(name, bed, mix, condition, scores, sorted(episodes), segments)


def attribute(day: Day, trigger_s: float, window_s: float) -> tuple[str, str]:
    """The segment overlapping most of the trigger's counting window, else the bed."""
    lo, hi = int((trigger_s - window_s) / HOP_S), int(trigger_s / HOP_S)
    best, best_overlap = ("bed", day.bed), 0
    for s in day.segments:
        overlap = min(hi, s.end) - max(lo, s.start)
        if overlap > best_overlap:
            best, best_overlap = (s.type, s.category), overlap
    return best


def day_plan(split_seed: int, positive_days: int, negative_days: int) -> list[tuple[str, str, float, str, str | None, int]]:
    """(name, bed, bed_db, mix, condition, seed) of every day of a split."""
    plan = []
    for ci, c in enumerate(POSITIVE_CONDITIONS):
        for d in range(positive_days):
            plan.append((f"pos:{c.name}:{d}", c.bed, c.bed_db, "none", c.name, split_seed * 10_000 + ci * 100 + d))
    for bi, (bed, db) in enumerate(NEGATIVE_BEDS.items()):
        for mi, mix in enumerate(MIXES):
            for d in range(negative_days):
                plan.append((f"neg:{bed}:{mix}:{d}", bed, db, mix, None, split_seed * 10_000 + 5000 + bi * 500 + mi * 20 + d))
    realistic = {"quiet": "quiet_near", "white": "white_snr5", "pink": "pink_snr5", "fan": "fan_snr5"}
    for bi, (bed, cond) in enumerate(realistic.items()):
        for d in range(positive_days):
            plan.append((f"real:{bed}:{d}", bed, NEGATIVE_BEDS[bed], "household", cond, split_seed * 10_000 + 9000 + bi * 50 + d))
    return plan
