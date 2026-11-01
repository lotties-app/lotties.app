# ml: prediction benchmark

An honest, CPU-only backtest of small models against the heuristic v1 predictions of the API
(`code/api/src/Lotties.Domain/Predictions`). It answers one question: does a small model predict a baby's next feed,
diaper, sleep start, wake-up and bed time better than the heuristic, for that baby, without peeking at the future?

Results: [`docs/ml/BENCHMARK.md`](../docs/ml/BENCHMARK.md). Service design: [`docs/ml/ARCHITECTURE.md`](../docs/ml/ARCHITECTURE.md).

## Data rules

- Real event exports contain a child's data. Keep them **outside the repository** and point `BR_ML_DATA` at the CSV.
  Never copy rows into the repo, docs, logs or issues.
- The benchmark writes only aggregate metrics (`results.json`, `results.md`) to `--out`. It never writes per-event or
  per-prediction rows. `ml/out/` and `ml/data/` are gitignored anyway.
- Tests use synthetic histories (`benchmark/synthetic.py`) only.

CSV columns (one row per event, UTC ISO-8601 timestamps):
`baby, type_key (feeding|sleep|diaper|medication), started_at_utc, ended_at_utc, kind, method, content, side, birth_date`.
Sleep `kind` follows the API payload (`nap`, `night`, `night_waking`, `bed_time`, `woke_up`, `fell_asleep`). Napper
imports log `bed_time` and `woke_up` as instants, naps and night wakings with durations, and bottles as instants.

## Setup

Python 3.11 or newer, no GPU libraries.

```bash
cd ml
uv venv .venv                     # or: python -m venv .venv
uv pip install --python .venv -e ".[dev]"   # or: .venv/bin/pip install -e ".[dev]"
```

## Run

```bash
cd ml
export BR_ML_DATA=/path/outside/the/repo/events.csv
.venv/bin/python -m benchmark.run --out out --sensitivity
```

PowerShell:

```powershell
cd ml
$env:BR_ML_DATA = "C:\path\outside\the\repo\events.csv"
.venv\Scripts\python.exe -m benchmark.run --out out --sensitivity
```

Options: `--test-days 21` (length of the scored window at the end of the data; the window before it is the validation
window), `--resamples 2000` (day-block bootstrap draws), `--skip-cold-start`, `--sensitivity` (LightGBM variants on both
windows). A full run takes 7-10 minutes on a laptop CPU (LightGBM single-threaded).

Tests (heuristic parity with the C# unit tests, leakage checks, synthetic end-to-end backtest):

```bash
cd ml
.venv/bin/python -m pytest
```

## What is compared

| Kind | Methods |
|---|---|
| Baselines | `global_median`, `last5_median`, `last10_median`, `same_hour_median` (±1 h of the clock, 14 days; for bed time: recent bed-time clocks), `age_band_prior` (population priors in `benchmark/priors.py`) |
| Heuristic | `heuristic`: faithful port of the C# engine; `heuristic_kind`: the same with durations taken only from sessions of the same kind (nap or night), a proposed v1.1 fix |
| Models | `lgbm_quantile`, `lgbm_quantile_ratio` (target relative to the last-10 median), `hgb_quantile` (scikit-learn), `linear_quantile` (L1 quantile regression), `hazard` (discrete-time, 15-minute bins, LightGBM classifier), `shrinkage` (Bayesian per-baby shrinkage), `ensemble` (mean quantiles of lgbm, hazard, shrinkage) |

Every method outputs q10, q25, q50, q75 and q90 in minutes from the decision instant.

## Layout

| Module | Role |
|---|---|
| `benchmark/data.py` | CSV loader, as-of views (an end after `t` is unknown) |
| `benchmark/heuristic.py` | Port of `PredictionEngine`, `SleepSessions`, `SampleSelector`, `WeightedStatistics` |
| `benchmark/targets.py` | Decision points and outcomes per target, logging-gap caps |
| `benchmark/features.py` | Leak-free features as of each decision instant |
| `benchmark/baselines.py`, `priors.py`, `models.py` | Methods |
| `benchmark/backtest.py` | Rolling-origin evaluation with daily refits, cold-start variants, timings |
| `benchmark/metrics.py` | MAE, pinball, coverage, day-block bootstrap |
| `benchmark/run.py` | CLI and report |
