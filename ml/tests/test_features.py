"""Leakage tests: every feature at a decision instant must be computable from the history known at that instant."""

from __future__ import annotations

import math

import numpy as np
import pytest

from benchmark.data import Dataset, as_seen_at
from benchmark.features import Timeline, evening_clock
from benchmark.synthetic import generate
from benchmark.targets import build_targets


def truncated(dataset: Dataset, t: float) -> Dataset:
    return Dataset(tuple(as_seen_at(item, t) for item in dataset.events if item.start <= t), dataset.birth_date, dataset.time_zone)


def same(a: dict, b: dict) -> list[str]:
    differing = []
    for key in a:
        x, y = a[key], b[key]
        if isinstance(x, float) and math.isnan(x):
            if not (isinstance(y, float) and math.isnan(y)):
                differing.append(key)
        elif not math.isclose(x, y, rel_tol=1e-9, abs_tol=1e-9):
            differing.append(key)
    return differing


@pytest.fixture(scope="module")
def dataset() -> Dataset:
    return generate(days=24, seed=3)


@pytest.mark.parametrize("target", ["feed", "diaper", "sleep_start", "nap_duration", "night_duration", "bedtime"])
def test_features_only_use_the_past(dataset, target):
    full = Timeline(dataset)
    samples = build_targets(dataset)[target]
    picks = np.linspace(len(samples) // 3, len(samples) - 1, 6).astype(int)
    for index in picks:
        t = float(samples.t[index])
        past = truncated(dataset, t)
        past_timeline = Timeline(past)
        past_samples = build_targets(past)[target]
        assert t in set(past_samples.t), "the decision point must exist with only the past"
        expected = full.common(t) | full.outcome_features(samples, t) | full.heuristic_features(target, t)
        actual = past_timeline.common(t) | past_timeline.outcome_features(past_samples, t) | past_timeline.heuristic_features(target, t)
        assert same(expected, actual) == [], f"{target} features changed when the future was removed"


def test_outcomes_are_known_only_after_they_happen(dataset):
    samples = build_targets(dataset)["feed"]
    t = float(samples.t[len(samples) // 2])
    timeline = Timeline(dataset)
    features = timeline.outcome_features(samples, t)
    known = samples.valid & (samples.outcome_at <= t)
    assert features["n_known"] == known.sum()
    assert features["prev_y1"] == samples.y[known][-1]


def test_evening_clock_keeps_late_bed_times_late():
    offset = -3 * 3600.0
    eight_pm = 23 * 3600.0  # 20:00 local
    one_am = (4 + 24) * 3600.0  # 01:00 local next day
    seven_am = 10 * 3600.0
    assert evening_clock(eight_pm, offset) == 480
    assert evening_clock(one_am, offset) == 780
    assert evening_clock(seven_am, offset) == -300
