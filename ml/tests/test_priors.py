"""The age-band priors: bed time and night length from the published Brazilian cohort from 3 months, the rest marked
unsourced, and the pre-2026-10-23 table one switch away for before/after runs (docs/design/28-age-norms.md 15.5)."""

from __future__ import annotations

import math

import pytest

from benchmark import priors


@pytest.fixture(autouse=True)
def current_priors():
    priors.use_legacy_priors(False)
    yield
    priors.use_legacy_priors(False)


def test_bed_time_is_the_pelotas_median_from_three_months():
    for band in (1, 2, 3):
        mean, sd = priors.prior(band, "bedtime")
        assert mean == 600  # 22:00 as minutes after noon
        assert sd == pytest.approx(76.5, abs=0.1)  # (01:00 - 20:00) / 3.92


def test_night_length_is_the_pelotas_median_from_three_months():
    assert priors.prior(1, "night") == pytest.approx((570, math.log(12.78 / 9.5) / 1.96))
    assert priors.prior(3, "night") == pytest.approx((600, math.log(13.6 / 10) / 1.96))
    assert priors.prior(1, "night")[0] < priors.prior(2, "night")[0] < priors.prior(3, "night")[0]


def test_unsourced_values_are_explicit_and_unchanged():
    for band in range(4):
        assert priors.prior(band, "awake") == priors.UNSOURCED_AWAKE[band]
        assert priors.prior(band, "nap") == priors.UNSOURCED_NAP[band]
        assert priors.prior(band, "feed") == priors.UNSOURCED_FEED_GAP[band] == priors.LEGACY_PRIORS[band]["feed"]
        assert priors.prior(band, "diaper") == priors.UNSOURCED_DIAPER_GAP[band] == priors.LEGACY_PRIORS[band]["diaper"]
        assert priors.UNSOURCED_AWAKE[band] == priors.LEGACY_PRIORS[band]["awake"]
        assert priors.UNSOURCED_NAP[band] == priors.LEGACY_PRIORS[band]["nap"]
    assert priors.prior(0, "night") == priors.UNSOURCED_NIGHT_UNDER_3M == priors.LEGACY_PRIORS[0]["night"]
    assert priors.prior(0, "bedtime") == priors.UNSOURCED_BEDTIME_UNDER_3M == priors.LEGACY_PRIORS[0]["bedtime"]


def test_the_legacy_table_is_one_switch_away():
    priors.use_legacy_priors(True)
    assert priors.prior(1, "bedtime") == (480, 60)
    assert priors.prior(3, "night") == (690, 0.15)
    priors.use_legacy_priors(False)
    assert priors.prior(1, "bedtime")[0] == 600
