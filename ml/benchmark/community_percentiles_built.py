"""The percentile configuration the API builds, measured as built (owner decisions of 2026-11-27).

Follow-up of ``benchmark/community_percentiles.py`` (option A of the 2026-11-26 study): the owner chose option A with a
bound, and the coordinator fixed the remaining defaults. The API's pure core (``CommunityHistogramMechanism`` and
``CommunityStatisticsAggregator`` in code/api/src/Lotties.Domain/CommunityInsights) differs from what the study measured,
so this module measures exactly the built configuration:

- **Window**: a release reads only the last complete calendar quarter (here 91 days); each synthetic baby's history is
  placed at a random calendar position overlapping it, so babies are "babies logging in that quarter".
- **4-week age bands** from week 0 to 104, no coarse fallback; bottles: formula only (breast milk not studied).
- Clipping and per-baby cap as before (14 days per baby and band, keyed hash of baby id and day), then **at most 4 cells
  per baby** per statistic: a baby in more bands keeps the 4 with the most capped days (ties by a keyed hash of her id
  and the band), decided from her own data only, before any k or dominance decision.
- One summary per baby and cell (her median), a uniform half-step jitter, clipping to the metric's range, the study's
  fixed bins (offset by half a step), **Laplace noise of scale 1/2 on every bin, snapped** (Mironov: input clamped to
  +-2^20, rounded to the smallest power of two at least the scale, clamped again), the isotonic CDF read-out of
  **p25, p50 and p75 only**, rounded to the published step; **a cell whose noisy total is 0 or less publishes nothing**.
- Epsilon 2 per cell and release, at most 4 cells per baby: at most 8 per baby per statistic per release.

It reports the error for cells of 20, 30, 50 and 100 babies (against the band's truth under the same pipeline), next to
the study's configuration (plain Laplace, whole history, no bound) on the same 4-week bands; the exact DP check of the
snapped bin; the strongest attacker's advantage on one published percentile; cells per baby; and how many babies
logging in a quarter a 4-week band needs to reach 20 babies from 20 families. It also writes the vectors the C# tests
cross-check (``ml/tests/community_histogram_vectors.json``).

``python -m benchmark.community_percentiles_built --seed 1 --out out`` writes ``out/percentiles_built.md`` and
``out/percentiles_built.json``. Synthetic data only.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from . import community
from .community_percentiles import METRICS, Metric, histogram_counts, histogram_edges, isotonic_increasing, population
from .synthetic import MAX_WEEK, CommunityCohort, Observations

BAND_EDGES = tuple(range(0, MAX_WEEK + 1, 4))
"""4-week bands from week 0 to 104 (26 bands), the only grid of the percentile statistics (no coarse fallback)."""
QUARTER_DAYS = 91
MAX_CELLS = 4
EPSILON_PER_CELL = 2.0
LEVELS = (25, 50, 75)
SNAP_BOUND = float(2**20)
CELL_SIZES = (20, 30, 50, 100)
CELL_BANDS = ((0, 4), (4, 8), (8, 12), (16, 20), (24, 28), (36, 40), (60, 64), (88, 92))
"""4-week bands of the cell study, spread like the 2026-11-26 study's bands (first weeks to the second year)."""
PRIVACY_BANDS = {"bottle_ml_per_feed": (8, 12), "night_sleep_minutes": (36, 40), "naps_per_day": (24, 28), "day_sleep_minutes": (36, 40)}
INSTANCE_SIZES = (100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000)
CELL_KEY = community.HASH_KEY ^ 0x5EED
"""Key of the per-baby rank of her cells (the API uses HMAC-SHA256 with its secret key; any keyed rank works here)."""
FORMULA = 0
VECTORS = Path(__file__).resolve().parents[1] / "tests" / "community_histogram_vectors.json"


# ---------------------------------------------------------------------------------------------------------------
# The mechanism as built.


def snap_grid(scale: float) -> float:
    """The smallest power of two at least ``scale`` (exact)."""
    mantissa, exponent = math.frexp(scale)
    return math.ldexp(1.0, exponent - 1) if mantissa == 0.5 else math.ldexp(1.0, exponent)


def snapped(values: np.ndarray, scale: float, noise: np.ndarray) -> np.ndarray:
    """Mironov's snapping mechanism with the given Laplace draws: clamp, add, round to the grid (half to even), clamp."""
    grid = snap_grid(scale)
    noisy = np.clip(values, -SNAP_BOUND, SNAP_BOUND) + noise
    return np.clip(np.round(noisy / grid) * grid, -SNAP_BOUND, SNAP_BOUND)


def readout(counts: np.ndarray, edges: np.ndarray, metric: Metric) -> np.ndarray | None:
    """p25, p50 and p75 from (noisy) bin counts: isotonic cumulative counts, clipped at 0, interpolated inside the bin,
    clipped to the metric's range and rounded to its step; None when the noisy total is 0 or less (nothing published)."""
    cdf = np.clip(isotonic_increasing(np.cumsum(counts)), 0, None)
    total = cdf[-1]
    if total <= 0:
        return None
    cdf = np.concatenate([[0.0], cdf])
    out = []
    for level in LEVELS:
        target = level / 100 * total
        j = int(np.clip(np.searchsorted(cdf, target, side="left"), 1, len(edges) - 1))
        low, high = cdf[j - 1], cdf[j]
        fraction = 0.5 if high <= low else (target - low) / (high - low)
        out.append(edges[j - 1] + fraction * (edges[j] - edges[j - 1]))
    return np.round(np.clip(np.asarray(out), *metric.clip) / metric.step) * metric.step


def built_release(metric: Metric, summaries: np.ndarray, rng: np.random.Generator, epsilon: float = EPSILON_PER_CELL) -> np.ndarray | None:
    """One cell's published p25, p50, p75 (or None): jitter, clip, fixed bins, snapped Laplace(1 / epsilon) per bin."""
    low, high = metric.clip
    edges = histogram_edges(metric, low, high)
    values = np.clip(summaries + rng.uniform(-metric.step / 2, metric.step / 2, len(summaries)), low, high)
    counts = histogram_counts(values, edges)
    scale = 1 / epsilon
    return readout(snapped(counts, scale, rng.laplace(0, scale, len(counts))), edges, metric)


def study_release(metric: Metric, summaries: np.ndarray, rng: np.random.Generator, epsilon: float = EPSILON_PER_CELL) -> np.ndarray | None:
    """The 2026-11-26 study's hist mechanism (plain Laplace, no snapping), read the same way, for a like-for-like row."""
    low, high = metric.clip
    edges = histogram_edges(metric, low, high)
    values = np.clip(summaries + rng.uniform(-metric.step / 2, metric.step / 2, len(summaries)), low, high)
    counts = histogram_counts(values, edges) + rng.laplace(0, 1 / epsilon, len(edges) - 1)
    return readout(counts, edges, metric)


def snapped_pmf(count: float, scale: float, support: np.ndarray) -> np.ndarray:
    """Exact probability of each snapped output on ``support`` (grid points) for an exact bin count: the Laplace mass of
    the rounding interval around the point (the clamp at 2^20 never binds for these counts)."""
    grid = snap_grid(scale)
    low = (support - grid / 2 - count) / scale
    high = (support + grid / 2 - count) / scale
    # Stable in both tails: the mass of [low, high] of a standard Laplace, without subtracting numbers close to 1.
    upper = 0.5 * (np.exp(-np.maximum(low, 0)) - np.exp(-np.maximum(high, 0)))
    lower = 0.5 * (np.exp(np.minimum(high, 0)) - np.exp(np.minimum(low, 0)))
    return np.where(low >= 0, upper, np.where(high <= 0, lower, upper + lower))


# ---------------------------------------------------------------------------------------------------------------
# The pipeline as built: window, bands, cap, at most 4 cells per baby, one median per baby and cell.


def windowed(cohort: CommunityCohort, observations: dict[str, Observations], seed: int) -> dict[str, Observations]:
    """Each baby's history placed at a random calendar day so that it overlaps the quarter [0, 91); only the days inside
    it are kept, with their calendar day (the cap's keyed hash reads it, like the API's local day)."""
    rng = np.random.default_rng([seed, cohort.size, 34, 11])
    last = np.zeros(cohort.size, np.int64)
    night = observations["night_sleep_minutes"]
    np.maximum.at(last, night.baby, night.day)
    start = rng.integers(-last, QUARTER_DAYS)
    out = {}
    for key, obs in observations.items():
        calendar = start[obs.baby] + obs.day
        keep = (calendar >= 0) & (calendar < QUARTER_DAYS)
        out[key] = Observations(obs.baby[keep], calendar[keep], obs.week[keep], obs.value[keep], obs.dimension[keep])
    return out


@dataclass(frozen=True)
class BuiltCell:
    babies: np.ndarray
    families: np.ndarray
    summaries: np.ndarray


def built_cells(metric: Metric, cohort: CommunityCohort, obs: Observations, bound: int | None = MAX_CELLS, edges: tuple[int, ...] = BAND_EDGES) -> dict[tuple[int, int], BuiltCell]:
    """Clip, band, cap each baby at 14 days per band (keyed hash of baby id and day), keep at most ``bound`` bands per
    baby (most capped days, then a keyed rank; her own data only) and take her median per band."""
    if metric.key == "bottle_ml_per_feed":
        obs = obs.take(obs.dimension == FORMULA)
    band = community.band_index(obs.week, edges)
    keep = band >= 0
    if not keep.any():
        return {}
    baby, day, band = obs.baby[keep].astype(np.int64), obs.day[keep].astype(np.int64), band[keep].astype(np.int64)
    value = np.clip(obs.value[keep], *metric.clip)
    group = baby * 64 + band
    day_key = group * 4096 + day
    unique_days, first = np.unique(day_key, return_index=True)
    day_group = unique_days // 4096
    hashed = community.keyed_hash(community.HASH_KEY, cohort.baby_id[baby[first]], day[first])
    order = np.lexsort((hashed, day_group))
    kept_days = unique_days[order[_rank_within(day_group[order]) < community.CAP_DAYS]]
    if bound is not None:
        kept_days = _bounded(kept_days, cohort, bound)
    capped = np.isin(day_key, kept_days)
    frame = pd.DataFrame({"band": band[capped], "baby": baby[capped], "value": value[capped]})
    medians = frame.groupby(["band", "baby"], sort=True)["value"].median().reset_index()
    out: dict[tuple[int, int], BuiltCell] = {}
    for band_index, rows in medians.groupby("band", sort=True):
        babies = rows["baby"].to_numpy()
        out[(edges[int(band_index)], edges[int(band_index) + 1])] = BuiltCell(babies, cohort.family[babies], rows["value"].to_numpy(dtype=float))
    return out


def _rank_within(sorted_groups: np.ndarray) -> np.ndarray:
    """0, 1, 2, ... inside each run of equal values of a sorted array."""
    starts = np.flatnonzero(np.r_[True, sorted_groups[1:] != sorted_groups[:-1]])
    return np.arange(len(sorted_groups)) - np.repeat(starts, np.diff(np.r_[starts, len(sorted_groups)]))


def _bounded(kept_days: np.ndarray, cohort: CommunityCohort, bound: int) -> np.ndarray:
    """The kept days of at most ``bound`` bands per baby: the bands with the most capped days, ties by a keyed rank of the
    baby id and the band (her own data only)."""
    groups, days = np.unique(kept_days // 4096, return_counts=True)
    baby, band = groups // 64, groups % 64
    rank = community.keyed_hash(CELL_KEY, cohort.baby_id[baby], band)
    order = np.lexsort((rank, -days, baby))
    kept_groups = groups[order[_rank_within(baby[order]) < bound]]
    return kept_days[np.isin(kept_days // 4096, kept_groups)]


def admitted(cell: BuiltCell, k: int = community.K, dominance: float = community.DOMINANCE) -> bool:
    """k babies from k families, and no family with more than ``dominance`` of the cell's babies (one summary each)."""
    if len(np.unique(cell.babies)) < k or len(np.unique(cell.families)) < k:
        return False
    return pd.Series(cell.families).value_counts().max() <= dominance * len(cell.babies)


# ---------------------------------------------------------------------------------------------------------------
# Studies.


def cell_study(seed: int, pool_size: int, reps: int) -> dict:
    """Errors of cells of n babies drawn from each band's population, built configuration and study configuration."""
    cohort, observations = population(pool_size, seed, "base")
    window = windowed(cohort, observations, seed)
    rng = np.random.default_rng([seed, 34, 27])
    out: dict = {}
    for key, metric in METRICS.items():
        built_pools = built_cells(metric, cohort, window[key])
        study_pools = built_cells(metric, cohort, observations[key], bound=None)
        rows: dict = {}
        for label, pools, mechanism in (("built", built_pools, built_release), ("study", study_pools, study_release)):
            for n in CELL_SIZES:
                errors = {level: [] for level in LEVELS}
                coverage, nothing = [], 0
                for band in CELL_BANDS:
                    pool = pools[band].summaries
                    truth = np.percentile(pool, LEVELS)
                    for _ in range(reps):
                        cell = pool[rng.choice(len(pool), n, replace=False)]
                        got = mechanism(metric, cell, rng)
                        if got is None:
                            nothing += 1
                            continue
                        for level, value, true in zip(LEVELS, got, truth):
                            errors[level].append(abs(value - true))
                        coverage.append(float(np.mean((pool >= got[0]) & (pool <= got[2]))))
                rows[f"{label}@{n}"] = {
                    "p50_mean": float(np.mean(errors[50])), "p50_p90": float(np.percentile(errors[50], 90)),
                    "p25_mean": float(np.mean(errors[25])), "p75_mean": float(np.mean(errors[75])),
                    "coverage_p25_p75": float(np.mean(coverage)), "nothing": nothing,
                }
        out[key] = {
            "unit": metric.unit,
            "pool_babies": {f"{a}-{b}": int(len(built_pools[(a, b)].summaries)) for a, b in CELL_BANDS},
            "rows": rows,
        }
    return out


def privacy_study(seed: int, pool_size: int, draws: int) -> dict:
    """The exact DP check of one snapped bin, and the strongest attacker's advantage on one published percentile."""
    scale = 1 / EPSILON_PER_CELL
    support = np.arange(-60, 120) * snap_grid(scale)
    worst = 0.0
    for count in range(0, 50):
        p, q = snapped_pmf(count, scale, support), snapped_pmf(count + 1, scale, support)
        mask = (p > 1e-300) & (q > 1e-300)
        worst = max(worst, float(np.max(np.abs(np.log(p[mask]) - np.log(q[mask])))))
    cohort, observations = population(pool_size, seed, "base")
    window = windowed(cohort, observations, seed)
    rng = np.random.default_rng([seed, 34, 29])
    attacks: dict = {}
    for key, band in PRIVACY_BANDS.items():
        metric = METRICS[key]
        pool = built_cells(metric, cohort, window[key])[band].summaries
        cell = pool[rng.choice(len(pool), 20, replace=False)]
        targets = [int(np.argmax(np.abs(cell - np.median(cell))))] + [int(i) for i in rng.choice(20, 2, replace=False)]
        tvs = []
        for target in targets:
            worlds = [released_draws(metric, cell, rng, draws), released_draws(metric, np.delete(cell, target), rng, draws)]
            tvs.append(max(total_variation(worlds[0][:, level], worlds[1][:, level]) for level in range(len(LEVELS))))
        attacks[key] = {"band": f"{band[0]}-{band[1]}", "advantage_extreme": tvs[0], "advantage_random": float(np.mean(tvs[1:]))}
    return {
        "epsilon_per_cell": EPSILON_PER_CELL, "max_cells": MAX_CELLS, "epsilon_per_release": EPSILON_PER_CELL * MAX_CELLS,
        "worst_log_ratio_snapped_bin": worst, "formal_per_cell": math.tanh(EPSILON_PER_CELL / 2),
        "formal_per_release": math.tanh(EPSILON_PER_CELL * MAX_CELLS / 2), "histogram_tv_bound": 1 - math.exp(-EPSILON_PER_CELL / 2),
        "attacks": attacks, "draws": draws,
    }


def released_draws(metric: Metric, cell: np.ndarray, rng: np.random.Generator, draws: int) -> np.ndarray:
    rows = [built_release(metric, cell, rng) for _ in range(draws)]
    return np.asarray([row if row is not None else np.full(len(LEVELS), np.nan) for row in rows])


def total_variation(a: np.ndarray, b: np.ndarray) -> float:
    """Plug-in total variation between two samples of a published value (NaN, nothing published, is its own value)."""
    a, b = np.nan_to_num(a, nan=-1e9), np.nan_to_num(b, nan=-1e9)
    values = np.union1d(a, b)
    pa = np.searchsorted(values, a)
    pb = np.searchsorted(values, b)
    return float(0.5 * np.abs(np.bincount(pa, minlength=len(values)) / len(a) - np.bincount(pb, minlength=len(values)) / len(b)).sum())


def instance_study(seed: int, seeds: int) -> dict:
    """Instances of N babies logging in a quarter (all opted in, about 1.3 babies per family): bands reaching 20 babies
    from 20 families (and the dominance rule), babies per band, cells per baby (at most 4 by construction)."""
    out: dict = {}
    for size in INSTANCE_SIZES:
        entry: dict = {}
        for key, metric in METRICS.items():
            published, first_year, babies, cells_per_baby = [], [], [], []
            for repeat in range(seeds):
                cohort, observations = population(size, seed * 1000 + repeat, "base")
                cells = built_cells(metric, cohort, windowed(cohort, observations, seed * 1000 + repeat)[key])
                counts = {band: len(cell.babies) for band, cell in cells.items()}
                ok = {band for band, cell in cells.items() if admitted(cell)}
                published.append(len(ok) / (len(BAND_EDGES) - 1))
                first_year.append(sum(1 for band in ok if band[1] <= 52) / 13)
                babies.extend(counts.get((a, b), 0) for a, b in zip(BAND_EDGES, BAND_EDGES[1:]))
                members = np.concatenate([cell.babies for cell in cells.values()]) if cells else np.array([], np.int64)
                cells_per_baby.extend(np.bincount(members).tolist() if len(members) else [])
            per_baby = np.asarray([c for c in cells_per_baby if c > 0])
            entry[key] = {
                "bands_published": float(np.mean(published)), "first_year_published": float(np.mean(first_year)),
                "median_babies_per_band": float(np.median(babies)),
                "cells_per_baby": {"median": float(np.median(per_baby)), "p90": float(np.percentile(per_baby, 90)), "max": int(per_baby.max())},
            }
        out[str(size)] = entry
    return out


def vectors(seed: int) -> dict:
    """Cases the C# mechanism must reproduce: bin edges, binning, read-out of given noisy counts, and the error of the
    noisy median of one synthetic cell over many draws (for a statistical comparison with the C# sampler)."""
    rng = np.random.default_rng([seed, 34, 31])
    out: dict = {"seed": seed, "epsilonPerCell": EPSILON_PER_CELL, "levels": list(LEVELS), "metrics": {}}
    cohort, observations = population(20000, seed, "base")
    window = windowed(cohort, observations, seed)
    for key, metric in METRICS.items():
        low, high = metric.clip
        edges = histogram_edges(metric, low, high)
        probes = np.concatenate([edges, edges + 1e-6, edges - 1e-6, [low, high], rng.uniform(low, high, 20)])
        binning = [{"value": float(v), "bin": int(np.argmax(histogram_counts(np.asarray([v]), edges)))} for v in np.clip(probes, low, high)]
        readouts = []
        for case in range(12):
            counts = histogram_counts(np.clip(rng.normal((low + high) / 3, (high - low) / 8, int(rng.integers(20, 120))), low, high), edges)
            noisy = snapped(counts, 0.5, rng.laplace(0, 0.5, len(counts))) if case % 3 else counts
            got = readout(noisy, edges, metric)
            readouts.append({"counts": noisy.tolist(), "expected": None if got is None else got.tolist()})
        readouts.append({"counts": [0.0] * (len(edges) - 1), "expected": None})
        readouts.append({"counts": [-0.5] + [0.0] * (len(edges) - 2), "expected": None})
        pool = built_cells(metric, cohort, window[key])[PRIVACY_BANDS[key]].summaries
        cell = np.sort(pool[rng.choice(len(pool), 20, replace=False)])
        draws = [built_release(metric, cell, rng) for _ in range(40000)]
        released = np.asarray([d for d in draws if d is not None])
        exact = np.median(cell)
        out["metrics"][key] = {
            "clip": [low, high], "step": metric.step, "binWidth": metric.bin_width, "edges": edges.tolist(),
            "binning": binning, "readouts": readouts, "cell": cell.tolist(),
            "noisyMedianMeanAbsError": float(np.mean(np.abs(released[:, 1] - exact))), "exactMedian": float(exact), "draws": len(draws),
        }
    return out


# ---------------------------------------------------------------------------------------------------------------
# Run and report.


def run(seed: int = 1, pool_size: int = 80000, reps: int = 200, privacy_draws: int = 20000, instance_seeds: int = 5) -> dict:
    started = time.perf_counter()
    return {
        "parameters": {
            "seed": seed, "pool_size": pool_size, "reps": reps, "privacy_draws": privacy_draws, "instance_seeds": instance_seeds,
            "cell_sizes": list(CELL_SIZES), "bands": [list(b) for b in CELL_BANDS], "quarter_days": QUARTER_DAYS,
            "max_cells": MAX_CELLS, "epsilon_per_cell": EPSILON_PER_CELL, "levels": list(LEVELS),
        },
        "cells": cell_study(seed, pool_size, reps),
        "privacy": privacy_study(seed, pool_size, privacy_draws),
        "instances": instance_study(seed, instance_seeds),
        "runtime_seconds": time.perf_counter() - started,
    }


def _f(value, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def markdown(report: dict) -> str:
    p = report["parameters"]
    lines = [
        "### Results of the built configuration (generated, seed {})".format(p["seed"]),
        "",
        f"`python -m benchmark.community_percentiles_built --seed {p['seed']}`: population of {p['pool_size']} synthetic babies, "
        f"each history placed to overlap one {p['quarter_days']}-day quarter; 4-week bands {', '.join(f'{a}-{b}' for a, b in p['bands'])}; "
        f"{p['reps']} cells per band and size; epsilon {p['epsilon_per_cell']} per cell, at most {p['max_cells']} cells per baby; "
        "p25, p50, p75. Error against the band's truth under the same pipeline, pooled over the bands; \"bad case\" is the 90th "
        "percentile of the median's error; coverage is the share of the band's babies inside the released p25-p75 (target 50 %). "
        "\"study\" is the 2026-11-26 study's histogram (plain Laplace, each baby's whole history, no cell bound) on the same bands.",
        "",
    ]
    for key, entry in report["cells"].items():
        lines += [f"#### {key} ({entry['unit']})", "", "| Configuration | Cell size | Median error | Bad case | p25 error | p75 error | Coverage p25-p75 | Cells with nothing |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for label in ("built", "study"):
            for n in p["cell_sizes"]:
                row = entry["rows"][f"{label}@{n}"]
                lines.append(f"| {label} | {n} | {_f(row['p50_mean'])} | {_f(row['p50_p90'])} | {_f(row['p25_mean'])} | {_f(row['p75_mean'])} | {100 * row['coverage_p25_p75']:.0f} % | {row['nothing']} |")
        lines += ["", "Babies per band in the population (built pipeline): " + ", ".join(f"{band}: {count}" for band, count in entry["pool_babies"].items()) + ".", ""]
    privacy = report["privacy"]
    lines += [
        "#### Privacy of the built configuration",
        "",
        f"- Exact check of one snapped bin (scale {1 / privacy['epsilon_per_cell']:.1f}, grid {snap_grid(1 / privacy['epsilon_per_cell']):.1f}), counts 0-50 against count + 1: "
        f"largest |log probability ratio| {privacy['worst_log_ratio_snapped_bin']:.4f}, at most epsilon {privacy['epsilon_per_cell']} per cell.",
        f"- Formal bound per cell and release tanh(epsilon / 2) = {privacy['formal_per_cell']:.2f}; per baby and release (at most {privacy['max_cells']} cells, "
        f"epsilon {privacy['epsilon_per_release']:.0f}) {privacy['formal_per_release']:.4f}; the histogram's own TV at most {privacy['histogram_tv_bound']:.2f}.",
        "",
        f"Strongest attacker on one published percentile of a 20-baby cell ({privacy['draws']} draws per world; plug-in, a lower bound for the release):",
        "",
        "| Statistic | Band | Advantage, most extreme baby | Advantage, random baby |",
        "|---|---|---:|---:|",
    ]
    for key, attack in privacy["attacks"].items():
        lines.append(f"| {key} | {attack['band']} | {attack['advantage_extreme']:.2f} | {attack['advantage_random']:.2f} |")
    lines += [
        "",
        "#### Babies logging in a quarter for a 4-week band to reach 20 babies from 20 families",
        "",
        "Instances of N babies whose logging overlaps the quarter (all opted in, about 1.3 babies per family; the generator's ages are "
        f"uniform over two years, histories 2-16 weeks); mean over {p['instance_seeds']} instances. Bands published: share of the 26 bands passing k and "
        "dominance; first year: share of the 13 bands up to week 52.",
        "",
        "| Babies logging in the quarter | Statistic | Bands published | First-year bands published | Median babies per band | Cells per baby (median / p90 / max) |",
        "|---:|---|---:|---:|---:|---|",
    ]
    for size, entry in report["instances"].items():
        for key, row in entry.items():
            cpb = row["cells_per_baby"]
            lines.append(f"| {size} | {key} | {100 * row['bands_published']:.0f} % | {100 * row['first_year_published']:.0f} % | {row['median_babies_per_band']:.0f} | {cpb['median']:.0f} / {cpb['p90']:.0f} / {cpb['max']} |")
    lines += ["", f"Runtime: {report['runtime_seconds']:.0f} s.", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--pool-size", type=int, default=80000)
    parser.add_argument("--reps", type=int, default=200)
    parser.add_argument("--privacy-draws", type=int, default=20000)
    parser.add_argument("--instance-seeds", type=int, default=5)
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--vectors", action="store_true", help="also rewrite ml/tests/community_histogram_vectors.json")
    args = parser.parse_args(argv)
    report = run(args.seed, args.pool_size, args.reps, args.privacy_draws, args.instance_seeds)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "percentiles_built.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.out / "percentiles_built.md").write_text(markdown(report), encoding="utf-8")
    if args.vectors:
        VECTORS.write_text(json.dumps(vectors(args.seed), indent=1) + "\n", encoding="utf-8")
    print(markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
