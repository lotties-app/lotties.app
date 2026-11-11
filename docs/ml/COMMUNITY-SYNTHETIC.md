# Community insights: synthetic study of the pooled-statistics pipeline

November 2026. Task T8, first half, of [docs/design/34-community-insights.md](../design/34-community-insights.md)
(section 9 "Evaluation", item 1). Code: [`ml/benchmark/community.py`](../../ml/benchmark/community.py), inputs from
`community_cohort` in [`ml/benchmark/synthetic.py`](../../ml/benchmark/synthetic.py), tests in
[`ml/tests/test_community.py`](../../ml/tests/test_community.py).

> **Synthetic data cannot prove a real-world gain** (docs/design/28-age-norms.md section 15.4). Every baby, family and
> value below is generated; there is no child data in this study. The numbers show what the pipeline does when babies
> behave like the generator says, nothing more. The gap between a pooled number and a published norm is partly built
> into the generator (its truth curves move week by week inside a norm's band). No pooled statistic may be promoted
> on these results; the pilot backtest (section 9 items 2-3) is still to do.

Command (about 5 minutes on a laptop CPU, single process):

```bash
cd ml
.venv/bin/python -m benchmark.community --k 20 --epsilon 0.2 --seed 1 --out out
```

## What was simulated

- **Instances** of 100, 1 000 and 10 000 babies, in families of 1 (75 %), 2 (20 %) or 3 (5 %) babies. About 2 % of
  families (and at least one per instance) are **heavy**: every day logged for 40 weeks, 28 bottles a day, biased values
  (x1.5 ml, x3 tummy time, +90 min night, +1.5 naps, always "gas" for crying). Every other baby logs a window of 2 to 16
  weeks starting at a random age between 0 and 103 weeks, 80 % of days.
- **Opt-in** of 5, 20 and 50 %, decided per family (all babies of a family in or out). The babies who did not opt in
  are the **held-out** babies: they never feed the pool and they are the ones scored for calibration and cold start.
- **Inputs per use case** (design 34 section 4), per baby per day: ml per bottle (formula or breast milk, 1 % typing
  slips x10), tummy minutes per day (weeks 0-26, about 65 % of days), night sleep minutes and naps per day (routines),
  and answered crying spells with the cause that helped and the part of day.
- **Truth**: formula ml per feed, night sleep and naps follow straight lines through the published norms of
  `code/api/data/age-norms.json`, placed at each norm band's middle week; tummy time, breast-milk bottles, the first
  weeks of night sleep and naps, all spreads and the crying causes are unsourced generator choices (listed in
  `synthetic.py`). The crying causes have a known ground truth per cry band (docs/design/27) and part of day.

## The pipeline (pure functions in `community.py`, design 34 section 5)

1. Population: the opted-in babies (a withdrawn baby is simply not in it).
2. Clipping to the published range: bottles 0-400 ml, tummy 0-180 min, night 0-960 min, naps 0-8.
3. Fixed age bands: fine grid weekly to week 12, 2-week bands to week 28, 4-week bands to week 104; coarse fallback
   grid 4-week bands to week 52, then 12-week bands (the last one 100-104). Cry bands are the four `cryAgeBand` bands,
   with no coarse grid. Dimensions: feeding kind for bottles, part of day for crying.
4. Per-baby cap: at most 14 days per baby and cell, picked by a keyed hash of baby id and day (the same days on every
   run); then **one summary per baby** (her own median; for crying her own share of each cause).
5. k: a cell needs at least 20 distinct babies AND 20 distinct families; a cell published by the previous run stays
   while it keeps 18 (hysteresis). Dominance: suppressed when one family has more than 25 % of the cell's values after
   the cap. A fine cell below k is covered by its coarse cell when that one passes (coarse cells are only released when
   a fine cell inside them is suppressed).
6. Outputs: p10, p25, p50, p75, p90 of the babies' medians, plus p3 and p97 only from 50 babies; crying: the mean share
   of each cause. Babies are published as a bucket (20-49, 50-99, 100+), never a count.
7. Noise, epsilon per statistic per release split evenly over the cell's outputs: the exponential mechanism over a
   fixed grid for each percentile (10 ml, 2 min, 10 min, 0.5 nap steps; the "DP median over a fixed grid" of section 5),
   and the Laplace mechanism (scale 2 / (n epsilon)) on the crying shares. Percentiles are sorted and shares
   renormalised afterwards (post-processing).

Deviation and simplifications to review: the fine grid's 2-week bands run to week 28, not 26 (design 34 section 5), so
every fine band sits inside one 4-week coarse band. Epsilon is accounted per cell; a baby whose history spans several
bands spends it in each of them (basic composition), and a family of s babies has s times the per-baby budget. The k
counts, the dominance check and the hysteresis use exact counts, which are not noised: the suppression decision itself
is not differentially private (see the membership numbers below).

## What each number means

- **Fine bands published / Covered**: share of fine cells (bands x dimensions) with their own published number, and
  with a number from either the fine cell or its coarse fallback. The rest falls back to the published norm or the
  built-in default in the app.
- **Suppressed fine (reasons)**: count of fine cells suppressed, by reason (`below_k`, `dominance`).
- **Pooled p50 error**: mean absolute difference, over covered fine bands, between the released median and the
  generator's truth for that band (the truth curve averaged over the band's weeks), with noise and without. For crying:
  mean absolute difference of the cause shares from the ground truth, in percentage points.
- **Bands with a prior / Pooled error there / Prior error there**: the same error restricted to covered bands that have
  a usable published norm (`needsReview` false and confidence not low; the middle of the range when the norm has no
  typical value), and the norm's own error against the same truth. Crying has no published share, so its baseline is
  the uniform split (20 % per cause). Tummy time and breast-milk bottles have no norm (n/a).
- **Cold start**: for each held-out baby's first 14 days, every value (clipped) on bands where both a pooled number and
  a norm exist is predicted by the pooled median and by the norm; MAE of each, and the difference pooled minus prior
  with a 95 % bootstrap CI over babies (1 000 draws). Negative means the pooled number helps.
- **Calibration p10-p90**: share of held-out babies' own band medians (same cap and clipping) inside the published
  p10-p90 of their band; target 80 % +/- 5. CI by bootstrap over babies.
- **Membership inference** on the smallest published fine cell (the riskiest), 2 000 trials per game, against a target
  family drawn at random. The threshold is fitted on half of the trials and the advantage (true-positive rate minus
  false-positive rate, 0 = no better than guessing, 1 = always right) is measured on the other half, CI by bootstrap.
  *Single release*: the attacker knows the target family's own values and sees one release; in the other world the
  family is replaced by a family that did not opt in. *Withdrawal*: two consecutive releases, between which the family
  withdrew or not, everything else equal (the differencing case of design 34 section 8); a second release that is
  suppressed counts as the largest change. For epsilon 0.2 per baby the theoretical bound on the withdrawal advantage
  is tanh(epsilon / 2) = 0.10 (0.29 for a family of three), plus whatever the non-private suppression leaks.
- **Epsilon sweep**: the pooled median error and the calibration at several epsilons on one instance (10 000 babies,
  20 % opt-in), to set the noise against the band spread before epsilon is chosen.

## Findings

1. **Instance size decides coverage.** An instance of 100 babies publishes nothing (one crying cell at 50 % opt-in).
   At 1 000 babies fine cells appear only from 20 % opt-in, and bottles (two kinds, 78 cells) need 50 %. At 10 000
   babies 20 % opt-in covers every band of every statistic. Self-hosted instances will silently use the norms
   (design 34 section 6), as intended.
2. **Without noise the pipeline is accurate and close to calibrated.** Exact pooled medians are within 4-10 ml, 1-5
   minutes of tummy time, 5-11 minutes of night sleep and 0.2 naps of the generator truth; calibration of the p10-p90
   is 73-79 % for bottles and night sleep (slightly under the 80 % target in small cells; 66 % for bottles at 1 000
   babies and 20 %, where only coarse cells spanning a steep part of the curve exist), 74-86 % for tummy time and
   83-92 % for naps (whole-number naps make many ties).
3. **At epsilon 0.2 the noise swamps the numbers.** With epsilon split over 5 or 7 percentiles, the exponential
   mechanism over a 10 ml or 10 minute grid is close to uniform in cells of 20-99 babies: the pooled median is off by
   54-76 ml, 50-60 minutes of tummy time and 70-180 minutes of night sleep, and the cold-start MAE is worse than the
   norm prior everywhere (bottles +14 to +55 ml, night +23 to +173 min, naps +0.2 to +1.8, all CIs above zero). The
   sweep shows the error reaching the exact level only around epsilon 5-10 per statistic per release. Crying shares
   (Laplace on one vector) are much less affected: 4.8 points at epsilon 0.2 against 1.7 exact at 10 000 babies and
   20 % opt-in, against 8 points for the uniform baseline.
4. **Pooled versus the norms, without noise: small and only at scale.** On bands with a usable norm, the exact pooled
   median is closer to the truth than the norm for bottles at 10 000 babies with 20-50 % opt-in (2-3 ml against 6 ml)
   and for naps (0.2 against 0.3), but not for night sleep (4-13 min against 4.5) nor for bottles in smaller pools
   (7.6-7.8 ml against 5.3-5.8). The cold-start MAE moves by about 1 ml per feed for bottles (-0.5 to -1.2 ml at 10 000
   babies, CIs below zero; +0.6, CI across zero, at 1 000 and 50 %), by -0.1 naps a day, and by -0.2 to +1.7 minutes
   for night sleep: a real but tiny gain on a 45-60 ml or 60 minute error, and one the generator builds in (its truth
   moves inside the norms' bands while the norm is flat). The study therefore shows no gain worth a promotion for
   bottles, night sleep or naps; it does show that pooled numbers are the only source for breast-milk bottles, tummy
   time, the bands where the norm needs review (night sleep 17-52 and 78-104 weeks) and crying, where pooled shares beat
   the uniform baseline (1.4-2.9 points against 8-10 without noise).
5. **Privacy.** Without noise a single release gives an attacker who knows one family's values an advantage of up to
   0.27 on the smallest cell (mostly 0.1-0.2; crying shares leak the most), and a withdrawal between two releases is
   detected almost always (advantage 1.00 because some percentile moves; less for naps, whose whole-number medians
   often do not move). With noise both advantages are within about 0.07 of zero, inside the 0.10 bound. So the formal noise does protect against differencing, but only at a cost that makes the
   quantile statistics useless at epsilon 0.2 (finding 3).
6. **The dominance rule bites on heavy families.** It counts values after the per-day cap, so a heavy family logging
   28 bottles a day suppresses the cells it is in (7 fine bottle cells at 1 000 babies and 50 %, 14 at 10 000 and 5 %),
   although each baby already contributes one summary to the percentiles. Counting baby summaries, or capping values
   per day, would keep those cells.

## Open questions for the owner and the T5 build

- O2 (noise): at epsilon 0.2 per weekly release, quantile statistics are not usable in cells under about 100 babies.
  Options to weigh: no DP on percentiles and rely on k, caps, clipping, dominance and hysteresis (but then a withdrawal
  is detectable, finding 5); monthly release with a larger epsilon; one noisy median per cell instead of 5-7
  percentiles; a coarser grid; or noise only on shares and counts.
- The dominance rule's unit (values after the day cap, or babies' summaries), finding 6.
- The fine grid edge (2-week bands to week 28 instead of 26) so that fine bands nest in the coarse ones.
- The suppression decision uses exact counts; with hysteresis it can still flip on one withdrawal near 18.

## Results

All tables below are produced by the command above (seed 1) and are aggregates of synthetic data only.

k = 20 babies and families, hysteresis 18, dominance 25%, cap 14 days per baby and cell, epsilon = 0.2 per statistic per release, seed 1, 1000 bootstrap draws, 2000 membership trials per game. Synthetic data only; it cannot prove a real-world gain.

### bottle_ml_per_feed

#### Coverage and error

| Babies | Opt-in | Opted-in babies | Fine bands published | Covered (fine or coarse) | Suppressed fine (reasons) | Pooled p50 error, noise (ml) | Pooled p50 error, exact (ml) | Bands with a prior | Pooled error there, noise | Pooled error there, exact | Prior error there |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | 5% | 5 | 0% | 0% | below_k 78 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 20% | 21 | 0% | 0% | below_k 78 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 50% | 46 | 0% | 0% | below_k 78 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 5% | 64 | 0% | 0% | below_k 78 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 20% | 190 | 0% | 19% | below_k 78 | 56.0 | 3.8 | 0 | n/a | n/a | n/a |
| 1000 | 50% | 509 | 62% | 85% | below_k 23, dominance 7 | 60.1 | 7.4 | 22 | 48.8 | 7.6 | 5.8 |
| 10000 | 5% | 494 | 55% | 68% | below_k 21, dominance 14 | 76.0 | 9.9 | 11 | 100.3 | 7.8 | 5.3 |
| 10000 | 20% | 2037 | 96% | 100% | below_k 3 | 64.7 | 5.1 | 25 | 38.6 | 2.2 | 6.2 |
| 10000 | 50% | 5069 | 99% | 100% | below_k 1 | 54.3 | 3.5 | 25 | 41.6 | 3.4 | 6.2 |

#### Cold start and calibration

| Babies | Opt-in | Cold-start points | Prior MAE (ml) | Pooled MAE, noise (ml) | Δ pooled − prior, noise (95 % CI) | Pooled MAE, exact (ml) | Δ pooled − prior, exact (95 % CI) | Calibration p10-p90, noise (%, CI) | Calibration, exact (%, CI) |
|---:|---:|---:|---:|---:|---|---:|---|---|---|
| 100 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 50% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | 94 (91-97) | 66 (60-71) |
| 1000 | 50% | 7957 | 42.1 | 71.1 | 29.0 (+21.5..+36.5) | 42.7 | 0.6 (-0.3..+1.5) | 94 (92-95) | 78 (74-82) |
| 10000 | 5% | 82741 | 48.7 | 103.4 | 54.7 (+48.8..+59.8) | 47.5 | -1.2 (-1.7..-0.7) | 90 (90-90) | 77 (76-78) |
| 10000 | 20% | 161836 | 46.3 | 62.4 | 16.1 (+14.7..+17.7) | 45.7 | -0.5 (-0.8..-0.2) | 85 (85-86) | 77 (76-78) |
| 10000 | 50% | 97436 | 45.9 | 60.2 | 14.3 (+12.2..+16.4) | 45.0 | -0.9 (-1.2..-0.6) | 88 (87-89) | 79 (78-80) |

#### Membership inference (smallest published fine cell)

| Babies | Opt-in | Cell (weeks, dimension, babies) | Single release, exact | Single release, noise | Withdrawal, exact | Withdrawal, noise |
|---:|---:|---|---|---|---|---|
| 100 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 20% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 50% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 20% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 50% | 6-7, formula, 20-49 | 0.18 (0.12..0.24) | -0.06 (-0.12..-0.01) | 1.00 (1.00..1.00) | -0.03 (-0.09..0.04) |
| 10000 | 5% | 9-10, formula, 20-49 | 0.18 (0.12..0.24) | -0.01 (-0.07..0.06) | 1.00 (1.00..1.00) | 0.03 (-0.03..0.08) |
| 10000 | 20% | 0-1, formula, 20-49 | 0.17 (0.11..0.22) | -0.00 (-0.02..0.02) | 1.00 (1.00..1.00) | 0.00 (-0.02..0.02) |
| 10000 | 50% | 0-1, formula, 20-49 | 0.07 (0.03..0.11) | 0.01 (-0.02..0.03) | 1.00 (1.00..1.00) | -0.04 (-0.08..0.01) |

### tummy_minutes_per_day

#### Coverage and error

| Babies | Opt-in | Opted-in babies | Fine bands published | Covered (fine or coarse) | Suppressed fine (reasons) | Pooled p50 error, noise (min) | Pooled p50 error, exact (min) | Bands with a prior | Pooled error there, noise | Pooled error there, exact | Prior error there |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | 5% | 5 | 0% | 0% | below_k 19 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 20% | 21 | 0% | 0% | below_k 19 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 50% | 46 | 0% | 0% | below_k 19 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 5% | 64 | 0% | 0% | below_k 19 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 20% | 190 | 16% | 53% | below_k 16 | 48.2 | 5.3 | 0 | n/a | n/a | n/a |
| 1000 | 50% | 509 | 89% | 100% | below_k 2 | 50.8 | 1.8 | 0 | n/a | n/a | n/a |
| 10000 | 5% | 494 | 74% | 79% | below_k 5 | 56.5 | 2.2 | 0 | n/a | n/a | n/a |
| 10000 | 20% | 2037 | 100% | 100% | none | 56.6 | 1.0 | 0 | n/a | n/a | n/a |
| 10000 | 50% | 5069 | 100% | 100% | none | 48.1 | 1.5 | 0 | n/a | n/a | n/a |

#### Cold start and calibration

| Babies | Opt-in | Cold-start points | Prior MAE (min) | Pooled MAE, noise (min) | Δ pooled − prior, noise (95 % CI) | Pooled MAE, exact (min) | Δ pooled − prior, exact (95 % CI) | Calibration p10-p90, noise (%, CI) | Calibration, exact (%, CI) |
|---:|---:|---:|---:|---:|---|---:|---|---|---|
| 100 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 50% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | 56 (52-61) | 79 (72-85) |
| 1000 | 50% | 0 | n/a | n/a | n/a | n/a | n/a | 60 (57-64) | 86 (80-92) |
| 10000 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | 56 (55-57) | 74 (73-76) |
| 10000 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | 47 (46-49) | 79 (77-81) |
| 10000 | 50% | 0 | n/a | n/a | n/a | n/a | n/a | 72 (71-74) | 80 (77-82) |

#### Membership inference (smallest published fine cell)

| Babies | Opt-in | Cell (weeks, dimension, babies) | Single release, exact | Single release, noise | Withdrawal, exact | Withdrawal, noise |
|---:|---:|---|---|---|---|---|
| 100 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 20% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 50% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 20% | 12-14, all, 20-49 | 0.12 (0.07..0.16) | -0.00 (-0.06..0.06) | 1.00 (1.00..1.00) | -0.01 (-0.04..0.02) |
| 1000 | 50% | 2-3, all, 20-49 | 0.15 (0.09..0.20) | -0.02 (-0.07..0.03) | 1.00 (1.00..1.00) | -0.03 (-0.09..0.03) |
| 10000 | 5% | 5-6, all, 20-49 | 0.11 (0.06..0.15) | -0.01 (-0.04..0.01) | 1.00 (1.00..1.00) | 0.00 (-0.05..0.05) |
| 10000 | 20% | 0-1, all, 20-49 | 0.16 (0.10..0.22) | 0.04 (-0.02..0.09) | 1.00 (1.00..1.00) | -0.06 (-0.11..-0.01) |
| 10000 | 50% | 0-1, all, 50-99 | 0.02 (-0.04..0.08) | 0.03 (-0.03..0.08) | 1.00 (1.00..1.00) | -0.01 (-0.03..0.01) |

### night_sleep_minutes

#### Coverage and error

| Babies | Opt-in | Opted-in babies | Fine bands published | Covered (fine or coarse) | Suppressed fine (reasons) | Pooled p50 error, noise (min) | Pooled p50 error, exact (min) | Bands with a prior | Pooled error there, noise | Pooled error there, exact | Prior error there |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | 5% | 5 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 20% | 21 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 50% | 46 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 5% | 64 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 20% | 190 | 49% | 74% | below_k 20 | 156.0 | 10.7 | 10 | 136.0 | 8.5 | 4.5 |
| 1000 | 50% | 509 | 95% | 100% | below_k 2 | 183.9 | 9.1 | 10 | 213.3 | 12.1 | 4.5 |
| 10000 | 5% | 494 | 90% | 90% | below_k 4 | 141.3 | 11.3 | 10 | 137.9 | 13.3 | 4.5 |
| 10000 | 20% | 2037 | 100% | 100% | none | 119.5 | 7.5 | 10 | 137.8 | 5.9 | 4.5 |
| 10000 | 50% | 5069 | 100% | 100% | none | 68.5 | 4.6 | 10 | 43.6 | 3.9 | 4.5 |

#### Cold start and calibration

| Babies | Opt-in | Cold-start points | Prior MAE (min) | Pooled MAE, noise (min) | Δ pooled − prior, noise (95 % CI) | Pooled MAE, exact (min) | Δ pooled − prior, exact (95 % CI) | Calibration p10-p90, noise (%, CI) | Calibration, exact (%, CI) |
|---:|---:|---:|---:|---:|---|---:|---|---|---|
| 100 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 50% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 20% | 3152 | 58.5 | 147.6 | 89.0 (+78.4..+100.7) | 59.6 | 1.1 (-0.2..+2.3) | 88 (87-89) | 73 (69-75) |
| 1000 | 50% | 1921 | 58.1 | 231.1 | 173.0 (+154.7..+193.3) | 59.8 | 1.7 (+0.0..+3.5) | 81 (78-83) | 74 (70-78) |
| 10000 | 5% | 35554 | 60.4 | 142.9 | 82.6 (+79.6..+85.5) | 61.6 | 1.2 (+0.8..+1.6) | 81 (81-82) | 75 (74-76) |
| 10000 | 20% | 29902 | 60.3 | 150.0 | 89.7 (+86.2..+92.9) | 60.3 | -0.0 (-0.2..+0.2) | 90 (90-91) | 79 (78-80) |
| 10000 | 50% | 18548 | 60.7 | 83.9 | 23.1 (+20.6..+25.6) | 60.5 | -0.2 (-0.5..-0.0) | 96 (96-97) | 79 (78-81) |

#### Membership inference (smallest published fine cell)

| Babies | Opt-in | Cell (weeks, dimension, babies) | Single release, exact | Single release, noise | Withdrawal, exact | Withdrawal, noise |
|---:|---:|---|---|---|---|---|
| 100 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 20% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 50% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 20% | 12-14, all, 20-49 | 0.15 (0.10..0.20) | -0.03 (-0.08..0.03) | 1.00 (1.00..1.00) | 0.02 (-0.03..0.08) |
| 1000 | 50% | 2-3, all, 20-49 | 0.06 (0.02..0.10) | 0.01 (-0.02..0.04) | 1.00 (1.00..1.00) | 0.04 (-0.01..0.09) |
| 10000 | 5% | 4-5, all, 20-49 | 0.07 (0.01..0.13) | -0.01 (-0.07..0.06) | 1.00 (1.00..1.00) | 0.02 (-0.02..0.07) |
| 10000 | 20% | 0-1, all, 20-49 | 0.06 (0.03..0.08) | 0.02 (-0.04..0.08) | 1.00 (1.00..1.00) | 0.01 (-0.05..0.07) |
| 10000 | 50% | 0-1, all, 50-99 | 0.03 (-0.02..0.07) | 0.00 (-0.01..0.02) | 1.00 (1.00..1.00) | -0.00 (-0.03..0.02) |

### naps_per_day

#### Coverage and error

| Babies | Opt-in | Opted-in babies | Fine bands published | Covered (fine or coarse) | Suppressed fine (reasons) | Pooled p50 error, noise (naps) | Pooled p50 error, exact (naps) | Bands with a prior | Pooled error there, noise | Pooled error there, exact | Prior error there |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | 5% | 5 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 20% | 21 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 50% | 46 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 5% | 64 | 0% | 0% | below_k 39 | n/a | n/a | 0 | n/a | n/a | n/a |
| 1000 | 20% | 190 | 49% | 74% | below_k 20 | 2.3 | 0.2 | 29 | 2.3 | 0.2 | 0.2 |
| 1000 | 50% | 509 | 95% | 100% | below_k 2 | 1.8 | 0.2 | 39 | 1.8 | 0.2 | 0.3 |
| 10000 | 5% | 494 | 90% | 90% | below_k 4 | 1.6 | 0.2 | 35 | 1.6 | 0.2 | 0.2 |
| 10000 | 20% | 2037 | 100% | 100% | none | 1.3 | 0.2 | 39 | 1.3 | 0.2 | 0.3 |
| 10000 | 50% | 5069 | 100% | 100% | none | 0.7 | 0.2 | 39 | 0.7 | 0.2 | 0.3 |

#### Cold start and calibration

| Babies | Opt-in | Cold-start points | Prior MAE (naps) | Pooled MAE, noise (naps) | Δ pooled − prior, noise (95 % CI) | Pooled MAE, exact (naps) | Δ pooled − prior, exact (95 % CI) | Calibration p10-p90, noise (%, CI) | Calibration, exact (%, CI) |
|---:|---:|---:|---:|---:|---|---:|---|---|---|
| 100 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 20% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 100 | 50% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 5% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 1000 | 20% | 8122 | 0.8 | 2.6 | 1.8 (+1.7..+1.9) | 0.7 | -0.1 (-0.1..-0.0) | 67 (65-70) | 83 (80-85) |
| 1000 | 50% | 5577 | 0.8 | 2.1 | 1.3 (+1.2..+1.4) | 0.7 | -0.1 (-0.1..-0.1) | 69 (66-72) | 88 (85-91) |
| 10000 | 5% | 104873 | 0.8 | 1.9 | 1.1 (+1.1..+1.1) | 0.7 | -0.1 (-0.1..-0.1) | 77 (76-77) | 89 (88-89) |
| 10000 | 20% | 91106 | 0.8 | 1.4 | 0.7 (+0.6..+0.7) | 0.7 | -0.1 (-0.1..-0.1) | 83 (83-84) | 89 (89-90) |
| 10000 | 50% | 56340 | 0.8 | 1.0 | 0.2 (+0.2..+0.2) | 0.7 | -0.1 (-0.1..-0.1) | 93 (93-94) | 92 (91-93) |

#### Membership inference (smallest published fine cell)

| Babies | Opt-in | Cell (weeks, dimension, babies) | Single release, exact | Single release, noise | Withdrawal, exact | Withdrawal, noise |
|---:|---:|---|---|---|---|---|
| 100 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 20% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 50% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 1000 | 20% | 12-14, all, 20-49 | -0.00 (-0.06..0.06) | 0.03 (-0.03..0.09) | 0.30 (0.26..0.34) | -0.02 (-0.08..0.05) |
| 1000 | 50% | 2-3, all, 20-49 | 0.06 (-0.01..0.11) | 0.00 (-0.03..0.04) | 1.00 (1.00..1.00) | -0.00 (-0.02..0.01) |
| 10000 | 5% | 4-5, all, 20-49 | 0.00 (0.00..0.00) | 0.02 (-0.02..0.06) | 0.89 (0.86..0.92) | -0.01 (-0.06..0.05) |
| 10000 | 20% | 0-1, all, 20-49 | 0.00 (0.00..0.00) | -0.00 (-0.01..0.00) | 1.00 (1.00..1.00) | -0.01 (-0.02..0.01) |
| 10000 | 50% | 0-1, all, 50-99 | 0.00 (0.00..0.00) | -0.00 (-0.05..0.05) | 0.00 (0.00..0.00) | 0.01 (-0.01..0.03) |

### cry_outcome_by_cause

#### Coverage and error

| Babies | Opt-in | Opted-in babies | Fine bands published | Covered (fine or coarse) | Suppressed fine (reasons) | Pooled share error, noise (points) | Pooled share error, exact (points) | Bands with a prior | Pooled error there, noise | Pooled error there, exact | Prior error there |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | 5% | 5 | 0% | 0% | below_k 16 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 20% | 21 | 0% | 0% | below_k 16 | n/a | n/a | 0 | n/a | n/a | n/a |
| 100 | 50% | 46 | 25% | 25% | below_k 12 | 12.9 | 5.4 | 4 | 12.9 | 5.4 | 10.1 |
| 1000 | 5% | 64 | 25% | 25% | below_k 12 | 9.5 | 2.9 | 4 | 9.5 | 2.9 | 10.1 |
| 1000 | 20% | 190 | 62% | 62% | below_k 6 | 11.6 | 2.9 | 10 | 11.6 | 2.9 | 8.5 |
| 1000 | 50% | 509 | 100% | 100% | none | 9.5 | 2.5 | 16 | 9.5 | 2.5 | 8.0 |
| 10000 | 5% | 494 | 94% | 94% | below_k 1 | 9.3 | 2.1 | 15 | 9.3 | 2.1 | 7.9 |
| 10000 | 20% | 2037 | 100% | 100% | none | 4.8 | 1.7 | 16 | 4.8 | 1.7 | 8.0 |
| 10000 | 50% | 5069 | 100% | 100% | none | 2.2 | 1.4 | 16 | 2.2 | 1.4 | 8.0 |

#### Membership inference (smallest published fine cell)

| Babies | Opt-in | Cell (weeks, dimension, babies) | Single release, exact | Single release, noise | Withdrawal, exact | Withdrawal, noise |
|---:|---:|---|---|---|---|---|
| 100 | 5% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 20% | no published cell | n/a | n/a | n/a | n/a |
| 100 | 50% | 26-104, night, 20-49 | 0.11 (0.08..0.14) | 0.01 (-0.05..0.07) | 1.00 (1.00..1.00) | -0.00 (-0.06..0.06) |
| 1000 | 5% | 26-104, afternoon, 20-49 | 0.03 (-0.03..0.08) | 0.00 (-0.06..0.07) | 1.00 (1.00..1.00) | -0.00 (-0.07..0.06) |
| 1000 | 20% | 6-13, morning, 20-49 | 0.19 (0.12..0.25) | 0.00 (-0.06..0.06) | 1.00 (1.00..1.00) | 0.01 (-0.03..0.04) |
| 1000 | 50% | 0-6, night, 20-49 | 0.27 (0.21..0.33) | -0.01 (-0.07..0.05) | 1.00 (1.00..1.00) | -0.07 (-0.13..-0.00) |
| 10000 | 5% | 0-6, afternoon, 20-49 | 0.17 (0.12..0.23) | 0.01 (-0.03..0.05) | 1.00 (1.00..1.00) | 0.00 (-0.05..0.06) |
| 10000 | 20% | 0-6, night, 50-99 | 0.24 (0.18..0.30) | 0.02 (-0.04..0.08) | 1.00 (1.00..1.00) | -0.02 (-0.03..0.00) |
| 10000 | 50% | 0-6, night, 100+ | 0.20 (0.13..0.26) | -0.01 (-0.01..0.00) | 1.00 (1.00..1.00) | 0.01 (-0.04..0.07) |

### Epsilon sweep (10000 babies, 20% opt-in)

Pooled median error (shares: share error in points) / calibration p10-p90 (%), per epsilon per statistic per release.

| Statistic | exact | 0.2 | 0.5 | 1.0 | 2.0 | 5.0 | 10.0 |
|---|---|---|---|---|---|---|---|
| bottle_ml_per_feed (ml) | 5.1 / 77 | 59.3 / 79 | 47.1 / 89 | 33.5 / 92 | 14.9 / 91 | 6.0 / 86 | 5.1 / 80 |
| tummy_minutes_per_day (min) | 1.0 / 79 | 62.3 / 44 | 44.7 / 75 | 24.1 / 84 | 13.0 / 88 | 1.2 / 83 | 1.1 / 82 |
| night_sleep_minutes (min) | 7.5 / 79 | 107.5 / 92 | 46.1 / 96 | 20.4 / 91 | 18.5 / 87 | 9.0 / 81 | 8.3 / 80 |
| naps_per_day (naps) | 0.2 / 89 | 1.2 / 87 | 0.7 / 91 | 0.5 / 90 | 0.3 / 91 | 0.3 / 88 | 0.3 / 88 |
| cry_outcome_by_cause (points) | 1.7 / n/a | 2.9 / n/a | 1.8 / n/a | 1.7 / n/a | 1.7 / n/a | 1.7 / n/a | 1.7 / n/a |

Runtime: 309 s.
