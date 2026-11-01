"""The night-window evaluation on synthetic cohorts: the generator follows its cohort, the learned window reads the
baby's own markers, and every variant is scored on the same decision points."""

from __future__ import annotations

import statistics

from benchmark.data import SECONDS_PER_HOUR, local_seconds_of_day
from benchmark.heuristic import BED_TIME, WOKE_UP
from benchmark.night_window import CURRENT, MARGIN, NORM_PRIOR, VARIANTS, evaluate_baby, learned_window, summarize
from benchmark.synthetic import BRAZIL, SWISS, cohort_baby

OFFSET = -3 * SECONDS_PER_HOUR


def _bed_clocks(dataset) -> list[float]:
    """Bed times as hours after noon (22:00 = 10)."""
    return [((local_seconds_of_day(item.start, OFFSET) / SECONDS_PER_HOUR) - 12) % 24 for item in dataset.events if item.kind == BED_TIME]


def test_cohorts_follow_their_published_bed_times():
    brazil = statistics.median(statistics.median(_bed_clocks(cohort_baby(BRAZIL, seed, 10))) for seed in range(25))
    swiss = statistics.median(statistics.median(_bed_clocks(cohort_baby(SWISS, seed, 10))) for seed in range(25))
    assert 9.25 <= brazil <= 10.75  # about 22:00
    assert 7.5 <= swiss <= 8.5  # about 20:00
    for seed in range(25):
        assert all(8 - 0.5 <= clock <= 13 + 0.5 for clock in _bed_clocks(cohort_baby(BRAZIL, seed, 10)))


def test_every_night_has_a_bed_time_and_a_wake_up():
    dataset = cohort_baby(BRAZIL, 3, 20)
    assert sum(item.kind == BED_TIME for item in dataset.events) == 20
    assert sum(item.kind == WOKE_UP for item in dataset.events) == 20
    assert all(a.start <= b.start for a, b in zip(dataset.events, dataset.events[1:]))


def test_learned_window_needs_enough_nights_and_reads_the_median_clocks():
    dataset = cohort_baby(BRAZIL, 5, 20)
    early = dataset.first_start + 2 * 86400
    assert learned_window(dataset, early, OFFSET, CURRENT) == CURRENT
    start, end = learned_window(dataset, dataset.last_start, OFFSET, CURRENT)
    beds = sorted(_bed_clocks(dataset)[-14:])
    assert abs(((start / SECONDS_PER_HOUR) - 12) % 24 - statistics.median(beds)) < 0.6
    shifted, _ = learned_window(dataset, dataset.last_start, OFFSET, CURRENT, MARGIN)
    assert round(((start - shifted) % 86400) / 60) == 60
    assert 4 * SECONDS_PER_HOUR <= end <= 12 * SECONDS_PER_HOUR
    assert NORM_PRIOR == (22 * SECONDS_PER_HOUR, 8 * SECONDS_PER_HOUR)


def test_variants_are_scored_on_the_same_points():
    errors = evaluate_baby(cohort_baby(BRAZIL, 1, 21))
    assert {"feed/all", "sleep_start/all"} <= set(errors)
    for key, by_variant in errors.items():
        assert set(by_variant) == set(VARIANTS), key
        assert len({len(values) for values in by_variant.values()}) == 1, key
    report = summarize([errors, evaluate_baby(cohort_baby(BRAZIL, 2, 21))], resamples=20, seed=1)
    entry = report["feed/all"]
    assert entry["babies"] == 2
    assert entry["norm_prior"]["ci95"][0] <= entry["norm_prior"]["ci95"][1]
