"""Rolling-origin backtest.

For every evaluation day D (local calendar day) the trained models are refit at 00:00 local of D on the decision
points whose outcome was already known then (plus censored rows for the hazard model), and predict every decision
point of D. Features are computed as of each decision instant, so nothing after it is visible. Baselines, the
heuristic port and the shrinkage model are online: they use everything known at the decision instant itself.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from .baselines import BASELINES, age_band_prior, baseline_quantiles
from .data import SECONDS_PER_DAY, Dataset, local_date, local_midnight
from .features import Timeline, evening_clock, known_outcomes
from .heuristic import age_band
from .models import CORE_FEATURES, DiscreteHazard, LinearQuantile, QuantileGBM, Shrinkage, TrainSet
from .priors import prior
from .targets import Samples, build_targets

TRAINED = ("lgbm_quantile", "lgbm_quantile_ratio", "hgb_quantile", "linear_quantile", "hazard")
SENSITIVITY = ("lgbm_small", "lgbm_core", "lgbm_core_ratio")
ONLINE = ("shrinkage",)
ENSEMBLE_MEMBERS = ("lgbm_quantile", "hazard", "shrinkage")
METHODS = BASELINES + TRAINED + ONLINE + ("ensemble",)
FAST_METHODS = tuple(method for method in METHODS if method != "hgb_quantile")
MIN_TRAIN = 15
SMALL_LGBM = {"n_estimators": 60, "num_leaves": 4, "max_depth": 2, "min_child_samples": 30}


def make_model(name: str):
    if name == "lgbm_quantile":
        return QuantileGBM("lgbm", ratio=False)
    if name == "lgbm_small":
        return QuantileGBM("lgbm", ratio=False, params=SMALL_LGBM)
    if name == "lgbm_core":
        return QuantileGBM("lgbm", ratio=False, columns=CORE_FEATURES)
    if name == "lgbm_core_ratio":
        return QuantileGBM("lgbm", ratio=True, columns=CORE_FEATURES)
    if name == "lgbm_quantile_ratio":
        return QuantileGBM("lgbm", ratio=True)
    if name == "hgb_quantile":
        return QuantileGBM("hgb", ratio=False)
    if name == "linear_quantile":
        return LinearQuantile()
    if name == "hazard":
        return DiscreteHazard()
    raise ValueError(name)


@dataclass
class TargetData:
    name: str
    samples: Samples
    X: pd.DataFrame
    day: np.ndarray  # local date ordinal of each decision point
    offset: float

    @property
    def spec(self):
        return self.samples.spec


@dataclass
class Prepared:
    dataset: Dataset
    timeline: Timeline
    targets: dict[str, TargetData]
    seconds: float


def prepare(dataset: Dataset) -> Prepared:
    started = time.perf_counter()
    timeline = Timeline(dataset)
    targets = {}
    for name, samples in build_targets(dataset).items():
        offset = dataset.offset_seconds(dataset.last_start)
        X = timeline.frame(name, samples)
        day = np.array([local_date(t, dataset.offset_seconds(t)).toordinal() for t in samples.t])
        targets[name] = TargetData(name, samples, X, day, offset)
    return Prepared(dataset, timeline, targets, time.perf_counter() - started)


def prior_median(prepared: Prepared, target: TargetData, t: float) -> tuple[float, float]:
    dataset = prepared.dataset
    band = age_band(dataset.birth_date, local_date(t, dataset.offset_seconds(t)))
    return prior(band, target.spec.prior_key)


def train_set(prepared: Prepared, target: TargetData, at: float) -> TrainSet:
    samples = target.samples
    known = samples.valid & (samples.outcome_at <= at)
    pending = (samples.t < at) & (samples.outcome_at > at)
    censored_after = (at - samples.t) / 60
    pending &= censored_after <= samples.spec.cap_minutes
    median, _ = prior_median(prepared, target, at)
    return TrainSet(
        X=target.X[known].reset_index(drop=True),
        y=samples.y[known],
        t=samples.t[known],
        censored_X=target.X[pending].reset_index(drop=True),
        censored_after=censored_after[pending],
        censored_t=samples.t[pending],
        offset=target.offset,
        cap=samples.spec.cap_minutes,
        prior_median=median if target.name != "bedtime" else 600.0,
    )


def online_quantiles(prepared: Prepared, target: TargetData, method: str, index: int) -> np.ndarray | None:
    t = float(target.samples.t[index])
    if method in BASELINES:
        return baseline_quantiles(method, prepared.timeline, target.samples, t)
    if method == "shrinkage":
        offset = prepared.dataset.offset_seconds(t)
        center, spread = prior_median(prepared, target, t)
        if target.name == "bedtime":
            timeline = prepared.timeline
            nights = timeline.session_night & (timeline.session_start <= t)
            times = timeline.session_start[nights]
            clocks = np.array([evening_clock(value, offset) for value in times])
            return Shrinkage.bedtime(times, clocks, t, evening_clock(t, offset), center, spread)
        history = known_outcomes(target.samples, t)
        return Shrinkage.lengths(history.t, history.y, t, offset, center, spread)
    raise ValueError(method)


@dataclass
class Run:
    """Predictions of every method for the evaluated decision points of one target."""

    target: str
    index: np.ndarray
    y: np.ndarray
    day: np.ndarray
    subset: np.ndarray
    predictions: dict[str, np.ndarray]
    fallbacks: dict[str, int] = field(default_factory=dict)
    fit_seconds: dict[str, float] = field(default_factory=dict)


def evaluate(
    prepared: Prepared,
    target_name: str,
    days: list[date],
    frozen_at: float | None = None,
    methods: tuple[str, ...] = METHODS,
) -> Run:
    """Predicts every valid decision point on ``days``; trained models refit daily (or once at ``frozen_at``)."""
    target = prepared.targets[target_name]
    samples = target.samples
    ordinals = {day.toordinal() for day in days}
    index = np.nonzero(samples.valid & np.isin(target.day, list(ordinals)))[0]
    predictions = {method: np.full((len(index), 5), np.nan) for method in methods}
    fallbacks = {method: 0 for method in methods}
    fit_seconds = {method: 0.0 for method in methods}
    position = {row: i for i, row in enumerate(index)}

    def fallback(row: int) -> np.ndarray:
        value = baseline_quantiles("heuristic", prepared.timeline, samples, float(samples.t[row]))
        return value if value is not None else age_band_prior(prepared.timeline, samples, float(samples.t[row]))

    for method in methods:
        if method in BASELINES or method in ONLINE:
            for row in index:
                value = online_quantiles(prepared, target, method, int(row))
                if value is None:
                    fallbacks[method] += 1
                    value = age_band_prior(prepared.timeline, samples, float(samples.t[row]))
                predictions[method][position[row]] = value

    trained = [method for method in methods if method in TRAINED or method in SENSITIVITY]
    groups: dict[float, list[int]] = {}
    for row in index:
        if frozen_at is not None:
            at = frozen_at
        else:
            day = date.fromordinal(int(target.day[row]))
            at = local_midnight(day, prepared.dataset.offset_seconds(float(samples.t[row])))
        groups.setdefault(at, []).append(int(row))
    for at, rows in groups.items():
        train = train_set(prepared, target, at)
        X = target.X.iloc[rows].reset_index(drop=True)
        t = samples.t[rows]
        for method in trained:
            if len(train.y) < MIN_TRAIN:
                for row in rows:
                    predictions[method][position[row]] = fallback(row)
                fallbacks[method] += len(rows)
                continue
            started = time.perf_counter()
            model = make_model(method).fit(train)
            fit_seconds[method] += time.perf_counter() - started
            values = model.predict(X, t, target.offset)
            for i, row in enumerate(rows):
                predictions[method][position[row]] = values[i]

    if "ensemble" in methods and all(member in predictions for member in ENSEMBLE_MEMBERS):
        predictions["ensemble"] = np.sort(np.mean([predictions[m] for m in ENSEMBLE_MEMBERS], axis=0), axis=1)
    return Run(target_name, index, samples.y[index], target.day[index], samples.subset[index], predictions, fallbacks, fit_seconds)


def local_days(dataset: Dataset, first: date, last: date) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def data_days(dataset: Dataset) -> tuple[date, date]:
    first = local_date(dataset.first_start, dataset.offset_seconds(dataset.first_start))
    last = local_date(dataset.last_start, dataset.offset_seconds(dataset.last_start))
    return first, last


def combine(runs: list[Run], name: str) -> Run:
    """Concatenates runs of several targets (e.g. nap and night durations into 'wake_up')."""
    methods = set.intersection(*(set(run.predictions) for run in runs))
    return Run(
        name,
        np.concatenate([run.index for run in runs]),
        np.concatenate([run.y for run in runs]),
        np.concatenate([run.day for run in runs]),
        np.concatenate([run.subset for run in runs]),
        {method: np.concatenate([run.predictions[method] for run in runs]) for method in methods},
        {method: sum(run.fallbacks.get(method, 0) for run in runs) for method in methods},
    )


def subset(run: Run, label: str, name: str) -> Run:
    mask = run.subset == label
    return Run(
        name,
        run.index[mask],
        run.y[mask],
        run.day[mask],
        run.subset[mask],
        {method: values[mask] for method, values in run.predictions.items()},
        dict(run.fallbacks),
    )


def timings(prepared: Prepared, target_name: str, repeats: int = 3) -> dict[str, dict[str, float]]:
    """Fit time on the whole history, predict time per decision point and serialized size, per trained model.

    Single-threaded (BLAS/OpenMP limited to one thread), like the service's training child process.
    """
    with threadpool_limits(limits=1):
        return _timings(prepared, target_name, repeats)


def _timings(prepared: Prepared, target_name: str, repeats: int) -> dict[str, dict[str, float]]:
    target = prepared.targets[target_name]
    at = prepared.dataset.last_start + SECONDS_PER_DAY
    train = train_set(prepared, target, at)
    X = target.X.iloc[-50:].reset_index(drop=True)
    t = target.samples.t[-50:]
    out = {}
    for method in TRAINED:
        fit_times, predict_times = [], []
        model = None
        for _ in range(repeats):
            started = time.perf_counter()
            model = make_model(method).fit(train)
            fit_times.append(time.perf_counter() - started)
            started = time.perf_counter()
            for i in range(len(X)):
                model.predict(X.iloc[[i]], t[i : i + 1], target.offset)
            predict_times.append((time.perf_counter() - started) / len(X))
        out[method] = {
            "train_rows": int(len(train.y)),
            "fit_ms": 1000 * float(np.median(fit_times)),
            "predict_ms": 1000 * float(np.median(predict_times)),
            "size_kb": model.size_bytes() / 1024,
        }
    return out


def feature_seconds_per_point(prepared: Prepared) -> float:
    total = sum(len(target.samples) for target in prepared.targets.values())
    return prepared.seconds / max(total, 1)


__all__ = [
    "METHODS",
    "TRAINED",
    "Prepared",
    "Run",
    "combine",
    "data_days",
    "evaluate",
    "local_days",
    "prepare",
    "subset",
    "timings",
]
