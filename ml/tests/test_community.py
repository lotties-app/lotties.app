"""Property tests of the community-insights pipeline (docs/design/34-community-insights.md section 5): k babies and k
families per published cell, withdrawal effective at the next run, a heavy family bounded by the per-baby cap, noise
off equals the exact clipped statistic, determinism for a seed. Synthetic data only."""

from __future__ import annotations

import json

import numpy as np
import pytest

from benchmark import community
from benchmark.community import CATALOG, HYSTERESIS, K, LEVELS, WIDE_LEVELS, load_priors, prior_for, release
from benchmark.synthetic import CommunityCohort, Observations, community_cohort

NIGHT = CATALOG["night_sleep_minutes"]
BOTTLE = CATALOG["bottle_ml_per_feed"]
CRY = CATALOG["cry_outcome_by_cause"]


def hand_cohort(babies: list[tuple[int, list[tuple[int, int, float]]]], key: str = "night_sleep_minutes", dimension: int = 0) -> CommunityCohort:
    """``babies``: (family, [(day, week, value), ...]) per baby, all in one statistic."""
    rows = [(index, day, week, value) for index, (_, values) in enumerate(babies) for day, week, value in values]
    baby, day, week, value = (np.asarray(column) for column in zip(*rows))
    observations = Observations(baby.astype(np.int64), day.astype(np.int64), week.astype(np.int64), value.astype(float), np.full(len(baby), dimension, np.int64))
    n = len(babies)
    return CommunityCohort(
        np.arange(1, n + 1, dtype=np.int64) * 7919, np.asarray([family for family, _ in babies], np.int64), np.zeros(n, bool), np.zeros(n, np.int64), {key: observations}
    )


def one_band(n_babies: int, week: int = 40, days: int = 5, families: list[int] | None = None, start: float = 500) -> list[tuple[int, list[tuple[int, int, float]]]]:
    families = families if families is not None else list(range(n_babies))
    return [(families[i], [(d, week, start + 3 * i + d) for d in range(days)]) for i in range(n_babies)]


@pytest.fixture(scope="module")
def cohort() -> CommunityCohort:
    return community_cohort(1000, seed=7)


@pytest.fixture(scope="module")
def included(cohort) -> np.ndarray:
    opted = np.random.default_rng(3).random(cohort.family.max() + 1) < 0.5
    return opted[cohort.family]


def test_a_published_cell_never_has_fewer_than_k_babies_or_k_families(cohort, included):
    published_any = False
    for statistic in CATALOG.values():
        for epsilon in (None, 0.2):
            result = release(statistic, cohort, included, K, epsilon, np.random.default_rng(1))
            for cell in result.cells.values():
                published_any = True
                members = np.fromiter(cell.members, np.int64)
                assert len(members) == cell.n_babies >= K
                assert len(np.unique(cohort.family[members])) == cell.n_families >= K
                assert included[members].all()
                assert cell.babies in ("20-49", "50-99", "100+")
                assert ("p3" in cell.outputs) == (statistic.kind == "quantiles" and cell.n_babies >= 50)
    assert published_any


def test_k_counts_families_not_babies():
    # 30 babies in 15 families of two (twins): 30 babies but only 15 families, so the cell is suppressed.
    twins = hand_cohort(one_band(30, families=[i // 2 for i in range(30)]))
    result = release(NIGHT, twins, np.ones(30, bool))
    assert not result.cells
    assert result.suppressed[("fine", 40, 44, "all")] == "below_k"


def test_hysteresis_keeps_a_published_cell_down_to_18_but_never_opens_one_below_k():
    data = hand_cohort(one_band(19))
    key = ("fine", 40, 44, "all")
    assert key not in release(NIGHT, data, np.ones(19, bool)).cells
    assert key in release(NIGHT, data, np.ones(19, bool), previous=frozenset({key})).cells
    small = hand_cohort(one_band(HYSTERESIS - 1))
    assert key not in release(NIGHT, small, np.ones(HYSTERESIS - 1, bool), previous=frozenset({key})).cells


def test_a_withdrawn_baby_is_absent_from_the_next_run(cohort, included):
    first = release(NIGHT, cohort, included, K, None)
    cell = max(first.cells.values(), key=lambda c: c.n_babies)
    withdrawn = min(cell.members)
    after = included.copy()
    after[withdrawn] = False
    second = release(NIGHT, cohort, after, K, None, previous=first.published_keys())
    assert all(withdrawn not in c.members for c in second.cells.values())
    # Nothing of hers survives: the next run equals a run on data where her rows never existed.
    observations = cohort.observations[NIGHT.key]
    erased = CommunityCohort(cohort.baby_id, cohort.family, cohort.heavy, cohort.bottle_kind, {NIGHT.key: observations.take(observations.baby != withdrawn)})
    rerun = release(NIGHT, erased, after, K, None, previous=first.published_keys())
    assert {k: c.outputs for k, c in second.cells.items()} == {k: c.outputs for k, c in rerun.cells.items()}


def test_a_heavy_family_is_bounded_by_the_cap():
    normal = one_band(30, days=5)
    # Three babies of one family logging every day for 100 days, 30 values a day, all far above the clip.
    heavy = [(99, [(d, 40, 5000.0) for d in range(100) for _ in range(30)]) for _ in range(3)]
    light = [(99, [(0, 40, 960.0)]) for _ in range(3)]
    with_heavy = hand_cohort(normal + heavy)
    with_light = hand_cohort(normal + light)
    cell = community.cell_inputs(NIGHT, with_heavy.observations[NIGHT.key], with_heavy, NIGHT.fine_edges)[(NIGHT.fine_edges.index(40), 0)]
    family = cell.families == 99
    assert family.sum() == 3  # one summary per baby, whatever the volume
    assert (cell.values[family] <= community.CAP_DAYS * 30).all()  # at most 14 days per baby
    assert (cell.summaries[family] == NIGHT.clip[1]).all()  # clipped to the published range
    # Logging 3 000 values per baby moves the release no more than logging one value at the clip edge.
    light_cell = community.cell_inputs(NIGHT, with_light.observations[NIGHT.key], with_light, NIGHT.fine_edges)[(NIGHT.fine_edges.index(40), 0)]
    assert community.cell_outputs(NIGHT, cell, None, np.random.default_rng(0)) == community.cell_outputs(NIGHT, light_cell, None, np.random.default_rng(0))
    # And the dominance rule counts its capped values: 3 x 14 x 30 values against 150 suppresses the cell.
    assert release(NIGHT, with_heavy, np.ones(33, bool)).suppressed[("fine", 40, 44, "all")] == "dominance"
    assert ("fine", 40, 44, "all") in release(NIGHT, with_light, np.ones(33, bool)).cells


def test_the_cap_picks_the_same_days_on_every_run():
    data = hand_cohort([(i, [(d, 40, float(d)) for d in range(60)]) for i in range(25)])
    first = community.cell_inputs(NIGHT, data.observations[NIGHT.key], data, NIGHT.fine_edges)
    rows = data.observations[NIGHT.key]
    reversed_rows = rows.take(np.arange(len(rows.baby))[::-1])
    second = community.cell_inputs(NIGHT, reversed_rows, data, NIGHT.fine_edges)
    for key in first:
        assert np.array_equal(first[key].summaries, second[key].summaries)
        assert (first[key].values == community.CAP_DAYS).all()
    assert len({float(s) for s in first[(NIGHT.fine_edges.index(40), 0)].summaries}) > 1  # keyed per baby, not the same days for all


@pytest.mark.parametrize("n", [25, 60])
def test_noise_off_equals_the_exact_clipped_statistic(n):
    rng = np.random.default_rng(n)
    babies = [(i, [(d, 40, float(v)) for d, v in enumerate(rng.normal(600, 200, 6))]) for i in range(n)]
    babies[0] = (0, [(d, 40, 5000.0) for d in range(6)])  # beyond the clip
    babies[1] = (1, [(d, 40, -50.0) for d in range(6)])
    result = release(NIGHT, hand_cohort(babies), np.ones(n, bool), K, None)
    cell = result.cells[("fine", 40, 44, "all")]
    expected_summaries = [np.median(np.clip([v for _, _, v in values], *NIGHT.clip)) for _, values in babies]
    levels = WIDE_LEVELS if n >= 50 else LEVELS
    assert cell.outputs == pytest.approx({f"p{level}": float(np.percentile(expected_summaries, level)) for level in levels})


def test_noise_off_equals_the_exact_shares():
    babies = [(i, [(d, 30, float((i + d) % 5)) for d in range(4)]) for i in range(24)]
    data = hand_cohort(babies, key=CRY.key, dimension=2)
    cell = release(CRY, data, np.ones(24, bool), K, None).cells[("fine", 26, 104, "evening")]
    shares = np.mean([np.bincount([int(v) for _, _, v in values], minlength=5) / len(values) for _, values in babies], axis=0)
    assert [cell.outputs[c] for c in community.CRY_CAUSES] == pytest.approx(list(shares))
    noisy = release(CRY, data, np.ones(24, bool), K, 0.2, np.random.default_rng(1)).cells[("fine", 26, 104, "evening")]
    assert sum(noisy.outputs.values()) == pytest.approx(1.0)


def test_noise_changes_the_numbers_but_stays_on_the_grid():
    data = hand_cohort(one_band(40))
    noisy = release(NIGHT, data, np.ones(40, bool), K, 0.2, np.random.default_rng(5)).cells[("fine", 40, 44, "all")]
    exact = release(NIGHT, data, np.ones(40, bool), K, None).cells[("fine", 40, 44, "all")]
    assert noisy.outputs != exact.outputs
    values = list(noisy.outputs.values())
    assert values == sorted(values)
    assert all(v % NIGHT.step == 0 and NIGHT.clip[0] <= v <= NIGHT.clip[1] for v in values)


def test_a_fine_cell_below_k_is_published_inside_its_coarse_cell():
    # 6 babies in each of the weekly bands 4, 5, 6 and 7: every fine cell is below k, the coarse 4-8 cell has 24.
    babies = [(i, [(d, 4 + i % 4, 300.0 + i) for d in range(3)]) for i in range(24)]
    data = hand_cohort(babies)
    result = release(NIGHT, data, np.ones(24, bool))
    assert not [key for key in result.cells if key[0] == "fine"]
    coarse = result.cells[("coarse", 4, 8, "all")]
    assert result.source(5, 6, "all") is coarse
    assert result.source(9, 10, "all") is None


def test_priors_never_use_a_norm_that_needs_review_or_has_low_confidence():
    priors = load_priors()
    assert prior_for(priors, "night_sleep_minutes", 0, 14, 16) == pytest.approx(570)  # Pelotas 9.5 h, 13-17 weeks
    assert prior_for(priors, "night_sleep_minutes", 0, 28, 32) is None  # 17-52 weeks: low confidence, needs review
    assert prior_for(priors, "bottle_ml_per_feed", 0, 0, 1) is None  # 0-7 days: needs review
    assert prior_for(priors, "bottle_ml_per_feed", 0, 2, 3) == pytest.approx(90)  # middle of 60-120 ml
    assert prior_for(priors, "bottle_ml_per_feed", 1, 2, 3) is None  # no breast-milk bottle norm
    assert prior_for(priors, "tummy_minutes_per_day", 0, 2, 3) is None


def test_the_cohort_has_families_of_one_to_three_and_a_heavy_family():
    data = community_cohort(1000, seed=2)
    sizes = np.bincount(data.family)
    sizes = sizes[sizes > 0]
    assert sizes.min() == 1 and sizes.max() <= 3 and (sizes > 1).any()
    assert data.heavy.any()
    for heavy_family in np.unique(data.family[data.heavy]):
        assert data.heavy[data.family == heavy_family].all()


def test_determinism_for_a_seed():
    def report(seed):
        out = community.run(K, 0.2, seed, resamples=20, trials=40, sizes=(100,), rates=(0.5,), sweep=None)
        out.pop("runtime_seconds")
        return json.dumps(out, sort_keys=True)

    assert report(3) == report(3)
    assert report(3) != report(4)
    a, b = community_cohort(500, 9), community_cohort(500, 9)
    assert np.array_equal(a.baby_id, b.baby_id)
    assert all(np.array_equal(a.observations[k].value, b.observations[k].value) for k in a.observations)
