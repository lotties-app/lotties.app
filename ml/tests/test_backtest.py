"""End-to-end backtest regression on synthetic data: no future rows in training, sane accuracy on a regular baby."""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pytest

from benchmark.backtest import data_days, evaluate, local_days, prepare, train_set
from benchmark.data import local_midnight
from benchmark.metrics import bootstrap_improvement, scores
from benchmark.synthetic import generate


@pytest.fixture(scope="module")
def prepared():
    return prepare(generate(days=30, seed=11))


def test_training_rows_are_all_known_at_refit(prepared):
    first, last = data_days(prepared.dataset)
    at = local_midnight(last - timedelta(days=3), -3 * 3600.0)
    for name, target in prepared.targets.items():
        train = train_set(prepared, target, at)
        assert np.all(train.t + train.y * 60 <= at), name
        assert np.all(train.censored_t < at), name
        assert np.all(train.censored_after <= target.spec.cap_minutes), name


@pytest.mark.parametrize("target, max_mae", [("feed", 40), ("diaper", 40), ("sleep_start", 30), ("nap_duration", 25), ("night_duration", 40)])
def test_regular_baby_is_predicted_well(prepared, target, max_mae):
    first, last = data_days(prepared.dataset)
    days = local_days(prepared.dataset, last - timedelta(days=4), last - timedelta(days=1))
    methods = ("heuristic", "heuristic_kind", "last10_median", "lgbm_quantile", "hazard", "shrinkage", "ensemble")
    run = evaluate(prepared, target, days, methods=methods)
    assert len(run.y) >= 3
    for method, values in run.predictions.items():
        assert np.isfinite(values).all(), method
        assert np.all(np.diff(values, axis=1) >= 0), f"{method} quantiles cross"
    assert scores(run.y, run.predictions["heuristic_kind"])["mae"] <= max_mae
    for method in ("lgbm_quantile", "hazard", "shrinkage", "ensemble"):
        assert scores(run.y, run.predictions[method])["mae"] <= max_mae * 1.5, method


def test_bootstrap_detects_a_clear_improvement():
    rng = np.random.default_rng(0)
    y = rng.uniform(60, 180, 300)
    days = np.repeat(np.arange(30), 10)
    good = np.column_stack([y - 20, y - 10, y + rng.normal(0, 5, 300), y + 10, y + 20])
    bad = np.column_stack([y - 60, y - 30, y + rng.normal(0, 40, 300), y + 30, y + 60])
    result = bootstrap_improvement(y, good, bad, days, resamples=500)
    assert result["mae_rel_lo"] > 0.5
    assert result["mae_p_better"] == 1.0
