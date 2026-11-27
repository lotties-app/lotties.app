"""Checks of the built percentile configuration (benchmark/community_percentiles_built.py), the one the API implements:
the snapped bin's privacy loss against the definition, the cell bound and "one summary per baby" through the real cell
code (removing one baby moves each of her at most 4 cells' counts by exactly one and nothing else), the window, the
read-out's "nothing" case and determinism. Synthetic data only."""

from __future__ import annotations

import numpy as np

from benchmark import community_percentiles_built as built
from benchmark.community_percentiles import METRICS, histogram_counts, histogram_edges, population


def test_snap_grid_is_the_smallest_power_of_two_at_least_the_scale():
    assert built.snap_grid(0.5) == 0.5
    assert built.snap_grid(0.2) == 0.25
    assert built.snap_grid(10.0) == 16.0
    assert built.snap_grid(5.0) == 8.0


def test_snapped_bin_privacy_loss_never_exceeds_epsilon():
    scale = 1 / built.EPSILON_PER_CELL
    support = np.arange(-80, 160) * built.snap_grid(scale)
    for count in range(0, 40):
        p, q = built.snapped_pmf(count, scale, support), built.snapped_pmf(count + 1, scale, support)
        assert abs(p.sum() - 1) < 1e-9
        mask = (p > 1e-300) & (q > 1e-300)
        assert np.max(np.abs(np.log(p[mask]) - np.log(q[mask]))) <= built.EPSILON_PER_CELL + 1e-9


def test_snapped_sampler_matches_the_exact_pmf():
    rng = np.random.default_rng(3)
    scale = 0.5
    draws = built.snapped(np.full(200000, 7.0), scale, rng.laplace(0, scale, 200000))
    support = np.arange(-20, 60) * built.snap_grid(scale)
    exact = built.snapped_pmf(7.0, scale, support)
    observed = np.array([(draws == point).mean() for point in support])
    assert 0.5 * np.abs(exact - observed).sum() < 0.01


def test_readout_publishes_nothing_when_the_noisy_total_is_not_positive():
    metric = METRICS["bottle_ml_per_feed"]
    edges = histogram_edges(metric, *metric.clip)
    assert built.readout(np.zeros(len(edges) - 1), edges, metric) is None
    assert built.readout(np.r_[-0.5, np.zeros(len(edges) - 2)], edges, metric) is None
    # A bin's count is spread evenly over the bin: 20 babies at 150 ml (bin 135-155) read 140, 140, 150.
    got = built.readout(histogram_counts(np.full(20, 150.0), edges), edges, metric)
    assert got is not None and list(got) == [140.0, 140.0, 150.0]


def _cells(seed: int = 4, size: int = 1500):
    cohort, observations = population(size, seed, "base")
    window = built.windowed(cohort, observations, seed)
    return cohort, window


def test_window_keeps_only_the_quarter():
    _, window = _cells()
    for obs in window.values():
        assert obs.day.min() >= 0 and obs.day.max() < built.QUARTER_DAYS


def test_a_baby_is_in_at_most_four_cells_and_removing_her_moves_only_her_cells_by_one():
    cohort, window = _cells()
    metric = METRICS["night_sleep_minutes"]
    obs = window["night_sleep_minutes"]
    cells = built.built_cells(metric, cohort, obs)
    members = np.concatenate([cell.babies for cell in cells.values()])
    assert np.bincount(members).max() <= built.MAX_CELLS
    edges = histogram_edges(metric, *metric.clip)
    for target in np.unique(members)[:4]:
        without = built.built_cells(metric, cohort, obs.take(obs.baby != target))
        her = {band for band, cell in cells.items() if target in cell.babies}
        assert len(her) <= built.MAX_CELLS
        for band, cell in cells.items():
            before = histogram_counts(np.clip(cell.summaries, *metric.clip), edges)
            after_cell = without.get(band)
            after = histogram_counts(np.clip(after_cell.summaries, *metric.clip), edges) if after_cell else np.zeros_like(before)
            assert np.abs(before - after).sum() == (1 if band in her else 0)
            others = cell.babies != target
            if after_cell is not None:
                assert np.array_equal(cell.summaries[others], after_cell.summaries)


def test_the_cell_bound_depends_only_on_the_babys_own_data():
    cohort, window = _cells()
    metric = METRICS["naps_per_day"]
    obs = window["naps_per_day"]
    cells = built.built_cells(metric, cohort, obs)
    target = int(np.bincount(np.concatenate([c.babies for c in cells.values()])).argmax())
    alone = built.built_cells(metric, cohort, obs.take(obs.baby == target))
    assert {band for band, c in cells.items() if target in c.babies} == set(alone)


def test_release_is_deterministic_for_a_seed():
    metric = METRICS["day_sleep_minutes"]
    cell = np.linspace(100, 300, 20)
    a = built.built_release(metric, cell, np.random.default_rng(9))
    b = built.built_release(metric, cell, np.random.default_rng(9))
    assert np.array_equal(a, b)
