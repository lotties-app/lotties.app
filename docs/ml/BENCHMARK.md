# Can a small model beat the heuristic? Backtest of event-time predictions

October 2026. Code: [`ml/`](../../ml/README.md). Service design: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Only aggregate metrics appear here; the data is one real baby's anonymised history kept outside the repository.

## Summary

1. **No small model reliably beats the heuristic at "when is the next feed, diaper or sleep".** Gains of 5-11 % in the
   test window shrink to about zero in the three weeks before it. The one consistent signal is diapers: the ensemble
   fixed in advance (LightGBM quantiles + discrete hazard + shrinkage) cut the MAE by 11 % [4, 16] in the test window and
   by 5 % [-6, 14] in validation, and improved the interval (pinball) loss by 12 % and 11 %, both intervals above zero.
   That is about 12 minutes on a 108-minute error.
2. **The large wins are in wake-up times, and they come from fixing one heuristic rule, not from ML.** The C# engine
   takes a running sleep's typical duration from all sessions of the same day/night phase, so a nap that starts after
   19:00 is expected to last a night (about 10 h) and a bed time before 19:00 is expected to last a nap. Taking
   durations only from sessions of the same kind (nap or night) cuts the wake-up MAE from 92 to 43 minutes (54 % [37, 65])
   in the test window and from 124 to 74 in validation. Every kind-aware method, even a plain global median, lands
   close (44-52 minutes in test); the best model (shrinkage) is -3 % [-12, +3] against the fixed heuristic in test and
   +10 % [+3, +17] in validation.
3. **Bed time**, which the C# engine does not predict: the recent bed-time clocks (the quantiles of the last 14 bed
   times that are still later than now) are the best or tied-best method (MAE 45 minutes in test, 96 in validation).
   Gradient boosting is clearly worse (-25 % and -57 %).
4. **Models must be refit every day.** Trained once on the first 1-3 weeks and then frozen, LightGBM and the hazard
   model lose 18-32 % against the heuristic on feeds and up to 37 % on sleep starts: at 1-2 months the rhythm drifts
   within days. Diapers are the exception (+7 to +13 % frozen after 2-3 weeks).
5. **Cold start:** in weeks 2-4 of the history no model beats the heuristic on next-start targets; kind-aware durations
   win from week 2.
6. **Cost is not the obstacle:** fitting all six targets takes about 1 s per baby on one CPU thread (LightGBM or
   hazard), a prediction takes 3-5 ms per target, a five-quantile LightGBM set is 0.1-0.5 MB, and the whole benchmark
   peaked at 0.2 GB of memory.

## Recommendation

1. **Ship heuristic v1.1 in the C# Domain first** (pure functions, no new infrastructure):
   - typical duration of a running sleep from finished sessions of the same kind (naps for a nap, nights for a night);
     evaluated here as `heuristic_kind`;
   - a bed-time window from the last 14 bed-time clocks, keeping only those later than now (q25-q75); evaluated here as
     the bed-time `same_hour_median`;
   - keep the q25-q75 window as it is: it is well calibrated for next-start targets (47-49 % coverage in test, 45-50 %
     in validation, for a nominal 50 %).
2. **Do not ship ML as the default.** If the ml-service of [`ARCHITECTURE.md`](ARCHITECTURE.md) is built, run it in
   shadow mode and use a model for a baby's target only when all of these hold in that baby's own rolling backtest:
   - MAE at least 5 % better than the heuristic (v1.1 once shipped) over the last 21 days, with the lower bound of the
     95 % day-block bootstrap interval above zero;
   - better (positive improvement) on the 21 days before as well;
   - mean pinball loss not worse, and 80 % interval coverage between 65 % and 92 %;
   - at least 80 scored decision points (15 nights for night duration) over at least 14 days;
   - refit daily (never a frozen model), trained in the last 72 h, no logging gap in progress.
   Otherwise the heuristic answers. On this baby the gate would promote the ensemble for diapers and, only just, for
   feeds (+5.5 % [+0.5, +10] in test, +0.1 % in validation); nothing else.
3. **Which models:** the ensemble (mean quantiles of `lgbm_quantile`, `hazard`, `shrinkage`) for next-start targets,
   and `shrinkage` as the robust, file-less option for durations and bed time. Not worth carrying: the linear quantile
   model (unstable, catastrophic when frozen), scikit-learn HistGradientBoosting (same accuracy as LightGBM at 6 times
   the fit time), a GRU.
4. **What to improve instead**, in order of expected value: heuristic v1.1 above; logging-gap handling (the "paused"
   state of the design review), because gaps dominate the largest errors; a product decision on top-up feeds (10 % of
   feed intervals are under 23 minutes and no method predicts them); evaluating predictions while waiting (the hazard
   model can condition on time elapsed, which this benchmark does not score); and rerunning this benchmark on more
   babies, with consent, before any default-on decision.

## Results

All numbers are minutes. Δ is the relative improvement of MAE (or mean pinball) over the reference, positive is
better, with a 95 % day-block bootstrap interval. Coverage is the share of outcomes inside the 80 % (q10-q90) and 50 %
(q25-q75) intervals. "±15/±30" is the share of medians within 15/30 minutes of the outcome.

### Headline

| Target | n test | Reference MAE (test / validation) | Ensemble Δ test | Ensemble Δ validation | Best single model, test | Verdict |
|---|---:|---|---|---|---|---|
| Next feed | 203 | heuristic 73 / 71 | +5 % [+1, +10] | +0 % [-5, +5] | hgb_quantile 68, +7 % [+2, +12] (lgbm: +6 % test, -3 % validation) | no reliable gain |
| Next diaper | 99 | heuristic 108 / 87 | +11 % [+4, +16] | +5 % [-6, +14] | lgbm_quantile 96, +11 % [+5, +16] (-3 % validation) | modest, consistent only for the ensemble |
| Next sleep (awake window) | 112 | heuristic 40 / 63 | +9 % [-2, +19] | +1 % [-14, +13] | hazard 37, +8 % [-5, +21] (-7 % validation) | no |
| Wake-up (nap and night) | 116 | heuristic 92 / 124; kind-aware 43 / 74 | vs kind-aware: -8 % [-25, +4] | vs kind-aware: +4 % [-8, +14] | shrinkage 44: vs kind-aware -3 % [-12, +3], validation +10 % [+3, +17] | fix the heuristic |
| Nap duration | 96 | heuristic 71 / 104; kind-aware 41 / 61 | vs kind-aware: -11 % [-28, +2] | vs kind-aware: +4 % [-7, +14] | shrinkage 42: vs kind-aware -4 % [-12, +2] | fix the heuristic |
| Night duration | 20 | heuristic 192 / 195; kind-aware 51 / 122 | vs kind-aware: +4 % [-27, +26] | vs kind-aware: +5 % [-28, +25] | shrinkage 50: vs kind-aware +2 % [-20, +15], validation +21 % [+8, +33] | fix the heuristic; shrinkage helps with few nights |
| Bed time (asked at every daytime wake-up) | 114 | bed-time clocks 45 / 96 | -3 % [-31, +17] | -9 % [-33, +7] | shrinkage 47, -4 % [-29, +14] | recent bed-time clocks |

### Detail, test window (2026-09-30 to 2026-10-20)

**Next feed** (n = 203, 21 days; reference `heuristic`)

| Method | MAE | MedAE | Pinball q10 / q50 / q90 | Cov 80 | Cov 50 | ±15 | ±30 | ΔMAE | ΔPinball |
|---|---:|---:|---|---:|---:|---:|---:|---|---|
| heuristic | 73 | 59 | 12.2 / 36.6 / 19.6 | 76 % | 47 % | 11 % | 24 % | ref | ref |
| global_median | 77 | 59 | 12.3 / 38.3 / 19.1 | 79 % | 54 % | 11 % | 22 % | -5 % [-9, -0] | -2 % [-6, +2] |
| last5_median | 89 | 78 | 16.9 / 44.7 / 26.4 | 57 % | 34 % | 11 % | 22 % | -22 % [-32, -13] | -28 % [-36, -21] |
| last10_median | 81 | 68 | 13.5 / 40.3 / 22.6 | 66 % | 45 % | 10 % | 24 % | -10 % [-16, -4] | -12 % [-16, -6] |
| same_hour_median | 69 | 49 | 12.5 / 34.3 / 17.9 | 69 % | 48 % | 17 % | 33 % | +6 % [+1, +12] | +6 % [+1, +11] |
| age_band_prior | 75 | 71 | 15.4 / 37.7 / 21.0 | 69 % | 44 % | 12 % | 26 % | -3 % [-8, +2] | -8 % [-14, -3] |
| lgbm_quantile | 69 | 53 | 11.9 / 34.6 / 18.4 | 68 % | 41 % | 17 % | 32 % | +6 % [+1, +10] | +5 % [+0, +9] |
| lgbm_quantile_ratio | 70 | 53 | 12.2 / 35.1 / 19.4 | 69 % | 42 % | 15 % | 31 % | +4 % [-1, +8] | +3 % [-2, +7] |
| hgb_quantile | 68 | 55 | 11.9 / 34.1 / 18.6 | 69 % | 41 % | 15 % | 32 % | +7 % [+2, +12] | +6 % [+1, +10] |
| linear_quantile | 73 | 58 | 12.0 / 36.4 / 18.2 | 77 % | 48 % | 11 % | 28 % | +1 % [-5, +6] | +3 % [-2, +7] |
| hazard | 69 | 53 | 12.0 / 34.6 / 18.6 | 69 % | 44 % | 17 % | 31 % | +5 % [-1, +11] | +5 % [-1, +10] |
| shrinkage | 75 | 61 | 12.1 / 37.7 / 19.0 | 83 % | 50 % | 12 % | 24 % | -3 % [-8, +1] | -1 % [-5, +3] |
| ensemble | 69 | 55 | 11.9 / 34.6 / 17.0 | 78 % | 46 % | 18 % | 33 % | +5 % [+1, +10] | +7 % [+3, +11] |

**Next diaper** (n = 99, 21 days; reference `heuristic`)

| Method | MAE | MedAE | Pinball q10 / q50 / q90 | Cov 80 | Cov 50 | ±15 | ±30 | ΔMAE | ΔPinball |
|---|---:|---:|---|---:|---:|---:|---:|---|---|
| heuristic | 108 | 80 | 21.0 / 53.9 / 31.1 | 75 % | 48 % | 11 % | 21 % | ref | ref |
| global_median | 107 | 79 | 21.0 / 53.3 / 29.2 | 73 % | 42 % | 6 % | 15 % | +1 % [-4, +5] | +2 % [-1, +6] |
| last5_median | 123 | 104 | 29.2 / 61.4 / 39.7 | 57 % | 36 % | 12 % | 19 % | -14 % [-24, -4] | -23 % [-33, -13] |
| last10_median | 111 | 90 | 23.8 / 55.3 / 35.5 | 68 % | 42 % | 8 % | 22 % | -3 % [-9, +2] | -8 % [-15, -2] |
| same_hour_median | 106 | 76 | 24.5 / 52.9 / 32.9 | 63 % | 33 % | 11 % | 23 % | +2 % [-8, +10] | -4 % [-16, +7] |
| age_band_prior | 111 | 93 | 20.1 / 55.6 / 28.5 | 76 % | 55 % | 15 % | 27 % | -3 % [-9, +3] | +2 % [-2, +5] |
| lgbm_quantile | 96 | 78 | 22.2 / 48.1 / 28.1 | 65 % | 35 % | 12 % | 21 % | +11 % [+5, +16] | +7 % [+2, +13] |
| lgbm_quantile_ratio | 97 | 74 | 21.9 / 48.3 / 26.7 | 69 % | 38 % | 11 % | 23 % | +10 % [+4, +16] | +9 % [+2, +15] |
| hgb_quantile | 96 | 78 | 21.7 / 48.1 / 28.1 | 68 % | 35 % | 11 % | 25 % | +11 % [+4, +17] | +8 % [+2, +14] |
| linear_quantile | 111 | 89 | 21.7 / 55.4 / 25.6 | 74 % | 40 % | 8 % | 17 % | -3 % [-24, +10] | +3 % [-9, +12] |
| hazard | 96 | 77 | 20.4 / 47.9 / 28.2 | 64 % | 34 % | 15 % | 23 % | +11 % [-2, +23] | +9 % [-3, +21] |
| shrinkage | 101 | 76 | 19.7 / 50.5 / 27.8 | 84 % | 60 % | 15 % | 27 % | +6 % [+0, +12] | +8 % [+1, +13] |
| ensemble | 96 | 78 | 19.9 / 48.0 / 25.7 | 72 % | 44 % | 13 % | 22 % | +11 % [+4, +16] | +12 % [+6, +17] |

**Next sleep start, asked at each wake-up** (n = 112, 20 days; reference `heuristic`)

| Method | MAE | MedAE | Pinball q10 / q50 / q90 | Cov 80 | Cov 50 | ±15 | ±30 | ΔMAE | ΔPinball |
|---|---:|---:|---|---:|---:|---:|---:|---|---|
| heuristic | 40 | 33 | 7.6 / 20.2 / 12.4 | 79 % | 49 % | 25 % | 46 % | ref | ref |
| global_median | 39 | 33 | 7.4 / 19.5 / 11.9 | 88 % | 62 % | 27 % | 48 % | +4 % [+0, +8] | +4 % [-2, +9] |
| last5_median | 41 | 32 | 8.7 / 20.5 / 13.9 | 53 % | 30 % | 25 % | 46 % | -1 % [-7, +5] | -7 % [-14, +1] |
| last10_median | 44 | 36 | 7.7 / 22.0 / 11.7 | 66 % | 37 % | 21 % | 41 % | -9 % [-17, -1] | -3 % [-10, +4] |
| same_hour_median | 38 | 31 | 8.2 / 19.0 / 10.3 | 75 % | 48 % | 29 % | 50 % | +6 % [-2, +14] | +7 % [-2, +17] |
| age_band_prior | 40 | 32 | 7.8 / 20.0 / 10.3 | 70 % | 43 % | 24 % | 47 % | +1 % [-5, +7] | +5 % [+1, +10] |
| lgbm_quantile | 39 | 33 | 7.0 / 19.3 / 10.6 | 77 % | 46 % | 28 % | 44 % | +5 % [-8, +16] | +8 % [-0, +18] |
| lgbm_quantile_ratio | 39 | 32 | 7.2 / 19.3 / 13.2 | 74 % | 44 % | 29 % | 47 % | +5 % [-6, +14] | +1 % [-8, +12] |
| hgb_quantile | 38 | 28 | 7.2 / 18.8 / 10.6 | 78 % | 46 % | 24 % | 51 % | +7 % [-5, +20] | +9 % [+1, +18] |
| linear_quantile | 43 | 36 | 7.4 / 21.3 / 12.5 | 81 % | 56 % | 21 % | 39 % | -5 % [-16, +6] | -2 % [-14, +10] |
| hazard | 37 | 27 | 7.3 / 18.6 / 11.8 | 76 % | 48 % | 24 % | 55 % | +8 % [-5, +21] | +6 % [-6, +18] |
| shrinkage | 41 | 30 | 7.5 / 20.5 / 14.2 | 91 % | 64 % | 19 % | 51 % | -1 % [-10, +6] | -5 % [-15, +5] |
| ensemble | 37 | 27 | 7.1 / 18.4 / 11.0 | 87 % | 60 % | 26 % | 54 % | +9 % [-2, +19] | +9 % [+1, +17] |

Split by what the next sleep turned out to be: before a **nap** (n = 95) the heuristic's MAE is 41 and the ensemble's
37 (+9 % [-2, +19]); before the **night** (n = 17, the last awake window of the day) the heuristic's MAE is 39
(median error 24) and the best model, the hazard model, 33 (+17 % [-17, +46]; -13 % in validation). Too few nights to
call.

**Wake-up, asked when the sleep starts** (n = 116: 96 naps and 20 nights; reference `heuristic`, last column against
the kind-aware fix)

| Method | MAE | MedAE | Pinball q10 / q50 / q90 | Cov 80 | Cov 50 | ±15 | ±30 | ΔMAE | ΔPinball | ΔMAE vs heuristic_kind |
|---|---:|---:|---|---:|---:|---:|---:|---|---|---|
| heuristic | 92 | 24 | 14.8 / 46.1 / 34.5 | 70 % | 42 % | 39 % | 54 % | ref | ref | -117 % [-182, -59] |
| heuristic_kind | 43 | 17 | 6.8 / 21.3 / 18.4 | 68 % | 44 % | 44 % | 62 % | +54 % [+37, +65] | +51 % [+37, +62] | ref |
| global_median | 49 | 40 | 6.8 / 24.4 / 16.1 | 86 % | 49 % | 16 % | 30 % | +47 % [+28, +59] | +51 % [+33, +62] | -14 % [-35, +0] |
| last5_median | 48 | 26 | 8.7 / 23.9 / 20.5 | 63 % | 33 % | 35 % | 54 % | +48 % [+28, +61] | +44 % [+26, +58] | -12 % [-24, +0] |
| last10_median | 44 | 24 | 6.2 / 22.0 / 17.6 | 66 % | 41 % | 35 % | 57 % | +52 % [+36, +63] | +52 % [+37, +63] | -3 % [-12, +3] |
| same_hour_median | 51 | 35 | 7.5 / 25.7 / 18.0 | 59 % | 36 % | 26 % | 43 % | +44 % [+27, +54] | +46 % [+30, +58] | -21 % [-40, -6] |
| age_band_prior | 49 | 39 | 8.2 / 24.5 / 16.6 | 69 % | 37 % | 9 % | 31 % | +47 % [+27, +59] | +48 % [+29, +61] | -15 % [-37, +0] |
| lgbm_quantile | 47 | 34 | 7.9 / 23.4 / 15.6 | 70 % | 36 % | 19 % | 43 % | +49 % [+31, +60] | +51 % [+35, +62] | -10 % [-27, +2] |
| lgbm_quantile_ratio | 46 | 26 | 8.2 / 23.0 / 16.5 | 76 % | 44 % | 27 % | 54 % | +50 % [+30, +62] | +50 % [+32, +61] | -8 % [-22, +4] |
| hgb_quantile | 47 | 35 | 8.5 / 23.6 / 15.7 | 64 % | 38 % | 22 % | 42 % | +49 % [+31, +60] | +50 % [+33, +61] | -11 % [-30, +3] |
| linear_quantile | 60 | 31 | 10.8 / 29.8 / 18.0 | 66 % | 46 % | 28 % | 47 % | +35 % [+14, +51] | +39 % [+17, +54] | -40 % [-70, -15] |
| hazard | 52 | 42 | 8.9 / 26.1 / 16.6 | 56 % | 31 % | 22 % | 40 % | +43 % [+21, +57] | +46 % [+27, +59] | -23 % [-50, -3] |
| shrinkage | 44 | 30 | 6.1 / 21.9 / 16.5 | 79 % | 50 % | 27 % | 52 % | +52 % [+36, +62] | +53 % [+39, +63] | -3 % [-12, +3] |
| ensemble | 46 | 34 | 6.2 / 23.0 / 15.6 | 70 % | 39 % | 21 % | 45 % | +50 % [+33, +61] | +53 % [+38, +64] | -8 % [-25, +4] |

Where the heuristic's duration error comes from (test window): for the 90 naps that start in the day phase its MAE is
42 minutes (last-10 nap median: 43), for the 6 naps that start after 19:00 or before 07:00 it is 517; for the 17 nights
that start after 19:00 it is 111 (last-10 night median: 48), for the 3 bed times before 19:00 it is 654.

Separately, naps (n = 96): heuristic 71, kind-aware 41, shrinkage 42, last-10 median 42, ensemble 45, LightGBM 46.
Nights (n = 20): heuristic 192, kind-aware 51, ensemble 49, shrinkage 50, global median 50, LightGBM 52, hazard 63
(its 80 % interval covered only 15 %: the 15-minute-bin hazard with 47 nights cannot shape a 10-hour curve).

**Bed time, asked at every daytime wake-up** (n = 114, 20 days; reference: recent bed-time clocks)

| Method | MAE | MedAE | Pinball q10 / q50 / q90 | Cov 80 | Cov 50 | ±15 | ±30 | ΔMAE | ΔPinball |
|---|---:|---:|---|---:|---:|---:|---:|---|---|
| bed-time clocks (`same_hour_median`) | 45 | 46 | 10.1 / 22.6 / 11.9 | 76 % | 46 % | 25 % | 39 % | ref | ref |
| heuristic (its next-sleep prediction) | 395 | 398 | 45.2 / 197.7 / 301.1 | 14 % | 9 % | 5 % | 11 % | -775 % | -1119 % |
| last10_median | 236 | 225 | 43.5 / 117.8 / 45.4 | 68 % | 41 % | 2 % | 4 % | -421 % | -363 % |
| age_band_prior | 65 | 59 | 10.6 / 32.5 / 15.1 | 72 % | 43 % | 14 % | 15 % | -44 % [-100, -5] | -30 % [-61, -4] |
| lgbm_quantile | 56 | 51 | 14.9 / 28.2 / 14.1 | 71 % | 35 % | 19 % | 29 % | -25 % [-87, +11] | -28 % [-62, -1] |
| hgb_quantile | 51 | 45 | 13.2 / 25.7 / 13.9 | 72 % | 40 % | 17 % | 34 % | -14 % [-61, +15] | -18 % [-49, +5] |
| linear_quantile | 69 | 62 | 20.6 / 34.6 / 14.0 | 69 % | 41 % | 17 % | 25 % | -53 % [-128, -6] | -55 % [-100, -18] |
| hazard | 52 | 36 | 11.7 / 26.1 / 13.0 | 53 % | 36 % | 11 % | 43 % | -16 % [-52, +13] | -14 % [-36, +8] |
| shrinkage | 47 | 43 | 8.3 / 23.5 / 12.7 | 85 % | 56 % | 24 % | 43 % | -4 % [-29, +14] | +0 % [-14, +11] |
| ensemble | 47 | 40 | 10.3 / 23.4 / 10.5 | 77 % | 50 % | 18 % | 36 % | -3 % [-31, +17] | +1 % [-14, +13] |

The heuristic row is not a fair bed-time predictor (it predicts the next nap in the morning); it is shown because it
is what the app displays. Asked only at the last wake-up before the night (n = 18), the heuristic's next-sleep
prediction has MAE 64 (median 25), the bed-time clocks 51, the hazard model 44 (+14 % [-23, +40], validation
+17 % [-20, +46]). Too few to call.

### Validation window (2026-09-09 to 2026-09-29)

ΔMAE against the same references (HistGradientBoosting was not rerun here):

| Target | n | Reference MAE | heuristic_kind | lgbm_quantile | linear_quantile | hazard | shrinkage | ensemble |
|---|---:|---:|---|---|---|---|---|---|
| Next feed | 222 | 71 | - | -3 % [-10, +4] | -11 % [-22, -2] | -4 % [-13, +4] | -1 % [-5, +3] | +0 % [-5, +5] |
| Next diaper | 88 | 87 | - | -3 % [-14, +6] | -78 % [-165, -21] | +3 % [-12, +13] | +2 % [-9, +12] | +5 % [-6, +14] |
| Next sleep | 89 | 63 | - | -4 % [-18, +7] | -65 % [-154, -10] | -7 % [-29, +10] | +0 % [-10, +9] | +1 % [-14, +13] |
| Nap duration | 73 | 104 | +41 % [+23, +55] | +41 % [+20, +55] | +11 % [-27, +44] | +40 % [+18, +55] | +44 % [+24, +59] | +44 % [+24, +57] |
| Night duration | 20 | 195 | +37 % [+18, +56] | +27 % [+10, +42] | +35 % [+13, +53] | +39 % [+17, +59] | +51 % [+38, +63] | +41 % [+26, +55] |
| Wake-up | 93 | 124 | +40 % [+26, +50] | +36 % [+23, +45] | +19 % [-9, +43] | +40 % [+26, +50] | +46 % [+33, +56] | +43 % [+31, +51] |
| Bed time | 82 | 96 (clocks) | - | -57 % [-127, -14] | -96 % [-175, -38] | +1 % [-20, +20] | -2 % [-18, +14] | -9 % [-33, +7] |

Validation is harder for everyone (younger baby, fewer days of history, bed times less regular: the clock baseline's
MAE is 96 here against 45 in test). The ranking of next-start methods flips between the two windows; the duration
picture (kind-awareness is what matters) does not.

### Intervals

For next-start targets the heuristic's own q25-q75 window covers 47-49 % of outcomes in test and 45-50 % in
validation, close to the nominal 50 %. Its q10-q90 extension covers 69-82 %. The LightGBM quantile sets are
overconfident (80 % intervals cover 62-77 %, 50 % intervals 35-46 %), the hazard model more so (54-76 %). Shrinkage is
slightly conservative (80 % intervals cover 79-91 %). The ensemble sits in between (69-87 %). This is why the promotion
gate checks coverage and pinball, not only MAE.

### Cold start

Rolling refit, evaluated during week k of the history (so with k-1 weeks behind it). ΔMAE against the heuristic
(bed time: against the bed-time clocks); `fallback` means fewer than 15 training rows, so the heuristic answered.

| Week | Target | n | Ref. MAE | heuristic_kind | lgbm_quantile | hazard | shrinkage | ensemble |
|---|---|---:|---:|---|---|---|---|---|
| 2 | feed | 80 | 74 | - | -3 % [-13, +4] | -13 % [-34, +5] | -2 % [-10, +5] | -1 % [-10, +8] |
| 2 | diaper | 27 | 90 | - | -6 % [-16, +4] | +13 % [-4, +27] | +2 % [-14, +17] | +9 % [-2, +20] |
| 2 | sleep start | 24 | 80 | - | +0 % [-2, +4] | +3 % [-19, +22] | +6 % [-4, +16] | +4 % [-7, +14] |
| 2 | wake-up | 25 | 110 | +35 % [-3, +55] | +24 % [+1, +45] (nights: fallback) | +23 % [+5, +49] (nights: fallback) | +37 % [+5, +59] | +29 % [+7, +52] |
| 2 | bed time | 22 | 84 | - | -167 % [-336, -81] | -11 % [-37, +22] | -5 % [-18, +9] | -25 % [-90, +17] |
| 3 | feed | 86 | 71 | - | -2 % [-11, +8] | +0 % [-3, +5] | +1 % [-4, +6] | +2 % [-2, +6] |
| 3 | diaper | 35 | 80 | - | +3 % [-11, +17] | -0 % [-23, +17] | +8 % [-13, +24] | +9 % [-9, +25] |
| 3 | sleep start | 27 | 69 | - | -3 % [-23, +19] | -10 % [-55, +27] | +1 % [-16, +17] | -2 % [-29, +25] |
| 3 | wake-up | 28 | 152 | +44 % [+25, +53] | +39 % [+19, +50] (4 of 7 nights: fallback) | +39 % [+11, +52] (same) | +49 % [+29, +59] | +44 % [+23, +54] |
| 3 | bed time | 26 | 111 | - | -61 % [-216, +14] | +6 % [-39, +29] | -12 % [-33, +1] | -10 % [-70, +22] |
| 4 | feed | 64 | 73 | - | -6 % [-22, +8] | -7 % [-30, +12] | -4 % [-12, +4] | -5 % [-20, +8] |
| 4 | diaper | 28 | 85 | - | -5 % [-39, +17] | -1 % [-39, +16] | -1 % [-28, +13] | +1 % [-31, +17] |
| 4 | sleep start | 35 | 48 | - | -5 % [-62, +16] | -6 % [-68, +21] | +2 % [-29, +15] | +7 % [-40, +26] |
| 4 | wake-up | 37 | 111 | +34 % [+11, +49] | +29 % [-1, +44] | +43 % [+21, +56] | +43 % [+22, +59] | +40 % [+16, +52] |
| 4 | bed time | 31 | 101 | - | -9 % [-53, +14] | +7 % [-32, +42] | +13 % [-9, +47] | +6 % [-6, +17] |

Trained once on the first k weeks and frozen, evaluated on the test window (features stay live; shrinkage is online
and not frozen, so it is left out):

| Trained on | Feed lgbm / hazard / ensemble | Diaper lgbm / hazard / ensemble | Sleep start lgbm / hazard | Wake-up lgbm / hazard | Bed time lgbm / hazard |
|---|---|---|---|---|---|
| first week | -20 % / -18 % / -11 % | -5 % / -4 % / +2 % | +1 % / -15 % | +14 % / -1 % (nights: fallback) | -414 % / -162 % |
| first 2 weeks | -23 % / -32 % / -16 % | +8 % / +12 % / +12 % | -9 % / -37 % | +5 % / -4 % (nights: fallback) | -386 % / -231 % |
| first 3 weeks | -21 % / -28 % / -15 % | +7 % / +13 % / +12 % | -17 % / -22 % | +15 % / +6 % | -115 % / -30 % |
| rolling daily refit (reference) | +6 % / +5 % / +5 % | +11 % / +11 % / +11 % | +5 % / +8 % | +49 % / +43 % | -25 % / -16 % |

The linear quantile model is not usable frozen (losses of several hundred percent even with its output clipped to
20 times the base). Night-duration models need 15 nights before they train at all.

### Sensitivity

Three LightGBM variants (smaller: 60 trees, 4 leaves, 30 rows per leaf; core features only: 21 of the 41 features;
core features with the ratio target) move ΔMAE by at most a few points: next feed -3 to +2 % in validation and +5 to
+7 % in test, next diaper -3 to +3 % and +7 to +11 %, next sleep -17 to -2 % and +5 to +9 %, wake-up +35 to +36 % and
+48 to +52 %. The conclusions are not an artifact of the chosen hyperparameters.

### Runtime, memory and size (one baby, 7 weeks, one CPU thread)

| Model | Fit, all six targets | Predict, per target | Size per target |
|---|---:|---:|---:|
| lgbm_quantile (5 quantile models) | 0.97 s | 5 ms | 95-520 KB |
| hazard (one classifier) | 0.96 s | 3.5 ms | 160-175 KB |
| linear_quantile | 1.1 s | 8.5 ms | 12 KB |
| hgb_quantile | 5.8 s | 15 ms | 280-775 KB |
| shrinkage | none (recomputed per request) | under 1 ms | none |

Feature building (including the heuristic port as a feature) takes about 2.8 ms per decision point. The full benchmark
(test, validation, sensitivity, six cold-start windows, timings) runs in about 7 minutes and its process peaked at
198 MB of memory. Training rows on the whole history: 512 feeds, 221 diapers, 233 sleep starts, 201 naps, 47 nights,
224 bed-time decisions.

## Limitations

- **One baby, seven weeks, aged 3 to 10 weeks.** No other baby was held out, so nothing here says how any method
  generalises; rhythms change fast at this age and the test weeks are not the validation weeks.
- **Small samples.** 20 nights per window and 17-18 last-wake-of-the-day decisions give intervals of ±30 points or
  more; the duration and bed-time conclusions rest on the large, consistent effects only.
- **Logging.** Napper-style logs are often entered after the fact, while the benchmark assumes every event was visible
  at its start (equally for every method). Gaps above the caps and sub-minute duplicates were excluded (7 feed, 16
  diaper, 9 sleep-start and 18 bed-time decision points); real users would have seen predictions during those gaps.
- **Multiple comparisons.** 14 methods, 10 targets, 2 windows. The model settings and the ensemble were fixed before the
  first run; after it, `heuristic_kind` was added as a diagnostic (no tunable parameter) and the linear model's output
  was clipped. Read single-window improvements under 10 % as noise unless both windows agree.
- **Scope.** Predictions are scored only right after the triggering event, not while time passes; there are no
  amounts in the export; feed duration could not be scored; the age-band priors are rough guesses.
- **The port is a port.** It passes the C# test expectations, but features use sessions paired over the whole
  history, which differs from the as-of pairing only for a bed time whose wake-up comes more than 16 h later (none in
  this data).

## Reproduce

```bash
cd ml
export BR_ML_DATA=/path/outside/the/repo/events.csv
.venv/bin/python -m benchmark.run --out out --sensitivity   # writes out/results.json and out/results.md
.venv/bin/python -m pytest                                   # 44 tests: C# parity, leakage, synthetic backtest
```

Results are deterministic (fixed seeds, single-threaded LightGBM); two full runs produced identical metrics except for
the linear model, whose output clipping was added between them.

## Data

- One baby, 1,236 events over 51 local days (2026-08-31 to 2026-10-20), age 21 to 71 days, so the whole history is in
  the 0-3 m age band (the heuristic's age-band narrowing never changes anything here).
- Napper-imported semantics: `bed_time` and `woke_up` are instants; naps and night wakings have durations; 98.5 % of
  feeds are bottle instants (only 8 breast feeds have a duration), so **feed duration cannot be evaluated**; diapers
  and medication are instants. The export has no amount column, so the planned "last amounts" features do not exist.
- Sleep sessions follow the C# rules: 201 naps and 47 bed-time nights (bed time to wake-up; a 48th pair is longer
  than 16 h, so the C# rule drops it), night wakings dropped. 7 naps start inside a bed-time night and stay separate
  sessions (the C# engine does the same: no `fell_asleep` markers in this export).
- Feed intervals are bimodal: the median is about 1 h 50 m but 10 % are under 23 minutes (top-ups and cluster feeds),
  which caps how well any method can do on "next feed".

| Target | Decision points | Scored outcomes | Excluded (gap or duplicate) | Test window n | Validation n |
|---|---:|---:|---:|---:|---:|
| Next feed | 520 | 512 | 7 | 203 | 222 |
| Next diaper | 238 | 221 | 16 | 99 | 88 |
| Next sleep start | 243 | 233 | 9 | 112 (95 before a nap, 17 before the night) | 89 (71, 18) |
| Nap duration | 201 | 201 | 0 | 96 | 73 |
| Night duration | 47 | 47 | 0 | 20 | 20 |
| Bed time | 243 | 224 | 18 | 114 (18 at the last wake-up) | 82 (19) |

The one remaining decision point per target is the last one, whose outcome is not in the data.

## Method

### Targets and decision points

| Target | Asked at | Outcome | Logging-gap cap |
|---|---|---|---|
| `feed` | each feed start | minutes to the next feed start | 8 h |
| `diaper` | each change | minutes to the next change | 12 h |
| `sleep_start` | each wake-up (end of a nap or night) | minutes to the next sleep session (nap or night) | 8 h |
| `nap_start`, `night_start` | subsets of `sleep_start` by what the next session turned out to be | | |
| `nap_duration` | each nap start | minutes to its end (the wake-up) | 6 h |
| `night_duration` | each bed time | minutes to the morning wake-up | 16 h |
| `wake_up` | union of the two above | | |
| `bedtime` | every daytime wake-up | minutes to that evening's bed time | 16 h |
| `bedtime_after_last_nap` | subset of `bedtime` asked at the last wake-up before the night | | |

Outcomes above the cap are logging gaps (a forgotten evening, an unlogged night) and outcomes under one minute are
duplicates; both are excluded for every method alike, from training and from scoring.

### No leakage

- Every feature is computed "as of" the decision instant: only events that started at or before it are visible, and
  an end after it is unknown (the event is running). The heuristic port runs on exactly that view.
- Outcome statistics (last-5/10 medians, previous outcomes) only use decision points whose outcome had already
  happened.
- Trained models are refit every day at 00:00 local on the decision points whose outcome was known by then. The hazard
  model also gets the still-open decision points as censored rows ("not yet after N minutes"), which is information
  available at refit time.
- `ml/tests/test_features.py` recomputes the features of sampled decision points on a history truncated at the
  decision instant and requires identical values; `test_backtest.py` checks that no training row's outcome is after
  its refit instant.
- Assumption: events were logged in real time. Napper users often log after the fact, so in reality some events were
  not visible yet at the decision instant; this flatters every method equally.

### Windows

- **Test**: the last 21 days (2026-09-30 to 2026-10-20), scored once with fixed settings.
- **Validation**: the 21 days before (2026-09-09 to 2026-09-29), with 9 days of history before its first day.
- Hyperparameters were fixed before looking at either window (conservative values for a few hundred rows: 150 trees,
  depth 3, 7 leaves, 20 rows per leaf, learning rate 0.05, row and column subsampling 0.8). Nothing was tuned on the
  test window. Changes after the first run: `heuristic_kind` was added (a diagnostic, see below) and the linear
  model's log-ratio output was clipped to ±3 after it blew up when frozen; a sensitivity run checks three LightGBM
  variants on both windows.

### Methods

| Method | What it is |
|---|---|
| `heuristic` | Faithful port of the C# engine (`PredictionEngine`, `SleepSessions`, `SampleSelector`, `WeightedStatistics`, default options). Passes 29 parity tests copied from the C# unit tests. |
| `heuristic_kind` | The same, but a running sleep's typical duration comes only from sessions of the same kind (naps for a nap, nights for a night) instead of all sessions in the same day/night phase. A proposed v1.1 fix, not current behaviour. |
| `global_median`, `last5_median`, `last10_median` | Quantiles of all / the last 5 / the last 10 known outcomes of the target |
| `same_hour_median` | Known outcomes of the last 14 days asked within ±1 h of the same clock time (falls back to last-10). For `bedtime`: recent bed-time clocks later than now. |
| `age_band_prior` | Rough population priors per age band (`ml/benchmark/priors.py`); no personal data |
| `lgbm_quantile` | LightGBM quantile regression on log minutes, one model per quantile |
| `lgbm_quantile_ratio` | Same, target relative to the last-10 median |
| `hgb_quantile` | scikit-learn HistGradientBoosting quantile regression (a second implementation as a check) |
| `linear_quantile` | L1-penalised linear quantile regression on the ratio target |
| `hazard` | Discrete-time hazard: P(event in the next 15 min, given not yet) from one LightGBM classifier over (decision, bin) rows with elapsed time and the bin's clock time; quantiles from the survival curve |
| `shrinkage` | Bayesian shrinkage on log minutes: age-band prior, then a recency-weighted baby mean (half-life 4 days), then a time-of-day kernel mean; normal predictive. For bed time, the same on the bed-time clock, conditioned on bed time being after now. Online (updates at every decision). |
| `ensemble` | Mean quantiles of `lgbm_quantile`, `hazard` and `shrinkage` (fixed in advance) |

Features (41, as of the decision): clock time (sin/cos), day of week, age in days, day/night phase, minutes since the
last feed / change / wake-up / sleep start, hours since the last medication, whether a sleep is running, previous feed
and change gaps, counts of feeds and changes in the last 6/12/24 h, night wakings in 12 h, sleep minutes and naps in
24 h, naps and nap minutes since the morning wake-up, last nap and night lengths, last awake window, the median of the
last 7 bed-time clocks and the minutes until it, the target's last three known outcomes and its
last-5/last-10/global/same-hour medians, and the heuristic port's own q25/q50/q75 (stacking).

A small GRU was not tried: torch would add hundreds of MB to a CPU container, and with roughly 25 (nights) to 300
(feeds) training rows per target at the start of the test window, and trees barely beating the heuristic, a recurrent
net has nothing to work with.

### Metrics

Per target: MAE and median absolute error of the median (minutes), pinball loss at q10/q50/q90, empirical coverage of
the central 80 % (q10-q90) and 50 % (q25-q75) intervals, share within ±15 and ±30 minutes, and the relative MAE and
mean-pinball improvement over the reference (`1 - loss(model)/loss(reference)`, positive is better) with a 95 %
interval from a day-block bootstrap (2,000 resamples of whole local days). The heuristic's own window is q25..q75; its
q10/q90 come from the same selected, recency-weighted samples (an extension used only for the 80 % metrics).

Port approximations: times are float seconds rather than .NET ticks (identical for this whole-second data); the local
offset is the time zone's at the decision instant (the C# engine uses the request's offset, the same here: no DST in
São Paulo since 2019); the C# engine has no bed-time prediction, so the `heuristic` row of `bedtime` is its next-sleep
prediction, which is what the app shows after the last nap.
