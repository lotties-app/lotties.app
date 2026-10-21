"""Small CPU-only models: quantile gradient boosting (LightGBM, scikit-learn), linear quantile regression,
a discrete-time hazard classifier and a Bayesian shrinkage model.

All return quantiles (q10, q25, q50, q75, q90) in minutes from the decision instant, sorted to avoid crossing.
"""

from __future__ import annotations

import math
import pickle
import warnings
from dataclasses import dataclass

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.linear_model import QuantileRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .data import SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, local_seconds_of_day
from .heuristic import QUANTILES
from .priors import Z

LEVELS = np.array(QUANTILES)
MIN_LENGTH = 1.0

LGBM_REGRESSION = dict(
    n_estimators=150,
    learning_rate=0.05,
    num_leaves=7,
    max_depth=3,
    min_child_samples=20,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    n_jobs=1,
    random_state=0,
    verbose=-1,
)

LGBM_HAZARD = dict(
    n_estimators=200,
    learning_rate=0.05,
    num_leaves=7,
    max_depth=3,
    min_child_samples=30,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    n_jobs=1,
    random_state=0,
    verbose=-1,
)


def sort_quantiles(values: np.ndarray) -> np.ndarray:
    return np.sort(np.maximum(values, MIN_LENGTH), axis=1)


def base_of(frame: pd.DataFrame, fallback: float) -> np.ndarray:
    """Reference length per row for ratio targets: last-10 median, else global median, else the prior median."""
    base = frame["base_last10"].to_numpy(dtype=float)
    base = np.where(np.isfinite(base), base, frame["base_global"].to_numpy(dtype=float))
    base = np.where(np.isfinite(base), base, fallback)
    return np.maximum(base, MIN_LENGTH)


@dataclass
class TrainSet:
    """Training rows known at the refit instant: features, outcomes (minutes), and censored rows for the hazard."""

    X: pd.DataFrame
    y: np.ndarray
    t: np.ndarray
    censored_X: pd.DataFrame
    censored_after: np.ndarray
    censored_t: np.ndarray
    offset: float
    cap: float
    prior_median: float


CORE_FEATURES = (
    "hour_sin",
    "hour_cos",
    "is_night",
    "age_days",
    "since_feed",
    "since_diaper",
    "since_wake",
    "since_sleep_start",
    "asleep",
    "naps_today",
    "since_day_start",
    "last_nap_min",
    "last_night_min",
    "last_awake_min",
    "prev_y1",
    "base_last5",
    "base_last10",
    "base_same_hour",
    "heur_q50",
    "bed_clock_med7",
    "until_bed_med7",
)


class QuantileGBM:
    """One gradient-boosting model per quantile on log(y) or log(y / base).

    ``params`` overrides the LightGBM defaults and ``columns`` restricts the features (sensitivity runs).
    """

    def __init__(self, engine: str = "lgbm", ratio: bool = False, params: dict | None = None, columns: tuple[str, ...] | None = None):
        self.engine = engine
        self.ratio = ratio
        self.params = {**LGBM_REGRESSION, **(params or {})}
        self.columns = list(columns) if columns else None
        self.models: list = []
        self.prior_median = 60.0

    def _x(self, X: pd.DataFrame) -> pd.DataFrame:
        return X[self.columns] if self.columns else X

    def _new(self, quantile: float):
        if self.engine == "lgbm":
            return lgb.LGBMRegressor(objective="quantile", alpha=quantile, **self.params)
        return HistGradientBoostingRegressor(
            loss="quantile",
            quantile=quantile,
            max_iter=150,
            learning_rate=0.05,
            max_leaf_nodes=7,
            max_depth=3,
            min_samples_leaf=20,
            l2_regularization=1.0,
            random_state=0,
        )

    def fit(self, train: TrainSet) -> "QuantileGBM":
        self.prior_median = train.prior_median
        target = np.log(np.maximum(train.y, MIN_LENGTH))
        if self.ratio:
            target = target - np.log(base_of(train.X, self.prior_median))
        self.models = [self._new(q).fit(self._x(train.X), target) for q in QUANTILES]
        return self

    def predict(self, X: pd.DataFrame, t: np.ndarray, offset: float) -> np.ndarray:
        raw = np.column_stack([model.predict(self._x(X)) for model in self.models])
        if self.ratio:
            raw = raw + np.log(base_of(X, self.prior_median))[:, None]
        return sort_quantiles(np.exp(raw))

    def size_bytes(self) -> int:
        if self.engine == "lgbm":
            return sum(len(model.booster_.model_to_string()) for model in self.models)
        return len(pickle.dumps(self.models))


class LinearQuantile:
    """L1-penalised linear quantile regression on standardised, median-imputed features; target log(y / base)."""

    def __init__(self, alpha: float = 0.01):
        self.alpha = alpha
        self.models: list = []
        self.prior_median = 60.0

    def fit(self, train: TrainSet) -> "LinearQuantile":
        self.prior_median = train.prior_median
        target = np.log(np.maximum(train.y, MIN_LENGTH)) - np.log(base_of(train.X, self.prior_median))
        self.models = []
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=ConvergenceWarning)
            warnings.simplefilter("ignore", category=UserWarning)
            for quantile in QUANTILES:
                model = make_pipeline(
                    SimpleImputer(strategy="median", keep_empty_features=True),
                    StandardScaler(),
                    QuantileRegressor(quantile=quantile, alpha=self.alpha, solver="highs"),
                )
                self.models.append(model.fit(train.X, target))
        return self

    MAX_LOG_RATIO = 3.0  # at most 20x above or below the base: a linear model extrapolates without bound

    def predict(self, X: pd.DataFrame, t: np.ndarray, offset: float) -> np.ndarray:
        raw = np.column_stack([model.predict(X) for model in self.models])
        raw = np.clip(raw, -self.MAX_LOG_RATIO, self.MAX_LOG_RATIO)
        return sort_quantiles(np.exp(raw + np.log(base_of(X, self.prior_median))[:, None]))

    def size_bytes(self) -> int:
        return len(pickle.dumps(self.models))


class DiscreteHazard:
    """P(event in the next 15-minute bin | not yet), one LightGBM classifier over (sample, bin) rows.

    Bin rows carry the sample's features plus the elapsed time, elapsed / typical length, and the local clock time of
    the bin, so the survival curve can bend around night and day. Rows of samples whose outcome was still unknown at the
    refit instant are kept as censored (all zeros up to the refit).
    """

    BIN = 15.0

    def __init__(self):
        self.model = None
        self.columns: list[str] = []
        self.bins = 0
        self.cap = 0.0
        self.prior_median = 60.0
        self.constant: float | None = None

    def _rows(self, X: pd.DataFrame, t: np.ndarray, offset: float, bins_per_row: np.ndarray) -> pd.DataFrame:
        repeat = np.repeat(np.arange(len(X)), bins_per_row)
        k = np.concatenate([np.arange(count) for count in bins_per_row]) if len(bins_per_row) else np.array([], int)
        rows = X.iloc[repeat].reset_index(drop=True)
        elapsed = (k + 0.5) * self.BIN
        base = base_of(X, self.prior_median)[repeat]
        clock = ((t[repeat] + elapsed * SECONDS_PER_MINUTE + offset) % SECONDS_PER_DAY) / SECONDS_PER_HOUR
        rows["elapsed"] = elapsed
        rows["elapsed_ratio"] = elapsed / base
        rows["bin_hour_sin"] = np.sin(2 * math.pi * clock / 24)
        rows["bin_hour_cos"] = np.cos(2 * math.pi * clock / 24)
        rows["bin_is_night"] = ((clock >= 19) | (clock < 7)).astype(float)
        return rows

    def fit(self, train: TrainSet) -> "DiscreteHazard":
        self.cap = train.cap
        self.bins = int(math.ceil(train.cap / self.BIN))
        self.prior_median = train.prior_median
        event_bin = np.minimum((train.y // self.BIN).astype(int), self.bins - 1)
        censored_bins = np.minimum((train.censored_after // self.BIN).astype(int), self.bins)
        X = pd.concat([train.X, train.censored_X], ignore_index=True)
        t = np.concatenate([train.t, train.censored_t])
        counts = np.concatenate([event_bin + 1, censored_bins])
        rows = self._rows(X, t, train.offset, counts)
        labels = np.concatenate(
            [np.r_[np.zeros(count - 1), 1.0] for count in event_bin + 1]
            + [np.zeros(count) for count in censored_bins]
        )
        self.columns = list(rows.columns)
        if labels.min() == labels.max():
            self.constant = float(labels[0])
            return self
        self.constant = None
        self.model = lgb.LGBMClassifier(objective="binary", **LGBM_HAZARD).fit(rows, labels)
        return self

    def survival(self, X: pd.DataFrame, t: np.ndarray, offset: float) -> np.ndarray:
        counts = np.full(len(X), self.bins)
        rows = self._rows(X.reset_index(drop=True), t, offset, counts)[self.columns]
        if self.constant is not None:
            hazard = np.full(len(rows), self.constant)
        else:
            hazard = self.model.predict_proba(rows)[:, 1]
        hazard = np.clip(hazard.reshape(len(X), self.bins), 1e-6, 1 - 1e-6)
        return np.cumprod(1 - hazard, axis=1)

    def predict(self, X: pd.DataFrame, t: np.ndarray, offset: float) -> np.ndarray:
        survival = self.survival(X, t, offset)
        cdf = np.concatenate([np.zeros((len(X), 1)), 1 - survival], axis=1)
        edges = np.arange(self.bins + 1) * self.BIN
        result = np.empty((len(X), len(LEVELS)))
        for row in range(len(X)):
            curve = cdf[row]
            for column, level in enumerate(LEVELS):
                above = np.nonzero(curve >= level)[0]
                if len(above) == 0:
                    result[row, column] = self.cap
                    continue
                k = above[0]
                low, high = curve[k - 1], curve[k]
                share = (level - low) / (high - low) if high > low else 1.0
                result[row, column] = edges[k - 1] + share * self.BIN
        return sort_quantiles(result)

    def size_bytes(self) -> int:
        return len(self.model.booster_.model_to_string()) if self.model is not None else 8


class Shrinkage:
    """Per-baby Bayesian shrinkage on log lengths: age-band prior -> recency-weighted baby mean -> time-of-day mean.

    Online: the posterior at ``t`` uses every outcome known at ``t`` (last 28 days, half-life 4 days); the time-of-day
    level is a Gaussian kernel (sd 1.5 h) on the decision clock time. Bed time uses the same idea on the bed-time clock
    and conditions the predictive normal on bed time being after now.
    """

    HALF_LIFE_DAYS = 4.0
    MEMORY_DAYS = 28.0
    PRIOR_COUNT = 2.0
    HOUR_COUNT = 4.0
    HOUR_SD = 1.5

    @staticmethod
    def _weights(times: np.ndarray, t: float) -> np.ndarray:
        age_days = (t - times) / SECONDS_PER_DAY
        return np.where(age_days <= Shrinkage.MEMORY_DAYS, 0.5 ** (np.maximum(age_days, 0) / Shrinkage.HALF_LIFE_DAYS), 0.0)

    @staticmethod
    def _effective(weights: np.ndarray) -> float:
        total = weights.sum()
        return float(total * total / (weights * weights).sum()) if total > 0 else 0.0

    @classmethod
    def posterior(cls, values: np.ndarray, weights: np.ndarray, prior_mean: float, prior_sd: float) -> tuple[float, float, float]:
        n = cls._effective(weights)
        if n == 0:
            return prior_mean, prior_sd**2, 0.0
        mean = float((weights * values).sum() / weights.sum())
        post_mean = (cls.PRIOR_COUNT * prior_mean + n * mean) / (cls.PRIOR_COUNT + n)
        spread = float((weights * (values - post_mean) ** 2).sum() / weights.sum())
        post_var = (cls.PRIOR_COUNT * prior_sd**2 + n * spread) / (cls.PRIOR_COUNT + n)
        return post_mean, post_var, n

    @classmethod
    def lengths(cls, times: np.ndarray, y: np.ndarray, t: float, offset: float, prior_median: float, prior_log_sd: float) -> np.ndarray:
        weights = cls._weights(times, t)
        z = np.log(np.maximum(y, MIN_LENGTH))
        mean, var, _ = cls.posterior(z, weights, math.log(prior_median), prior_log_sd)
        clock = local_seconds_of_day(t, offset) / SECONDS_PER_HOUR
        clocks = ((times + offset) % SECONDS_PER_DAY) / SECONDS_PER_HOUR
        distance = np.abs(clocks - clock)
        distance = np.minimum(distance, 24 - distance)
        kernel = weights * np.exp(-0.5 * (distance / cls.HOUR_SD) ** 2)
        n_hour = cls._effective(kernel)
        if n_hour > 0:
            local_mean = float((kernel * z).sum() / kernel.sum())
            mean_h = (cls.HOUR_COUNT * mean + n_hour * local_mean) / (cls.HOUR_COUNT + n_hour)
            local_var = float((kernel * (z - mean_h) ** 2).sum() / kernel.sum())
            var_h = (cls.HOUR_COUNT * var + n_hour * local_var) / (cls.HOUR_COUNT + n_hour)
        else:
            mean_h, var_h = mean, var
        sd = math.sqrt(var_h * (1 + 1 / (cls.HOUR_COUNT + n_hour)))
        return np.maximum(np.exp(mean_h + Z * sd), MIN_LENGTH)

    @classmethod
    def bedtime(cls, bed_times: np.ndarray, bed_clocks: np.ndarray, t: float, now_clock: float, prior_clock: float, prior_sd: float) -> np.ndarray:
        from .priors import truncated_clock_quantiles

        weights = cls._weights(bed_times, t)
        mean, var, n = cls.posterior(bed_clocks, weights, prior_clock, prior_sd)
        sd = math.sqrt(var * (1 + 1 / (cls.PRIOR_COUNT + n)))
        return truncated_clock_quantiles(mean, sd, now_clock)
