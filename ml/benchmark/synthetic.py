"""Synthetic, Napper-shaped histories for tests (never real data).

A day: wake-up around 07:00 (woke_up marker), naps after jittered awake windows until bed time around 20:00
(bed_time marker), night wakings inside the night, feeds every ~2.5 h by day and ~3.5 h by night (instants), diapers
every ~3.5 h (instants).

Also the night-window cohorts (``cohort_baby``) and the community-insights cohorts (``community_cohort``, per-baby
per-day inputs of the pooled statistics), both described in their own blocks below.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import numpy as np

from .data import SECONDS_PER_MINUTE, Dataset, Event
from .priors import UNSOURCED_AWAKE, UNSOURCED_NAP

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
# in minutes, the medians of the benchmark's unsourced priors.
UNSOURCED_AWAKE_MINUTES = tuple(UNSOURCED_AWAKE[band][0] for band in range(4))
UNSOURCED_NAP_MINUTES = tuple(UNSOURCED_NAP[band][0] for band in range(4))
UNSOURCED_DAY_FEED_GAP_MINUTES = 180
UNSOURCED_DIAPER_GAP_MINUTES = 210


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
    diaper_rng = random.Random(f"{cohort.name}-{seed}-diapers")  # its own stream: diapers never shift the sleep and feed draws
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
        diaper = wake + 10 * SECONDS_PER_MINUTE
        while diaper < bed:
            events.append(Event("diaper", diaper, diaper, None, None, "WET"))
            diaper += (UNSOURCED_DIAPER_GAP_MINUTES + diaper_rng.uniform(-30, 30)) * SECONDS_PER_MINUTE
        if offset % 7 == 0:
            # A weekly medication instant, like a real export has: the full backtest's medication feature is then not
            # all missing (an all-missing column breaks scikit-learn's HistGradientBoosting binning).
            dose = wake + 120 * SECONDS_PER_MINUTE
            events.append(Event("medication", dose, dose))
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


# ---------------------------------------------------------------------------------------------------------------
# Synthetic community cohorts for the pooled-statistics study (benchmark/community.py; docs/design/34-community-insights.md
# section 9 item 1). Never real data: every baby, family and value below is drawn from the curves and spreads in this
# block. A cohort is per-baby, per-local-day inputs (what the aggregation job would derive in memory, design 34 section
# 4), not event histories: 10 000 babies of events would be slow and add nothing to the pooled statistics.
#
# SOURCED anchors (code/api/data/age-norms.json, the published-norms priors the pool must beat): formula ml per feed
# (midpoints of the 1-4, 4-9, 9-13, 13-17, 17-26 and 26-52 week ranges), night sleep (Pelotas medians 9.5 h at 3
# months, 10 h at 12, 10.5 h at 24) and naps per day (3.1 / 2.2 / 1.2 in the 0-6, 6-12, 12-24 month bands), each
# placed at its band's middle week and joined by straight lines, so the truth moves week by week inside a published
# band. UNSOURCED (no published norm): every between-baby and day-to-day spread, the breast-milk bottle factor, the
# tummy-time curve, the first weeks of night sleep and naps, feeds per day, crying spells and their causes, the family
# sizes, opt-in by family, and the "heavy" families. The crying causes have a known ground truth by construction.
# Synthetic data cannot prove a real-world gain (docs/design/28-age-norms.md section 15.4).

MAX_WEEK = 104
"""Age in completed weeks, exclusive: the catalog bands end at week 104."""

FORMULA_ML_BY_WEEK = ((0, 45), (2.6, 90), (6.5, 120), (10.9, 165), (15.2, 190), (21.8, 190), (39.1, 210), (104, 210))
"""Week 0 and week 104 are unsourced; the others are midpoints of the published formula ranges at their band middles."""
UNSOURCED_BREAST_MILK_FACTOR = 0.85
UNSOURCED_TUMMY_MINUTES_BY_WEEK = ((0, 5), (8, 20), (16, 35), (26, 45))
NIGHT_MINUTES_BY_WEEK = ((0, 510), (15.2, 570), (65.2, 600), (104, 630))
"""Week 0 is unsourced; 15.2 / 65.2 / 104 are the Pelotas medians (the 104-week one is the 24-month median)."""
NAPS_BY_WEEK = ((0, 4.0), (13, 3.1), (39, 2.2), (78, 1.2), (104, 1.0))
"""Weeks 0 and 104 are unsourced; the others are the typical values of the three published nap bands."""
TUMMY_WEEKS = 26
CRY_CAUSES = ("hunger", "sleepy", "diaper", "gas", "comfort")
PARTS_OF_DAY = ("morning", "afternoon", "evening", "night")
CRY_BAND_EDGES = (0, 6, 13, 26, MAX_WEEK)
"""docs/design/27 `cryAgeBand`: newborn (< 6 weeks), 6 weeks to 3 months, 3 to 6 months, 6 months and over."""
UNSOURCED_CRY_CAUSE_BASE = (
    (0.35, 0.15, 0.15, 0.20, 0.15),
    (0.30, 0.20, 0.10, 0.25, 0.15),
    (0.30, 0.30, 0.10, 0.10, 0.20),
    (0.25, 0.35, 0.10, 0.05, 0.25),
)
"""Ground truth of "what helped" per cry band (causes in ``CRY_CAUSES`` order), before the part-of-day factors."""
UNSOURCED_CRY_PART_FACTOR = (
    (1.0, 0.8, 1.2, 0.8, 1.0),
    (1.0, 1.0, 1.0, 1.0, 1.0),
    (0.8, 1.3, 0.8, 1.5, 1.3),
    (1.4, 0.7, 1.0, 1.0, 0.9),
)
UNSOURCED_PART_OF_DAY_SHARES = (0.2, 0.25, 0.4, 0.15)
HEAVY_FAMILY_SHARE = 0.02
"""Share of families that log much more (every day for 40 weeks, 28 bottles a day) and with biased values."""


def curve(points: tuple[tuple[float, float], ...], weeks):
    """Piecewise-linear truth curve at ``weeks`` (scalar or array), flat outside the anchors."""
    xs, ys = zip(*points)
    return np.interp(weeks, xs, ys)


def cry_truth(cry_band: int, part: int) -> np.ndarray:
    """The known ground truth: share of spells where each cause helped, for one cry band and part of day."""
    weights = np.asarray(UNSOURCED_CRY_CAUSE_BASE[cry_band]) * np.asarray(UNSOURCED_CRY_PART_FACTOR[part])
    return weights / weights.sum()


@dataclass(frozen=True)
class Observations:
    """One row per input value: the baby (index into the cohort arrays), the baby's local day number, the age in
    completed weeks that day, the value and the dimension (bottle kind, part of day; 0 when the statistic has none)."""

    baby: np.ndarray
    day: np.ndarray
    week: np.ndarray
    value: np.ndarray
    dimension: np.ndarray

    def take(self, mask: np.ndarray) -> "Observations":
        return Observations(self.baby[mask], self.day[mask], self.week[mask], self.value[mask], self.dimension[mask])


@dataclass(frozen=True)
class CommunityCohort:
    baby_id: np.ndarray
    """Stable random 63-bit ids (the keyed hash of the per-baby cap reads them)."""
    family: np.ndarray
    heavy: np.ndarray
    """Per baby: whether its family is a heavy-logging one."""
    bottle_kind: np.ndarray
    """0 formula, 1 breast milk (the catalog dimension of ``bottle_ml_per_feed``)."""
    observations: dict[str, Observations]

    @property
    def size(self) -> int:
        return len(self.baby_id)


def _families(rng: np.random.Generator, size: int) -> tuple[np.ndarray, np.ndarray]:
    sizes = rng.choice((1, 2, 3), size=size, p=(0.75, 0.2, 0.05))
    family = np.repeat(np.arange(size), sizes)[:size]
    heavy_family = rng.random(size) < HEAVY_FAMILY_SHARE
    heavy_family[int(rng.integers(0, family.max() + 1))] = True  # at least one heavy family per instance
    return family, heavy_family[family]


def _days(rng: np.random.Generator, family: np.ndarray, heavy: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Expanded logged days (baby, day number, age week). A history is a window of 2-16 weeks (heavy: 40, the same
    start for the whole family) from a random age; 80 % of days are logged (heavy: all)."""
    size = len(family)
    start = rng.integers(0, MAX_WEEK - 1, size)
    family_start = rng.integers(0, MAX_WEEK - 40, family.max() + 1)
    start = np.where(heavy, family_start[family], start)
    n_days = np.where(heavy, 40, rng.integers(2, 17, size)) * 7
    baby = np.repeat(np.arange(size), n_days)
    day = np.arange(len(baby)) - np.repeat(np.cumsum(n_days) - n_days, n_days)
    week = start[baby] + day // 7
    logged = (week < MAX_WEEK) & ((rng.random(len(baby)) < 0.8) | heavy[baby])
    return baby[logged], day[logged], week[logged]


def community_cohort(size: int, seed: int) -> CommunityCohort:
    """``size`` synthetic babies in families of 1 to 3 (75 / 20 / 5 %), about 2 % of families heavy (at least one)."""
    rng = np.random.default_rng([seed, size, 34])
    family, heavy = _families(rng, size)
    baby_id = rng.integers(1, 2**63 - 1, size, dtype=np.int64)
    kind = (rng.random(size) < 0.4).astype(np.int64)
    baby, day, week = _days(rng, family, heavy)
    hb = heavy[baby]
    observations: dict[str, Observations] = {}

    # Milk per feed: a baby factor (lognormal sd 0.18), per-feed spread (sd 0.15), 1 % typing slips (x10, then clipped).
    feeds = np.where(hb, 28, np.clip(np.rint(rng.normal(7 - 4 * np.minimum(week, 52) / 52, 1.0)), 2, 10)).astype(np.int64)
    fb, fd, fw = np.repeat(baby, feeds), np.repeat(day, feeds), np.repeat(week, feeds)
    factor = rng.lognormal(0, 0.18, size) * np.where(kind == 1, UNSOURCED_BREAST_MILK_FACTOR, 1.0) * np.where(heavy, 1.5, 1.0)
    ml = curve(FORMULA_ML_BY_WEEK, fw + 0.5) * factor[fb] * rng.lognormal(0, 0.15, len(fb))
    ml = np.where(rng.random(len(fb)) < 0.01, ml * 10, ml)
    observations["bottle_ml_per_feed"] = Observations(fb, fd, fw, ml, kind[fb])

    # Tummy time: weeks 0-26, on about 65 % of days; baby factor sd 0.45, day spread sd 0.4.
    tummy_p = rng.beta(6.5, 3.5, size)
    has = (week < TUMMY_WEEKS) & (rng.random(len(baby)) < tummy_p[baby])
    t_factor = rng.lognormal(0, 0.45, size) * np.where(heavy, 3.0, 1.0)
    minutes = curve(UNSOURCED_TUMMY_MINUTES_BY_WEEK, week + 0.5) * t_factor[baby] * rng.lognormal(0, 0.4, len(baby))
    observations["tummy_minutes_per_day"] = Observations(baby[has], day[has], week[has], minutes[has], np.zeros(int(has.sum()), np.int64))

    # Routines: night sleep (baby offset sd 60 min, night spread sd 45 min) and naps (offset sd 0.5, day sd 0.7, whole).
    zeros = np.zeros(len(baby), np.int64)
    night = curve(NIGHT_MINUTES_BY_WEEK, week + 0.5) + rng.normal(0, 60, size)[baby] + rng.normal(0, 45, len(baby)) + np.where(hb, 90, 0)
    observations["night_sleep_minutes"] = Observations(baby, day, week, night, zeros)
    naps = curve(NAPS_BY_WEEK, week + 0.5) + rng.normal(0, 0.5, size)[baby] + rng.normal(0, 0.7, len(baby)) + np.where(hb, 1.5, 0)
    observations["naps_per_day"] = Observations(baby, day, week, np.clip(np.rint(naps), 0, None), zeros)

    # Crying: answered fussy spells, Poisson 0.6 a day; part of day and the helping cause from the ground truth with a
    # per-baby tilt (Dirichlet, concentration 20); a heavy family always answers "gas".
    spells = rng.poisson(0.6, len(baby))
    cb, cd, cw = np.repeat(baby, spells), np.repeat(day, spells), np.repeat(week, spells)
    part = rng.choice(4, size=len(cb), p=UNSOURCED_PART_OF_DAY_SHARES)
    band = np.searchsorted(CRY_BAND_EDGES, cw, side="right") - 1
    cause = np.zeros(len(cb), np.int64)
    for b in range(4):
        for p in range(4):
            rows = np.flatnonzero((band == b) & (part == p))
            if len(rows) == 0:
                continue
            tilt = rng.dirichlet(cry_truth(b, p) * 20, size)[cb[rows]]
            below = np.cumsum(tilt, axis=1) < rng.random(len(rows))[:, None]
            cause[rows] = np.minimum(below.sum(axis=1), len(CRY_CAUSES) - 1)
    cause = np.where(heavy[cb], CRY_CAUSES.index("gas"), cause)
    observations["cry_outcome_by_cause"] = Observations(cb, cd, cw, cause.astype(float), part.astype(np.int64))
    return CommunityCohort(baby_id, family, heavy, kind, observations)
