"""Percentile statistics in small cells: can milk per feed and sleep be published usefully with honest privacy?

Follow-up of the community-insights synthetic study (benchmark/community.py, docs/ml/COMMUNITY-SYNTHETIC.md) for the
owner request of 2026-11-26: ``bottle_ml_per_feed``, ``night_sleep_minutes`` and, where useful, ``naps_per_day`` and
``day_sleep_minutes`` in v1, with k = 20 babies from 20 families, in cells of 20 to about 100 babies (few families for a
long time). Synthetic only: no child data, no network, CPU.

What it does:

1. **Cell study.** For fixed age bands, a large synthetic population (``community_cohort`` of ``POOL_SIZE`` babies, the
   earlier study's generator and pipeline: clipping, 14-day cap by keyed hash, one median per baby) gives the cohort
   truth of each band. Cells of n = 20, 30, 50, 100, 300 babies are drawn from it and released by each candidate
   mechanism at several epsilons; we score the error against the cohort truth, against the published-norms prior, the
   calibration (share of the population inside the released p25-p75 and p10-p90), the cold-start MAE against the prior,
   and the privacy loss (below). Two cohorts: ``base`` (the earlier generator, whose truth runs through the norms) and
   ``messy`` (a stress test: mixed feeders, patchy logging, wider spreads; unsourced).
2. **Mechanisms** (pure functions, each checked in ml/tests/test_community_percentiles.py): exact (rounded), the
   exponential mechanism per percentile with the budget split (the earlier study's), the same for fewer percentiles,
   the joint exponential mechanism (Gillenwater, Joseph and Kulesza 2021) on a fixed grid, a Laplace-noised histogram
   with fixed bins read by an isotonic CDF, and a smooth-sensitivity median (Nissim, Raskhodnikova and Smith 2007,
   Cauchy-like noise, pure DP). Optional band ranges: fixed per band from the public reference curve (the published
   norms), never from the data.
3. **Privacy measures.** Neighbouring datasets are "with or without one baby" (add/remove, a withdrawal). For every
   mechanism the strongest attacker (knows every other baby in the cell, the DP threat model) has an optimal advantage
   (true-positive minus false-positive rate) equal to the total variation distance between the two output
   distributions; it is computed exactly (exponential mechanism, smooth sensitivity), by Monte Carlo over the exact
   privacy-loss variable (joint exponential mechanism, split percentiles) or bounded in closed form (histogram).
   Composed over T releases with fresh noise the same way. Without noise the advantage is the share of withdrawals that
   change a published (rounded) number. A weaker, realistic attacker (knows only the target's value; other babies join
   between releases) plays the earlier study's games.
4. **Instances.** How fast cells fill with few families on the fine, coarse and wide band grids, how many cells a baby
   is in per release (the real per-baby epsilon is the per-cell epsilon times that number), and the error a user would
   see at each week (sampling, age blur of wide bands, noise).

``python -m benchmark.community_percentiles --seed 1 --out out`` writes ``out/percentiles.md`` and
``out/percentiles.json``. Synthetic data cannot prove a real-world gain (docs/design/28-age-norms.md section 15.4).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.special import logsumexp

from . import community
from .community import AGE_NORMS, CATALOG, COARSE_EDGES, FINE_EDGES, NormPrior, Statistic
from .synthetic import (
    DAY_SLEEP_MINUTES_BY_WEEK,
    FORMULA_ML_BY_WEEK,
    MAX_WEEK,
    NAPS_BY_WEEK,
    NIGHT_MINUTES_BY_WEEK,
    CommunityCohort,
    Observations,
    community_cohort,
    curve,
    day_sleep_observations,
)

K = community.K
POOL_SIZE = 80000
CELL_SIZES = (20, 30, 50, 100, 300)
EPSILONS = (0.2, 0.5, 1.0, 2.0, 3.0, 5.0)
WIDE_EDGES = (0, 13, 26, 39, 52, 78, MAX_WEEK)
"""A "wide" grid of about 3-month bands (then 6-month bands), to see how coarse bands fill and blur."""

# ---------------------------------------------------------------------------------------------------------------
# Metrics. The clip ranges are the earlier study's (design 34 section 5); day sleep has none in the design (0-12 h).


@dataclass(frozen=True)
class Metric:
    key: str
    unit: str
    clip: tuple[float, float]
    step: float
    """Grid step of the mechanisms and rounding unit of every published value."""
    bin_width: float
    """Histogram bin width."""
    grid_step: float
    """Internal grid of the rank mechanisms (exponential, joint). Finer than ``step`` where babies' summaries sit on the
    published grid (half-integer nap medians, bottles typed in tens): on a grid as coarse as the data the mechanism
    picks the point closest in rank, not in value, a one-step bias. An odd divisor, so no grid point falls on a rounding
    boundary. The published value is still rounded to ``step``."""
    reference: tuple[tuple[float, float], ...]
    """Public reference curve (the published-norm anchors of synthetic.py): only used for the fixed band ranges."""
    multiplicative: bool
    norm: tuple[str, str, float] | None
    """(age-norms metric, population, scale to the metric's unit) of the published-norms prior."""

    @property
    def statistic(self) -> Statistic:
        if self.key in CATALOG:
            return CATALOG[self.key]
        return Statistic(self.key, "quantiles", self.clip, self.step, FINE_EDGES, COARSE_EDGES)

    def band_range(self, start: int, end: int) -> tuple[float, float]:
        """A fixed range per band from the public reference curve, never from the data: [0, 2.5 x reference] for
        amounts, reference +/- 6 h for sleep minutes, the full clip for naps; rounded out to whole bins."""
        weeks = np.arange(start, end) + 0.5
        low_ref, high_ref = float(curve(self.reference, weeks).min()), float(curve(self.reference, weeks).max())
        if self.key == "naps_per_day":
            return self.clip
        if self.multiplicative:
            low, high = 0.0, 2.5 * high_ref
        else:
            low, high = low_ref - 360, high_ref + 360
        low = max(self.clip[0], math.floor(low / self.bin_width) * self.bin_width)
        high = min(self.clip[1], math.ceil(high / self.bin_width) * self.bin_width)
        return low, high


METRICS: dict[str, Metric] = {
    metric.key: metric
    for metric in (
        Metric("bottle_ml_per_feed", "ml", (0, 400), 10, 20, 2, FORMULA_ML_BY_WEEK, True, ("feed_volume_ml_per_feed", "formula", 1.0)),
        Metric("night_sleep_minutes", "min", (0, 960), 10, 30, 10, NIGHT_MINUTES_BY_WEEK, False, ("night_sleep_hours", "all", 60.0)),
        Metric("naps_per_day", "naps", (0, 8), 0.5, 0.5, 0.1, NAPS_BY_WEEK, False, ("naps_per_day", "all", 1.0)),
        Metric("day_sleep_minutes", "min", (0, 720), 10, 30, 10, DAY_SLEEP_MINUTES_BY_WEEK, False, ("day_sleep_hours_24h", "all", 60.0)),
    )
}

STUDY_BANDS = ((2, 3), (6, 7), (10, 11), (16, 18), (24, 26), (36, 40), (60, 64), (88, 92))
"""Fine-grid bands of the cell study, from the first weeks to the second year."""
PRIVACY_BANDS = {"bottle_ml_per_feed": (10, 11), "night_sleep_minutes": (36, 40), "naps_per_day": (24, 26), "day_sleep_minutes": (36, 40)}


def load_priors(path: Path = AGE_NORMS) -> dict[str, tuple[NormPrior, ...]]:
    """Usable published norms per metric (community.load_priors' rule: never a norm with needsReview or low
    confidence; the middle of the range when there is no typical value)."""
    norms = json.loads(path.read_text(encoding="utf-8"))["norms"]
    out: dict[str, tuple[NormPrior, ...]] = {}
    for key, metric in METRICS.items():
        name, population, scale = metric.norm
        usable = []
        for norm in norms:
            if norm["metric"] != name or norm["population"] != population or norm["needsReview"] or norm["confidence"] == "low":
                continue
            typical = norm["typical"]
            if typical is None and norm["low"] is not None and norm["high"] is not None:
                typical = (norm["low"] + norm["high"]) / 2
            if typical is not None:
                usable.append(NormPrior(norm["ageBand"]["fromWeeks"], norm["ageBand"]["toWeeks"], typical * scale, norm["id"]))
        out[key] = tuple(usable)
    return out


def prior_for(priors: dict[str, tuple[NormPrior, ...]], key: str, start: int, end: int) -> float | None:
    middle = (start + end) / 2
    for norm in priors.get(key, ()):
        if norm.from_weeks <= middle < norm.to_weeks:
            return norm.value
    return None


# ---------------------------------------------------------------------------------------------------------------
# Mechanisms. ``values`` are the babies' own summaries of one cell (one per baby, already clipped by the pipeline);
# every mechanism clips them again to its own fixed range. Neighbouring cells differ by one baby (add/remove).


def grid_for(low: float, high: float, step: float) -> np.ndarray:
    return np.round(np.arange(low, high + step / 2, step), 9)


def exact_quantiles(values: np.ndarray, levels: tuple[int, ...]) -> np.ndarray:
    """The earlier study's exact output: numpy's linear-interpolation percentiles of the babies' summaries."""
    return np.percentile(values, levels)


def em_sensitivity(level: float) -> float:
    """Add/remove sensitivity of the rank utility -|#{x < g} - q n|: adding one value x raises #{x < g} by 1 for the
    grid points above x (0 below) and q n by q, so the utility moves by 1 - q or q: at most max(q, 1 - q) (0.5 for the
    median). The earlier study used 1, the swap (replace one value) sensitivity, which is conservative here."""
    q = level / 100
    return max(q, 1 - q)


def em_log_probs(sorted_values: np.ndarray, level: float, epsilon: float, grid: np.ndarray, sensitivity: float | None = None) -> np.ndarray:
    """Exponential mechanism for one percentile over a fixed grid, weights exp(epsilon u / (2 sensitivity)):
    epsilon-DP for adding or removing one baby (one value). The tests check the ratio on every neighbour."""
    sensitivity = em_sensitivity(level) if sensitivity is None else sensitivity
    below = np.searchsorted(sorted_values, grid, side="left")
    logits = epsilon / (2 * sensitivity) * -np.abs(below - level / 100 * len(sorted_values))
    return logits - logsumexp(logits)


def em_quantiles(values: np.ndarray, levels: tuple[int, ...], epsilon: float, grid: np.ndarray, rng: np.random.Generator, tight: bool = True) -> np.ndarray:
    """One exponential-mechanism draw per percentile, epsilon split evenly (basic composition), sorted afterwards
    (post-processing). ``tight=False`` uses sensitivity 1 and then draws exactly like community.dp_quantiles."""
    ordered = np.sort(values)
    eps = epsilon / len(levels)
    picks = [grid[int(np.argmax(em_log_probs(ordered, level, eps, grid, None if tight else 1.0) + rng.gumbel(size=len(grid))))] for level in levels]
    return np.sort(np.asarray(picks))


@dataclass(frozen=True)
class JointTables:
    """Forward messages of the joint exponential mechanism on a grid (log space)."""

    below: np.ndarray
    targets: np.ndarray
    alphas: tuple[np.ndarray, ...]
    middles: tuple[np.ndarray, ...]
    last: np.ndarray
    log_z: float
    scale: float


def joint_sensitivity(levels: tuple[int, ...]) -> float:
    """Add/remove sensitivity of the joint utility: a value added to interval j moves |c_j - t_j| by at most
    1 - (q_j - q_{j-1}) and every other term by at most its own q_i - q_{i-1}, which sum to the same 1 - (q_j - q_{j-1});
    so 2 (1 - min_j (q_j - q_{j-1})): 1.5 for p25/p50/p75, 1.8 for p10-p90 (Gillenwater et al. use 2, the swap bound)."""
    q = np.concatenate([[0.0], np.asarray(levels, float) / 100, [1.0]])
    return float(2 * (1 - np.diff(q).min()))


def joint_tables(sorted_values: np.ndarray, levels: tuple[int, ...], epsilon: float, grid: np.ndarray, sensitivity: float | None = None) -> JointTables:
    """Joint exponential mechanism (Gillenwater, Joseph, Kulesza 2021, "JointExp") restricted to non-decreasing tuples of
    grid points o_1 <= ... <= o_m. Utility u(o) = -sum_j |c_j(o) - n (q_j - q_{j-1})| over the m + 1 intervals
    [lo, o_1), [o_1, o_2), ..., [o_m, hi], with c_j the number of values in interval j; weights
    exp(epsilon u / (2 sensitivity)): epsilon-DP for all m percentiles together (no split of the budget)."""
    n = len(sorted_values)
    below = np.searchsorted(sorted_values, grid, side="left").astype(float)
    q = np.concatenate([[0.0], np.asarray(levels, float) / 100, [1.0]])
    targets = n * np.diff(q)
    scale = epsilon / (2 * (joint_sensitivity(levels) if sensitivity is None else sensitivity))
    first = -scale * np.abs(below - targets[0])
    last = -scale * np.abs(n - below - targets[-1])
    upper = np.triu(np.ones((len(grid), len(grid)), bool))
    diff = below[None, :] - below[:, None]
    middles = tuple(np.where(upper, -scale * np.abs(diff - t), -np.inf) for t in targets[1:-1])
    alphas = [first]
    for middle in middles:
        alphas.append(logsumexp(alphas[-1][:, None] + middle, axis=0))
    return JointTables(below, targets, tuple(alphas), middles, last, float(logsumexp(alphas[-1] + last)), scale)


def joint_sample_indices(tables: JointTables, rng: np.random.Generator, size: int) -> np.ndarray:
    """``size`` exact draws (grid indices, shape size x m) by backward sampling of the chain."""
    m = len(tables.alphas)
    out = np.empty((size, m), np.int64)
    top = tables.alphas[-1] + tables.last
    out[:, m - 1] = np.argmax(top[:, None] + rng.gumbel(size=(len(top), size)), axis=0)
    for j in range(m - 2, -1, -1):
        conditional = (tables.alphas[j][:, None] + tables.middles[j])[:, out[:, j + 1]]
        out[:, j] = np.argmax(conditional + rng.gumbel(size=conditional.shape), axis=0)
    return out


def joint_log_prob(tables: JointTables, indices: np.ndarray) -> np.ndarray:
    """Exact log-probability of non-decreasing index tuples (rows) under the mechanism."""
    b = tables.below[indices]
    n = tables.targets.sum()
    counts = np.diff(np.concatenate([np.zeros((len(b), 1)), b, np.full((len(b), 1), n)], axis=1), axis=1)
    return tables.scale * -np.abs(counts - tables.targets).sum(axis=1) - tables.log_z


def joint_quantiles(values: np.ndarray, levels: tuple[int, ...], epsilon: float, grid: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    tables = joint_tables(np.sort(values), levels, epsilon, grid)
    return grid[joint_sample_indices(tables, rng, 1)[0]]


def isotonic_increasing(y: np.ndarray) -> np.ndarray:
    """Least-squares non-decreasing fit (pool adjacent violators, equal weights)."""
    values: list[float] = []
    weights: list[int] = []
    for v in y:
        values.append(float(v))
        weights.append(1)
        while len(values) > 1 and values[-2] > values[-1]:
            v2, w2 = values.pop(), weights.pop()
            v1, w1 = values.pop(), weights.pop()
            values.append((v1 * w1 + v2 * w2) / (w1 + w2))
            weights.append(w1 + w2)
    return np.repeat(values, weights)


def quantiles_from_counts(counts: np.ndarray, levels: tuple[int, ...], edges: np.ndarray) -> np.ndarray:
    """Percentiles read from (noisy) bin counts: cumulative counts made non-decreasing (isotonic fit) and non-negative,
    then linear interpolation inside the bin where the target rank falls. Post-processing only."""
    cdf = np.clip(isotonic_increasing(np.cumsum(counts)), 0, None)
    total = cdf[-1]
    if total <= 0:
        return np.full(len(levels), (edges[0] + edges[-1]) / 2)
    cdf = np.concatenate([[0.0], cdf])
    out = []
    for level in levels:
        target = level / 100 * total
        j = int(np.clip(np.searchsorted(cdf, target, side="left"), 1, len(edges) - 1))
        low, high = cdf[j - 1], cdf[j]
        fraction = 0.5 if high <= low else (target - low) / (high - low)
        out.append(edges[j - 1] + fraction * (edges[j] - edges[j - 1]))
    return np.asarray(out)


def isotonic_batch(y: np.ndarray, chunk: int = 2000) -> np.ndarray:
    """Row-wise least-squares non-decreasing fit, the min-max formula fit_j = max_{i <= j} min_{k >= j} mean(y_i..y_k)
    (same result as isotonic_increasing, vectorised; the tests compare them)."""
    rows, width = y.shape
    i = np.arange(width)[:, None]
    k = np.arange(width)[None, :]
    lengths = np.where(k >= i, k - i + 1, 1).astype(float)
    out = np.empty_like(y, dtype=float)
    for start in range(0, rows, chunk):
        part = y[start:start + chunk]
        prefix = np.concatenate([np.zeros((len(part), 1)), np.cumsum(part, axis=1)], axis=1)
        means = np.where(k >= i, (prefix[:, None, 1:] - prefix[:, :width, None]) / lengths, np.inf)
        suffix_min = np.minimum.accumulate(means[:, :, ::-1], axis=2)[:, :, ::-1]
        out[start:start + chunk] = np.where(i <= k, suffix_min, -np.inf).max(axis=1)
    return out


def quantiles_from_counts_batch(counts: np.ndarray, levels: tuple[int, ...], edges: np.ndarray) -> np.ndarray:
    """quantiles_from_counts for many noisy histograms at once (rows)."""
    cdf = np.clip(isotonic_batch(np.cumsum(counts, axis=1)), 0, None)
    total = cdf[:, -1]
    cdf = np.concatenate([np.zeros((len(cdf), 1)), cdf], axis=1)
    targets = total[:, None] * (np.asarray(levels, float) / 100)[None, :]
    j = np.clip((cdf[:, None, :] < targets[:, :, None]).sum(axis=2), 1, len(edges) - 1)
    low, high = np.take_along_axis(cdf, j - 1, axis=1), np.take_along_axis(cdf, j, axis=1)
    fraction = np.where(high > low, (targets - low) / np.where(high > low, high - low, 1), 0.5)
    out = edges[j - 1] + fraction * (edges[j] - edges[j - 1])
    return np.where(total[:, None] > 0, out, (edges[0] + edges[-1]) / 2)


def histogram_counts(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Counts of the babies' summaries in fixed bins (values outside are clipped into the edge bins). One summary per
    baby: adding or removing one baby changes exactly one count by 1 (L1 sensitivity 1)."""
    return np.histogram(np.clip(values, edges[0], edges[-1]), bins=edges)[0].astype(float)


def histogram_quantiles(values: np.ndarray, levels: tuple[int, ...], epsilon: float | None, edges: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Laplace(1 / epsilon) on every bin count (epsilon-DP for the whole histogram), any number of percentiles read
    from it at no extra cost."""
    counts = histogram_counts(values, edges)
    if epsilon is not None:
        counts = counts + rng.laplace(0, 1 / epsilon, len(counts))
    return quantiles_from_counts(counts, levels, edges)


SMOOTH_GAMMA = 4.0


def smooth_parameters(epsilon: float, gamma: float = SMOOTH_GAMMA) -> tuple[float, float]:
    """(alpha, beta) for the Cauchy-like density h(z) ~ 1 / (1 + |z|^gamma): alpha = beta = epsilon / (2 (gamma + 1))
    (Nissim, Raskhodnikova, Smith 2007). The tests check both admissibility conditions numerically."""
    value = epsilon / (2 * (gamma + 1))
    return value, value


def median_index(n: int) -> int:
    """0-based index of the released order statistic (the upper median when n is even)."""
    return n // 2


def smooth_sensitivity_median(sorted_values: np.ndarray, beta: float, low: float, high: float) -> float:
    """beta-smooth sensitivity of the order statistic x_(m), m = median_index(n): max over k of e^(-k beta) times the
    widest window of k + 2 consecutive order statistics around m, padded with ``low`` below and ``high`` above (NRS07
    proposition 3.4). The tests check, for add/remove neighbours, that it bounds the local sensitivity and changes by at
    most e^beta between neighbours (the two conditions of a smooth upper bound)."""
    n = len(sorted_values)
    m = median_index(n)
    pad = n + 2
    padded = np.concatenate([np.full(pad, low), np.clip(sorted_values, low, high), np.full(pad, high)])
    best = 0.0
    for k in range(n + 1):
        weight = math.exp(-k * beta)
        if weight * (high - low) <= best:
            break
        t = np.arange(k + 2)
        width = padded[pad + m + t] - padded[pad + m + t - k - 1]
        best = max(best, weight * float(width.max()))
    return best


def smooth_noise(rng: np.random.Generator, size: int | None = None, gamma: float = SMOOTH_GAMMA) -> np.ndarray:
    """Draws from h(z) ~ 1 / (1 + |z|^4) by rejection from a standard Cauchy (ratio bounded by 1.21)."""
    assert gamma == 4.0
    count = 1 if size is None else size
    out = np.empty(0)
    while len(out) < count:
        z = rng.standard_cauchy(2 * count + 8)
        accept = rng.random(len(z)) < (1 + z**2) / (1 + z**4) / 1.2072
        out = np.concatenate([out, z[accept]])
    return out[0] if size is None else out[:count]


def smooth_log_density(z: np.ndarray, gamma: float = SMOOTH_GAMMA) -> np.ndarray:
    """log h(z), normalised (the integral of 1 / (1 + z^4) is pi / sqrt 2)."""
    return -np.log1p(np.abs(z) ** gamma) - math.log(math.pi / math.sqrt(2))


def smooth_median(values: np.ndarray, epsilon: float, low: float, high: float, rng: np.random.Generator) -> float:
    ordered = np.sort(np.clip(values, low, high))
    alpha, beta = smooth_parameters(epsilon)
    sensitivity = smooth_sensitivity_median(ordered, beta, low, high)
    return float(ordered[median_index(len(ordered))] + sensitivity / alpha * smooth_noise(rng))


# ---------------------------------------------------------------------------------------------------------------
# Candidate releases.


@dataclass(frozen=True)
class Config:
    name: str
    mechanism: str
    """exact | em | joint | hist | smooth."""
    levels: tuple[int, ...]
    band_range: bool = False
    label: str = ""


FIVE = (10, 25, 50, 75, 90)
THREE = (25, 50, 75)
ONE = (50,)
CONFIGS: dict[str, Config] = {
    config.name: config
    for config in (
        Config("exact5", "exact", FIVE, label="exact p10-p90, rounded (no noise)"),
        Config("exact3", "exact", THREE, label="exact p25/p50/p75, rounded (no noise)"),
        Config("exact1", "exact", ONE, label="exact median, rounded (no noise)"),
        Config("em5", "em", FIVE, label="exponential mechanism per percentile, 5 percentiles, budget split (earlier study)"),
        Config("em3", "em", THREE, label="exponential mechanism per percentile, p25/p50/p75, budget split"),
        Config("em1", "em", ONE, label="exponential mechanism, median only"),
        Config("em1_band", "em", ONE, True, label="exponential mechanism, median only, band range"),
        Config("joint3", "joint", THREE, label="joint exponential mechanism, p25/p50/p75"),
        Config("joint3_band", "joint", THREE, True, label="joint exponential mechanism, p25/p50/p75, band range"),
        Config("joint5", "joint", FIVE, label="joint exponential mechanism, p10-p90"),
        Config("hist5", "hist", FIVE, label="noisy histogram (fixed bins), p10-p90 read from it"),
        Config("hist5_band", "hist", FIVE, True, label="noisy histogram, band range, p10-p90 read from it"),
        Config("smooth1", "smooth", ONE, label="smooth-sensitivity median (Cauchy-like noise)"),
    )
}


def config_range(metric: Metric, config: Config, band: tuple[int, int]) -> tuple[float, float]:
    return metric.band_range(*band) if config.band_range else metric.clip


def histogram_edges(metric: Metric, low: float, high: float) -> np.ndarray:
    """Fixed bins of ``bin_width`` covering [low, high], offset by half a rounding step so that every published value
    sits inside a bin, not on an edge (a tie block of summaries then stays in one bin)."""
    start = low - metric.step / 2
    count = int(math.ceil((high - start) / metric.bin_width - 1e-9))
    return np.round(start + metric.bin_width * np.arange(count + 1), 9)


def dequantize(metric: Metric, values: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Uniform jitter of half a step on each baby's summary before a noisy mechanism. Summaries are often on the
    published grid (half-integer nap medians, bottles typed as round numbers); the rank utility counts #{x < g} and the
    histogram spreads a bin's count evenly, so ties would push every noisy percentile up to one step high (seen in the
    first run: a 0.2-0.4 nap floor even at n = 300). A random per-record transform, so the DP guarantee is unchanged."""
    return values + rng.uniform(-metric.step / 2, metric.step / 2, len(values))


def release(metric: Metric, config: Config, band: tuple[int, int], values: np.ndarray, epsilon: float | None, rng: np.random.Generator) -> np.ndarray:
    """The published numbers of one cell (``config.levels`` order), clipped to the range and rounded to the step."""
    low, high = config_range(metric, config, band)
    if config.mechanism == "exact" or epsilon is None:
        out = exact_quantiles(np.clip(values, low, high), config.levels)
        return np.round(np.clip(out, low, high) / metric.step) * metric.step
    values = np.clip(dequantize(metric, values, rng), low, high)
    if config.mechanism == "em":
        out = em_quantiles(values, config.levels, epsilon, grid_for(low, high, metric.grid_step), rng)
    elif config.mechanism == "joint":
        out = joint_quantiles(values, config.levels, epsilon, grid_for(low, high, metric.grid_step), rng)
    elif config.mechanism == "hist":
        out = histogram_quantiles(values, config.levels, epsilon, histogram_edges(metric, low, high), rng)
    elif config.mechanism == "smooth":
        out = np.array([smooth_median(values, epsilon, low, high, rng)])
    else:
        raise ValueError(config.mechanism)
    return np.round(np.clip(out, low, high) / metric.step) * metric.step


# ---------------------------------------------------------------------------------------------------------------
# Privacy: the strongest attacker's advantage between "with" and "without" one baby (total variation distance).


def privacy_loss_samples(metric: Metric, config: Config, band: tuple[int, int], with_values: np.ndarray, without_values: np.ndarray, epsilon: float, rng: np.random.Generator, size: int) -> np.ndarray:
    """Draws of the privacy loss L = log p(o) / q(o) with o drawn from the release WITH the baby (p) and q the release
    without her, for the mechanism's raw output (before sorting, rounding or clipping, which can only lower the
    advantage). TV(p, q) = E_p[(1 - e^-L)+]; T releases with fresh noise compose by summing T independent draws."""
    low, high = config_range(metric, config, band)
    a, b = np.sort(np.clip(with_values, low, high)), np.sort(np.clip(without_values, low, high))
    if config.mechanism == "em":
        grid = grid_for(low, high, metric.grid_step)
        eps = epsilon / len(config.levels)
        total = np.zeros(size)
        for level in config.levels:
            p, q = em_log_probs(a, level, eps, grid), em_log_probs(b, level, eps, grid)
            draws = rng.choice(len(grid), size=size, p=np.exp(p))
            total += p[draws] - q[draws]
        return total
    if config.mechanism == "joint":
        grid = grid_for(low, high, metric.grid_step)
        tp, tq = joint_tables(a, config.levels, epsilon, grid), joint_tables(b, config.levels, epsilon, grid)
        draws = joint_sample_indices(tp, rng, size)
        return joint_log_prob(tp, draws) - joint_log_prob(tq, draws)
    if config.mechanism == "hist":
        # The two histograms differ by 1 in one bin; the other bins carry the same noise distribution and cancel.
        eta = rng.laplace(0, 1 / epsilon, size)
        return epsilon * (np.abs(eta + 1) - np.abs(eta))
    if config.mechanism == "smooth":
        alpha, beta = smooth_parameters(epsilon)
        fa, fb = a[median_index(len(a))], b[median_index(len(b))]
        sa, sb = smooth_sensitivity_median(a, beta, low, high) / alpha, smooth_sensitivity_median(b, beta, low, high) / alpha
        w = fa + sa * smooth_noise(rng, size)
        return (smooth_log_density((w - fa) / sa) - math.log(sa)) - (smooth_log_density((w - fb) / sb) - math.log(sb))
    raise ValueError(config.mechanism)


def tv_from_losses(losses: np.ndarray) -> float:
    return float(np.mean(np.clip(1 - np.exp(-losses), 0, None)))


def histogram_released_tv(metric: Metric, config: Config, band: tuple[int, int], with_values: np.ndarray, without_values: np.ndarray, epsilon: float, rng: np.random.Generator, size: int = 40000, releases: tuple[int, ...] = ()) -> dict[str, float]:
    """The advantage against the histogram's published (rounded) percentiles, from below: the largest TV between the
    two worlds' distributions of any single published percentile (plug-in estimate on ``size`` draws per world;
    one-dimensional, so its upward bias is about 0.01). The upper bound is the histogram's own 1 - e^(-epsilon / 2).
    For each T in ``releases``: the same percentile over T releases with fresh noise, from the plug-in probabilities
    (half a count of smoothing; an estimate, not a bound)."""
    low, high = config_range(metric, config, band)
    edges = histogram_edges(metric, low, high)
    worlds = []
    for values in (with_values, without_values):
        counts = histogram_counts(np.clip(values, low, high), edges)
        noisy = counts[None, :] + rng.laplace(0, 1 / epsilon, (size, len(counts)))
        released = np.clip(quantiles_from_counts_batch(noisy, config.levels, edges), low, high)
        worlds.append(np.rint(released / metric.step).astype(np.int64))
    best, best_pmfs = -1.0, None
    for level in range(len(config.levels)):
        a, b = worlds[0][:, level], worlds[1][:, level]
        offset = min(a.min(), b.min())
        pa = np.bincount(a - offset, minlength=max(a.max(), b.max()) - offset + 1) / size
        pb = np.bincount(b - offset, minlength=len(pa)) / size
        tv = float(0.5 * np.abs(pa - pb).sum())
        if tv > best:
            best, best_pmfs = tv, (pa, pb)
    out = {"1": best}
    pa, pb = best_pmfs
    sa, sb = (pa * size + 0.5) / (size + 0.5 * len(pa)), (pb * size + 0.5) / (size + 0.5 * len(pb))
    loss = np.log(sa) - np.log(sb)
    for t in releases:
        draws = rng.choice(len(pa), size=(size // 4, t), p=pa)
        out[str(t)] = tv_from_losses(loss[draws].sum(axis=1))
    return out


def em_single_tv(metric: Metric, config: Config, band: tuple[int, int], with_values: np.ndarray, without_values: np.ndarray, epsilon: float) -> float:
    low, high = config_range(metric, config, band)
    grid = grid_for(low, high, metric.grid_step)
    p = em_log_probs(np.sort(np.clip(with_values, low, high)), config.levels[0], epsilon, grid)
    q = em_log_probs(np.sort(np.clip(without_values, low, high)), config.levels[0], epsilon, grid)
    return float(0.5 * np.abs(np.exp(p) - np.exp(q)).sum())


def release_tv(metric: Metric, config: Config, band: tuple[int, int], with_values: np.ndarray, without_values: np.ndarray, epsilon: float | None, rng: np.random.Generator, samples: int = 4000) -> float:
    """The strongest attacker's advantage for one release (TV between with and without one baby)."""
    if config.mechanism == "exact" or epsilon is None:
        r = lambda v: release(metric, config, band, v, None, rng)  # noqa: E731
        return float(not np.array_equal(r(with_values), r(without_values)))
    if config.mechanism == "hist":
        return 1 - math.exp(-epsilon / 2)
    if config.mechanism == "em" and len(config.levels) == 1:
        return em_single_tv(metric, config, band, with_values, without_values, epsilon)
    return tv_from_losses(privacy_loss_samples(metric, config, band, with_values, without_values, epsilon, rng, samples))


def composed_tv(metric: Metric, config: Config, band: tuple[int, int], with_values: np.ndarray, without_values: np.ndarray, epsilon: float | None, releases: int, rng: np.random.Generator, samples: int = 4000) -> float:
    """Advantage over ``releases`` releases of the same cell with fresh noise (same data in each). Without noise the
    releases are identical, so repeating them adds nothing."""
    if config.mechanism == "exact" or epsilon is None:
        return release_tv(metric, config, band, with_values, without_values, None, rng)
    losses = np.zeros(samples)
    for _ in range(releases):
        losses += privacy_loss_samples(metric, config, band, with_values, without_values, epsilon, rng, samples)
    return tv_from_losses(losses)


def formal_advantage(epsilon: float) -> float:
    """The epsilon-DP bound on any attacker's advantage between two neighbouring datasets: tanh(epsilon / 2)."""
    return math.tanh(epsilon / 2)


def formal_posterior(epsilon: float, prior: float = 0.5) -> float:
    """Highest posterior an attacker can reach from ``prior`` that the baby is in: odds times e^epsilon."""
    odds = prior / (1 - prior) * math.exp(min(epsilon, 700))
    return odds / (1 + odds)


# ---------------------------------------------------------------------------------------------------------------
# Synthetic population: the earlier study's cohort (all babies), plus day sleep, plus the "messy" stress transform.

SCENARIOS = ("base", "messy")


def messy_observations(cohort: CommunityCohort, observations: dict[str, Observations], seed: int) -> dict[str, Observations]:
    """UNSOURCED stress test of the generator (more realistic logging, not a claim about babies): 20 % of formula
    babies are mixed feeders whose bottles are top-ups (x 0.45), an extra baby spread (lognormal sd 0.15), 3 % of
    bottles left half-finished (x 0.3), amounts typed as round numbers (10 or 30 ml); 30 % of babies log nights and naps patchily (on 40 % of their days a stretch of
    1-4 h of night or 30-120 min of naps is missing), an extra baby offset (night sd 45 min, day 30 min, naps 0.5), and
    15 % of babies miss one nap on half their days. The truth then sits below and wider than the norms."""
    rng = np.random.default_rng([seed, cohort.size, 34, 7])
    size = cohort.size
    out = dict(observations)
    bottle = observations["bottle_ml_per_feed"]
    factor = rng.lognormal(0, 0.15, size) * np.where(rng.random(size) < 0.2, 0.45, 1.0)
    partial = np.where(rng.random(len(bottle.value)) < 0.03, 0.3, 1.0)
    # parents type round amounts: 70 % of families to the nearest 10 ml, 30 % to the nearest 30 ml (many ties)
    unit = np.where(rng.random(size) < 0.3, 30.0, 10.0)[bottle.baby]
    typed = np.maximum(np.round(bottle.value * factor[bottle.baby] * partial / unit) * unit, 10.0)
    out["bottle_ml_per_feed"] = Observations(bottle.baby, bottle.day, bottle.week, typed, bottle.dimension)
    patchy = rng.random(size) < 0.3
    for key, gap, offset in (("night_sleep_minutes", (60, 240), 45), ("day_sleep_minutes", (30, 120), 30)):
        obs = observations[key]
        missing = (patchy[obs.baby] & (rng.random(len(obs.value)) < 0.4)) * rng.uniform(*gap, len(obs.value))
        value = np.clip(obs.value + rng.normal(0, offset, size)[obs.baby] - missing, 0, None)
        out[key] = Observations(obs.baby, obs.day, obs.week, value, obs.dimension)
    naps = observations["naps_per_day"]
    misses = (rng.random(size) < 0.15)[naps.baby] & (rng.random(len(naps.value)) < 0.5)
    value = np.clip(np.rint(naps.value + rng.normal(0, 0.5, size)[naps.baby]) - misses, 0, None)
    out["naps_per_day"] = Observations(naps.baby, naps.day, naps.week, value, naps.dimension)
    return out


def population(size: int, seed: int, scenario: str) -> tuple[CommunityCohort, dict[str, Observations]]:
    cohort = community_cohort(size, seed)
    observations = {key: cohort.observations[key] for key in ("bottle_ml_per_feed", "night_sleep_minutes", "naps_per_day")}
    observations["day_sleep_minutes"] = day_sleep_observations(cohort, seed)
    if scenario == "messy":
        observations = messy_observations(cohort, observations, seed)
    return cohort, observations


def _with(cohort: CommunityCohort, key: str, observations: Observations) -> CommunityCohort:
    return CommunityCohort(cohort.baby_id, cohort.family, cohort.heavy, cohort.bottle_kind, {key: observations})


def band_cells(metric: Metric, cohort: CommunityCohort, observations: Observations, edges: tuple[int, ...]) -> dict[tuple[int, int], community.CellInputs]:
    """The earlier pipeline's cells (clip, cap, one median per baby) for the metric on ``edges``; bottles: formula only."""
    cells = community.cell_inputs(metric.statistic, observations, _with(cohort, metric.key, observations), edges)
    return {(edges[band], edges[band + 1]): cell for (band, dim), cell in cells.items() if dim == 0}


@dataclass(frozen=True)
class BandPool:
    """One band of the population: every baby's summary (the cohort truth comes from these), plus a table of the
    cold-start MAE of a constant prediction c against the babies' daily values (each baby weighs the same)."""

    metric: str
    band: tuple[int, int]
    summaries: np.ndarray
    mae_grid: np.ndarray
    mae: np.ndarray

    def truth(self, levels: tuple[int, ...]) -> np.ndarray:
        return np.percentile(self.summaries, levels)

    def coverage(self, low: float, high: float) -> float:
        return float(np.mean((self.summaries >= low) & (self.summaries <= high)))

    def cold_start_mae(self, prediction: float) -> float:
        return float(np.interp(prediction, self.mae_grid, self.mae))


def _mae_table(metric: Metric, observations: Observations, band: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    rows = (observations.week >= band[0]) & (observations.week < band[1]) & (observations.dimension == 0)
    baby = observations.baby[rows]
    first = pd.Series(observations.day[rows]).groupby(baby).transform("min").to_numpy()
    keep = observations.day[rows] - first < community.COLD_START_DAYS
    values = np.clip(observations.value[rows][keep], *metric.clip)
    baby = baby[keep]
    _, inverse, counts = np.unique(baby, return_inverse=True, return_counts=True)
    weights = 1 / counts[inverse] / len(counts)
    order = np.argsort(values)
    values, weights = values[order], weights[order]
    grid = np.arange(metric.clip[0], metric.clip[1] + metric.step / 10, metric.step / 10)
    cw, cwv = np.concatenate([[0], np.cumsum(weights)]), np.concatenate([[0], np.cumsum(weights * values)])
    split = np.searchsorted(values, grid)
    mae = grid * cw[split] - cwv[split] + (cwv[-1] - cwv[split]) - grid * (cw[-1] - cw[split])
    return grid, mae


def build_pools(seed: int, scenario: str, size: int = POOL_SIZE, bands: tuple[tuple[int, int], ...] = STUDY_BANDS) -> dict[str, dict[tuple[int, int], BandPool]]:
    cohort, observations = population(size, seed, scenario)
    edges = tuple(sorted({edge for band in bands for edge in band} | {0, MAX_WEEK}))
    pools: dict[str, dict[tuple[int, int], BandPool]] = {}
    for key, metric in METRICS.items():
        cells = band_cells(metric, cohort, observations[key], edges)
        pools[key] = {}
        for band in bands:
            grid, mae = _mae_table(metric, observations[key], band)
            pools[key][band] = BandPool(key, band, cells[band].summaries, grid, mae)
    return pools


# ---------------------------------------------------------------------------------------------------------------
# Cell study.

STUDY_CONFIGS = tuple(CONFIGS)


def _cell_task(args) -> dict:
    """All cell sizes, configs and epsilons for one (scenario, metric, band); seeded per task, so the result does not
    depend on the number of workers."""
    scenario, key, band, summaries, mae_grid, mae, prior, reps, sizes, seed = args
    metric = METRICS[key]
    pool = BandPool(key, band, summaries, mae_grid, mae)
    truth = dict(zip(FIVE, pool.truth(FIVE)))
    rng = np.random.default_rng([seed, SCENARIOS.index(scenario), list(METRICS).index(key), band[0], 11])
    out: dict = {}
    for n in sizes:
        rows: dict[str, dict[str, list]] = {}
        for _ in range(reps):
            values = summaries[rng.choice(len(summaries), n, replace=False)]
            for name in STUDY_CONFIGS:
                config = CONFIGS[name]
                for epsilon in ((None,) if config.mechanism == "exact" else EPSILONS):
                    label = f"{name}@{'none' if epsilon is None else epsilon}"
                    got = dict(zip(config.levels, release(metric, config, band, values, epsilon, rng)))
                    row = rows.setdefault(label, {"err50": [], "err25": [], "err75": [], "cov50": [], "cov80": [], "mae_delta": [], "beats": []})
                    row["err50"].append(abs(got[50] - truth[50]))
                    if 25 in got:
                        row["err25"].append(abs(got[25] - truth[25]))
                        row["err75"].append(abs(got[75] - truth[75]))
                        row["cov50"].append(pool.coverage(got[25], got[75]) * 100)
                    if 10 in got:
                        row["cov80"].append(pool.coverage(got[10], got[90]) * 100)
                    if prior is not None:
                        row["mae_delta"].append(pool.cold_start_mae(got[50]) - pool.cold_start_mae(prior))
                        row["beats"].append(float(abs(got[50] - truth[50]) < abs(prior - truth[50])))
        out[n] = rows
    return {
        "scenario": scenario, "metric": key, "band": band, "pool": len(summaries), "truth": {str(k): float(v) for k, v in truth.items()},
        "iqr": float(truth[75] - truth[25]), "prior": prior, "prior_error": None if prior is None else abs(prior - truth[50]),
        "prior_mae": None if prior is None else pool.cold_start_mae(prior), "rows": out,
    }


def _summarise(values: list[float]) -> dict | None:
    if not values:
        return None
    array = np.asarray(values, float)
    return {"mean": float(array.mean()), "p90": float(np.percentile(array, 90))}


def summarise_cells(tasks: list[dict]) -> dict:
    """Per scenario, metric, cell size and config@epsilon: errors pooled over the study bands (mean and 90th
    percentile over cells), errors relative to each band's IQR, calibration and the cold-start delta."""
    out: dict = {}
    for task in tasks:
        scenario, key = task["scenario"], task["metric"]
        for n, rows in task["rows"].items():
            for label, row in rows.items():
                entry = out.setdefault(scenario, {}).setdefault(key, {}).setdefault(str(n), {}).setdefault(label, {k: [] for k in ("err50", "err25", "err75", "rel50", "cov50", "cov80", "mae_delta", "beats")})
                for metric_name in ("err50", "err25", "err75", "cov50", "cov80", "mae_delta", "beats"):
                    entry[metric_name].extend(row[metric_name])
                # relative to the band's IQR, at least one grid step (whole-number naps can have an IQR of 0)
                entry["rel50"].extend(np.asarray(row["err50"]) / max(task["iqr"], METRICS[key].step) * 100)
    summary: dict = {}
    for scenario, metrics in out.items():
        for key, sizes in metrics.items():
            for n, labels in sizes.items():
                for label, entry in labels.items():
                    summary.setdefault(scenario, {}).setdefault(key, {}).setdefault(n, {})[label] = {name: _summarise(values) for name, values in entry.items()}
    return summary


def band_facts(tasks: list[dict]) -> dict:
    facts: dict = {}
    for task in tasks:
        facts.setdefault(task["scenario"], {}).setdefault(task["metric"], []).append(
            {"band": list(task["band"]), "pool": task["pool"], "truth": task["truth"], "iqr": task["iqr"], "prior": task["prior"], "prior_error": task["prior_error"], "prior_mae": task["prior_mae"]}
        )
    return facts


# ---------------------------------------------------------------------------------------------------------------
# Privacy study (strong attacker, exact or Monte Carlo TV) and the weaker attacker's games.

PRIVACY_CONFIGS = ("exact5", "exact3", "exact1", "em5", "em3", "em1", "joint3", "joint5", "hist5", "smooth1")
COMPOSE_CONFIGS = ("em1", "joint3", "hist5", "smooth1")
COMPOSE_RELEASES = (4, 12, 52)


def _privacy_task(args) -> dict:
    scenario, key, band, summaries, reps, targets, samples, sizes, seed = args
    metric = METRICS[key]
    rng = np.random.default_rng([seed, list(METRICS).index(key), band[0], 13])
    out: dict = {}
    for n in sizes:
        cells = [summaries[rng.choice(len(summaries), n, replace=False)] for _ in range(reps)]
        for name in PRIVACY_CONFIGS:
            config = CONFIGS[name]
            for epsilon in ((None,) if config.mechanism == "exact" else EPSILONS):
                label = f"{name}@{'none' if epsilon is None else epsilon}"
                tvs, released, composed = [], [], {t: [] for t in COMPOSE_RELEASES}
                for raw in cells:
                    if config.mechanism == "exact":
                        values = raw
                        chosen = range(n)  # cheap: every member
                    else:
                        # the mechanism's own jitter, one draw shared by both worlds (the TV given the jitter; its
                        # average over draws bounds the TV of the jittered mechanism from above, by convexity)
                        values = dequantize(metric, raw, rng)
                        extreme = int(np.argmax(np.abs(values - np.median(values))))
                        chosen = [extreme] + list(rng.choice(n, targets - 1, replace=False))
                    for target in chosen:
                        without = np.delete(values, target)
                        tvs.append(release_tv(metric, config, band, values, without, epsilon, rng, samples))
                        if config.mechanism == "hist" and target == chosen[0]:
                            released.append(histogram_released_tv(metric, config, band, values, without, epsilon, rng, 5 * samples, COMPOSE_RELEASES))
                        if name in COMPOSE_CONFIGS and epsilon is not None and target == chosen[0]:
                            for releases in COMPOSE_RELEASES:
                                composed[releases].append(composed_tv(metric, config, band, values, without, epsilon, releases, rng, samples // 2))
                entry = {"mean": float(np.mean(tvs)), "max": float(np.max(tvs))}
                if released:
                    entry["released_lower_extreme"] = {t: float(np.mean([r[t] for r in released])) for t in released[0]}
                if any(composed.values()):
                    entry["composed_extreme"] = {str(t): float(np.mean(v)) for t, v in composed.items()}
                out.setdefault(str(n), {})[label] = entry
    return {"metric": key, "band": band, "rows": out}


GAME_CONFIGS = (("exact5", None), ("exact3", None), ("exact1", None), ("em1", 1.0), ("em1", 2.0), ("joint3", 2.0), ("joint3", 3.0), ("hist5", 2.0), ("hist5", 3.0))


def _threshold_advantage(positive: np.ndarray, negative: np.ndarray) -> float:
    """TPR - FPR at the best threshold, fitted on the first half of the trials and scored on the second half."""
    hp, hn = len(positive) // 2, len(negative) // 2
    candidates = np.unique(np.concatenate([positive[:hp], negative[:hn]]))
    gains = [np.mean(positive[:hp] >= t) - np.mean(negative[:hn] >= t) for t in candidates]
    threshold = candidates[int(np.argmax(gains))]
    return float(np.mean(positive[hp:] >= threshold) - np.mean(negative[hn:] >= threshold))


def _game_task(args) -> dict:
    """The weaker attacker: knows the target baby's own summary, not the other babies.

    ``withdrawal``: two consecutive releases; between them the target withdrew or not, and ``churn`` new babies (Poisson
    mean, a share of n) joined the cell in both worlds. Score: how far the released percentiles moved away from the
    target's side (removing a value above a percentile lowers it). ``single``: one release with the target, or with a
    random other baby in her place; score: closeness of the released median to her value (the earlier study's game)."""
    key, band, summaries, trials, sizes, seed = args
    metric = METRICS[key]
    rng = np.random.default_rng([seed, list(METRICS).index(key), band[0], 17])
    out: dict = {}
    for n in sizes:
        for name, epsilon in GAME_CONFIGS:
            config = CONFIGS[name]
            label = f"{name}@{'none' if epsilon is None else epsilon}"
            for churn in (0.0, 0.1):
                moved_w, moved_s, close_in, close_out = [], [], [], []
                for _ in range(trials):
                    chosen = rng.choice(len(summaries), n + 1 + int(3 * churn * n + 10), replace=False)
                    cell, replacement = summaries[chosen[:n]], summaries[chosen[n]]
                    joiners = summaries[chosen[n + 1:n + 1 + rng.poisson(churn * n)]]
                    target = cell[0]
                    first = release(metric, config, band, cell, epsilon, rng)
                    side = np.sign(target - first)
                    withdrew = release(metric, config, band, np.concatenate([cell[1:], joiners]), epsilon, rng)
                    stayed = release(metric, config, band, np.concatenate([cell, joiners]), epsilon, rng)
                    moved_w.append(float(np.sum(side * (first - withdrew))))
                    moved_s.append(float(np.sum(side * (first - stayed))))
                    if churn == 0.0:
                        median = list(config.levels).index(50)
                        close_in.append(-abs(float(first[median]) - target))
                        other = release(metric, config, band, np.concatenate([cell[1:], [replacement]]), epsilon, rng)
                        close_out.append(-abs(float(other[median]) - target))
                entry = out.setdefault(str(n), {}).setdefault(label, {})
                entry[f"withdrawal_churn{int(churn * 100)}"] = _threshold_advantage(np.asarray(moved_w), np.asarray(moved_s))
                if churn == 0.0:
                    entry["single"] = _threshold_advantage(np.asarray(close_in), np.asarray(close_out))
    return {"metric": key, "band": band, "rows": out}


# ---------------------------------------------------------------------------------------------------------------
# Instances: filling, cells per baby, and what a user sees at each week.

INSTANCE_SIZES = (250, 500, 1000, 2000, 4000)
GRIDS = {"fine": FINE_EDGES, "coarse": COARSE_EDGES, "wide": WIDE_EDGES}
INSTANCE_CONFIGS = (("exact3", None), ("joint3", 1.0), ("joint3", 2.0), ("joint3", 3.0), ("hist5", 2.0), ("hist5", 3.0), ("em1", 1.0), ("em1", 2.0))


def weekly_truth(metric: Metric, cohort: CommunityCohort, observations: Observations) -> np.ndarray:
    """Cohort truth of the median per week of age (weekly cells of the large population), NaN when empty."""
    edges = tuple(range(0, MAX_WEEK + 1))
    cells = band_cells(metric, cohort, observations, edges)
    return np.array([np.median(cells[(w, w + 1)].summaries) if (w, w + 1) in cells else np.nan for w in range(MAX_WEEK)])


def _instance_task(args) -> dict:
    size, seed, truths, noise_draws = args
    cohort, observations = population(size, seed + 1000, "base")
    rng = np.random.default_rng([seed, size, 19])
    out: dict = {"size": size, "babies": int(cohort.size), "families": int(len(np.unique(cohort.family))), "metrics": {}}
    for key, metric in METRICS.items():
        obs = observations[key]
        truth = np.asarray(truths[key])
        entry: dict = {"grids": {}}
        for grid_name, edges in GRIDS.items():
            cells = band_cells(metric, cohort, obs, edges)
            published = {band: cell for band, cell in cells.items() if community.admit(cell, K, False) is None}
            sizes = [len(cell.babies) for cell in published.values()]
            bands = list(zip(edges, edges[1:]))
            weeks_covered = [w for w in range(MAX_WEEK) if any(a <= w < b for (a, b) in published)]
            # published cells per baby per release on this grid (all of a baby's history is in every release)
            per_baby = pd.Series(np.concatenate([cell.babies for cell in published.values()])).value_counts() if published else pd.Series(dtype=int)
            errors: dict = {}
            for name, epsilon in INSTANCE_CONFIGS:
                config = CONFIGS[name]
                draws = 1 if epsilon is None else noise_draws
                week_errors = []
                for (a, b), cell in published.items():
                    for _ in range(draws):
                        got = dict(zip(config.levels, release(metric, config, (a, b), cell.summaries, epsilon, rng)))
                        week_errors.extend(abs(got[50] - truth[w]) for w in range(a, b) if not np.isnan(truth[w]))
                errors[f"{name}@{'none' if epsilon is None else epsilon}"] = float(np.mean(week_errors)) if week_errors else None
            entry["grids"][grid_name] = {
                "bands": len(bands), "published": len(published), "weeks_covered": len(weeks_covered) / MAX_WEEK,
                "median_babies": float(np.median(sizes)) if sizes else None, "p10_babies": float(np.percentile(sizes, 10)) if sizes else None,
                "cells_per_baby": {"median": float(per_baby.median()) if len(per_baby) else None, "p90": float(per_baby.quantile(0.9)) if len(per_baby) else None, "max": int(per_baby.max()) if len(per_baby) else None},
                "week_error": errors,
            }
        out["metrics"][key] = entry
    return out


# ---------------------------------------------------------------------------------------------------------------
# Run and report.


def _map(function, tasks: list, workers: int) -> list:
    if workers <= 1:
        return [function(task) for task in tasks]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(function, tasks))


def run(seed: int = 1, reps: int = 200, privacy_reps: int = 10, privacy_targets: int = 3, samples: int = 4000, trials: int = 600, noise_draws: int = 10, workers: int = 1, pool_size: int = POOL_SIZE, instance_sizes=INSTANCE_SIZES, cell_sizes=CELL_SIZES) -> dict:
    started = time.perf_counter()
    priors = load_priors()
    pools = {scenario: build_pools(seed, scenario, pool_size) for scenario in SCENARIOS}
    cell_tasks = [
        (scenario, key, band, pool.summaries, pool.mae_grid, pool.mae, prior_for(priors, key, *band), reps, cell_sizes, seed)
        for scenario in SCENARIOS for key, bands in pools[scenario].items() for band, pool in bands.items()
    ]
    cells = _map(_cell_task, cell_tasks, workers)
    privacy_tasks = [("base", key, band, pools["base"][key][band].summaries, privacy_reps, privacy_targets, samples, cell_sizes, seed) for key, band in PRIVACY_BANDS.items()]
    privacy = _map(_privacy_task, privacy_tasks, workers)
    games = _map(_game_task, [(key, band, pools["base"][key][band].summaries, trials, cell_sizes, seed) for key, band in PRIVACY_BANDS.items()], workers)
    cohort, observations = population(pool_size, seed, "base")
    truths = {key: weekly_truth(metric, cohort, observations[key]).tolist() for key, metric in METRICS.items()}
    instances = _map(_instance_task, [(size, seed, truths, noise_draws) for size in instance_sizes], workers)
    return {
        "parameters": {"seed": seed, "pool_size": pool_size, "reps": reps, "privacy_reps": privacy_reps, "privacy_targets": privacy_targets, "samples": samples, "trials": trials, "noise_draws": noise_draws, "k": K, "cell_sizes": list(cell_sizes), "epsilons": list(EPSILONS), "bands": [list(b) for b in STUDY_BANDS]},
        "bands": band_facts(cells),
        "cells": summarise_cells(cells),
        "privacy": privacy,
        "games": games,
        "instances": instances,
        "runtime_seconds": time.perf_counter() - started,
    }


def _f(value, digits: int = 1) -> str:
    return "n/a" if value is None or (isinstance(value, float) and math.isnan(value)) else f"{value:.{digits}f}"


REPORT_CONFIGS = (
    ("exact5", None),
    ("em5", 0.2), ("em5", 5.0), ("em3", 3.0),
    ("em1", 0.2), ("em1", 0.5), ("em1", 1.0), ("em1", 2.0),
    ("smooth1", 1.0), ("smooth1", 5.0),
    ("joint3", 1.0), ("joint3", 2.0), ("joint3", 3.0), ("joint5", 5.0),
    ("hist5", 1.0), ("hist5", 2.0), ("hist5", 3.0), ("hist5_band", 2.0),
)
"""Rows of the cell tables in the report (the JSON keeps every configuration and epsilon). The exact rows of 1, 3 and 5
percentiles share their median, so only the 5-percentile one is shown (it also carries both coverages)."""
PRIVACY_REPORT = (
    "exact5@none", "exact3@none", "exact1@none", "em5@0.2", "em1@0.5", "em1@1.0", "em1@2.0", "joint3@1.0", "joint3@2.0",
    "joint3@3.0", "hist5@0.5", "hist5@1.0", "hist5@2.0", "hist5@3.0", "smooth1@1.0",
)


def _label(name: str, epsilon) -> str:
    return f"{name}@{'none' if epsilon is None else epsilon}"


def markdown(report: dict) -> str:
    p = report["parameters"]
    pair_sizes = (p["cell_sizes"][0], 50 if 50 in p["cell_sizes"] else p["cell_sizes"][-1])
    lines = [
        "## Percentile statistics in small cells (2026-11-26 study)",
        "",
        f"Generated by `python -m benchmark.community_percentiles --seed {p['seed']}`: population of {p['pool_size']} synthetic babies per scenario, "
        f"{p['reps']} cells per band and cell size, bands {', '.join(f'{a}-{b}' for a, b in p['bands'])} (weeks); privacy: {p['privacy_reps']} cells x "
        f"{p['privacy_targets']} target babies per cell size, {p['samples']} Monte Carlo draws; games: {p['trials']} trials per world. Synthetic data only.",
        "",
    ]
    for scenario in SCENARIOS:
        for key in METRICS:
            unit = METRICS[key].unit
            facts = report["bands"][scenario][key]
            iqr = np.mean([f["iqr"] for f in facts])
            prior_errors = [f["prior_error"] for f in facts if f["prior_error"] is not None]
            lines += [
                f"### {key}, {scenario} cohort",
                "",
                f"Mean band IQR (p75 - p25 of the babies' medians) {iqr:.1f} {unit}; published-norms prior error on the median {_f(np.mean(prior_errors) if prior_errors else None)} {unit} "
                f"({len(prior_errors)} of {len(facts)} bands have a usable norm).",
                "",
                "Median error (mean / 90th percentile over cells, " + unit + ") by cell size; then for n = 20 and 50: error as % of the IQR, "
                "p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.",
                "",
                "| Release | " + " | ".join(f"n={n}" for n in p["cell_sizes"]) + " | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |",
                "|---|" + "---:|" * len(p["cell_sizes"]) + "---:|---:|---:|---:|---:|---:|",
            ]
            rows = report["cells"][scenario][key]
            for name, epsilon in REPORT_CONFIGS:
                label = _label(name, epsilon)
                cells = [rows[str(n)].get(label) for n in p["cell_sizes"]]
                if not all(cells):
                    continue
                err = " | ".join(f"{_f(c['err50']['mean'])} / {_f(c['err50']['p90'])}" for c in cells)
                pair = lambda metric, digits=0, scale=1.0: " / ".join(  # noqa: E731
                    _f(None if rows[str(n)][label][metric] is None else rows[str(n)][label][metric]["mean"] * scale, digits) for n in pair_sizes
                )
                quartiles = " / ".join(
                    "n/a" if rows[str(n)][label]["err25"] is None else f"{rows[str(n)][label]['err25']['mean']:.1f}, {rows[str(n)][label]['err75']['mean']:.1f}" for n in pair_sizes
                )
                lines.append(f"| {label} | {err} | {pair('rel50')} | {quartiles} | {pair('cov50')} | {pair('cov80')} | {pair('mae_delta', 1)} | {pair('beats', 0, 100)} |")
            lines.append("")
    lines += ["### Privacy: the strongest attacker's advantage (TV) per release", "",
              "Mean / max over target babies (the most extreme member of each cell plus random members; no-noise rows: every member). "
              "Formal bound tanh(epsilon / 2): " + ", ".join(f"{e}: {formal_advantage(e):.2f}" for e in p["epsilons"]) + ". The histogram row is its closed-form bound.", ""]
    for entry in report["privacy"]:
        key = entry["metric"]
        lines += [f"#### {key}, band {entry['band'][0]}-{entry['band'][1]} weeks", "", "| Release | " + " | ".join(f"n={n}" for n in p["cell_sizes"]) + " |", "|---|" + "---:|" * len(p["cell_sizes"])]
        labels = [label for label in entry["rows"][str(p["cell_sizes"][0])] if label in PRIVACY_REPORT]
        for label in labels:
            lines.append(f"| {label} | " + " | ".join(f"{entry['rows'][str(n)][label]['mean']:.2f} / {entry['rows'][str(n)][label]['max']:.2f}" for n in p["cell_sizes"]) + " |")
            if "released_lower_extreme" in entry["rows"][str(p["cell_sizes"][0])][label]:
                lines.append(f"| {label}, published numbers (lower bound, extreme member) | " + " | ".join(f"{entry['rows'][str(n)][label]['released_lower_extreme']['1']:.2f}" for n in p["cell_sizes"]) + " |")
        lines += ["", "Composed over T releases of the same cell with fresh noise, most extreme member (TV for T = " + ", ".join(map(str, COMPOSE_RELEASES)) + "):", "",
                  "| Release | " + " | ".join(f"n={n}" for n in p["cell_sizes"]) + " |", "|---|" + "---:|" * len(p["cell_sizes"])]
        for label in labels:
            first = entry["rows"][str(p["cell_sizes"][0])][label]
            if "composed_extreme" not in first:
                continue
            lines.append(f"| {label} | " + " | ".join(" / ".join(f"{entry['rows'][str(n)][label]['composed_extreme'][str(t)]:.2f}" for t in COMPOSE_RELEASES) for n in p["cell_sizes"]) + " |")
            if "released_lower_extreme" in first:
                lines.append(f"| {label}, published numbers (estimate from one percentile) | " + " | ".join(" / ".join(f"{entry['rows'][str(n)][label]['released_lower_extreme'][str(t)]:.2f}" for t in COMPOSE_RELEASES) for n in p["cell_sizes"]) + " |")
        lines.append("")
    lines += ["### Privacy: the weaker attacker (knows only the target's value)", "",
              "Advantage (TPR - FPR, threshold fitted on half the trials): withdrawal between two releases with no other change / with about 10 % new babies joining; single release (in or replaced).", ""]
    for entry in report["games"]:
        lines += [f"#### {entry['metric']}, band {entry['band'][0]}-{entry['band'][1]} weeks", "", "| Release | " + " | ".join(f"n={n}" for n in p["cell_sizes"]) + " |", "|---|" + "---:|" * len(p["cell_sizes"])]
        for label in entry["rows"][str(p["cell_sizes"][0])]:
            lines.append(f"| {label} | " + " | ".join(
                f"{entry['rows'][str(n)][label]['withdrawal_churn0']:.2f} / {entry['rows'][str(n)][label]['withdrawal_churn10']:.2f} / {entry['rows'][str(n)][label]['single']:.2f}" for n in p["cell_sizes"]) + " |")
        lines.append("")
    lines += ["### Instances: filling, cells per baby, error a user sees at each week", "",
              "Every baby of the instance opted in (an instance of N babies is N opted-in babies, about N / 1.3 families); median error over covered weeks of the published median against that week's cohort truth.", ""]
    for key in METRICS:
        lines += [f"#### {key}", "", "| Opted-in babies | Grid | Bands published | Weeks covered | Median babies per cell | Cells per baby (median / p90 / max) | Error exact3 | joint3@1 | joint3@2 | joint3@3 | hist5@2 | hist5@3 | em1@1 | em1@2 |",
                  "|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for instance in report["instances"]:
            for grid_name, g in instance["metrics"][key]["grids"].items():
                e = g["week_error"]
                cpb = g["cells_per_baby"]
                lines.append(
                    f"| {instance['babies']} | {grid_name} | {g['published']} of {g['bands']} | {g['weeks_covered']:.0%} | {_f(g['median_babies'], 0)} | {_f(cpb['median'], 0)} / {_f(cpb['p90'], 0)} / {_f(cpb['max'], 0)} | "
                    + " | ".join(_f(e[_label(n, eps)]) for n, eps in INSTANCE_CONFIGS) + " |"
                )
        lines.append("")
    lines += budget_markdown(report)
    lines.append(f"Runtime: {report['runtime_seconds']:.0f} s.")
    return "\n".join(lines) + "\n"


BUDGET_EPSILONS = (0.5, 1.0, 2.0, 3.0)
BUDGET_SCHEDULES = (("weekly, fine grid", "fine", 52), ("monthly, coarse grid", "coarse", 12), ("quarterly, coarse grid", "coarse", 4), ("quarterly, wide grid", "wide", 4))


def budget_markdown(report: dict, key: str = "night_sleep_minutes", babies: int = 1000) -> list[str]:
    """What the formal guarantee is worth: per cell and release, per baby and release (times the published cells she
    is in, measured on the instance of about ``babies``), and per year by basic composition (the bound for pure DP)."""
    instance = min(report["instances"], key=lambda i: abs(i["babies"] - babies))
    grids = instance["metrics"][key]["grids"]
    lines = ["### What the formal guarantee is worth", "",
             f"Basic composition (pure DP): a baby in C published cells of a statistic per release, R releases a year, spends epsilon x C x R per statistic per year. "
             f"C measured on the {instance['babies']}-baby instance ({key}; median / p90 of the babies' published cells; the generator's babies log 2-16 weeks, a baby logged for a whole year is in about 13 coarse cells). "
             "Bound on any attacker's advantage tanh(e / 2). A family of s babies spends s times as much.", "",
             "| epsilon per cell and release | bound per cell and release | Schedule | C (median / p90) | epsilon per baby per year (median / p90) | bound per year (median baby) |",
             "|---:|---:|---|---|---|---:|"]
    for epsilon in BUDGET_EPSILONS:
        for label, grid, releases in BUDGET_SCHEDULES:
            cpb = grids[grid]["cells_per_baby"]
            if cpb["median"] is None:
                continue
            year = [epsilon * c * releases for c in (cpb["median"], cpb["p90"])]
            lines.append(f"| {epsilon} | {formal_advantage(epsilon):.2f} | {label} | {cpb['median']:.0f} / {cpb['p90']:.0f} | {year[0]:.0f} / {year[1]:.0f} | {formal_advantage(year[0]):.3f} |")
    lines.append("")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--reps", type=int, default=200)
    parser.add_argument("--privacy-reps", type=int, default=10)
    parser.add_argument("--samples", type=int, default=4000)
    parser.add_argument("--trials", type=int, default=600)
    parser.add_argument("--workers", type=int, default=min(12, os.cpu_count() or 1))
    parser.add_argument("--pool-size", type=int, default=POOL_SIZE)
    parser.add_argument("--out", default="out")
    parser.add_argument("--render", action="store_true", help="only rewrite percentiles.md from an existing percentiles.json")
    args = parser.parse_args(argv)
    if args.render:
        out = Path(args.out)
        (out / "percentiles.md").write_text(markdown(json.loads((out / "percentiles.json").read_text(encoding="utf-8"))), encoding="utf-8")
        return 0
    report = run(args.seed, args.reps, args.privacy_reps, 3, args.samples, args.trials, 10, args.workers, args.pool_size)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "percentiles.json").write_text(json.dumps(report, indent=1, default=float), encoding="utf-8")
    (out / "percentiles.md").write_text(markdown(report), encoding="utf-8")
    print(f"wrote {out / 'percentiles.md'} and {out / 'percentiles.json'} in {report['runtime_seconds']:.0f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
