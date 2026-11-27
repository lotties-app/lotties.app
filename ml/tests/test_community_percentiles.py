"""Correctness checks of the percentile-study mechanisms (benchmark/community_percentiles.py).

A DP claim is only as good as its sensitivity, so every mechanism is checked against the definition itself, not
against its own derivation: for small datasets and every add/remove neighbour (each value removed; a value added at the
edges, on grid points and between them), the exact output log-probabilities never differ by more than epsilon. The
pipeline's "one summary per baby" (which sets the histogram's sensitivity) is checked on the real cell code: taking one
baby's rows out changes each cell's counts by at most one. The Monte Carlo advantage estimates are checked against
closed forms. Synthetic data only."""

from __future__ import annotations

import itertools
import json
import math

import numpy as np
import pytest

from benchmark import community
from benchmark import community_percentiles as cp
from benchmark.synthetic import community_cohort, day_sleep_observations

EPSILONS = (0.3, 1.0, 3.0)
LOW, HIGH, STEP = 0.0, 100.0, 10.0
GRID = cp.grid_for(LOW, HIGH, STEP)


def datasets(seed: int, count: int = 25) -> list[np.ndarray]:
    """Random and adversarial small datasets in [LOW, HIGH]: spread, clustered, ties on grid points, edge values."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(count):
        n = int(rng.integers(2, 12))
        kind = i % 4
        if kind == 0:
            values = rng.uniform(LOW, HIGH, n)
        elif kind == 1:
            values = rng.normal(40, 3, n)
        elif kind == 2:
            values = rng.choice(GRID, n)
        else:
            values = np.concatenate([rng.choice([LOW, HIGH], n // 2), rng.uniform(LOW, HIGH, n - n // 2)])
        out.append(np.clip(values, LOW, HIGH))
    return out


def neighbours(values: np.ndarray) -> list[np.ndarray]:
    """Every add/remove neighbour that matters for rank utilities: each value removed, and a value added at both edges,
    at every grid point and in the middle of every grid interval."""
    removed = [np.delete(values, i) for i in range(len(values)) if len(values) > 1]
    extra = np.concatenate([GRID, (GRID[:-1] + GRID[1:]) / 2, [LOW, HIGH]])
    return removed + [np.append(values, x) for x in extra]


def nondecreasing(m: int, size: int) -> np.ndarray:
    return np.array(list(itertools.combinations_with_replacement(range(size), m)))


# ---------------------------------------------------------------------------------------------------------------
# Exponential mechanism, one percentile


@pytest.mark.parametrize("epsilon", EPSILONS)
@pytest.mark.parametrize("level", (10, 50, 75))
def test_em_single_is_epsilon_dp_for_add_remove(epsilon, level):
    worst = 0.0
    for values in datasets(1):
        p = cp.em_log_probs(np.sort(values), level, epsilon, GRID)
        assert np.isclose(np.exp(p).sum(), 1)
        for other in neighbours(values):
            q = cp.em_log_probs(np.sort(other), level, epsilon, GRID)
            worst = max(worst, float(np.abs(p - q).max()))
    assert worst <= epsilon + 1e-9
    assert worst >= 0.8 * epsilon  # calibrated to the real sensitivity: some neighbour gets near the budget


def test_the_earlier_studys_calibration_spends_only_part_of_the_budget_on_a_median():
    """The earlier study's exponential mechanism (sensitivity 1) is at most epsilon / 2-DP for a median under add/remove:
    correct but wasteful, which is one reason its medians were so noisy."""
    worst = 0.0
    for values in datasets(1):
        p = cp.em_log_probs(np.sort(values), 50, 1.0, GRID, sensitivity=1.0)
        for other in neighbours(values):
            worst = max(worst, float(np.abs(p - cp.em_log_probs(np.sort(other), 50, 1.0, GRID, sensitivity=1.0)).max()))
    assert worst <= 0.5 + 1e-9


def test_em_quantiles_draws_like_the_earlier_study():
    values = np.random.default_rng(0).uniform(0, 400, 33)
    for levels in ((10, 25, 50, 75, 90), (50,)):
        ours = cp.em_quantiles(values, levels, 0.7, cp.grid_for(0, 400, 10), np.random.default_rng(5), tight=False)
        theirs = community.dp_quantiles(values, levels, 0.7, (0, 400), 10, np.random.default_rng(5))
        assert np.array_equal(ours, theirs)


# ---------------------------------------------------------------------------------------------------------------
# Joint exponential mechanism


@pytest.mark.parametrize("levels", ((50,), (25, 75), (25, 50, 75)))
def test_joint_probabilities_sum_to_one_and_match_the_single_mechanism(levels):
    values = np.sort(np.random.default_rng(2).uniform(LOW, HIGH, 9))
    tables = cp.joint_tables(values, levels, 1.0, GRID)
    tuples = nondecreasing(len(levels), len(GRID))
    assert np.isclose(np.exp(cp.joint_log_prob(tables, tuples)).sum(), 1)
    if len(levels) == 1:
        assert np.allclose(cp.joint_log_prob(tables, tuples), cp.em_log_probs(values, 50, 1.0, GRID))


@pytest.mark.parametrize("epsilon", EPSILONS)
@pytest.mark.parametrize("levels", ((25, 75), (25, 50, 75)))
def test_joint_is_epsilon_dp_for_add_remove(epsilon, levels):
    tuples = nondecreasing(len(levels), len(GRID))
    worst = 0.0
    for values in datasets(3, 15):
        p = cp.joint_log_prob(cp.joint_tables(np.sort(values), levels, epsilon, GRID), tuples)
        for other in neighbours(values):
            q = cp.joint_log_prob(cp.joint_tables(np.sort(other), levels, epsilon, GRID), tuples)
            worst = max(worst, float(np.abs(p - q).max()))
    assert worst <= epsilon + 1e-9
    assert worst >= 0.6 * epsilon


def test_joint_sensitivities():
    assert cp.joint_sensitivity((50,)) == pytest.approx(1.0)
    assert cp.joint_sensitivity((25, 50, 75)) == pytest.approx(1.5)
    assert cp.joint_sensitivity((10, 25, 50, 75, 90)) == pytest.approx(1.8)


def test_joint_sampler_draws_from_the_exact_distribution():
    values = np.sort(np.random.default_rng(4).uniform(LOW, HIGH, 12))
    levels = (25, 50, 75)
    tables = cp.joint_tables(values, levels, 2.0, GRID)
    tuples = nondecreasing(3, len(GRID))
    exact = np.exp(cp.joint_log_prob(tables, tuples))
    draws = cp.joint_sample_indices(tables, np.random.default_rng(1), 200_000)
    assert (np.diff(draws, axis=1) >= 0).all()
    index = {tuple(t): i for i, t in enumerate(tuples)}
    empirical = np.bincount([index[tuple(d)] for d in draws], minlength=len(tuples)) / len(draws)
    assert 0.5 * np.abs(empirical - exact).sum() < 0.015


# ---------------------------------------------------------------------------------------------------------------
# Histogram: sensitivity through the real pipeline, and the read-out


def test_one_baby_changes_each_cells_histogram_by_at_most_one():
    """One summary per baby per cell, the 14-day cap of the other babies untouched: removing every row of one baby
    changes the counts of a cell she is in by exactly one, of every other cell by zero (L1 sensitivity 1 per cell)."""
    cohort = community_cohort(1500, seed=11)
    for key in ("bottle_ml_per_feed", "night_sleep_minutes", "naps_per_day"):
        metric = cp.METRICS[key]
        observations = cohort.observations[key]
        edges = cp.grid_for(*metric.clip, metric.bin_width)
        full = cp.band_cells(metric, cohort, observations, community.FINE_EDGES)
        heavy = int(np.flatnonzero(cohort.heavy)[0])
        for baby in (heavy, 3, 77, 500):
            reduced = cp.band_cells(metric, cohort, observations.take(observations.baby != baby), community.FINE_EDGES)
            for band, cell in full.items():
                assert (np.unique(cell.babies, return_counts=True)[1] == 1).all()
                before = cp.histogram_counts(cell.summaries, edges)
                after = cp.histogram_counts(reduced[band].summaries, edges) if band in reduced else np.zeros_like(before)
                assert np.abs(before - after).sum() == (1 if baby in cell.babies else 0)
                if band in reduced:
                    others = cell.babies != baby
                    assert np.array_equal(cell.summaries[others], reduced[band].summaries)


def test_histogram_edges_cover_the_range_with_published_values_inside_bins():
    for key, metric in cp.METRICS.items():
        for band in ((2, 3), (36, 40)):
            for low, high in (metric.clip, metric.band_range(*band)):
                edges = cp.histogram_edges(metric, low, high)
                assert edges[0] <= low and edges[-1] >= high
                assert np.allclose(np.diff(edges), metric.bin_width)
                published = cp.grid_for(low, high, metric.step)
                distance = np.min(np.abs(published[:, None] - edges[None, :]), axis=1)
                assert distance.min() >= metric.step / 2 - 1e-9  # no published value on an edge


def test_histogram_read_out_is_close_to_the_exact_percentiles_without_noise():
    rng = np.random.default_rng(6)
    edges = cp.grid_for(0, 400, 20)
    for _ in range(50):
        values = rng.normal(160, 35, int(rng.integers(20, 300)))
        got = cp.histogram_quantiles(values, cp.FIVE, None, edges, rng)
        assert np.all(np.abs(got - np.percentile(np.clip(values, 0, 400), cp.FIVE)) <= 20 + 1e-9)
        assert np.all(np.diff(got) >= 0)


def test_isotonic_fit_is_monotone_least_squares():
    rng = np.random.default_rng(8)
    for _ in range(200):
        y = np.cumsum(rng.laplace(0, 2, int(rng.integers(1, 30))) + rng.integers(0, 3))
        fit = cp.isotonic_increasing(y)
        assert np.all(np.diff(fit) >= -1e-12)
        assert np.isclose(fit.sum(), y.sum())  # PAVA keeps block means
        # no monotone perturbation does better
        assert ((fit - y) ** 2).sum() <= ((np.maximum.accumulate(y) - y) ** 2).sum() + 1e-9


def test_batch_isotonic_and_read_out_equal_the_loop_versions():
    rng = np.random.default_rng(12)
    edges = cp.histogram_edges(cp.METRICS["bottle_ml_per_feed"], 0, 400)
    counts = np.histogram(rng.normal(160, 40, 25), bins=edges)[0][None, :] + rng.laplace(0, 1.5, (300, len(edges) - 1))
    cumulative = np.cumsum(counts, axis=1)
    assert np.allclose(cp.isotonic_batch(cumulative, chunk=64), np.array([cp.isotonic_increasing(row) for row in cumulative]))
    batch = cp.quantiles_from_counts_batch(counts, cp.FIVE, edges)
    loop = np.array([cp.quantiles_from_counts(row, cp.FIVE, edges) for row in counts])
    assert np.allclose(batch, loop)


def test_histogram_released_lower_bound_is_below_the_histogram_bound():
    metric, config = cp.METRICS["bottle_ml_per_feed"], cp.CONFIGS["hist5"]
    values = np.random.default_rng(3).normal(160, 35, 20)
    without = np.delete(values, int(np.argmax(values)))
    rng = np.random.default_rng(1)
    for epsilon in (1.0, 3.0):
        lower = cp.histogram_released_tv(metric, config, (10, 11), values, without, epsilon, rng, 40000, (4,))
        assert lower["1"] <= 1 - math.exp(-epsilon / 2) + 0.02
        assert lower["1"] <= lower["4"] <= 1 - math.exp(-2 * epsilon) + 0.05
    floor = cp.histogram_released_tv(metric, config, (10, 11), values, values, 2.0, rng, 40000)
    assert floor["1"] < 0.03  # the plug-in estimate's own bias on identical worlds


@pytest.mark.parametrize("epsilon", EPSILONS)
def test_histogram_loss_is_bounded_and_tv_matches_the_closed_form(epsilon):
    metric, config = cp.METRICS["bottle_ml_per_feed"], cp.CONFIGS["hist5"]
    losses = cp.privacy_loss_samples(metric, config, (10, 11), np.arange(25.0), np.arange(24.0), epsilon, np.random.default_rng(1), 400_000)
    assert np.abs(losses).max() <= epsilon + 1e-12
    assert cp.tv_from_losses(losses) == pytest.approx(1 - math.exp(-epsilon / 2), abs=0.004)


# ---------------------------------------------------------------------------------------------------------------
# Smooth sensitivity median


@pytest.mark.parametrize("epsilon", EPSILONS)
def test_cauchy_like_noise_is_admissible(epsilon):
    """Sliding: h(z) <= e^(eps/2) h(z + d) for |d| <= alpha; dilation: h(z) <= e^(eps/2) e^l h(e^l z) for |l| <= beta."""
    alpha, beta = cp.smooth_parameters(epsilon)
    z = np.concatenate([np.linspace(-60, 60, 120_001), np.geomspace(60, 1e6, 2000), -np.geomspace(60, 1e6, 2000)])
    h = cp.smooth_log_density
    for d in np.linspace(-alpha, alpha, 41):
        assert (h(z) - h(z + d)).max() <= epsilon / 2 + 1e-9
    for lam in np.linspace(-beta, beta, 41):
        assert (h(z) - h(np.exp(lam) * z) - lam).max() <= epsilon / 2 + 1e-9


def test_cauchy_like_noise_sampler_matches_its_density():
    draws = np.sort(cp.smooth_noise(np.random.default_rng(3), 200_000))
    grid = np.linspace(-30, 30, 60_001)
    cdf = np.cumsum(np.exp(cp.smooth_log_density(grid))) * (grid[1] - grid[0])
    empirical = np.searchsorted(draws, grid) / len(draws)
    assert np.abs(empirical - cdf).max() < 0.01


@pytest.mark.parametrize("epsilon", EPSILONS)
def test_smooth_sensitivity_is_a_smooth_upper_bound_for_add_remove(epsilon):
    """The two conditions of NRS07 definition 2.1, checked for add/remove neighbours (the formula is stated for
    substitution): S(x) >= |f(x) - f(y)| and S(x) <= e^beta S(y) for every neighbour y."""
    _, beta = cp.smooth_parameters(epsilon)
    for values in datasets(5, 40):
        x = np.sort(values)
        sx = cp.smooth_sensitivity_median(x, beta, LOW, HIGH)
        fx = x[cp.median_index(len(x))]
        for other in neighbours(values):
            y = np.sort(other)
            sy = cp.smooth_sensitivity_median(y, beta, LOW, HIGH)
            assert sx + 1e-9 >= abs(fx - y[cp.median_index(len(y))])
            assert sx <= math.exp(beta) * sy + 1e-9


@pytest.mark.parametrize("epsilon", EPSILONS)
def test_smooth_median_is_epsilon_dp_end_to_end(epsilon):
    """The release density of x_(m) + S(x) / alpha * Z, compared with every neighbour's on a fine output grid."""
    alpha, beta = cp.smooth_parameters(epsilon)
    w = np.linspace(-400, 500, 9001)

    def log_density(values):
        x = np.sort(values)
        scale = cp.smooth_sensitivity_median(x, beta, LOW, HIGH) / alpha
        return cp.smooth_log_density((w - x[cp.median_index(len(x))]) / scale) - math.log(scale)

    worst = 0.0
    for values in datasets(9, 15):
        p = log_density(values)
        for other in neighbours(values):
            worst = max(worst, float(np.abs(p - log_density(other)).max()))
    assert worst <= epsilon + 1e-9


# ---------------------------------------------------------------------------------------------------------------
# Advantage estimates


@pytest.mark.parametrize("name", ("em1", "em3", "joint3", "smooth1"))
@pytest.mark.parametrize("epsilon", (0.5, 2.0))
def test_release_tv_is_zero_for_the_same_data_and_below_the_bound(name, epsilon):
    metric, config = cp.METRICS["bottle_ml_per_feed"], cp.CONFIGS[name]
    rng = np.random.default_rng(2)
    values = rng.normal(160, 35, 25)
    assert cp.release_tv(metric, config, (10, 11), values, values, epsilon, rng, 4000) == pytest.approx(0, abs=1e-12)
    for target in (int(np.argmax(values)), 0):
        tv = cp.release_tv(metric, config, (10, 11), values, np.delete(values, target), epsilon, rng, 20_000)
        assert 0 <= tv <= cp.formal_advantage(epsilon) + 0.02


def test_monte_carlo_tv_matches_the_exact_sum_for_one_percentile():
    metric, config = cp.METRICS["night_sleep_minutes"], cp.CONFIGS["em1"]
    values = np.random.default_rng(7).normal(600, 60, 20)
    without = np.delete(values, int(np.argmax(values)))
    exact = cp.em_single_tv(metric, config, (36, 40), values, without, 2.0)
    mc = cp.tv_from_losses(cp.privacy_loss_samples(metric, config, (36, 40), values, without, 2.0, np.random.default_rng(1), 400_000))
    assert mc == pytest.approx(exact, abs=0.005)
    # and the joint mechanism with one percentile is the same mechanism
    joint = cp.Config("j1", "joint", (50,))
    mc_joint = cp.tv_from_losses(cp.privacy_loss_samples(metric, joint, (36, 40), values, without, 2.0, np.random.default_rng(1), 400_000))
    assert mc_joint == pytest.approx(exact, abs=0.005)


def test_composition_grows_but_stays_below_the_composed_bound():
    metric, config = cp.METRICS["bottle_ml_per_feed"], cp.CONFIGS["hist5"]
    rng = np.random.default_rng(4)
    one = cp.composed_tv(metric, config, (10, 11), np.arange(20.0), np.arange(19.0), 1.0, 1, rng, 100_000)
    assert one == pytest.approx(1 - math.exp(-0.5), abs=0.01)
    twelve = cp.composed_tv(metric, config, (10, 11), np.arange(20.0), np.arange(19.0), 1.0, 12, rng, 100_000)
    assert one < twelve <= cp.formal_advantage(12.0)


def test_exact_release_tv_is_whether_a_rounded_number_moves():
    metric, config = cp.METRICS["bottle_ml_per_feed"], cp.CONFIGS["exact1"]
    values = np.array([100.0] * 10 + [200.0] * 11)
    assert cp.release_tv(metric, config, (10, 11), values, np.delete(values, 0), None, np.random.default_rng(0)) == 0.0
    values = np.array([100.0] * 10 + [200.0] * 10)
    assert cp.release_tv(metric, config, (10, 11), values, np.delete(values, 0), None, np.random.default_rng(0)) == 1.0


# ---------------------------------------------------------------------------------------------------------------
# Releases, ranges, generator


def test_exact_release_is_the_rounded_percentile():
    metric = cp.METRICS["night_sleep_minutes"]
    values = np.random.default_rng(1).normal(600, 70, 37)
    got = cp.release(metric, cp.CONFIGS["exact5"], (36, 40), values, None, np.random.default_rng(0))
    assert np.array_equal(got, np.round(np.percentile(values, cp.FIVE) / 10) * 10)


@pytest.mark.parametrize("name", ("em1", "joint3", "hist5"))
def test_ties_on_the_grid_do_not_push_noisy_percentiles_up(name):
    """Half-integer nap medians with the true median at the top of a tie block (55 % at 2.5, 30 % at 3.0, 15 % at
    3.5): with the half-step jitter a nearly noiseless release finds 2.5, as the exact percentile does; without it the
    rank utility and the histogram read-out would say 3.0."""
    metric, config = cp.METRICS["naps_per_day"], cp.CONFIGS[name]
    values = np.repeat([2.5, 3.0, 3.5], [110, 60, 30])
    assert cp.release(metric, cp.CONFIGS["exact1"], (24, 26), values, None, np.random.default_rng(0))[0] == 2.5
    rng = np.random.default_rng(1)
    medians = [dict(zip(config.levels, cp.release(metric, config, (24, 26), values, 50.0, rng)))[50] for _ in range(100)]
    assert np.mean(np.asarray(medians) == 2.5) >= 0.8


@pytest.mark.parametrize("name", [name for name, c in cp.CONFIGS.items() if c.mechanism != "exact"])
def test_every_release_is_sorted_rounded_and_inside_its_range(name):
    config = cp.CONFIGS[name]
    rng = np.random.default_rng(3)
    for key, metric in cp.METRICS.items():
        band = cp.PRIVACY_BANDS[key]
        low, high = cp.config_range(metric, config, band)
        for epsilon in (0.2, 3.0):
            got = cp.release(metric, config, band, rng.uniform(*metric.clip, 25), epsilon, rng)
            assert len(got) == len(config.levels)
            assert np.all(np.diff(got) >= 0) and np.all((got >= low) & (got <= high))
            assert np.allclose(got / metric.step, np.round(got / metric.step))


def test_band_ranges_are_fixed_and_hold_the_cohort():
    """Band ranges come from the public reference curve only (same input, same range) and, in the base cohort, hold
    the middle 98 % of the babies' summaries in every study band."""
    pools = cp.build_pools(seed=2, scenario="base", size=6000, bands=((2, 3), (10, 11), (36, 40)))
    for key, bands in pools.items():
        metric = cp.METRICS[key]
        for band, pool in bands.items():
            low, high = metric.band_range(*band)
            assert (low, high) == metric.band_range(*band)
            p1, p99 = np.percentile(pool.summaries, [1, 99])
            assert low <= p1 and p99 <= high


def test_day_sleep_leaves_the_cohort_unchanged_and_is_deterministic():
    a, b = community_cohort(400, 5), community_cohort(400, 5)
    first, second = day_sleep_observations(a, 5), day_sleep_observations(b, 5)
    assert np.array_equal(first.value, second.value)
    assert all(np.array_equal(a.observations[k].value, b.observations[k].value) for k in a.observations)
    assert (first.value >= 0).all() and np.array_equal(first.day, a.observations["night_sleep_minutes"].day)


def test_messy_cohort_is_lower_and_wider_than_base():
    base = cp.build_pools(seed=2, scenario="base", size=6000, bands=((10, 11), (36, 40)))
    messy = cp.build_pools(seed=2, scenario="messy", size=6000, bands=((10, 11), (36, 40)))
    for key in ("bottle_ml_per_feed", "night_sleep_minutes"):
        for band in base[key]:
            b, m = base[key][band].truth((25, 50, 75)), messy[key][band].truth((25, 50, 75))
            assert m[1] < b[1] and (m[2] - m[0]) > (b[2] - b[0])


def test_cold_start_table_is_the_mean_absolute_error():
    pools = cp.build_pools(seed=3, scenario="base", size=3000, bands=((10, 11),))
    pool = pools["naps_per_day"][(10, 11)]
    assert pool.cold_start_mae(pool.mae_grid[0]) >= pool.cold_start_mae(float(np.median(pool.summaries)))
    assert pool.mae.min() >= 0


def test_formal_numbers():
    assert cp.formal_advantage(0.2) == pytest.approx(0.0997, abs=1e-4)
    assert cp.formal_posterior(1.0) == pytest.approx(math.e / (1 + math.e))


def test_determinism_for_a_seed():
    def report(seed):
        out = cp.run(seed, reps=3, privacy_reps=1, privacy_targets=2, samples=200, trials=20, noise_draws=1, workers=1, pool_size=4000, instance_sizes=(300,), cell_sizes=(20, 30))
        assert "Percentile statistics" in cp.markdown(out)
        out.pop("runtime_seconds")
        return json.dumps(out, sort_keys=True, default=float)

    assert report(3) == report(3)
