# ml: prediction benchmark

An honest, CPU-only backtest of small models against the heuristic v1 predictions of the API
(`code/api/src/Lotties.Domain/Predictions`). It answers one question: does a small model predict a baby's next feed,
diaper, sleep start, wake-up and bed time better than the heuristic, for that baby, without peeking at the future?

Results: [`docs/ml/BENCHMARK.md`](../docs/ml/BENCHMARK.md). Service design: [`docs/ml/ARCHITECTURE.md`](../docs/ml/ARCHITECTURE.md).

The on-device cry detection spike is a separate project with its own environment: [`cry_detector/`](cry_detector/README.md).

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

Night-window evaluation (docs/design/28-age-norms.md section 15.4): the heuristic with the shipped 19:00-07:00
day/night split against later and per-baby windows, on synthetic Brazilian and Swiss-like cohorts built from the
published bed times and night lengths (no real data; under a minute):

```bash
cd ml
.venv/bin/python -m benchmark.night_window --out out            # synthetic cohorts (default)
.venv/bin/python -m benchmark.night_window --out out --bedtime-feed-lead 90   # sensitivity of one unsourced choice
.venv/bin/python -m benchmark.night_window --out out --data /path/outside/the/repo/events.csv   # the owner's export
```

Priors (`benchmark/priors.py`, docs/design/28-age-norms.md section 15.5): bed time and night length from 3 months come
from the published Brazilian cohort; awake windows, nap lengths, feed and diaper gaps are explicit `UNSOURCED_*`
constants. Before/after on synthetic cohorts, and the full harness on one synthetic baby (no CSV needed):

```bash
cd ml
.venv/bin/python -m benchmark.prior_check --out out
.venv/bin/python -m benchmark.run --synthetic brazil --out out/after
.venv/bin/python -m benchmark.run --synthetic brazil --legacy-priors --out out/before
```

Community insights (docs/design/34-community-insights.md section 9 item 1): the pooled-statistics pipeline of design 34
section 5 (clipping, fixed age bands with a coarse fallback, a 14-day cap per baby and cell, k babies and k families,
the 25 % dominance rule, hysteresis 18, p3/p97 only from 50 babies, noise) run on synthetic instances of 100, 1 000 and
10 000 babies at 5, 20 and 50 % opt-in. Synthetic only (`community_cohort` in `benchmark/synthetic.py`; no CSV, no
`BR_ML_DATA`); writes `community.json` and `community.md` to `--out`; about 5 minutes on a laptop CPU. Results:
[`docs/ml/COMMUNITY-SYNTHETIC.md`](../docs/ml/COMMUNITY-SYNTHETIC.md).

```bash
cd ml
.venv/bin/python -m benchmark.community --k 20 --epsilon 0.2 --seed 1 --out out   # --epsilon 0 turns the noise off
```

Percentile statistics in small cells (follow-up of 2026-11-26, same results file): milk per feed, night sleep, naps and
day sleep released by exact, exponential, joint-exponential, smooth-sensitivity and noisy-histogram mechanisms for
cells of 20 to 300 babies, with the strongest and a realistic attacker's advantage; writes `percentiles.json` and
`percentiles.md` (`--render` rewrites the markdown from the JSON); about 26 minutes with 12 worker processes.

```bash
cd ml
.venv/bin/python -m benchmark.community_percentiles --seed 1 --out out
```

The percentile configuration as built in the API (follow-up of 2026-11-27): previous-quarter window, 4-week bands, at most
4 cells per baby, snapped Laplace at epsilon 2 per cell, p25/p50/p75; cell errors, privacy checks and how many babies a
band needs; writes `percentiles_built.json` and `percentiles_built.md`, and with `--vectors` the C# cross-check vectors
`tests/community_histogram_vectors.json`; about 3 minutes.

```bash
cd ml
.venv/bin/python -m benchmark.community_percentiles_built --seed 1 --out out --vectors
```

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
| `benchmark/synthetic.py` | Synthetic histories: `generate` (tests), `cohort_baby` (Brazilian and Swiss-like cohorts from published bed times and night lengths) and `community_cohort` (per-baby, per-day inputs of the community statistics, families of 1 to 3, heavy families) |
| `benchmark/night_window.py` | Night-window evaluation CLI (`night_window.json`, `night_window.md` in `--out`) |
| `benchmark/community.py` | Community-insights synthetic study: the pooled-statistics pipeline as pure functions and its evaluation CLI (`community.json`, `community.md`) |
| `benchmark/community_percentiles.py` | Percentile statistics in small cells: DP quantile mechanisms (checked in `tests/test_community_percentiles.py`), privacy measures, cell, attacker and instance studies (`percentiles.json`, `percentiles.md`) |
| `benchmark/community_percentiles_built.py` | The percentile configuration the API builds (window, 4-week bands, 4-cell bound, snapped histogram; checked in `tests/test_community_percentiles_built.py`): cell errors, privacy checks, instances (`percentiles_built.json`, `percentiles_built.md`) and the C# cross-check vectors `tests/community_histogram_vectors.json` |
| `benchmark/prior_check.py` | Before/after of the age-band priors on synthetic cohorts (`prior_check.json`, `prior_check.md`) |
