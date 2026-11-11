"""Synthetic study of the community-insights pooled-statistics pipeline (docs/design/34-community-insights.md, sections
4-6 and section 9 item 1). Synthetic only: no child data, no network, CPU.

The pipeline of design 34 section 5 is written here as pure functions over in-memory per-baby, per-day inputs:
clipping to the published range, fixed age bands (a fine grid and a coarser fallback grid), a per-baby cap of 14 days
per cell picked by a keyed hash of baby id and day, one summary per baby (its own median, or its own share of each
crying cause), k distinct babies AND k distinct families per cell, the 25 % family dominance rule, hysteresis (a cell
already published stays while it keeps 18), p3/p97 only from 50 babies, optional noise (the exponential mechanism over
a fixed grid for each percentile and the Laplace mechanism for shares, epsilon per statistic per release split evenly
over the cell's outputs), and a release with babies buckets instead of counts.

``python -m benchmark.community --k 20 --epsilon 0.2 [--seed N]`` simulates instances of 100, 1 000 and 10 000 babies
at opt-in rates of 5, 20 and 50 % (by family) and reports per statistic: coverage, the error of the pooled median
against the generator's truth and of the published-norms prior on the same bands, the cold-start MAE of the pooled
median against the prior (first 14 days of babies who did not opt in, 95 % bootstrap CI over babies), calibration
(share of held-out babies inside the published p10-p90, target 80 +/- 5) and a membership-inference advantage with and
without noise. Synthetic data cannot prove a real-world gain (docs/design/28-age-norms.md section 15.4).
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from .synthetic import (
    CRY_BAND_EDGES,
    CRY_CAUSES,
    FORMULA_ML_BY_WEEK,
    MAX_WEEK,
    NAPS_BY_WEEK,
    NIGHT_MINUTES_BY_WEEK,
    PARTS_OF_DAY,
    TUMMY_WEEKS,
    UNSOURCED_BREAST_MILK_FACTOR,
    UNSOURCED_TUMMY_MINUTES_BY_WEEK,
    CommunityCohort,
    Observations,
    community_cohort,
    cry_truth,
    curve,
)

AGE_NORMS = Path(__file__).resolve().parents[2] / "code" / "api" / "data" / "age-norms.json"

K = 20
HYSTERESIS = 18
DOMINANCE = 0.25
CAP_DAYS = 14
WIDE_PERCENTILES_FROM = 50
LEVELS = (10, 25, 50, 75, 90)
WIDE_LEVELS = (3, 10, 25, 50, 75, 90, 97)
COLD_START_DAYS = 14
HASH_KEY = 0x34C0FFEE

# Fine grid: weekly to week 12, 2-week bands to week 28, 4-week bands to week 104. Coarse fallback: 4-week bands to
# week 52, then 12-week bands (the last one 100-104). Every coarse edge is a fine edge, so each fine band sits in one
# coarse band. (Design 34 says 2-week bands "to week 26"; 28 keeps the 4-week fine bands nested in the coarse ones.)
FINE_EDGES = tuple(range(0, 12)) + tuple(range(12, 28, 2)) + tuple(range(28, MAX_WEEK + 1, 4))
COARSE_EDGES = tuple(range(0, 52, 4)) + (52, 64, 76, 88, 100, MAX_WEEK)


def _cut(edges: tuple[int, ...], to_week: int) -> tuple[int, ...]:
    return tuple(edge for edge in edges if edge < to_week) + (to_week,)


@dataclass(frozen=True)
class Statistic:
    key: str
    kind: str
    """``quantiles`` (percentiles of the babies' own medians) or ``shares`` (mean of the babies' own cause shares)."""
    clip: tuple[float, float]
    step: float
    """Grid step of the noisy percentiles (exponential mechanism); a published value is a multiple of it."""
    fine_edges: tuple[int, ...]
    coarse_edges: tuple[int, ...] | None
    dimensions: tuple[str, ...] = ("all",)
    truth: Callable[[int, int, int], float] | None = None
    """Generator truth of the pooled median for a band (from, to) and dimension index; the mean of the truth curve over
    the band's weeks (the babies' own medians centre on the curve)."""


def _band_mean(points: tuple[tuple[float, float], ...], start: int, end: int, factor: float = 1.0) -> float:
    return float(np.mean(curve(points, np.arange(start, end) + 0.5)) * factor)


CATALOG: dict[str, Statistic] = {
    statistic.key: statistic
    for statistic in (
        Statistic(
            "bottle_ml_per_feed", "quantiles", (0, 400), 10, FINE_EDGES, COARSE_EDGES, ("formula", "breast_milk"),
            lambda a, b, d: _band_mean(FORMULA_ML_BY_WEEK, a, b, UNSOURCED_BREAST_MILK_FACTOR if d == 1 else 1.0),
        ),
        Statistic(
            "tummy_minutes_per_day", "quantiles", (0, 180), 2, _cut(FINE_EDGES, TUMMY_WEEKS), _cut(COARSE_EDGES, TUMMY_WEEKS),
            truth=lambda a, b, d: _band_mean(UNSOURCED_TUMMY_MINUTES_BY_WEEK, a, b),
        ),
        Statistic(
            "night_sleep_minutes", "quantiles", (0, 960), 10, FINE_EDGES, COARSE_EDGES,
            truth=lambda a, b, d: _band_mean(NIGHT_MINUTES_BY_WEEK, a, b),
        ),
        Statistic(
            "naps_per_day", "quantiles", (0, 8), 0.5, FINE_EDGES, COARSE_EDGES,
            truth=lambda a, b, d: _band_mean(NAPS_BY_WEEK, a, b),
        ),
        Statistic("cry_outcome_by_cause", "shares", (0, len(CRY_CAUSES) - 1), 1, CRY_BAND_EDGES, None, PARTS_OF_DAY),
    )
}


# ---------------------------------------------------------------------------------------------------------------
# Published-norms priors (code/api/data/age-norms.json): the fallback a pooled number must beat. A norm with
# needsReview or confidence "low" is never a default (CLAUDE.md age norms rule); without a typical value the middle of
# the published range stands in. Tummy time and the breast-milk bottle have no norm; crying has no published share of
# causes, so its baseline is the uniform split (every cause 20 %).

NORM_METRICS = {
    ("bottle_ml_per_feed", 0): ("feed_volume_ml_per_feed", "formula", 1.0),
    ("night_sleep_minutes", 0): ("night_sleep_hours", "all", 60.0),
    ("naps_per_day", 0): ("naps_per_day", "all", 1.0),
}


@dataclass(frozen=True)
class NormPrior:
    from_weeks: float
    to_weeks: float
    value: float
    norm_id: str


def load_priors(path: Path = AGE_NORMS) -> dict[tuple[str, int], tuple[NormPrior, ...]]:
    norms = json.loads(path.read_text(encoding="utf-8"))["norms"]
    priors: dict[tuple[str, int], tuple[NormPrior, ...]] = {}
    for key, (metric, population, scale) in NORM_METRICS.items():
        usable = []
        for norm in norms:
            if norm["metric"] != metric or norm["population"] != population:
                continue
            if norm["needsReview"] or norm["confidence"] == "low":
                continue
            typical = norm["typical"]
            if typical is None and norm["low"] is not None and norm["high"] is not None:
                typical = (norm["low"] + norm["high"]) / 2
            if typical is None:
                continue
            band = norm["ageBand"]
            usable.append(NormPrior(band["fromWeeks"], band["toWeeks"], typical * scale, norm["id"]))
        priors[key] = tuple(usable)
    return priors


def prior_for(priors: dict[tuple[str, int], tuple[NormPrior, ...]], statistic: str, dimension: int, start: int, end: int) -> float | None:
    """The usable norm whose band holds the middle of the fine band, else None."""
    middle = (start + end) / 2
    for norm in priors.get((statistic, dimension), ()):
        if norm.from_weeks <= middle < norm.to_weeks:
            return norm.value
    return None


# ---------------------------------------------------------------------------------------------------------------
# Pipeline (design 34 section 5), pure functions.


def keyed_hash(key: int, baby_id: np.ndarray, day: np.ndarray) -> np.ndarray:
    """A keyed 64-bit mix (splitmix64) of baby id and day: the per-baby cap picks the same days on every run."""

    def mix(x: np.ndarray) -> np.ndarray:
        x = x + np.uint64(0x9E3779B97F4A7C15)
        x = (x ^ (x >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        x = (x ^ (x >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        return x ^ (x >> np.uint64(31))

    with np.errstate(over="ignore"):
        return mix(baby_id.astype(np.uint64) ^ mix(day.astype(np.uint64) + np.uint64(key)))


def band_index(weeks: np.ndarray, edges: tuple[int, ...]) -> np.ndarray:
    """Band of each age in completed weeks (-1 outside the grid). Edges are fixed, never moved by the data."""
    index = np.searchsorted(np.asarray(edges), weeks, side="right") - 1
    return np.where((weeks >= edges[0]) & (weeks < edges[-1]), index, -1)


@dataclass(frozen=True)
class CellInputs:
    """One cell's inputs after clipping and the per-baby cap: one summary per baby, with its family and its number of
    values after capping. Study-only: the real job keeps this in memory for the run and writes none of it."""

    babies: np.ndarray
    families: np.ndarray
    summaries: np.ndarray
    """Quantiles: the baby's own median (1-D). Shares: the baby's own share of each cause (2-D)."""
    values: np.ndarray


def cell_inputs(statistic: Statistic, observations: Observations, cohort: CommunityCohort, edges: tuple[int, ...], cap: int = CAP_DAYS) -> dict[tuple[int, int], CellInputs]:
    """Clip, band, cap each baby at ``cap`` days per cell (keyed hash of baby id and day) and summarise per baby."""
    band = band_index(observations.week, edges)
    keep = band >= 0
    if not keep.any():
        return {}
    dims = len(statistic.dimensions)
    baby = observations.baby[keep]
    day = observations.day[keep]
    cell = band[keep] * dims + observations.dimension[keep]
    value = np.clip(observations.value[keep], *statistic.clip)
    group = baby.astype(np.int64) * 4096 + cell
    day_key = group * 4096 + day
    unique_days, first = np.unique(day_key, return_index=True)
    day_group = unique_days // 4096
    hashed = keyed_hash(HASH_KEY, cohort.baby_id[baby[first]], day[first])
    order = np.lexsort((hashed, day_group))
    sorted_group = day_group[order]
    starts = np.flatnonzero(np.r_[True, sorted_group[1:] != sorted_group[:-1]])
    rank = np.arange(len(order)) - np.repeat(starts, np.diff(np.r_[starts, len(order)]))
    kept_days = unique_days[order[rank < cap]]
    capped = np.isin(day_key, kept_days)
    frame = pd.DataFrame({"cell": cell[capped], "baby": baby[capped], "value": value[capped]})
    out: dict[tuple[int, int], CellInputs] = {}
    if statistic.kind == "quantiles":
        grouped = frame.groupby(["cell", "baby"], sort=True)["value"].agg(["median", "size"]).reset_index()
        summary_columns = ["median"]
    else:
        counts = pd.crosstab([frame["cell"], frame["baby"]], frame["value"].astype(int))
        counts = counts.reindex(columns=range(len(CRY_CAUSES)), fill_value=0)
        sizes = counts.sum(axis=1)
        grouped = (counts.div(sizes, axis=0)).reset_index()
        grouped["size"] = sizes.to_numpy()
        summary_columns = list(range(len(CRY_CAUSES)))
    for cell_id, rows in grouped.groupby("cell", sort=True):
        babies = rows["baby"].to_numpy()
        summaries = rows[summary_columns].to_numpy(dtype=float)
        out[(int(cell_id) // dims, int(cell_id) % dims)] = CellInputs(
            babies, cohort.family[babies], summaries[:, 0] if statistic.kind == "quantiles" else summaries, rows["size"].to_numpy()
        )
    return out


def babies_bucket(n: int) -> str:
    return "100+" if n >= 100 else "50-99" if n >= 50 else "20-49"


def dp_quantiles(values: np.ndarray, levels: tuple[int, ...], epsilon: float, clip: tuple[float, float], step: float, rng: np.random.Generator) -> np.ndarray:
    """One exponential-mechanism draw per percentile over the fixed grid clip[0]..clip[1] (utility minus the rank
    distance, sensitivity 1 per baby), epsilon split evenly over the percentiles; sorted afterwards (post-processing)."""
    grid = np.arange(clip[0], clip[1] + step / 2, step)
    ordered = np.sort(values)
    below = np.searchsorted(ordered, grid, side="left")
    eps = epsilon / len(levels)
    picks = []
    for level in levels:
        utility = -np.abs(below - level / 100 * len(ordered))
        picks.append(grid[int(np.argmax(eps * utility / 2 + rng.gumbel(size=len(grid))))])
    return np.sort(np.asarray(picks))


def cell_outputs(statistic: Statistic, inputs: CellInputs, epsilon: float | None, rng: np.random.Generator) -> dict[str, float]:
    """The published numbers of one cell: exact when ``epsilon`` is None, else noisy."""
    n = len(inputs.babies)
    if statistic.kind == "shares":
        shares = inputs.summaries.mean(axis=0)
        if epsilon is not None:
            # Replacing one baby moves the mean of share vectors by at most 2/n in L1.
            shares = np.clip(shares + rng.laplace(0, 2 / (n * epsilon), len(shares)), 0, None)
            shares = shares / shares.sum() if shares.sum() > 0 else np.full(len(shares), 1 / len(shares))
        return {cause: float(share) for cause, share in zip(CRY_CAUSES, shares)}
    levels = WIDE_LEVELS if n >= WIDE_PERCENTILES_FROM else LEVELS
    if epsilon is None:
        numbers = np.percentile(inputs.summaries, levels)
    else:
        numbers = dp_quantiles(inputs.summaries, levels, epsilon, statistic.clip, statistic.step, rng)
    return {f"p{level}": float(number) for level, number in zip(levels, numbers)}


def admit(inputs: CellInputs, k: int, was_published: bool, hysteresis: int = HYSTERESIS, dominance: float = DOMINANCE) -> str | None:
    """None when the cell may be published, else the suppression reason."""
    threshold = hysteresis if was_published else k
    if len(np.unique(inputs.babies)) < threshold or len(np.unique(inputs.families)) < threshold:
        return "below_k"
    per_family = pd.Series(inputs.values).groupby(inputs.families).sum()
    if per_family.max() > dominance * inputs.values.sum():
        return "dominance"
    return None


@dataclass(frozen=True)
class PublishedCell:
    statistic: str
    grid: str
    from_weeks: int
    to_weeks: int
    dimension: str
    outputs: dict[str, float]
    babies: str
    n_babies: int
    """Study-only (the file publishes ``babies`` as a bucket)."""
    n_families: int
    members: frozenset[int]
    """Study-only: baby indices in the cell, used by the tests and the membership game; never written out."""


CellKey = tuple[str, int, int, str]
"""(grid, from weeks, to weeks, dimension)."""


@dataclass(frozen=True)
class Release:
    statistic: str
    cells: dict[CellKey, PublishedCell]
    suppressed: dict[CellKey, str] = field(default_factory=dict)

    def published_keys(self) -> frozenset[CellKey]:
        return frozenset(self.cells)

    def source(self, start: int, end: int, dimension: str) -> PublishedCell | None:
        """The cell the app would use for a fine band: the fine cell, else the coarse cell that holds it."""
        cell = self.cells.get(("fine", start, end, dimension))
        if cell is not None:
            return cell
        for (grid, a, b, dim), coarse in self.cells.items():
            if grid == "coarse" and dim == dimension and a <= start and end <= b:
                return coarse
        return None


def release(
    statistic: Statistic,
    cohort: CommunityCohort,
    included: np.ndarray,
    k: int = K,
    epsilon: float | None = None,
    rng: np.random.Generator | None = None,
    previous: frozenset[CellKey] = frozenset(),
) -> Release:
    """One run of the job for one statistic over the babies in ``included`` (opted in, not withdrawn)."""
    rng = rng if rng is not None else np.random.default_rng(0)
    observations = cohort.observations[statistic.key]
    observations = observations.take(included[observations.baby])
    cells: dict[CellKey, PublishedCell] = {}
    suppressed: dict[CellKey, str] = {}
    grids = [("fine", statistic.fine_edges)] + ([("coarse", statistic.coarse_edges)] if statistic.coarse_edges else [])
    for grid, edges in grids:
        inputs = cell_inputs(statistic, observations, cohort, edges)
        for band in range(len(edges) - 1):
            start, end = edges[band], edges[band + 1]
            for dim, dimension in enumerate(statistic.dimensions):
                key = (grid, start, end, dimension)
                if grid == "coarse":
                    fine_inside = [(a, b) for a, b in zip(statistic.fine_edges, statistic.fine_edges[1:]) if start <= a and b <= end]
                    if all(("fine", a, b, dimension) in cells for a, b in fine_inside):
                        continue  # nothing to fall back for
                cell = inputs.get((band, dim))
                if cell is None:
                    suppressed[key] = "below_k"
                    continue
                reason = admit(cell, k, key in previous)
                if reason is not None:
                    suppressed[key] = reason
                    continue
                n = len(cell.babies)
                cells[key] = PublishedCell(
                    statistic.key, grid, start, end, dimension, cell_outputs(statistic, cell, epsilon, rng), babies_bucket(n), n,
                    len(np.unique(cell.families)), frozenset(int(b) for b in cell.babies),
                )
    return Release(statistic.key, cells, suppressed)


# ---------------------------------------------------------------------------------------------------------------
# Evaluation (design 34 section 9 item 1).


def _bootstrap(per_baby: list[np.ndarray], statistic: Callable[[list[np.ndarray]], float], resamples: int, rng: np.random.Generator) -> list[float] | None:
    if len(per_baby) < 2 or resamples <= 0:
        return None
    draws = []
    for _ in range(resamples):
        chosen = [per_baby[i] for i in rng.integers(0, len(per_baby), len(per_baby))]
        draws.append(statistic(chosen))
    low, high = np.nanpercentile(draws, [2.5, 97.5])
    return [float(low), float(high)]


def _fine_bands(statistic: Statistic) -> list[tuple[int, int, int]]:
    edges = statistic.fine_edges
    return [(a, b, d) for a, b in zip(edges, edges[1:]) for d in range(len(statistic.dimensions))]


def coverage(statistic: Statistic, published: Release) -> dict:
    bands = _fine_bands(statistic)
    fine = sum(1 for a, b, d in bands if ("fine", a, b, statistic.dimensions[d]) in published.cells)
    any_source = sum(1 for a, b, d in bands if published.source(a, b, statistic.dimensions[d]) is not None)
    reasons = pd.Series([reason for key, reason in published.suppressed.items() if key[0] == "fine"]).value_counts().to_dict()
    return {"bands": len(bands), "fine": fine / len(bands), "covered": any_source / len(bands), "fine_suppressed": {str(k): int(v) for k, v in reasons.items()}}


def errors(statistic: Statistic, published: Release, priors: dict) -> dict:
    """Mean absolute error of the pooled median (shares: of the cause shares, in points) against the generator truth on
    every covered fine band, and of pooled vs prior on the covered bands that have a usable prior."""
    pooled, with_prior_pooled, with_prior_norm = [], [], []
    for a, b, d in _fine_bands(statistic):
        source = published.source(a, b, statistic.dimensions[d])
        if source is None:
            continue
        if statistic.kind == "shares":
            band = CRY_BAND_EDGES.index(a)
            truth = cry_truth(band, d)
            got = np.array([source.outputs[c] for c in CRY_CAUSES])
            pooled.append(float(np.mean(np.abs(got - truth))) * 100)
            with_prior_pooled.append(pooled[-1])
            with_prior_norm.append(float(np.mean(np.abs(np.full(len(truth), 1 / len(truth)) - truth))) * 100)
            continue
        truth = statistic.truth(a, b, d)
        pooled.append(abs(source.outputs["p50"] - truth))
        prior = prior_for(priors, statistic.key, d, a, b)
        if prior is not None:
            with_prior_pooled.append(pooled[-1])
            with_prior_norm.append(abs(prior - truth))
    mean = lambda values: float(np.mean(values)) if values else None  # noqa: E731
    return {"cells": len(pooled), "pooled": mean(pooled), "prior_cells": len(with_prior_norm), "pooled_on_prior_cells": mean(with_prior_pooled), "prior": mean(with_prior_norm)}


def calibration(statistic: Statistic, published: Release, cohort: CommunityCohort, held_out: np.ndarray, resamples: int, rng: np.random.Generator) -> dict:
    """Share of held-out babies' own medians (same cap and clipping) inside the published p10-p90 of their band."""
    if statistic.kind != "quantiles":
        return {"share": None, "ci95": None, "babies": 0}
    observations = cohort.observations[statistic.key]
    inputs = cell_inputs(statistic, observations.take(held_out[observations.baby]), cohort, statistic.fine_edges)
    hits: dict[int, list[float]] = {}
    for (band, dim), cell in inputs.items():
        a, b = statistic.fine_edges[band], statistic.fine_edges[band + 1]
        source = published.source(a, b, statistic.dimensions[dim])
        if source is None:
            continue
        inside = (cell.summaries >= source.outputs["p10"]) & (cell.summaries <= source.outputs["p90"])
        for baby, hit in zip(cell.babies, inside):
            hits.setdefault(int(baby), []).append(float(hit))
    per_baby = [np.asarray(v) for v in hits.values()]
    if not per_baby:
        return {"share": None, "ci95": None, "babies": 0}
    share = lambda chosen: float(np.concatenate(chosen).mean()) * 100  # noqa: E731
    return {"share": share(per_baby), "ci95": _bootstrap(per_baby, share, resamples, rng), "babies": len(per_baby)}


def cold_start(statistic: Statistic, published: Release, cohort: CommunityCohort, held_out: np.ndarray, priors: dict, resamples: int, rng: np.random.Generator) -> dict:
    """MAE of the pooled median vs the published-norms prior as the prediction of each value (clipped) in the first
    14 days of every held-out baby, on bands with both; delta = pooled - prior, 95 % bootstrap CI over babies."""
    if statistic.kind != "quantiles":
        return {"points": 0}
    observations = cohort.observations[statistic.key]
    rows = observations.take(held_out[observations.baby])
    first_day = pd.Series(rows.day).groupby(rows.baby).transform("min").to_numpy() if len(rows.baby) else np.array([])
    rows = rows.take(rows.day - first_day < COLD_START_DAYS) if len(rows.baby) else rows
    band = band_index(rows.week, statistic.fine_edges)
    pooled_prediction = np.full(len(band), np.nan)
    prior_prediction = np.full(len(band), np.nan)
    for b in range(len(statistic.fine_edges) - 1):
        a, z = statistic.fine_edges[b], statistic.fine_edges[b + 1]
        for d, dimension in enumerate(statistic.dimensions):
            source = published.source(a, z, dimension)
            prior = prior_for(priors, statistic.key, d, a, z)
            if source is None or prior is None:
                continue
            mask = (band == b) & (rows.dimension == d)
            pooled_prediction[mask] = source.outputs["p50"]
            prior_prediction[mask] = prior
    usable = ~np.isnan(pooled_prediction) & ~np.isnan(prior_prediction)
    if not usable.any():
        return {"points": 0}
    value = np.clip(rows.value[usable], *statistic.clip)
    frame = pd.DataFrame({"baby": rows.baby[usable], "pooled": np.abs(pooled_prediction[usable] - value), "prior": np.abs(prior_prediction[usable] - value)})
    per_baby = [group[["pooled", "prior"]].to_numpy() for _, group in frame.groupby("baby")]
    delta = lambda chosen: float(np.concatenate(chosen)[:, 0].mean() - np.concatenate(chosen)[:, 1].mean())  # noqa: E731
    return {
        "points": int(usable.sum()), "babies": len(per_baby), "pooled_mae": float(frame["pooled"].mean()), "prior_mae": float(frame["prior"].mean()),
        "delta": delta(per_baby), "ci95": _bootstrap(per_baby, delta, resamples, rng),
    }


def _single_cell_release(statistic: Statistic, inputs: CellInputs, k: int, epsilon: float | None, was_published: bool, rng: np.random.Generator) -> dict[str, float] | None:
    if admit(inputs, k, was_published) is not None:
        return None
    return cell_outputs(statistic, inputs, epsilon, rng)


def _subset(inputs: CellInputs, mask: np.ndarray) -> CellInputs:
    return CellInputs(inputs.babies[mask], inputs.families[mask], inputs.summaries[mask], inputs.values[mask])


def _join(a: CellInputs, b: CellInputs) -> CellInputs:
    return CellInputs(*(np.concatenate([x, y]) for x, y in zip((a.babies, a.families, a.summaries, a.values), (b.babies, b.families, b.summaries, b.values))))


def _vector(statistic: Statistic, outputs: dict[str, float] | None) -> np.ndarray | None:
    if outputs is None:
        return None
    keys = CRY_CAUSES if statistic.kind == "shares" else [f"p{level}" for level in LEVELS]
    return np.array([outputs[key] for key in keys])


def _advantage(scores_member: np.ndarray, scores_other: np.ndarray, resamples: int, rng: np.random.Generator) -> dict:
    """Membership advantage TPR - FPR at the best threshold, the threshold picked on the first half of the trials and
    scored on the second half (no optimism from choosing it on the same trials); CI by bootstrap over the second half."""
    half_m, half_o = len(scores_member) // 2, len(scores_other) // 2
    fit_m, test_m = scores_member[:half_m], scores_member[half_m:]
    fit_o, test_o = scores_other[:half_o], scores_other[half_o:]
    candidates = np.unique(np.concatenate([fit_m, fit_o]))
    gains = [np.mean(fit_m >= t) - np.mean(fit_o >= t) for t in candidates]
    threshold = candidates[int(np.argmax(gains))]
    value = lambda m, o: float(np.mean(m >= threshold) - np.mean(o >= threshold))  # noqa: E731
    draws = [value(rng.choice(test_m, len(test_m)), rng.choice(test_o, len(test_o))) for _ in range(resamples)]
    return {"advantage": value(test_m, test_o), "ci95": [float(x) for x in np.percentile(draws, [2.5, 97.5])]}


def membership(statistic: Statistic, published: Release, cohort: CommunityCohort, included: np.ndarray, held_out: np.ndarray, k: int, epsilon: float | None, trials: int, resamples: int, rng: np.random.Generator) -> dict:
    """Two games on the smallest published fine cell (the riskiest), against one target family drawn at random.

    ``single``: the attacker knows the target family's own values and sees one release; in one world the family is in
    the cell, in the other it is replaced by a family that did not opt in (the attacker knows neither). Score: closeness
    of the released median (shares: the family's share vector) to the family's values.
    ``withdrawal``: two consecutive releases; between them the family withdrew or not, everything else equal (the
    differencing case of design 34 section 8). Score: how much the release moved (a suppressed second release counts as
    the largest move)."""
    fine = [cell for (grid, *_), cell in published.cells.items() if grid == "fine"]
    if not fine:
        return {}
    target = min(fine, key=lambda cell: (cell.n_babies, cell.from_weeks, cell.dimension))
    observations = cohort.observations[statistic.key]
    band = statistic.fine_edges.index(target.from_weeks)
    dim = statistic.dimensions.index(target.dimension)
    members = cell_inputs(statistic, observations.take(included[observations.baby]), cohort, statistic.fine_edges).get((band, dim))
    others = cell_inputs(statistic, observations.take(held_out[observations.baby]), cohort, statistic.fine_edges).get((band, dim))
    families = np.unique(members.families)
    other_families = np.unique(others.families) if others is not None else np.array([], dtype=np.int64)
    single_in, single_out, stayed, withdrew = [], [], [], []
    for trial in range(trials):
        family = families[rng.integers(0, len(families))]
        target_values = members.summaries[members.families == family]
        without = _subset(members, members.families != family)
        reference = target_values.mean(axis=0)
        # single release
        member_world = trial % 2 == 0
        if member_world:
            cell = members
        elif len(other_families):
            replacement = other_families[rng.integers(0, len(other_families))]
            cell = _join(without, _subset(others, others.families == replacement))
        else:
            cell = without
        released = _vector(statistic, _single_cell_release(statistic, cell, k, epsilon, False, rng))
        if released is None:
            score = -math.inf
        elif statistic.kind == "shares":
            score = -float(np.abs(released - reference).sum())
        else:
            score = -abs(float(released[2]) - float(reference))
        (single_in if member_world else single_out).append(score)
        # withdrawal between two releases
        first = _vector(statistic, _single_cell_release(statistic, members, k, epsilon, False, rng))
        second = _vector(statistic, _single_cell_release(statistic, without if member_world else members, k, epsilon, True, rng))
        move = math.inf if second is None or first is None else float(np.abs(second - first).sum())
        (withdrew if member_world else stayed).append(move)
    return {
        "cell": {"from_weeks": target.from_weeks, "to_weeks": target.to_weeks, "dimension": target.dimension, "babies": target.babies},
        "single": _advantage(np.asarray(single_in), np.asarray(single_out), resamples, rng),
        "withdrawal": _advantage(np.asarray(withdrew), np.asarray(stayed), resamples, rng),
    }


SIZES = (100, 1000, 10000)
RATES = (0.05, 0.2, 0.5)


def evaluate(size: int, rate: float, k: int, epsilon: float | None, seed: int, resamples: int, trials: int, priors: dict) -> dict:
    cohort = community_cohort(size, seed)
    opt_rng = np.random.default_rng([seed, size, int(rate * 1000), 1])
    opted_family = opt_rng.random(cohort.family.max() + 1) < rate
    included = opted_family[cohort.family]
    held_out = ~included
    out: dict = {"size": size, "rate": rate, "opted_in_babies": int(included.sum()), "opted_in_families": int(opted_family[np.unique(cohort.family)].sum()), "statistics": {}}
    for index, statistic in enumerate(CATALOG.values()):
        rng = np.random.default_rng([seed, size, int(rate * 1000), index, 2])
        noisy = release(statistic, cohort, included, k, epsilon, rng)
        exact = release(statistic, cohort, included, k, None, rng)
        out["statistics"][statistic.key] = {
            "coverage": coverage(statistic, noisy),
            "error": errors(statistic, noisy, priors),
            "error_exact": errors(statistic, exact, priors),
            "cold_start": cold_start(statistic, noisy, cohort, held_out, priors, resamples, rng),
            "cold_start_exact": cold_start(statistic, exact, cohort, held_out, priors, resamples, rng),
            "calibration": calibration(statistic, noisy, cohort, held_out, resamples, rng),
            "calibration_exact": calibration(statistic, exact, cohort, held_out, resamples, rng),
            "membership_noise": membership(statistic, exact, cohort, included, held_out, k, epsilon, trials, resamples, rng) if epsilon else {},
            "membership_exact": membership(statistic, exact, cohort, included, held_out, k, None, trials, resamples, rng),
        }
    return out


# ---------------------------------------------------------------------------------------------------------------
# Report


def _num(value, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def _ci(ci, digits: int = 1) -> str:
    return "" if not ci else f" ({ci[0]:+.{digits}f}..{ci[1]:+.{digits}f})"


def _pct_ci(ci) -> str:
    return "" if not ci else f" ({ci[0]:.0f}-{ci[1]:.0f})"


def _adv(entry: dict) -> str:
    if not entry:
        return "n/a"
    return f"{entry['advantage']:.2f} ({entry['ci95'][0]:.2f}..{entry['ci95'][1]:.2f})"


UNITS = {"bottle_ml_per_feed": "ml", "tummy_minutes_per_day": "min", "night_sleep_minutes": "min", "naps_per_day": "naps", "cry_outcome_by_cause": "points"}


def markdown(report: dict) -> str:
    params = report["parameters"]
    eps = params["epsilon"]
    lines = [
        "# Community insights: synthetic study",
        "",
        f"k = {params['k']} babies and families, hysteresis {HYSTERESIS}, dominance {DOMINANCE:.0%}, cap {CAP_DAYS} days per baby and cell, "
        f"epsilon = {eps if eps else 'off'} per statistic per release, seed {params['seed']}, {params['resamples']} bootstrap draws, "
        f"{params['trials']} membership trials per game. Synthetic data only; it cannot prove a real-world gain.",
        "",
    ]
    for key in CATALOG:
        unit = UNITS[key]
        what = "p50 error" if CATALOG[key].kind == "quantiles" else "share error"
        lines += [f"## {key}", "", "### Coverage and error", "",
                  f"| Babies | Opt-in | Opted-in babies | Fine bands published | Covered (fine or coarse) | Suppressed fine (reasons) | Pooled {what}, noise ({unit}) | Pooled {what}, exact ({unit}) | Bands with a prior | Pooled error there, noise | Pooled error there, exact | Prior error there |",
                  "|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|"]
        for combo in report["results"]:
            s = combo["statistics"][key]
            c, e, x = s["coverage"], s["error"], s["error_exact"]
            reasons = ", ".join(f"{name} {count}" for name, count in sorted(c["fine_suppressed"].items())) or "none"
            lines.append(
                f"| {combo['size']} | {combo['rate']:.0%} | {combo['opted_in_babies']} | {c['fine']:.0%} | {c['covered']:.0%} | {reasons} | "
                f"{_num(e['pooled'])} | {_num(x['pooled'])} | {e['prior_cells']} | {_num(e['pooled_on_prior_cells'])} | {_num(x['pooled_on_prior_cells'])} | {_num(e['prior'])} |"
            )
        if CATALOG[key].kind == "quantiles":
            lines += ["", "### Cold start and calibration", "",
                      f"| Babies | Opt-in | Cold-start points | Prior MAE ({unit}) | Pooled MAE, noise ({unit}) | Δ pooled − prior, noise (95 % CI) | Pooled MAE, exact ({unit}) | Δ pooled − prior, exact (95 % CI) | Calibration p10-p90, noise (%, CI) | Calibration, exact (%, CI) |",
                      "|---:|---:|---:|---:|---:|---|---:|---|---|---|"]
            for combo in report["results"]:
                s = combo["statistics"][key]
                cs, csx, cal, calx = s["cold_start"], s["cold_start_exact"], s["calibration"], s["calibration_exact"]
                lines.append(
                    f"| {combo['size']} | {combo['rate']:.0%} | {cs.get('points', 0)} | {_num(cs.get('prior_mae'))} | {_num(cs.get('pooled_mae'))} | "
                    f"{_num(cs.get('delta'))}{_ci(cs.get('ci95'))} | {_num(csx.get('pooled_mae'))} | {_num(csx.get('delta'))}{_ci(csx.get('ci95'))} | "
                    f"{_num(cal['share'], 0)}{_pct_ci(cal['ci95'])} | {_num(calx['share'], 0)}{_pct_ci(calx['ci95'])} |"
                )
        lines += ["", "### Membership inference (smallest published fine cell)", "",
                  "| Babies | Opt-in | Cell (weeks, dimension, babies) | Single release, exact | Single release, noise | Withdrawal, exact | Withdrawal, noise |",
                  "|---:|---:|---|---|---|---|---|"]
        for combo in report["results"]:
            s = combo["statistics"][key]
            mx, mn = s["membership_exact"], s["membership_noise"]
            if not mx:
                lines.append(f"| {combo['size']} | {combo['rate']:.0%} | no published cell | n/a | n/a | n/a | n/a |")
                continue
            cell = mx["cell"]
            lines.append(
                f"| {combo['size']} | {combo['rate']:.0%} | {cell['from_weeks']}-{cell['to_weeks']}, {cell['dimension']}, {cell['babies']} | "
                f"{_adv(mx['single'])} | {_adv(mn.get('single', {}))} | {_adv(mx['withdrawal'])} | {_adv(mn.get('withdrawal', {}))} |"
            )
        lines.append("")
    sweep = report.get("sweep")
    if sweep:
        labels = list(next(iter(sweep["statistics"].values())).keys())
        lines += [f"## Epsilon sweep ({sweep['size']} babies, {sweep['rate']:.0%} opt-in)", "",
                  "Pooled median error (shares: share error in points) / calibration p10-p90 (%), per epsilon per statistic per release.", "",
                  "| Statistic | " + " | ".join(labels) + " |", "|---|" + "---|" * len(labels)]
        for key, rows in sweep["statistics"].items():
            cells = [f"{_num(rows[label]['error'])} / {_num(rows[label]['calibration'], 0)}" for label in labels]
            lines.append(f"| {key} ({UNITS[key]}) | " + " | ".join(cells) + " |")
        lines.append("")
    lines.append(f"Runtime: {report['runtime_seconds']:.0f} s.")
    return "\n".join(lines) + "\n"


SWEEP_EPSILONS = (0.2, 0.5, 1.0, 2.0, 5.0, 10.0)


def epsilon_sweep(size: int, rate: float, k: int, epsilons: tuple[float, ...], seed: int, priors: dict) -> dict:
    """Pooled median error and calibration at several epsilons on one instance (same babies, same opt-in): the noise
    measured against the band spread before epsilon is chosen (design 34 section 5, "Noise")."""
    cohort = community_cohort(size, seed)
    opted_family = np.random.default_rng([seed, size, int(rate * 1000), 1]).random(cohort.family.max() + 1) < rate
    included = opted_family[cohort.family]
    out: dict = {"size": size, "rate": rate, "statistics": {}}
    for index, statistic in enumerate(CATALOG.values()):
        rows = {}
        for epsilon in (None, *epsilons):
            rng = np.random.default_rng([seed, size, index, 3])
            published = release(statistic, cohort, included, k, epsilon, rng)
            rows["exact" if epsilon is None else str(epsilon)] = {
                "error": errors(statistic, published, priors)["pooled"],
                "calibration": calibration(statistic, published, cohort, ~included, 0, rng)["share"],
            }
        out["statistics"][statistic.key] = rows
    return out


def run(k: int, epsilon: float | None, seed: int, resamples: int, trials: int, sizes=SIZES, rates=RATES, sweep: tuple[int, float] | None = (10000, 0.2)) -> dict:
    started = time.perf_counter()
    priors = load_priors()
    results = [evaluate(size, rate, k, epsilon, seed, resamples, trials, priors) for size in sizes for rate in rates]
    return {
        "parameters": {"k": k, "epsilon": epsilon, "seed": seed, "resamples": resamples, "trials": trials, "hysteresis": HYSTERESIS, "dominance": DOMINANCE, "cap_days": CAP_DAYS},
        "results": results,
        "sweep": epsilon_sweep(sweep[0], sweep[1], k, SWEEP_EPSILONS, seed, priors) if sweep else None,
        "runtime_seconds": time.perf_counter() - started,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--k", type=int, default=K)
    parser.add_argument("--epsilon", type=float, default=0.2, help="per statistic per release; 0 turns the noise off")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--resamples", type=int, default=1000)
    parser.add_argument("--trials", type=int, default=2000, help="membership trials per game (half per world)")
    parser.add_argument("--sizes", default=",".join(map(str, SIZES)))
    parser.add_argument("--rates", default=",".join(map(str, RATES)))
    parser.add_argument("--out", default="out")
    args = parser.parse_args(argv)
    report = run(
        args.k, args.epsilon or None, args.seed, args.resamples, args.trials,
        tuple(int(x) for x in args.sizes.split(",")), tuple(float(x) for x in args.rates.split(",")),
    )
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "community.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    text = markdown(report)
    (out / "community.md").write_text(text, encoding="utf-8")
    print(f"wrote {out / 'community.md'} and {out / 'community.json'} in {report['runtime_seconds']:.0f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
