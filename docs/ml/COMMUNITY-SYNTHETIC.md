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

## Follow-up, 2026-11-26: milk per feed and sleep as percentiles in small cells

Owner request of 2026-11-26: milk per feed (`bottle_ml_per_feed`) and sleep (`night_sleep_minutes`, and where useful
`naps_per_day` and `day_sleep_minutes`) must be in v1, which section 5.1 of design 34 left out (every percentile
statistic deferred on 2026-11-11). k stays 20 babies from 20 families, and for a long time cells will hold 20 to about
100 babies. This section asks, on synthetic data, whether and how these can be published usefully, and what privacy
that really gives. **It is evidence for the owner's decision; it changes nothing in design 34, the catalog, the policy
or the application code.**

Code: [`ml/benchmark/community_percentiles.py`](../../ml/benchmark/community_percentiles.py) (reuses the pipeline of
`community.py` and the generator of `synthetic.py`, which gains `day_sleep_observations`), tests in
[`ml/tests/test_community_percentiles.py`](../../ml/tests/test_community_percentiles.py). Command (26 minutes with 12
worker processes on a 24-core laptop; the result does not depend on the number of workers):

```bash
cd ml
.venv/bin/python -m benchmark.community_percentiles --seed 1 --out out
.venv/bin/python -m pytest tests/test_community_percentiles.py tests/test_community.py
```

The same synthetic-data warning applies as above, more strongly: in the base cohort the truth of bottles, night sleep,
naps and day sleep runs through the published norms by construction, so the norms look better here than they may be in
real Lotties data.

### What was done differently from the first study

- **Cells of a fixed size.** A population of 80 000 synthetic babies (the same generator and pipeline: clipping, the
  14-day cap by keyed hash, one median per baby) gives, for 8 fixed bands from week 2 to week 92, the cohort truth
  (the percentiles of all babies' summaries in the band, 1 400 to 10 000 babies per band). Cells of n = 20, 30, 50,
  100 and 300 babies are drawn from it, 200 per band and size, and released by every candidate. Errors are against
  that truth; calibration is the share of the whole band population inside the released p25-p75 (target 50 %) and
  p10-p90 (target 80 %); the cold-start MAE and "beats the prior" compare the released median with the usable
  published norm of the band.
- **Two cohorts.** `base` is the earlier generator plus day sleep (anchored on the published `day_sleep_hours_24h`
  typical values). `messy` is an unsourced stress test of logging realism: 20 % of formula babies are mixed feeders
  with small top-up bottles, 3 % of bottles half-finished, amounts typed as round numbers (10 or 30 ml), 30 % of
  babies log nights and naps patchily, wider baby spreads, 15 % miss a nap on half their days. Its truth sits below and
  wider than the norms.
- **Candidates** (each tested, below): exact percentiles rounded to the published step (no noise); the exponential
  mechanism per percentile with the budget split (the first study's), for 5, 3 or 1 percentiles; the joint exponential
  mechanism (Gillenwater, Joseph and Kulesza 2021) for 3 or 5 percentiles with one budget; a smooth-sensitivity median
  (Nissim, Raskhodnikova and Smith 2007, Cauchy-like noise, pure DP); a Laplace-noised histogram with fixed bins (20 ml,
  30 min, 0.5 naps) from which any number of percentiles is read through an isotonic CDF at no extra cost; and, for the
  histogram, the exponential median and the joint mechanism, a fixed range per band from the public reference curve.
  Epsilon 0.2, 0.5, 1, 2, 3 and 5 per cell per release.
- **Neighbours are "with or without one baby"** (a withdrawal, a deletion, a baby who never opted in), and every
  mechanism is calibrated to its exact sensitivity for that (replacing one baby's value by another is then covered at
  twice the epsilon). A family of s babies counts s times.
- **Privacy measured three ways.** (1) The formal bound: no attacker can tell "with" from "without" with an advantage
  (true-positive rate minus false-positive rate) above tanh(epsilon / 2). (2) The strongest attacker's actual advantage
  on the synthetic cells: an attacker who knows every other baby in the cell (the DP threat model) and the target's
  value is best served by the likelihood-ratio test, whose advantage is the total variation distance between the two
  output distributions; it is computed exactly (one percentile), by Monte Carlo over the exact privacy-loss variable
  (joint, split, smooth), or bounded (histogram: closed-form upper bound for the histogram itself, plug-in estimate
  for the published numbers), for the cell's most extreme baby and random babies; and over T = 4, 12, 52 releases of
  the same cell with fresh noise. Without noise, it is the share of withdrawals that move a published (rounded)
  number. (3) A weaker, realistic attacker who knows only one family's values: the first study's games (withdrawal
  between two releases with no other change, or with about 10 % new babies joining; membership from one release).
- **Instances.** Instances of 250 to 4 000 opted-in babies (all opted in; about 1.3 babies per family) on the fine
  grid, the coarse grid (4-week bands to week 52, then 12-week) and a wide grid (13-week bands to week 52, then 26):
  how many weeks get a number, how many published cells a baby is in per release, and the error of the published
  median against each week's truth (sampling, noise and the age blur of wide bands together).

### How the mechanisms were checked

A DP claim is only as good as its sensitivity, so each mechanism is tested against the definition, not against its own
derivation (`ml/tests/test_community_percentiles.py`, 72 tests, about 2 minutes; the first study's tests still pass):

- **Exponential mechanism, one percentile:** for 25 random and adversarial small cells (spread, clustered, ties on grid
  points, values at the clip edges) and every neighbour (each value removed; a value added at both edges, on every
  grid point and between grid points), the exact output log-probabilities never differ by more than epsilon, and some
  neighbour comes within 0.8 epsilon (the budget is not silently wasted).
- **Joint exponential mechanism:** probabilities enumerated over all non-decreasing tuples sum to 1; with one
  percentile it equals the single mechanism; the same every-neighbour check for 2 and 3 percentiles; 200 000 draws of
  the backward sampler are within 0.015 total variation of the exact distribution.
- **Histogram and "one summary per baby":** on a 1 500-baby cohort through the real cell code (`community.cell_inputs`),
  removing every row of one baby (a heavy-family baby and three others) changes the counts of each cell she is in by
  exactly 1, of every other cell by 0, and leaves the other babies' summaries identical (the keyed-hash cap of the
  others does not depend on her): L1 sensitivity 1 per cell. The Laplace privacy loss is then bounded by epsilon
  (400 000 draws) and its TV equals 1 - e^(-epsilon / 2). The vectorised isotonic read-out equals the loop version.
- **Smooth-sensitivity median:** the Cauchy-like noise passes both admissibility conditions numerically; the smooth
  bound (the textbook formula is for replacing a value) satisfies both conditions of a smooth upper bound for
  add/remove neighbours on 40 cells; the end-to-end release density never differs from any neighbour's by more than
  epsilon on a 9 001-point output grid.
- **Advantage estimates:** zero for identical cells; never above tanh(epsilon / 2) beyond Monte Carlo error; Monte Carlo
  equals the exact sum for one percentile (to 0.005); composition grows and stays under the composed bound; the
  histogram's published-number estimate stays under its closed form, with a plug-in floor under 0.03.
- **Rest:** day sleep leaves the earlier cohort unchanged; the messy cohort is lower and wider; band ranges come only
  from the reference curve and hold the middle 98 % of babies; every release is sorted, on the step and in range; the
  run is deterministic for a seed.

**Three problems found and fixed before the results below:**

1. **The first study's exponential mechanism spent only half its budget on a median.** It used sensitivity 1 (the
   bound for replacing a value). For adding or removing one baby the rank utility moves by at most max(q, 1 - q):
   0.5 for a median, 0.75 for p25/p75, 0.9 for p10/p90; for the joint mechanism 2 (1 - the smallest gap between
   levels): 1.5 for quartiles, 1.8 for p10-p90. The tests caught it (a median never got above epsilon / 2); the
   mechanisms here use the tight values. The first study's mechanism was correct, only conservative; its conclusion
   at epsilon 0.2 stands (here, tight, `em5@0.2` is still 69 ml off at n = 20).
2. **Ties on the published grid pushed every noisy percentile up to one step high.** Babies' summaries often sit on the
   published grid (half-integer nap medians; bottles typed as 120 or 150 ml). On a grid as coarse as the data the rank
   mechanisms pick the point closest in rank, not in value, and a histogram bin straddling two tie blocks reads high.
   The first full run showed it as a floor that did not shrink with n (naps 0.2-0.4 off even at 300 babies, against
   0.0 exact). Fix, fixed in advance per metric and data-independent: a uniform half-step jitter on each baby's summary
   before any noisy mechanism (a random per-record transform, so the guarantee is unchanged), an internal grid five
   times finer than the published step for bottles (2 ml) and naps (0.1), and histogram bins offset by half a step.
   After it: naps at n = 300 0.0 off, messy bottles under 1 ml. A test pins it. **A production job needs the same
   care.**
3. **The histogram's privacy number was only an upper bound** (the TV of the noisy histogram, which is never
   published), unfair against mechanisms whose TV is computed on their exact output. The tables now add an estimate
   on the published numbers (one percentile's distribution in both worlds, a lower bound for the whole release).

### Findings

1. **Small cells need a large epsilon; there is no mechanism that escapes it.** A noisy percentile's rank error is
   roughly (2 / epsilon) x log(number of candidate values) babies, so at n = 20 a useful median needs epsilon of about
   1 and useful quartiles about 2. At **epsilon 0.2 nothing works below about 100 babies**: the first study's split
   mechanism is 69 ml off on bottles at n = 20 (169 min of night sleep), and even the median alone at 0.2 is 81 ml off
   at n = 20, 27 at n = 50 and 6 at n = 100, against 7.5 / 5.1 / 3.8 for exact. Tier A of section 5.1 cannot serve
   percentiles in the cells we will have.
2. **The bar, set before reading the results:** a median whose typical error is at most a quarter of the band's
   interquartile range (IQR) and whose 1-in-10 bad case is at most half of it; a p25-p75 that holds 40-60 % of
   babies; a p10-p90 within 80 +/- 5 % (design 34 section 9). Even **exact** percentiles of 20 babies only just pass:
   7.5 ml typical and 16 ml bad-case on bottles (IQR 46 ml), 14 / 28 min on night sleep (IQR 89), 11.5 / 24 min on day
   sleep (IQR 70), 0.1 nap; and exact p10-p90 of 20 babies holds only 72-73 % (fails the calibration gate until
   about 50 babies; p25-p75 holds 45 %).
3. **Fewer percentiles help; one histogram helps most.** Ranked at n = 20, base cohort:
   - **Noisy histogram, epsilon 2:** median 9.1 ml (bad case 20) / 18.9 min (39) / 0.1 nap / 14.1 min (30), about
     1.2-1.4 times the exact error; p25 and p75 9-15 ml off on bottles, 21-27 min on night sleep (with the band range,
     a little better); and the best calibration of all candidates, exact included: p25-p75 holds 50 %, p10-p90
     78-79 % (naps 74 % and 89 %: whole numbers put many babies on the edges, exact does the same). From n = 50 it is within 10 % of exact (5.4 ml, 10.7 min, 8.2 min). At epsilon 1 it passes the bar from
     n = 30 for bottles and day sleep (9.7 ml, 15 min) and narrowly misses on night sleep's bad case (45 min against
     a limit of 45), and fails at 20 (13.9 ml, 34 min, 22 min).
   - **Exponential mechanism, median only:** at epsilon 1, 9.3 ml / 17 min / 0.2 nap / 15 min; at 2, 8.1 / 15 / 0.2 /
     12. The most accurate median per unit of epsilon, but no range, so it cannot carry "usually drink 120-170 ml".
   - **Joint exponential mechanism, quartiles:** at epsilon 2 the median is close (11.7 ml) but the outer quartiles have
     a heavy tail (night p25 64 min off on average at n = 20); at 3 it matches the histogram at 2. Not better than the
     histogram here.
   - **Smooth-sensitivity median:** useless below about 300 babies (177 ml off at n = 20 at epsilon 1, 15 ml at 5): its
     noise scale is set by the widest gaps around the median, which in 20 babies span the whole clip range.
   - **Fixed band ranges** gave small gains (night sleep p25/p75 21 instead of 27 min off; bottles none).
   - The **messy cohort** keeps the ranking with errors 1.2-1.6 times larger (its spreads are wider too) (histogram at 2: 14.7 ml, 24.9 min,
     16.6 min at n = 20; 7.9, 13.2, 9.5 at n = 50) and calibration still 49-55 %.
4. **Against the published norms, the pooled median is not better at n = 20 in this synthetic world**, because the
   generator's truth runs through the norms (prior error 3.1 ml on bottles, 5.5 min on night sleep, 8.6 min on day
   sleep): the histogram at epsilon 2 is closer to the truth than the norm in 5 % (bottles), 9 % (night) and 25 % (day)
   of cells, 12-26 % in the messy cohort; even exact percentiles only reach 6-35 %; the cold-start MAE is 0.9-3.3
   units worse than the prior at n = 20 and within about 1 unit at n = 50. Naps are the exception (the norm is one number for
   26 weeks): the pooled median beats it in 85 % of cells. So the value of pooled bottle and sleep numbers is **not** a
   better median than a correct norm; it is a calibrated range of what Lotties babies actually log, bands with no
   usable norm (6 of 8 night-sleep bands, 3 of 8 day-sleep bands, every breast-milk band) and real data that differ
   from the norms, none of which synthetic data can prove (the pilot has to, design 34 section 9). As priors they will
   not pass the cold-start gate on synthetic data; as context lines they pass the calibration gate (histogram).
5. **Without noise the differencing risk is real in small cells and fades with size.** The strongest attacker sees a
   single withdrawal whenever a rounded published number moves: for p25/p50/p75 that is 48 % of withdrawals on bottles,
   77 % on night sleep, 76 % on day sleep and 40 % on naps at n = 20; 25 / 35 / 20 / 8 % at n = 50; 10 / 35 / 7 / 7 % at
   n = 100 (for every cell some baby's withdrawal always shows). One median only: 25 / 50 / 10 / 50 % at n = 20, 0-10 %
   at n = 50. The realistic attacker who knows one family's values detects their withdrawal with an advantage of 0.19
   (naps) to 0.70 (night) at n = 20 when nothing else changed between files, 0.06-0.30 when about 10 % new babies
   joined, 0.01-0.15 at n = 50 with that churn; from a single release she can hardly tell whether the family is in at
   all (0.02-0.05). What it reveals is coarse (which side of a quartile the baby's value was), never her value; it does
   not grow with repeated releases (the same data gives the same file).
6. **Noise at epsilon 1-2 removes the realistic risk and cuts the strongest one per release, but repeated releases
   erode it.** With the histogram at epsilon 2 the realistic attacker's advantage is within measurement noise of zero
   (-0.03 to 0.10, 300 scored trials per world) in every case. The strongest attacker's advantage per release is
   0.19-0.23 on the published numbers at n = 20 (the histogram itself at most 0.63, the formal bound 0.76), at
   epsilon 1 0.10-0.13 (bound 0.46). But fresh noise at every release composes: for a cell whose data does not change, the strongest
   attacker's estimated advantage after 4 releases is 0.40-0.44 (epsilon 2) or 0.22-0.27 (epsilon 1), after 12 releases
   0.64-0.69 or 0.38-0.44, after 52 weekly releases about 1 (joint mechanism at 2: 0.95-0.97; median at 1:
   0.80-0.88). **Weekly releases with fresh noise give, within a year, about what no noise gives; quarterly releases
   keep most of the protection.**
7. **The formal guarantee per baby and per year is gone at any useful setting, and section 5.1 undercounts it.** A baby
   is in several published cells of a statistic in every release (her history covers several bands): on the 1 000-baby
   instance a median of 3 fine cells (p90 7, heavy loggers up to 22) or 2 coarse cells (p90 4, up to 11; a baby logged
   for a whole year is in about 13). Basic composition then gives epsilon x cells x releases per statistic per year:
   at epsilon 2 quarterly on the coarse grid 16 (p90 32), at 1 quarterly 8, at 0.5 quarterly 4, each with a bound of
   0.96-1.00, i.e. no meaningful bound; and it adds up across the four statistics. Design 34 section 5.1's "about 10"
   (tier A) and "about 260" (tier B) per statistic per year count releases but not cells: with 3 fine cells per baby
   they are about 31 and 780.
8. **Coarser bands fill faster; wide bands blur bottles.** With few families (250 opted-in babies, about 190 families)
   formula bottles get a number for 21 % of weeks on the fine grid, 42 % on the coarse grid and 88 % on the wide grid;
   night sleep 88 / 92 / 100 %. At 500 babies the fine and coarse grids both cover 92 %. From 1 000 babies on the coarse grid costs about 1 ml
   (bottles) and 1-2 min (sleep) against the fine grid, and it cuts the cells per baby (median 3 to 2, worst 22 to
   11). The wide grid
   blurs the age trend: bottles stay 8-9 ml off even with 4 000 babies (coarse: 5 ml), day sleep 11-13 min; for night
   sleep and naps, whose trend is slow, it is acceptable (6-9 min, 0.2 nap). The error a user sees on the coarse grid with the
   histogram at epsilon 2: bottles 9.9 / 6.9 / 6.2 ml and night sleep 14.8 / 8.3 / 5.8 min at 250 / 500 / 1 000
   babies.

### What the formal guarantee is worth, in plain words

Epsilon e per cell per release means: whoever sees one release of one cell, even knowing every other family in it,
cannot be more than e^e times surer that a given baby is in it than before (from even odds: 62 % at 0.5, 73 % at 1,
88 % at 2, 95 % at 3), and cannot tell "in" from "out" with an advantage above tanh(e / 2): 0.24 at 0.5, 0.46 at 1, 0.76
at 2, 0.91 at 3, 0.99 at 5. Over a year, multiply e by the cells the baby is in and by the releases (table at the end):
at every setting that keeps the numbers useful in cells of 20-100, the yearly number is 4 or more per statistic and
the bound is above 0.96, so **the noise must not be described as a strong formal guarantee**. What it does give,
measured on synthetic cells: it blurs one family's effect on each release, it takes the realistic attacker's advantage
to about zero, and, at a quarterly pace, it keeps the strongest attacker well below what no noise allows. Measured
values depend on the synthetic data; only the formal bounds hold for any data.

### Options for the owner

Common to all three, whatever is chosen: **quarterly releases** of every cell at once, never weekly (finding 6), the
**coarse grid** (4-week bands to one year, then 12-week bands; no wide bands for bottles, finding 8), one summary per
baby per cell, k = 20 babies from 20 families, the dominance rule, hysteresis, rounding to 10 ml, 10 min and half a
nap, p10/p90 only from 50 babies (design 34 section 5), and an honest per-baby account in the policy and the run log
(epsilon x cells x releases x statistics, finding 7). All four metrics can be published under each option; none of
them beats a correct published norm on the median in small cells, so their value is the range, the bands and kinds
with no usable norm, and real data that differ from the norms, which only the pilot can show.

**A. Ranges with light noise (recommended).** Each cell publishes the middle half (p25-p75) and the median, read from a
noisy histogram at epsilon 2 per cell per release.
- What the user sees: "Babies this age in Lotties usually drink 140-180 ml per bottle", "... sleep 9 h 10 to 10 h 30
  at night", "... take 2 to 3 naps", with "From families who chose to share, not advice", as soon as a cell has 20
  babies from 20 families.
- How far off: in a cell of 20 babies the median is typically 9 ml off (1 cell in 10 more than 20 ml), night sleep
  19 min (1 in 10 more than 39), day sleep 14 min, naps 0.1; the range ends 9-15 ml and 21-27 min. In a cell of 50:
  5 ml, 11 min, 8 min. That is 1.2-1.4 times the error that no noise would have at 20 babies, within 10 % of it from
  50, and the range really holds about half the babies (better than no noise at 20). With messier logging, 1.2-1.6
  times more.
- The privacy protection, really: per cell and release, formally no attacker can tell whether a baby is in with an
  advantage above 0.76 (posterior at most 88 % from even odds): a weak guarantee. Over a year the formal number is
  about 16 per statistic for a typical baby (2 cells x 4 releases), 64 over the four statistics: no meaningful formal
  bound, as with tier B. Measured on synthetic cells: someone who knows one family's values and compares the files gets
  no measurable advantage (0.10 at most, within noise), where no noise lets her detect the family's withdrawal with
  0.2-0.7; an attacker who knows every other baby in the cell gets about 0.2 per release and about 0.4 over a year
  (no noise: 0.4-0.8 at 20 babies).

**B. No noise.** The same publication, exact percentiles of the babies' summaries, rounded.
- What the user sees: the same lines.
- How far off: the unavoidable sampling error only: 7.5 ml (1 in 10 cells more than 16), 14 min (28), 11.5 min, 0.1
  nap at 20 babies; 5 ml, 10 min, 8 min at 50. But at 20 babies the p10-p90 holds only 72-73 % of babies (fails the
  calibration gate until about 50), the middle half 45 %.
- The privacy protection, really: no formal guarantee; the protection is k, caps, clipping, dominance, rounding,
  hysteresis and the quarterly pace. Measured: when one baby withdraws, at least one published quartile moves in
  40-77 % of cases at 20 babies, 8-35 % at 50, 7-35 % at 100, and an attacker who knows every other baby then sees it;
  someone who knows only that family's values detects the withdrawal with an advantage of 0.2-0.7 at 20 babies if
  nothing else changed between files, 0.06-0.30 with normal arrivals of new babies; from one file she can hardly tell
  whether the family is in at all (0.05 at most). What leaks is coarse (on which side of a quartile the baby's value
  was), never the value itself, and it does not grow with repeated releases. The policy must not mention noise for
  these statistics.

**C. Stricter noise, ranges later.** Epsilon 1 per cell per release; cells of 20-29 babies publish only the median
(exponential mechanism), the range comes from 30 babies (noisy histogram).
- What the user sees: "Babies this age in Lotties usually drink about 160 ml per bottle" in small cells, the range from
  30 babies.
- How far off: the median at 20 babies 9 ml, 17 min, 15 min, 0.2 nap; the range at 30 babies 10 ml, 21 min, 15 min
  (night sleep's 1-in-10 bad case, 45 min, just over half its IQR); at 50 babies 6.5 ml, 14 min, 10 min.
- The privacy protection, really: formally at most 0.46 per cell and release (posterior at most 73 %); about 8 per
  statistic per year for a typical baby, again no meaningful yearly bound. Measured: realistic attacker about zero;
  strongest attacker 0.10-0.20 per release and 0.22-0.34 over a year.

**Recommendation: A.** In the cells we will have for a long time (20-100 babies) it is the only option that shows the
range the design's wording needs from the first published cell with errors close to the unavoidable ones and the best
calibration, and it takes the realistic differencing risk that B leaves (0.2-0.7) to about zero while halving the
strongest attacker's. Its formal guarantee is weak and must be stated as such in the policy (as tier B already is),
with "blurs the effect of any one family on each published number" rather than any strong mathematical claim. Choose
C if the owner wants each release's formal bound under 0.5 and accepts ranges only from 30 families; B only if the
owner accepts a measured, non-formal differencing risk for simpler code and about 20 % less error at 20 babies.
A strong formal guarantee (epsilon 0.2-0.5 per release, the tier A of section 5.1) becomes possible for medians when
cells reach about 300 babies (exponential median at 0.2: 3.3 ml off at n = 300, exact 3.0); worth revisiting then.

### Limits of this study

- Synthetic data only. In the base cohort the truth runs through the norms, so every comparison with the norms favours
  them; the messy cohort is an unsourced guess at real logging. The spreads are unsourced: errors relative to the
  IQR transfer better than the absolute ones. No promotion on these results (design 34 section 9).
- Cells are random samples of one band's babies; real cells have siblings, heavy loggers (the dominance rule handles
  them, not modelled in the cell study) and shared logging habits.
- The measured advantages depend on the synthetic cells (ties, outliers, spacing) and on the attackers simulated (one
  test statistic for the weaker one); only the formal bounds hold for any data. The histogram's published-number
  figures are estimates from one percentile (a lower bound per release); its upper bound is the histogram's own TV.
- The suppression decisions (k, dominance, hysteresis) use exact counts and are not differentially private: a cell that
  appears at 20 or disappears below 18 reveals a count crossing a threshold. Not measured here (every measured cell
  stays published).
- Composition was measured on a cell whose data do not change between releases; basic composition across cells and
  statistics is a worst-case bound, not a measurement.
- One seed (1); Monte Carlo error about 0.01 on the advantages and 0.05 on the games; at n = 300 the cells come from
  pools of 1 400-10 000 babies, which understates that column's sampling error by up to about 11 %.
- The release schedule, the withdrawal semantics and the noise are design and policy decisions; nothing here is built
  in the API, the catalog or the policy.

### Results (generated, seed 1)

Generated by `python -m benchmark.community_percentiles --seed 1`: population of 80000 synthetic babies per scenario, 200 cells per band and cell size, bands 2-3, 6-7, 10-11, 16-18, 24-26, 36-40, 60-64, 88-92 (weeks); privacy: 10 cells x 3 target babies per cell size, 4000 Monte Carlo draws; games: 600 trials per world. Synthetic data only.

#### bottle_ml_per_feed, base cohort

Mean band IQR (p75 - p25 of the babies' medians) 46.3 ml; published-norms prior error on the median 3.1 ml (6 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, ml) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 7.5 / 16.1 | 6.5 / 13.9 | 5.1 / 12.5 | 3.8 / 7.5 | 3.0 / 6.1 | 16 / 11 | 7.5, 10.2 / 5.1, 7.0 | 45 / 48 | 73 / 77 | 0.6 / 0.2 | 6 / 10 |
| em5@0.2 | 68.7 / 139.9 | 70.4 / 147.5 | 64.9 / 139.7 | 52.9 / 121.6 | 12.4 / 27.1 | 178 / 170 | 64.8, 86.5 / 62.7, 82.9 | 53 / 55 | 87 / 89 | 46.1 / 42.3 | 1 / 1 |
| em5@5.0 | 9.3 / 19.7 | 7.1 / 15.8 | 5.4 / 12.5 | 3.9 / 7.5 | 3.0 / 6.1 | 20 / 11 | 20.9, 31.4 / 6.2, 9.1 | 61 / 50 | 92 / 87 | 1.0 / 0.2 | 4 / 9 |
| em3@3.0 | 9.0 / 18.1 | 7.1 / 15.8 | 5.3 / 12.5 | 3.9 / 7.5 | 3.0 / 6.1 | 19 / 11 | 32.3, 44.7 / 6.5, 10.0 | 64 / 51 | n/a / n/a | 1.0 / 0.2 | 5 / 9 |
| em1@0.2 | 80.5 / 186.1 | 59.8 / 164.3 | 26.6 / 74.0 | 6.4 / 13.9 | 3.3 / 7.1 | 204 / 69 | n/a / n/a | n/a / n/a | n/a / n/a | 58.6 / 15.4 | 1 / 4 |
| em1@0.5 | 30.0 / 80.3 | 12.1 / 23.0 | 6.5 / 13.9 | 4.3 / 8.1 | 3.1 / 6.1 | 74 / 14 | n/a / n/a | n/a / n/a | n/a / n/a | 15.9 / 0.4 | 4 / 8 |
| em1@1.0 | 9.3 / 19.7 | 7.3 / 15.8 | 5.3 / 12.5 | 3.9 / 7.5 | 3.0 / 6.1 | 20 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 1.0 / 0.2 | 5 / 9 |
| em1@2.0 | 8.1 / 17.5 | 6.9 / 14.2 | 5.0 / 11.9 | 3.9 / 7.5 | 3.0 / 6.1 | 18 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 0.7 / 0.2 | 6 / 10 |
| smooth1@1.0 | 177.3 / 237.1 | 166.3 / 237.1 | 116.6 / 207.5 | 34.3 / 74.2 | 11.7 / 25.8 | 422 / 284 | n/a / n/a | n/a / n/a | n/a / n/a | 142.7 / 87.3 | 0 / 0 |
| smooth1@5.0 | 14.9 / 32.9 | 10.6 / 23.9 | 7.3 / 16.1 | 4.6 / 8.1 | 3.2 / 6.1 | 32 / 16 | n/a / n/a | n/a / n/a | n/a / n/a | 3.2 / 0.6 | 4 / 7 |
| joint3@1.0 | 29.8 / 77.1 | 16.3 / 32.9 | 7.9 / 17.1 | 4.6 / 9.7 | 3.1 / 6.1 | 75 / 17 | 42.1, 70.0 / 9.3, 17.8 | 62 / 53 | n/a / n/a | 14.5 / 0.7 | 2 / 7 |
| joint3@2.0 | 11.7 / 25.8 | 8.3 / 17.5 | 5.6 / 12.5 | 4.0 / 7.5 | 3.1 / 6.1 | 26 / 12 | 16.7, 32.1 / 5.5, 7.9 | 53 / 50 | n/a / n/a | 1.8 / 0.3 | 4 / 9 |
| joint3@3.0 | 9.4 / 18.2 | 7.3 / 16.1 | 5.4 / 12.5 | 3.9 / 7.5 | 3.1 / 6.1 | 20 / 12 | 9.8, 16.3 / 5.3, 7.4 | 50 / 49 | n/a / n/a | 1.0 / 0.3 | 5 / 8 |
| joint5@5.0 | 9.0 / 18.1 | 7.5 / 16.1 | 5.3 / 12.5 | 3.9 / 7.5 | 3.1 / 6.1 | 19 / 11 | 9.2, 13.3 / 5.4, 7.5 | 51 / 50 | 83 / 80 | 0.9 / 0.2 | 5 / 9 |
| hist5@1.0 | 13.9 / 28.1 | 9.7 / 21.9 | 6.5 / 13.9 | 4.4 / 8.1 | 3.1 / 6.1 | 30 / 14 | 16.0, 27.1 / 7.1, 10.6 | 49 / 51 | 75 / 80 | 2.6 / 0.4 | 4 / 6 |
| hist5@2.0 | 9.1 / 19.7 | 7.3 / 15.8 | 5.4 / 12.5 | 3.9 / 7.5 | 3.1 / 6.1 | 20 / 12 | 9.4, 14.6 / 5.5, 8.4 | 50 / 51 | 78 / 80 | 0.9 / 0.2 | 5 / 8 |
| hist5@3.0 | 8.3 / 17.5 | 6.8 / 14.2 | 5.0 / 10.3 | 3.9 / 7.5 | 3.1 / 6.1 | 18 / 11 | 8.5, 12.6 / 5.3, 7.6 | 49 / 50 | 78 / 80 | 0.8 / 0.2 | 6 / 9 |
| hist5_band@2.0 | 9.4 / 21.9 | 7.5 / 17.1 | 5.2 / 11.9 | 4.0 / 7.5 | 3.1 / 6.1 | 20 / 11 | 9.7, 14.5 / 5.5, 8.0 | 50 / 51 | 78 / 80 | 1.0 / 0.2 | 5 / 8 |

#### night_sleep_minutes, base cohort

Mean band IQR (p75 - p25 of the babies' medians) 89.3 min; published-norms prior error on the median 5.5 min (2 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, min) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 13.9 / 28.2 | 12.1 / 25.0 | 9.7 / 19.9 | 6.6 / 14.3 | 4.2 / 9.6 | 16 / 11 | 15.5, 15.7 / 10.5, 10.7 | 45 / 48 | 72 / 77 | 1.4 / 0.6 | 10 / 13 |
| em5@0.2 | 168.6 / 345.0 | 163.1 / 332.3 | 149.3 / 320.1 | 119.6 / 295.0 | 25.7 / 51.8 | 189 / 167 | 231.9, 143.3 / 222.2, 129.6 | 56 / 58 | 90 / 92 | 121.1 / 100.3 | 1 / 1 |
| em5@5.0 | 16.9 / 35.7 | 13.3 / 28.2 | 10.2 / 21.0 | 6.7 / 14.3 | 4.0 / 9.1 | 19 / 11 | 81.8, 44.6 / 13.9, 13.6 | 63 / 51 | 95 / 89 | 2.2 / 0.7 | 10 / 12 |
| em3@3.0 | 17.2 / 35.7 | 13.5 / 28.2 | 10.2 / 20.1 | 6.6 / 14.3 | 4.0 / 9.6 | 19 / 11 | 123.6, 69.4 / 17.1, 14.9 | 67 / 51 | n/a / n/a | 2.4 / 0.7 | 8 / 12 |
| em1@0.2 | 189.3 / 450.1 | 145.8 / 405.0 | 54.1 / 158.2 | 11.7 / 24.9 | 4.7 / 10.1 | 212 / 60 | n/a / n/a | n/a / n/a | n/a / n/a | 137.6 / 28.4 | 2 / 7 |
| em1@0.5 | 63.8 / 211.8 | 23.1 / 37.9 | 12.3 / 24.9 | 7.3 / 14.9 | 4.1 / 9.6 | 71 / 14 | n/a / n/a | n/a / n/a | n/a / n/a | 42.6 / 1.3 | 4 / 11 |
| em1@1.0 | 17.3 / 34.3 | 13.4 / 28.2 | 10.0 / 20.1 | 6.7 / 14.3 | 4.0 / 9.0 | 19 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 2.8 / 0.7 | 8 / 16 |
| em1@2.0 | 14.8 / 30.1 | 12.5 / 25.7 | 9.8 / 19.9 | 6.7 / 14.3 | 4.0 / 9.0 | 17 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 1.7 / 0.6 | 11 / 14 |
| smooth1@1.0 | 432.0 / 590.4 | 392.4 / 590.4 | 262.2 / 482.4 | 67.7 / 137.9 | 21.5 / 41.8 | 484 / 294 | n/a / n/a | n/a / n/a | n/a / n/a | 370.2 / 203.1 | 0 / 0 |
| smooth1@5.0 | 27.8 / 59.0 | 20.3 / 41.0 | 13.8 / 29.1 | 8.4 / 18.2 | 4.6 / 9.9 | 31 / 15 | n/a / n/a | n/a / n/a | n/a / n/a | 8.2 / 1.6 | 7 / 12 |
| joint3@1.0 | 61.1 / 148.1 | 31.2 / 59.9 | 15.1 / 31.8 | 8.0 / 16.0 | 4.4 / 9.9 | 68 / 17 | 183.1, 88.8 / 29.2, 23.8 | 65 / 53 | n/a / n/a | 30.8 / 1.8 | 3 / 10 |
| joint3@2.0 | 22.5 / 45.7 | 14.9 / 31.0 | 10.6 / 21.8 | 7.1 / 14.9 | 4.2 / 9.6 | 25 / 12 | 63.8, 38.7 / 12.0, 12.0 | 54 / 50 | n/a / n/a | 4.0 / 0.8 | 8 / 14 |
| joint3@3.0 | 16.8 / 35.7 | 13.3 / 27.9 | 10.3 / 20.4 | 7.0 / 14.3 | 4.2 / 9.6 | 19 / 12 | 23.9, 22.8 / 11.1, 11.4 | 50 / 49 | n/a / n/a | 2.3 / 0.7 | 7 / 12 |
| joint5@5.0 | 17.0 / 34.9 | 13.6 / 29.6 | 10.4 / 21.0 | 7.0 / 14.9 | 4.3 / 9.6 | 19 / 12 | 21.9, 20.3 / 11.6, 11.8 | 52 / 50 | 84 / 80 | 2.5 / 0.7 | 7 / 12 |
| hist5@1.0 | 33.6 / 69.0 | 21.1 / 45.1 | 14.2 / 29.6 | 8.6 / 18.2 | 4.4 / 9.6 | 38 / 16 | 60.8, 48.2 / 19.3, 17.8 | 48 / 50 | 73 / 79 | 8.8 / 1.8 | 6 / 8 |
| hist5@2.0 | 18.9 / 39.0 | 14.9 / 30.1 | 10.7 / 21.8 | 7.1 / 15.0 | 4.0 / 9.6 | 21 / 12 | 26.5, 23.5 / 13.1, 12.5 | 50 / 51 | 78 / 80 | 2.6 / 0.9 | 9 / 15 |
| hist5@3.0 | 16.4 / 34.0 | 13.3 / 27.9 | 10.1 / 21.0 | 6.9 / 14.3 | 4.0 / 9.6 | 18 / 11 | 19.9, 18.7 / 11.4, 11.5 | 49 / 50 | 78 / 80 | 2.0 / 0.8 | 10 / 16 |
| hist5_band@2.0 | 17.7 / 37.9 | 14.6 / 29.9 | 10.4 / 21.0 | 6.8 / 14.3 | 4.0 / 9.1 | 20 / 12 | 21.1, 21.8 / 11.8, 12.4 | 50 / 50 | 78 / 80 | 2.2 / 0.7 | 8 / 16 |

#### naps_per_day, base cohort

Mean band IQR (p75 - p25 of the babies' medians) 0.8 naps; published-norms prior error on the median 0.4 naps (8 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, naps) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 0.0 / 0.0 | 11 / 6 | 0.1, 0.1 / 0.1, 0.1 | 71 / 75 | 86 / 89 | -0.1 / -0.1 | 90 / 95 |
| em5@0.2 | 1.7 / 3.5 | 1.7 / 3.5 | 1.6 / 3.5 | 1.2 / 2.5 | 0.3 / 0.5 | 245 / 228 | 1.3, 2.4 / 1.2, 2.3 | 52 / 56 | 85 / 87 | 1.1 / 1.0 | 18 / 18 |
| em5@5.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 26 / 10 | 0.4, 0.8 / 0.2, 0.2 | 76 / 73 | 96 / 93 | -0.0 / -0.1 | 76 / 91 |
| em3@3.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 26 / 10 | 0.5, 1.2 / 0.2, 0.2 | 78 / 74 | n/a / n/a | -0.0 / -0.1 | 76 / 90 |
| em1@0.2 | 1.7 / 4.0 | 1.2 / 3.5 | 0.6 / 1.5 | 0.2 / 0.5 | 0.1 / 0.5 | 230 / 80 | n/a / n/a | n/a / n/a | n/a / n/a | 1.0 / 0.2 | 25 / 59 |
| em1@0.5 | 0.7 / 1.5 | 0.3 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 91 / 17 | n/a / n/a | n/a / n/a | n/a / n/a | 0.3 / -0.1 | 56 / 84 |
| em1@1.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 28 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | -0.0 / -0.1 | 75 / 90 |
| em1@2.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 17 / 10 | n/a / n/a | n/a / n/a | n/a / n/a | -0.1 / -0.1 | 83 / 91 |
| smooth1@1.0 | 3.7 / 6.0 | 3.4 / 6.0 | 2.3 / 4.5 | 0.8 / 2.0 | 0.2 / 0.5 | 502 / 318 | n/a / n/a | n/a / n/a | n/a / n/a | 2.9 / 1.6 | 1 / 8 |
| smooth1@5.0 | 0.3 / 1.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 38 / 13 | n/a / n/a | n/a / n/a | n/a / n/a | 0.0 / -0.1 | 68 / 88 |
| joint3@1.0 | 0.7 / 1.5 | 0.3 / 1.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 90 / 19 | 0.7, 1.9 / 0.2, 0.4 | 77 / 73 | n/a / n/a | 0.2 / -0.1 | 48 / 82 |
| joint3@2.0 | 0.3 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 31 / 12 | 0.3, 0.7 / 0.1, 0.2 | 74 / 73 | n/a / n/a | -0.0 / -0.1 | 73 / 88 |
| joint3@3.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 20 / 11 | 0.2, 0.3 / 0.1, 0.1 | 72 / 73 | n/a / n/a | -0.1 / -0.1 | 79 / 90 |
| joint5@5.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 22 / 11 | 0.2, 0.3 / 0.1, 0.2 | 73 / 73 | 92 / 91 | -0.1 / -0.1 | 78 / 89 |
| hist5@1.0 | 0.2 / 1.0 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 0.0 / 0.0 | 25 / 9 | 0.2, 0.5 / 0.1, 0.2 | 73 / 75 | 88 / 91 | -0.0 / -0.1 | 78 / 91 |
| hist5@2.0 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 0.0 / 0.0 | 16 / 7 | 0.2, 0.2 / 0.1, 0.1 | 74 / 75 | 89 / 91 | -0.1 / -0.1 | 85 / 94 |
| hist5@3.0 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 0.0 / 0.0 | 12 / 6 | 0.1, 0.2 / 0.1, 0.1 | 74 / 75 | 89 / 90 | -0.1 / -0.1 | 88 / 95 |
| hist5_band@2.0 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 0.0 / 0.0 | 15 / 7 | 0.2, 0.2 / 0.1, 0.1 | 74 / 75 | 89 / 90 | -0.1 / -0.1 | 86 / 94 |

#### day_sleep_minutes, base cohort

Mean band IQR (p75 - p25 of the babies' medians) 69.5 min; published-norms prior error on the median 8.6 min (5 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, min) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 11.5 / 23.5 | 9.2 / 19.1 | 7.7 / 15.3 | 5.6 / 10.9 | 3.7 / 8.1 | 17 / 11 | 12.2, 12.0 / 8.3, 8.1 | 45 / 48 | 72 / 77 | 0.5 / -0.2 | 28 / 41 |
| em5@0.2 | 165.5 / 340.9 | 167.1 / 346.0 | 155.2 / 326.5 | 128.9 / 304.8 | 21.2 / 40.3 | 239 / 224 | 118.1, 234.9 / 109.5, 224.3 | 40 / 45 | 79 / 82 | 139.2 / 132.9 | 2 / 2 |
| em5@5.0 | 13.2 / 26.5 | 10.4 / 20.9 | 8.0 / 16.1 | 5.6 / 10.9 | 3.6 / 8.1 | 19 / 12 | 26.7, 71.5 / 10.2, 11.8 | 62 / 51 | 93 / 88 | 1.0 / -0.1 | 26 / 39 |
| em3@3.0 | 13.7 / 28.2 | 10.1 / 20.9 | 8.0 / 16.5 | 5.6 / 10.9 | 3.7 / 8.1 | 20 / 11 | 36.4, 111.6 / 10.8, 13.4 | 64 / 51 | n/a / n/a | 1.0 / -0.1 | 25 / 40 |
| em1@0.2 | 157.2 / 396.6 | 125.3 / 376.0 | 47.5 / 129.3 | 9.3 / 19.1 | 4.1 / 9.1 | 227 / 68 | n/a / n/a | n/a / n/a | n/a / n/a | 123.0 / 29.1 | 7 / 21 |
| em1@0.5 | 56.2 / 164.0 | 17.3 / 30.9 | 9.3 / 19.1 | 6.0 / 13.4 | 3.6 / 6.6 | 81 / 13 | n/a / n/a | n/a / n/a | n/a / n/a | 36.6 / 0.2 | 18 / 37 |
| em1@1.0 | 14.8 / 29.1 | 10.2 / 20.9 | 7.8 / 16.0 | 5.6 / 10.9 | 3.6 / 8.1 | 21 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 2.5 / -0.1 | 26 / 40 |
| em1@2.0 | 12.1 / 25.3 | 9.4 / 19.2 | 7.7 / 15.3 | 5.5 / 10.9 | 3.6 / 8.1 | 17 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 0.6 / -0.2 | 28 / 41 |
| smooth1@1.0 | 329.1 / 586.5 | 306.8 / 536.0 | 211.9 / 434.7 | 49.7 / 103.5 | 17.9 / 36.6 | 474 / 305 | n/a / n/a | n/a / n/a | n/a / n/a | 273.1 / 165.1 | 0 / 1 |
| smooth1@5.0 | 22.5 / 48.1 | 15.9 / 34.0 | 11.8 / 23.5 | 6.8 / 14.0 | 4.0 / 8.1 | 32 / 17 | n/a / n/a | n/a / n/a | n/a / n/a | 3.9 / 0.6 | 18 / 33 |
| joint3@1.0 | 56.5 / 153.5 | 26.1 / 46.5 | 11.8 / 25.3 | 6.4 / 13.5 | 4.1 / 9.1 | 81 / 17 | 49.7, 177.1 / 15.2, 29.2 | 62 / 52 | n/a / n/a | 36.7 / 0.6 | 12 / 32 |
| joint3@2.0 | 18.1 / 36.5 | 11.8 / 25.3 | 8.3 / 16.5 | 5.8 / 11.9 | 4.0 / 8.1 | 26 / 12 | 23.9, 55.4 / 9.1, 8.9 | 54 / 50 | n/a / n/a | 2.8 / -0.1 | 20 / 37 |
| joint3@3.0 | 13.6 / 29.1 | 10.1 / 20.9 | 8.3 / 16.5 | 5.9 / 11.9 | 4.1 / 9.1 | 20 / 12 | 15.4, 22.4 / 8.8, 8.9 | 50 / 49 | n/a / n/a | 1.0 / -0.1 | 25 / 38 |
| joint5@5.0 | 13.8 / 29.1 | 10.6 / 23.4 | 8.2 / 16.5 | 5.8 / 11.9 | 4.0 / 9.1 | 20 / 12 | 15.1, 18.2 / 9.3, 9.1 | 51 / 50 | 84 / 80 | 1.0 / -0.1 | 24 / 38 |
| hist5@1.0 | 22.3 / 44.7 | 15.0 / 30.9 | 9.9 / 20.3 | 6.5 / 13.5 | 3.8 / 8.1 | 32 / 14 | 23.9, 54.0 / 10.8, 14.0 | 50 / 51 | 76 / 81 | 4.4 / 0.1 | 18 / 34 |
| hist5@2.0 | 14.1 / 30.3 | 11.1 / 23.4 | 8.2 / 16.5 | 5.7 / 11.9 | 3.6 / 6.6 | 20 / 12 | 15.1, 20.6 / 8.9, 9.5 | 50 / 51 | 79 / 81 | 1.0 / -0.1 | 25 / 39 |
| hist5@3.0 | 12.6 / 26.0 | 9.9 / 20.3 | 7.5 / 15.3 | 5.7 / 10.9 | 3.6 / 6.6 | 18 / 11 | 13.6, 15.2 / 8.3, 8.5 | 50 / 51 | 79 / 81 | 0.7 / -0.2 | 30 / 41 |
| hist5_band@2.0 | 13.4 / 26.5 | 10.6 / 21.9 | 7.8 / 16.5 | 5.6 / 11.9 | 3.6 / 6.8 | 19 / 11 | 14.8, 17.5 / 8.8, 9.2 | 50 / 51 | 79 / 80 | 0.8 / -0.1 | 28 / 40 |

#### bottle_ml_per_feed, messy cohort

Mean band IQR (p75 - p25 of the babies' medians) 73.1 ml; published-norms prior error on the median 9.6 ml (6 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, ml) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 11.4 / 20.8 | 9.8 / 20.0 | 7.4 / 20.0 | 5.5 / 10.0 | 3.3 / 10.0 | 16 / 11 | 15.4, 13.2 / 10.0, 8.4 | 51 / 54 | 77 / 81 | 0.1 / -0.6 | 35 / 46 |
| em5@0.2 | 70.5 / 150.0 | 71.2 / 150.0 | 67.8 / 140.3 | 53.6 / 120.0 | 16.2 / 40.0 | 115 / 111 | 59.5, 87.6 / 55.7, 87.1 | 48 / 50 | 83 / 84 | 41.4 / 39.1 | 5 / 7 |
| em5@5.0 | 14.6 / 30.0 | 11.2 / 20.0 | 8.2 / 20.0 | 5.7 / 10.0 | 3.4 / 10.0 | 21 / 12 | 22.2, 32.5 / 12.9, 12.1 | 59 / 56 | 88 / 86 | 1.0 / -0.5 | 25 / 38 |
| em3@3.0 | 14.9 / 30.0 | 11.2 / 27.5 | 8.2 / 20.0 | 5.6 / 10.0 | 3.4 / 10.0 | 21 / 12 | 26.3, 47.5 / 13.4, 12.8 | 63 / 56 | n/a / n/a | 1.0 / -0.5 | 25 / 40 |
| em1@0.2 | 74.5 / 180.0 | 54.8 / 150.0 | 29.5 / 70.0 | 10.3 / 20.0 | 4.1 / 10.0 | 117 / 44 | n/a / n/a | n/a / n/a | n/a / n/a | 44.1 / 11.1 | 8 / 22 |
| em1@0.5 | 29.1 / 70.0 | 16.5 / 30.0 | 9.8 / 20.0 | 6.3 / 10.0 | 3.4 / 10.0 | 43 / 14 | n/a / n/a | n/a / n/a | n/a / n/a | 9.7 / -0.0 | 19 / 36 |
| em1@1.0 | 14.9 / 30.0 | 11.2 / 20.0 | 7.7 / 20.0 | 5.6 / 10.0 | 3.4 / 10.0 | 21 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 1.3 / -0.5 | 26 / 43 |
| em1@2.0 | 12.9 / 30.0 | 10.4 / 20.0 | 7.6 / 20.0 | 5.6 / 10.0 | 3.4 / 10.0 | 18 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 0.4 / -0.6 | 28 / 42 |
| smooth1@1.0 | 177.8 / 260.3 | 165.1 / 250.0 | 124.4 / 202.5 | 56.0 / 120.0 | 20.4 / 50.0 | 269 / 189 | n/a / n/a | n/a / n/a | n/a / n/a | 128.3 / 80.8 | 0 / 2 |
| smooth1@5.0 | 24.6 / 50.0 | 17.9 / 40.0 | 10.8 / 20.0 | 6.9 / 20.0 | 3.8 / 10.0 | 34 / 15 | n/a / n/a | n/a / n/a | n/a / n/a | 5.0 / 0.2 | 16 / 36 |
| joint3@1.0 | 31.3 / 70.0 | 20.1 / 40.0 | 11.3 / 20.0 | 6.6 / 17.5 | 3.7 / 10.0 | 47 / 16 | 34.7, 66.6 / 16.5, 17.4 | 62 / 57 | n/a / n/a | 11.3 / 0.3 | 15 / 31 |
| joint3@2.0 | 16.1 / 30.0 | 12.7 / 30.0 | 8.6 / 20.0 | 5.9 / 10.0 | 3.4 / 10.0 | 23 / 12 | 21.9, 28.0 / 12.6, 10.0 | 57 / 55 | n/a / n/a | 1.4 / -0.4 | 23 / 38 |
| joint3@3.0 | 14.3 / 30.0 | 11.3 / 20.0 | 7.8 / 20.0 | 5.7 / 10.0 | 3.5 / 10.0 | 20 / 11 | 19.0, 18.5 / 11.5, 9.2 | 55 / 55 | n/a / n/a | 0.9 / -0.5 | 26 / 42 |
| joint5@5.0 | 13.5 / 30.0 | 11.1 / 20.0 | 7.9 / 20.0 | 5.6 / 10.0 | 3.4 / 10.0 | 19 / 11 | 19.0, 17.4 / 11.7, 9.4 | 56 / 55 | 84 / 83 | 0.8 / -0.5 | 27 / 40 |
| hist5@1.0 | 21.5 / 50.0 | 15.0 / 30.0 | 9.5 / 20.0 | 6.6 / 10.0 | 3.9 / 10.0 | 30 / 14 | 27.5, 33.9 / 14.2, 13.3 | 53 / 55 | 77 / 83 | 3.4 / -0.2 | 19 / 33 |
| hist5@2.0 | 14.7 / 30.0 | 11.3 / 20.0 | 7.9 / 20.0 | 5.9 / 10.0 | 3.9 / 10.0 | 21 / 12 | 20.1, 19.8 / 11.3, 10.4 | 54 / 55 | 80 / 83 | 1.0 / -0.5 | 26 / 38 |
| hist5@3.0 | 12.6 / 30.0 | 10.2 / 20.0 | 7.6 / 20.0 | 5.6 / 10.0 | 3.9 / 10.0 | 18 / 11 | 17.9, 16.7 / 10.8, 9.5 | 55 / 55 | 81 / 83 | 0.5 / -0.6 | 28 / 38 |
| hist5_band@2.0 | 14.2 / 30.0 | 11.1 / 20.0 | 7.8 / 20.0 | 5.8 / 10.0 | 3.9 / 10.0 | 20 / 11 | 19.6, 18.6 / 11.5, 10.3 | 54 / 55 | 80 / 83 | 0.9 / -0.5 | 27 / 38 |

#### night_sleep_minutes, messy cohort

Mean band IQR (p75 - p25 of the babies' medians) 115.1 min; published-norms prior error on the median 6.5 min (2 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, min) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 18.3 / 39.6 | 15.1 / 30.4 | 11.8 / 24.0 | 8.6 / 17.1 | 4.9 / 10.4 | 16 / 10 | 20.6, 19.8 / 13.7, 12.7 | 46 / 48 | 73 / 77 | 1.8 / 0.8 | 17 / 27 |
| em5@0.2 | 157.8 / 320.4 | 151.2 / 309.6 | 138.7 / 299.6 | 114.7 / 264.0 | 26.8 / 59.6 | 137 / 121 | 210.7, 141.6 / 194.7, 127.4 | 56 / 57 | 90 / 90 | 92.4 / 84.2 | 2 / 2 |
| em5@5.0 | 22.0 / 46.0 | 17.1 / 36.0 | 12.8 / 27.0 | 8.8 / 17.3 | 4.9 / 10.4 | 19 / 11 | 71.7, 48.5 / 17.8, 16.4 | 60 / 50 | 93 / 87 | 2.9 / 0.9 | 16 / 24 |
| em3@3.0 | 22.5 / 46.0 | 17.0 / 34.2 | 12.5 / 26.0 | 8.8 / 19.3 | 4.8 / 10.4 | 20 / 11 | 103.8, 65.7 / 19.1, 17.0 | 63 / 50 | n/a / n/a | 2.6 / 1.0 | 11 / 23 |
| em1@0.2 | 179.6 / 410.4 | 136.1 / 379.7 | 55.9 / 126.4 | 15.4 / 30.4 | 5.9 / 12.9 | 156 / 49 | n/a / n/a | n/a / n/a | n/a / n/a | 122.1 / 33.3 | 2 / 12 |
| em1@0.5 | 65.1 / 170.8 | 26.8 / 50.4 | 15.4 / 30.4 | 9.4 / 19.6 | 5.0 / 10.4 | 57 / 13 | n/a / n/a | n/a / n/a | n/a / n/a | 31.7 / 2.2 | 9 / 18 |
| em1@1.0 | 23.4 / 49.3 | 16.9 / 36.0 | 12.8 / 27.0 | 8.7 / 19.3 | 4.9 / 10.4 | 20 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 3.1 / 0.9 | 14 / 24 |
| em1@2.0 | 19.1 / 40.4 | 15.7 / 30.7 | 11.6 / 24.0 | 8.5 / 17.0 | 4.8 / 10.4 | 17 / 10 | n/a / n/a | n/a / n/a | n/a / n/a | 2.0 / 0.8 | 18 / 26 |
| smooth1@1.0 | 432.2 / 579.6 | 403.0 / 579.6 | 269.7 / 494.0 | 81.5 / 166.0 | 30.0 / 60.4 | 376 / 235 | n/a / n/a | n/a / n/a | n/a / n/a | 348.7 / 199.0 | 0 / 1 |
| smooth1@5.0 | 35.0 / 76.0 | 26.5 / 56.0 | 17.7 / 36.0 | 11.0 / 20.7 | 5.6 / 10.7 | 30 / 15 | n/a / n/a | n/a / n/a | n/a / n/a | 8.0 / 2.5 | 8 / 19 |
| joint3@1.0 | 65.4 / 144.2 | 35.2 / 70.4 | 19.0 / 39.6 | 10.6 / 20.7 | 5.2 / 10.4 | 57 / 16 | 161.0, 92.4 / 34.2, 25.7 | 63 / 52 | n/a / n/a | 28.1 / 2.1 | 6 / 16 |
| joint3@2.0 | 27.2 / 57.0 | 19.4 / 40.4 | 13.4 / 29.3 | 9.1 / 19.6 | 5.2 / 10.4 | 24 / 12 | 59.5, 39.0 / 14.7, 14.8 | 53 / 49 | n/a / n/a | 4.3 / 1.1 | 10 / 23 |
| joint3@3.0 | 21.5 / 44.0 | 17.0 / 36.0 | 12.6 / 27.0 | 8.9 / 19.4 | 5.2 / 10.4 | 19 / 11 | 29.5, 26.1 / 14.6, 13.6 | 50 / 49 | n/a / n/a | 2.9 / 1.0 | 14 / 24 |
| joint5@5.0 | 22.3 / 47.0 | 17.8 / 36.0 | 12.9 / 27.0 | 8.8 / 19.3 | 5.2 / 10.4 | 19 / 11 | 28.3, 25.3 / 14.6, 14.0 | 51 / 50 | 83 / 80 | 2.7 / 1.0 | 16 / 25 |
| hist5@1.0 | 38.8 / 80.4 | 27.9 / 59.6 | 17.8 / 37.0 | 10.5 / 20.7 | 5.0 / 10.4 | 34 / 15 | 68.6, 53.5 / 25.3, 20.9 | 49 / 50 | 73 / 79 | 10.0 / 1.9 | 7 / 18 |
| hist5@2.0 | 24.9 / 50.4 | 19.3 / 39.6 | 13.2 / 27.0 | 8.9 / 19.6 | 4.8 / 10.4 | 22 / 11 | 34.1, 30.1 / 16.5, 15.3 | 49 / 50 | 77 / 79 | 3.3 / 1.1 | 12 / 23 |
| hist5@3.0 | 20.8 / 42.9 | 16.6 / 34.2 | 12.2 / 26.1 | 8.6 / 19.3 | 4.7 / 10.4 | 18 / 11 | 26.4, 24.1 / 14.5, 13.6 | 49 / 50 | 78 / 80 | 2.3 / 0.9 | 18 / 23 |
| hist5_band@2.0 | 23.2 / 49.6 | 17.9 / 37.0 | 12.8 / 27.1 | 8.6 / 19.6 | 4.7 / 10.4 | 20 / 11 | 28.6, 28.2 / 15.2, 15.2 | 49 / 50 | 77 / 79 | 3.0 / 0.9 | 15 / 25 |

#### naps_per_day, messy cohort

Mean band IQR (p75 - p25 of the babies' medians) 1.2 naps; published-norms prior error on the median 0.4 naps (8 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, naps) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 16 / 11 | 0.2, 0.2 / 0.1, 0.2 | 65 / 70 | 85 / 88 | -0.0 / -0.1 | 78 / 84 |
| em5@0.2 | 1.7 / 3.5 | 1.6 / 3.5 | 1.5 / 3.5 | 1.2 / 3.0 | 0.3 / 1.0 | 153 / 134 | 1.4, 2.2 / 1.2, 2.0 | 50 / 54 | 82 / 84 | 1.0 / 0.8 | 13 / 17 |
| em5@5.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 23 / 13 | 0.4, 0.7 / 0.2, 0.3 | 69 / 68 | 93 / 91 | -0.0 / -0.0 | 67 / 82 |
| em3@3.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 23 / 14 | 0.5, 1.0 / 0.2, 0.3 | 71 / 68 | n/a / n/a | -0.0 / -0.0 | 67 / 81 |
| em1@0.2 | 1.6 / 4.0 | 1.2 / 3.5 | 0.6 / 1.5 | 0.2 / 0.5 | 0.1 / 0.5 | 145 / 54 | n/a / n/a | n/a / n/a | n/a / n/a | 1.0 / 0.2 | 21 / 51 |
| em1@0.5 | 0.6 / 1.5 | 0.3 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 54 / 18 | n/a / n/a | n/a / n/a | n/a / n/a | 0.2 / -0.0 | 48 / 74 |
| em1@1.0 | 0.3 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 25 / 14 | n/a / n/a | n/a / n/a | n/a / n/a | -0.0 / -0.0 | 66 / 80 |
| em1@2.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 18 / 12 | n/a / n/a | n/a / n/a | n/a / n/a | -0.0 / -0.0 | 74 / 84 |
| smooth1@1.0 | 3.6 / 6.0 | 3.4 / 6.0 | 2.4 / 5.0 | 1.2 / 2.5 | 0.3 / 1.0 | 319 / 214 | n/a / n/a | n/a / n/a | n/a / n/a | 2.7 / 1.6 | 2 / 7 |
| smooth1@5.0 | 0.4 / 1.0 | 0.3 / 1.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 39 / 17 | n/a / n/a | n/a / n/a | n/a / n/a | 0.1 / -0.0 | 52 / 76 |
| joint3@1.0 | 0.7 / 1.5 | 0.4 / 1.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 61 / 20 | 0.6, 1.6 / 0.3, 0.4 | 72 / 68 | n/a / n/a | 0.2 / -0.0 | 40 / 71 |
| joint3@2.0 | 0.3 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 27 / 15 | 0.4, 0.7 / 0.2, 0.2 | 68 / 68 | n/a / n/a | -0.0 / -0.0 | 62 / 79 |
| joint3@3.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 23 / 13 | 0.3, 0.4 / 0.1, 0.2 | 67 / 68 | n/a / n/a | -0.0 / -0.0 | 68 / 82 |
| joint5@5.0 | 0.2 / 0.5 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 23 / 13 | 0.3, 0.4 / 0.2, 0.2 | 68 / 69 | 90 / 89 | -0.0 / -0.0 | 66 / 82 |
| hist5@1.0 | 0.3 / 1.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 27 / 14 | 0.3, 0.6 / 0.2, 0.2 | 67 / 70 | 86 / 90 | -0.0 / -0.0 | 65 / 80 |
| hist5@2.0 | 0.2 / 0.6 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 19 / 12 | 0.3, 0.3 / 0.1, 0.2 | 69 / 70 | 88 / 90 | -0.0 / -0.1 | 74 / 83 |
| hist5@3.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 17 / 11 | 0.2, 0.3 / 0.1, 0.2 | 69 / 70 | 88 / 89 | -0.0 / -0.1 | 76 / 84 |
| hist5_band@2.0 | 0.2 / 1.0 | 0.2 / 0.5 | 0.1 / 0.5 | 0.1 / 0.5 | 0.0 / 0.0 | 20 / 11 | 0.2, 0.3 / 0.1, 0.2 | 69 / 70 | 88 / 89 | -0.0 / -0.1 | 74 / 84 |

#### day_sleep_minutes, messy cohort

Mean band IQR (p75 - p25 of the babies' medians) 82.5 min; published-norms prior error on the median 5.1 min (5 of 8 bands have a usable norm).

Median error (mean / 90th percentile over cells, min) by cell size; then for n = 20 and 50: error as % of the IQR, p25-p75 coverage (target 50 %), p10-p90 coverage (target 80 %), cold-start MAE delta vs the prior (negative helps), share of cells closer to the truth than the prior.

| Release | n=20 | n=30 | n=50 | n=100 | n=300 | % IQR n=20 / 50 | p25, p75 error n=20 / 50 | p25-p75 cov. n=20 / 50 | p10-p90 cov. n=20 / 50 | Δ MAE n=20 / 50 | beats prior n=20 / 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| exact5@none | 13.4 / 28.1 | 11.1 / 23.8 | 8.8 / 18.5 | 6.4 / 13.8 | 4.1 / 8.1 | 16 / 11 | 14.4, 15.0 / 9.3, 9.9 | 45 / 48 | 72 / 77 | 1.2 / 0.4 | 24 / 34 |
| em5@0.2 | 172.2 / 356.0 | 167.6 / 344.5 | 157.3 / 334.3 | 125.6 / 298.5 | 22.0 / 44.3 | 210 / 191 | 126.0, 240.8 / 109.1, 227.2 | 38 / 43 | 75 / 79 | 146.0 / 129.7 | 1 / 1 |
| em5@5.0 | 15.8 / 31.9 | 12.5 / 25.7 | 9.3 / 18.8 | 6.4 / 13.8 | 4.1 / 8.1 | 19 / 11 | 26.5, 68.9 / 11.5, 13.6 | 59 / 50 | 91 / 87 | 1.8 / 0.5 | 22 / 31 |
| em3@3.0 | 16.1 / 33.8 | 12.4 / 25.7 | 9.3 / 18.8 | 6.5 / 13.8 | 4.1 / 8.1 | 20 / 11 | 32.9, 101.7 / 12.2, 15.7 | 61 / 51 | n/a / n/a | 1.9 / 0.5 | 21 / 33 |
| em1@0.2 | 159.3 / 414.3 | 108.2 / 344.2 | 48.8 / 120.5 | 10.4 / 21.9 | 4.6 / 8.8 | 194 / 59 | n/a / n/a | n/a / n/a | n/a / n/a | 127.9 / 29.2 | 5 / 16 |
| em1@0.5 | 50.6 / 108.7 | 20.5 / 34.1 | 11.1 / 24.1 | 7.1 / 14.3 | 4.1 / 8.1 | 61 / 13 | n/a / n/a | n/a / n/a | n/a / n/a | 29.9 / 0.8 | 15 / 28 |
| em1@1.0 | 16.9 / 32.1 | 12.1 / 24.5 | 9.5 / 18.9 | 6.6 / 14.1 | 4.1 / 8.1 | 21 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 3.2 / 0.5 | 19 / 31 |
| em1@2.0 | 14.1 / 28.8 | 11.4 / 24.2 | 9.0 / 18.5 | 6.3 / 13.8 | 4.1 / 8.1 | 17 / 11 | n/a / n/a | n/a / n/a | n/a / n/a | 1.4 / 0.4 | 22 / 32 |
| smooth1@1.0 | 320.7 / 554.3 | 304.7 / 543.8 | 216.2 / 459.0 | 63.4 / 125.9 | 20.9 / 44.1 | 389 / 262 | n/a / n/a | n/a / n/a | n/a / n/a | 261.9 / 159.8 | 0 / 1 |
| smooth1@5.0 | 25.1 / 53.8 | 18.4 / 38.1 | 12.9 / 25.9 | 7.8 / 15.9 | 4.4 / 8.8 | 30 / 16 | n/a / n/a | n/a / n/a | n/a / n/a | 5.1 / 1.3 | 15 / 26 |
| joint3@1.0 | 61.0 / 148.1 | 29.7 / 54.3 | 14.0 / 29.6 | 7.7 / 15.8 | 4.4 / 8.5 | 74 / 17 | 47.9, 179.0 / 16.8, 29.8 | 62 / 52 | n/a / n/a | 37.6 / 1.4 | 11 / 26 |
| joint3@2.0 | 20.5 / 41.2 | 14.5 / 31.2 | 10.0 / 20.4 | 6.8 / 14.2 | 4.2 / 8.5 | 25 / 12 | 25.0, 60.5 / 10.5, 11.2 | 54 / 50 | n/a / n/a | 3.1 / 0.6 | 16 / 29 |
| joint3@3.0 | 16.0 / 31.9 | 12.2 / 24.3 | 9.4 / 18.8 | 6.6 / 14.1 | 4.3 / 8.5 | 19 / 11 | 17.8, 23.7 / 10.1, 10.3 | 49 / 50 | n/a / n/a | 1.8 / 0.5 | 21 / 30 |
| joint5@5.0 | 15.8 / 33.8 | 12.9 / 25.8 | 9.7 / 19.6 | 6.6 / 14.1 | 4.3 / 8.5 | 19 / 12 | 17.5, 20.3 / 10.6, 11.0 | 51 / 50 | 83 / 80 | 1.7 / 0.5 | 20 / 29 |
| hist5@1.0 | 24.4 / 50.4 | 17.3 / 35.8 | 11.4 / 24.1 | 7.2 / 14.3 | 4.3 / 8.5 | 30 / 14 | 25.6, 58.8 / 12.5, 16.6 | 50 / 51 | 76 / 81 | 4.4 / 0.8 | 14 / 26 |
| hist5@2.0 | 16.6 / 34.2 | 12.6 / 25.9 | 9.5 / 18.8 | 6.7 / 14.1 | 4.1 / 8.5 | 20 / 11 | 18.3, 23.7 / 10.0, 11.4 | 49 / 51 | 78 / 80 | 1.8 / 0.5 | 20 / 31 |
| hist5@3.0 | 14.6 / 30.4 | 11.4 / 24.2 | 9.2 / 18.5 | 6.4 / 13.8 | 4.2 / 8.5 | 18 / 11 | 15.3, 18.3 / 9.6, 10.4 | 49 / 50 | 78 / 80 | 1.5 / 0.5 | 22 / 32 |
| hist5_band@2.0 | 16.6 / 34.2 | 12.2 / 25.7 | 9.4 / 18.8 | 6.6 / 14.1 | 4.2 / 8.5 | 20 / 11 | 17.5, 21.1 / 10.0, 11.2 | 49 / 51 | 78 / 80 | 1.8 / 0.5 | 22 / 33 |

#### Privacy: the strongest attacker's advantage (TV) per release

Mean / max over target babies (the most extreme member of each cell plus random members; no-noise rows: every member). Formal bound tanh(epsilon / 2): 0.2: 0.10, 0.5: 0.24, 1.0: 0.46, 2.0: 0.76, 3.0: 0.91, 5.0: 0.99. The histogram row is its closed-form bound.

##### bottle_ml_per_feed, band 10-11 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.65 / 1.00 | 0.64 / 1.00 | 0.40 / 1.00 | 0.22 / 1.00 | 0.11 / 1.00 |
| exact3@none | 0.48 / 1.00 | 0.58 / 1.00 | 0.25 / 1.00 | 0.10 / 1.00 | 0.10 / 1.00 |
| exact1@none | 0.25 / 1.00 | 0.30 / 1.00 | 0.05 / 1.00 | 0.00 / 0.00 | 0.10 / 1.00 |
| em5@0.2 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 |
| em1@0.5 | 0.12 / 0.12 | 0.11 / 0.12 | 0.10 / 0.12 | 0.10 / 0.12 | 0.04 / 0.12 |
| em1@1.0 | 0.17 / 0.24 | 0.21 / 0.24 | 0.19 / 0.24 | 0.13 / 0.24 | 0.05 / 0.23 |
| em1@2.0 | 0.31 / 0.46 | 0.25 / 0.44 | 0.26 / 0.46 | 0.10 / 0.39 | 0.01 / 0.10 |
| joint3@1.0 | 0.11 / 0.16 | 0.11 / 0.15 | 0.12 / 0.15 | 0.13 / 0.17 | 0.10 / 0.17 |
| joint3@2.0 | 0.26 / 0.31 | 0.22 / 0.31 | 0.22 / 0.31 | 0.24 / 0.35 | 0.09 / 0.31 |
| joint3@3.0 | 0.39 / 0.46 | 0.31 / 0.41 | 0.28 / 0.48 | 0.26 / 0.44 | 0.14 / 0.53 |
| hist5@0.5 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 |
| hist5@0.5, published numbers (lower bound, extreme member) | 0.05 | 0.06 | 0.06 | 0.05 | 0.04 |
| hist5@1.0 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 |
| hist5@1.0, published numbers (lower bound, extreme member) | 0.11 | 0.11 | 0.10 | 0.10 | 0.06 |
| hist5@2.0 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 |
| hist5@2.0, published numbers (lower bound, extreme member) | 0.21 | 0.21 | 0.18 | 0.18 | 0.10 |
| hist5@3.0 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 |
| hist5@3.0, published numbers (lower bound, extreme member) | 0.29 | 0.29 | 0.25 | 0.21 | 0.04 |
| smooth1@1.0 | 0.00 / 0.02 | 0.00 / 0.01 | 0.00 / 0.01 | 0.02 / 0.05 | 0.01 / 0.05 |

Composed over T releases of the same cell with fresh noise, most extreme member (TV for T = 4, 12, 52):

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| em1@0.5 | 0.19 / 0.33 / 0.62 | 0.19 / 0.32 / 0.62 | 0.18 / 0.31 / 0.58 | 0.16 / 0.28 / 0.54 | 0.10 / 0.18 / 0.35 |
| em1@1.0 | 0.32 / 0.51 / 0.82 | 0.37 / 0.58 / 0.90 | 0.35 / 0.54 / 0.87 | 0.28 / 0.47 / 0.77 | 0.14 / 0.23 / 0.42 |
| em1@2.0 | 0.60 / 0.83 / 0.99 | 0.47 / 0.68 / 0.86 | 0.48 / 0.70 / 0.87 | 0.18 / 0.34 / 0.60 | 0.07 / 0.12 / 0.20 |
| joint3@1.0 | 0.25 / 0.41 / 0.74 | 0.24 / 0.39 / 0.71 | 0.23 / 0.38 / 0.69 | 0.24 / 0.40 / 0.72 | 0.20 / 0.33 / 0.62 |
| joint3@2.0 | 0.46 / 0.71 / 0.97 | 0.42 / 0.66 / 0.94 | 0.42 / 0.65 / 0.93 | 0.43 / 0.67 / 0.96 | 0.26 / 0.43 / 0.69 |
| joint3@3.0 | 0.61 / 0.85 / 0.99 | 0.54 / 0.79 / 0.99 | 0.54 / 0.78 / 0.96 | 0.50 / 0.73 / 0.94 | 0.29 / 0.42 / 0.55 |
| hist5@0.5 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 | 0.36 / 0.58 / 0.91 |
| hist5@0.5, published numbers (estimate from one percentile) | 0.11 / 0.20 / 0.41 | 0.13 / 0.22 / 0.44 | 0.13 / 0.22 / 0.44 | 0.11 / 0.19 / 0.38 | 0.07 / 0.13 / 0.26 |
| hist5@1.0 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.61 / 0.87 / 1.00 |
| hist5@1.0, published numbers (estimate from one percentile) | 0.24 / 0.40 / 0.73 | 0.24 / 0.41 / 0.73 | 0.21 / 0.37 / 0.68 | 0.18 / 0.30 / 0.58 | 0.12 / 0.21 / 0.42 |
| hist5@2.0 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.88 / 0.99 / 1.00 |
| hist5@2.0, published numbers (estimate from one percentile) | 0.44 / 0.69 / 0.96 | 0.40 / 0.64 / 0.94 | 0.35 / 0.56 / 0.89 | 0.32 / 0.52 / 0.85 | 0.19 / 0.32 / 0.60 |
| hist5@3.0 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 |
| hist5@3.0, published numbers (estimate from one percentile) | 0.56 / 0.82 / 0.99 | 0.53 / 0.79 / 0.99 | 0.47 / 0.71 / 0.97 | 0.39 / 0.62 / 0.92 | 0.11 / 0.19 / 0.38 |
| smooth1@1.0 | 0.01 / 0.03 / 0.05 | 0.01 / 0.01 / 0.02 | 0.01 / 0.01 / 0.02 | 0.05 / 0.09 / 0.19 | 0.03 / 0.05 / 0.10 |

##### night_sleep_minutes, band 36-40 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.99 / 1.00 | 0.87 / 1.00 | 0.42 / 1.00 | 0.44 / 1.00 | 0.20 / 1.00 |
| exact3@none | 0.77 / 1.00 | 0.69 / 1.00 | 0.35 / 1.00 | 0.35 / 1.00 | 0.20 / 1.00 |
| exact1@none | 0.50 / 1.00 | 0.35 / 1.00 | 0.10 / 1.00 | 0.20 / 1.00 | 0.00 / 0.00 |
| em5@0.2 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 |
| em1@0.5 | 0.11 / 0.12 | 0.11 / 0.12 | 0.10 / 0.12 | 0.07 / 0.12 | 0.02 / 0.12 |
| em1@1.0 | 0.20 / 0.24 | 0.20 / 0.24 | 0.11 / 0.24 | 0.06 / 0.23 | 0.01 / 0.07 |
| em1@2.0 | 0.29 / 0.46 | 0.24 / 0.45 | 0.12 / 0.40 | 0.08 / 0.40 | 0.03 / 0.38 |
| joint3@1.0 | 0.11 / 0.16 | 0.11 / 0.15 | 0.13 / 0.16 | 0.10 / 0.16 | 0.02 / 0.10 |
| joint3@2.0 | 0.24 / 0.31 | 0.21 / 0.31 | 0.19 / 0.36 | 0.10 / 0.30 | 0.03 / 0.31 |
| joint3@3.0 | 0.33 / 0.47 | 0.28 / 0.46 | 0.23 / 0.46 | 0.14 / 0.46 | 0.03 / 0.50 |
| hist5@0.5 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 |
| hist5@0.5, published numbers (lower bound, extreme member) | 0.06 | 0.06 | 0.05 | 0.05 | 0.04 |
| hist5@1.0 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 |
| hist5@1.0, published numbers (lower bound, extreme member) | 0.10 | 0.11 | 0.10 | 0.09 | 0.08 |
| hist5@2.0 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 |
| hist5@2.0, published numbers (lower bound, extreme member) | 0.19 | 0.21 | 0.17 | 0.18 | 0.13 |
| hist5@3.0 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 |
| hist5@3.0, published numbers (lower bound, extreme member) | 0.28 | 0.29 | 0.26 | 0.23 | 0.15 |
| smooth1@1.0 | 0.05 / 0.05 | 0.05 / 0.05 | 0.05 / 0.05 | 0.01 / 0.05 | 0.02 / 0.05 |

Composed over T releases of the same cell with fresh noise, most extreme member (TV for T = 4, 12, 52):

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| em1@0.5 | 0.20 / 0.33 / 0.62 | 0.19 / 0.32 / 0.60 | 0.18 / 0.30 / 0.57 | 0.13 / 0.22 / 0.43 | 0.04 / 0.07 / 0.14 |
| em1@1.0 | 0.34 / 0.56 / 0.88 | 0.34 / 0.54 / 0.87 | 0.23 / 0.37 / 0.66 | 0.16 / 0.25 / 0.47 | 0.03 / 0.06 / 0.14 |
| em1@2.0 | 0.51 / 0.75 / 0.94 | 0.45 / 0.66 / 0.87 | 0.26 / 0.41 / 0.65 | 0.19 / 0.31 / 0.48 | 0.06 / 0.09 / 0.10 |
| joint3@1.0 | 0.24 / 0.40 / 0.73 | 0.23 / 0.39 / 0.71 | 0.24 / 0.41 / 0.72 | 0.19 / 0.31 / 0.59 | 0.05 / 0.09 / 0.19 |
| joint3@2.0 | 0.45 / 0.70 / 0.97 | 0.41 / 0.64 / 0.94 | 0.37 / 0.58 / 0.87 | 0.19 / 0.33 / 0.61 | 0.08 / 0.14 / 0.23 |
| joint3@3.0 | 0.59 / 0.84 / 0.99 | 0.51 / 0.75 / 0.98 | 0.44 / 0.65 / 0.86 | 0.22 / 0.35 / 0.50 | 0.05 / 0.08 / 0.15 |
| hist5@0.5 | 0.36 / 0.58 / 0.90 | 0.35 / 0.58 / 0.90 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 |
| hist5@0.5, published numbers (estimate from one percentile) | 0.13 / 0.23 / 0.46 | 0.13 / 0.22 / 0.44 | 0.12 / 0.21 / 0.42 | 0.11 / 0.20 / 0.40 | 0.09 / 0.15 / 0.32 |
| hist5@1.0 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.61 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 |
| hist5@1.0, published numbers (estimate from one percentile) | 0.22 / 0.38 / 0.69 | 0.24 / 0.40 / 0.72 | 0.20 / 0.35 / 0.66 | 0.18 / 0.31 / 0.59 | 0.15 / 0.26 / 0.51 |
| hist5@2.0 | 0.88 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 |
| hist5@2.0, published numbers (estimate from one percentile) | 0.40 / 0.64 / 0.94 | 0.41 / 0.64 / 0.94 | 0.33 / 0.54 / 0.87 | 0.33 / 0.54 / 0.87 | 0.24 / 0.40 / 0.70 |
| hist5@3.0 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 |
| hist5@3.0, published numbers (estimate from one percentile) | 0.55 / 0.81 / 0.99 | 0.54 / 0.80 / 0.99 | 0.47 / 0.71 / 0.97 | 0.42 / 0.65 / 0.94 | 0.30 / 0.48 / 0.76 |
| smooth1@1.0 | 0.09 / 0.15 / 0.30 | 0.09 / 0.16 / 0.32 | 0.09 / 0.16 / 0.33 | 0.02 / 0.04 / 0.07 | 0.06 / 0.10 / 0.20 |

##### naps_per_day, band 24-26 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.46 / 1.00 | 0.22 / 1.00 | 0.13 / 1.00 | 0.10 / 1.00 | 0.00 / 0.00 |
| exact3@none | 0.40 / 1.00 | 0.15 / 1.00 | 0.08 / 1.00 | 0.07 / 1.00 | 0.00 / 0.00 |
| exact1@none | 0.10 / 1.00 | 0.15 / 1.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| em5@0.2 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 |
| em1@0.5 | 0.10 / 0.12 | 0.08 / 0.12 | 0.08 / 0.12 | 0.06 / 0.12 | 0.00 / 0.02 |
| em1@1.0 | 0.16 / 0.24 | 0.14 / 0.24 | 0.06 / 0.23 | 0.01 / 0.08 | 0.00 / 0.01 |
| em1@2.0 | 0.22 / 0.46 | 0.20 / 0.46 | 0.09 / 0.38 | 0.06 / 0.38 | 0.00 / 0.00 |
| joint3@1.0 | 0.12 / 0.15 | 0.11 / 0.16 | 0.11 / 0.17 | 0.10 / 0.16 | 0.03 / 0.19 |
| joint3@2.0 | 0.23 / 0.31 | 0.21 / 0.30 | 0.17 / 0.31 | 0.10 / 0.34 | 0.06 / 0.33 |
| joint3@3.0 | 0.27 / 0.44 | 0.25 / 0.46 | 0.21 / 0.50 | 0.07 / 0.51 | 0.05 / 0.38 |
| hist5@0.5 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 |
| hist5@0.5, published numbers (lower bound, extreme member) | 0.06 | 0.06 | 0.06 | 0.05 | 0.02 |
| hist5@1.0 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 |
| hist5@1.0, published numbers (lower bound, extreme member) | 0.13 | 0.11 | 0.10 | 0.06 | 0.01 |
| hist5@2.0 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 |
| hist5@2.0, published numbers (lower bound, extreme member) | 0.23 | 0.17 | 0.13 | 0.08 | 0.00 |
| hist5@3.0 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 |
| hist5@3.0, published numbers (lower bound, extreme member) | 0.31 | 0.25 | 0.17 | 0.10 | 0.00 |
| smooth1@1.0 | 0.00 / 0.01 | 0.01 / 0.05 | 0.00 / 0.00 | 0.02 / 0.05 | 0.01 / 0.05 |

Composed over T releases of the same cell with fresh noise, most extreme member (TV for T = 4, 12, 52):

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| em1@0.5 | 0.19 / 0.32 / 0.61 | 0.17 / 0.30 / 0.57 | 0.17 / 0.28 / 0.54 | 0.13 / 0.23 / 0.45 | 0.01 / 0.02 / 0.03 |
| em1@1.0 | 0.31 / 0.50 / 0.81 | 0.27 / 0.43 / 0.73 | 0.17 / 0.29 / 0.52 | 0.04 / 0.09 / 0.20 | 0.01 / 0.01 / 0.04 |
| em1@2.0 | 0.45 / 0.65 / 0.85 | 0.41 / 0.62 / 0.84 | 0.16 / 0.29 / 0.51 | 0.11 / 0.18 / 0.30 | 0.00 / 0.00 / 0.01 |
| joint3@1.0 | 0.24 / 0.40 / 0.72 | 0.23 / 0.37 / 0.69 | 0.24 / 0.40 / 0.71 | 0.18 / 0.29 / 0.56 | 0.08 / 0.14 / 0.27 |
| joint3@2.0 | 0.43 / 0.67 / 0.95 | 0.43 / 0.66 / 0.94 | 0.26 / 0.45 / 0.75 | 0.24 / 0.40 / 0.62 | 0.13 / 0.23 / 0.41 |
| joint3@3.0 | 0.53 / 0.78 / 0.96 | 0.54 / 0.78 / 0.97 | 0.36 / 0.55 / 0.80 | 0.21 / 0.33 / 0.51 | 0.11 / 0.19 / 0.27 |
| hist5@0.5 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 | 0.35 / 0.57 / 0.91 | 0.36 / 0.58 / 0.90 | 0.35 / 0.58 / 0.91 |
| hist5@0.5, published numbers (estimate from one percentile) | 0.13 / 0.23 / 0.45 | 0.13 / 0.23 / 0.45 | 0.13 / 0.22 / 0.44 | 0.10 / 0.18 / 0.35 | 0.04 / 0.08 / 0.18 |
| hist5@1.0 | 0.61 / 0.87 / 1.00 | 0.61 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.61 / 0.87 / 1.00 | 0.61 / 0.87 / 1.00 |
| hist5@1.0, published numbers (estimate from one percentile) | 0.27 / 0.44 / 0.77 | 0.24 / 0.41 / 0.73 | 0.21 / 0.37 / 0.67 | 0.12 / 0.20 / 0.39 | 0.03 / 0.07 / 0.14 |
| hist5@2.0 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 |
| hist5@2.0, published numbers (estimate from one percentile) | 0.43 / 0.67 / 0.95 | 0.35 / 0.56 / 0.87 | 0.25 / 0.41 / 0.67 | 0.14 / 0.25 / 0.45 | 0.01 / 0.03 / 0.06 |
| hist5@3.0 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 |
| hist5@3.0, published numbers (estimate from one percentile) | 0.54 / 0.80 / 0.98 | 0.46 / 0.69 / 0.91 | 0.31 / 0.50 / 0.73 | 0.17 / 0.27 / 0.41 | 0.00 / 0.01 / 0.04 |
| smooth1@1.0 | 0.00 / 0.01 / 0.01 | 0.03 / 0.04 / 0.09 | 0.00 / 0.01 / 0.01 | 0.05 / 0.09 / 0.18 | 0.03 / 0.06 / 0.11 |

##### day_sleep_minutes, band 36-40 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.83 / 1.00 | 0.80 / 1.00 | 0.34 / 1.00 | 0.14 / 1.00 | 0.05 / 1.00 |
| exact3@none | 0.76 / 1.00 | 0.71 / 1.00 | 0.20 / 1.00 | 0.07 / 1.00 | 0.03 / 1.00 |
| exact1@none | 0.50 / 1.00 | 0.35 / 1.00 | 0.10 / 1.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| em5@0.2 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 | 0.01 / 0.01 |
| em1@0.5 | 0.11 / 0.12 | 0.09 / 0.12 | 0.10 / 0.12 | 0.04 / 0.12 | 0.03 / 0.12 |
| em1@1.0 | 0.15 / 0.24 | 0.15 / 0.24 | 0.16 / 0.24 | 0.03 / 0.23 | 0.02 / 0.15 |
| em1@2.0 | 0.20 / 0.46 | 0.19 / 0.40 | 0.24 / 0.40 | 0.02 / 0.38 | 0.00 / 0.02 |
| joint3@1.0 | 0.11 / 0.15 | 0.10 / 0.14 | 0.10 / 0.15 | 0.10 / 0.17 | 0.04 / 0.16 |
| joint3@2.0 | 0.25 / 0.31 | 0.21 / 0.30 | 0.17 / 0.33 | 0.10 / 0.33 | 0.03 / 0.29 |
| joint3@3.0 | 0.32 / 0.46 | 0.27 / 0.52 | 0.22 / 0.45 | 0.13 / 0.45 | 0.11 / 0.41 |
| hist5@0.5 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 | 0.22 / 0.22 |
| hist5@0.5, published numbers (lower bound, extreme member) | 0.06 | 0.07 | 0.06 | 0.06 | 0.04 |
| hist5@1.0 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 | 0.39 / 0.39 |
| hist5@1.0, published numbers (lower bound, extreme member) | 0.12 | 0.12 | 0.11 | 0.11 | 0.07 |
| hist5@2.0 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 | 0.63 / 0.63 |
| hist5@2.0, published numbers (lower bound, extreme member) | 0.22 | 0.22 | 0.19 | 0.18 | 0.12 |
| hist5@3.0 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 | 0.78 / 0.78 |
| hist5@3.0, published numbers (lower bound, extreme member) | 0.30 | 0.31 | 0.27 | 0.26 | 0.17 |
| smooth1@1.0 | 0.00 / 0.03 | 0.00 / 0.01 | 0.00 / 0.01 | 0.02 / 0.05 | 0.01 / 0.05 |

Composed over T releases of the same cell with fresh noise, most extreme member (TV for T = 4, 12, 52):

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| em1@0.5 | 0.19 / 0.31 / 0.59 | 0.18 / 0.29 / 0.55 | 0.19 / 0.31 / 0.58 | 0.10 / 0.17 / 0.35 | 0.07 / 0.14 / 0.28 |
| em1@1.0 | 0.29 / 0.48 / 0.80 | 0.25 / 0.42 / 0.71 | 0.31 / 0.49 / 0.79 | 0.05 / 0.10 / 0.21 | 0.07 / 0.12 / 0.23 |
| em1@2.0 | 0.40 / 0.61 / 0.81 | 0.42 / 0.64 / 0.83 | 0.44 / 0.66 / 0.83 | 0.04 / 0.08 / 0.14 | 0.01 / 0.02 / 0.06 |
| joint3@1.0 | 0.24 / 0.40 / 0.73 | 0.22 / 0.36 / 0.67 | 0.20 / 0.34 / 0.63 | 0.22 / 0.36 / 0.66 | 0.10 / 0.17 / 0.36 |
| joint3@2.0 | 0.47 / 0.71 / 0.97 | 0.42 / 0.65 / 0.93 | 0.34 / 0.54 / 0.83 | 0.25 / 0.40 / 0.65 | 0.12 / 0.21 / 0.36 |
| joint3@3.0 | 0.57 / 0.80 / 0.99 | 0.57 / 0.80 / 0.99 | 0.42 / 0.62 / 0.85 | 0.26 / 0.41 / 0.57 | 0.18 / 0.27 / 0.35 |
| hist5@0.5 | 0.36 / 0.58 / 0.90 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.91 | 0.35 / 0.58 / 0.90 | 0.35 / 0.58 / 0.91 |
| hist5@0.5, published numbers (estimate from one percentile) | 0.14 / 0.25 / 0.48 | 0.14 / 0.25 / 0.49 | 0.13 / 0.22 / 0.44 | 0.12 / 0.21 / 0.42 | 0.08 / 0.15 / 0.30 |
| hist5@1.0 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 | 0.62 / 0.87 / 1.00 |
| hist5@1.0, published numbers (estimate from one percentile) | 0.25 / 0.42 / 0.74 | 0.25 / 0.42 / 0.74 | 0.22 / 0.38 / 0.69 | 0.21 / 0.35 / 0.66 | 0.14 / 0.23 / 0.46 |
| hist5@2.0 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 | 0.89 / 0.99 / 1.00 |
| hist5@2.0, published numbers (estimate from one percentile) | 0.43 / 0.67 / 0.94 | 0.44 / 0.69 / 0.96 | 0.37 / 0.59 / 0.91 | 0.33 / 0.53 / 0.86 | 0.23 / 0.38 / 0.69 |
| hist5@3.0 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 | 0.97 / 1.00 / 1.00 |
| hist5@3.0, published numbers (estimate from one percentile) | 0.58 / 0.82 / 0.99 | 0.58 / 0.82 / 0.99 | 0.49 / 0.74 / 0.97 | 0.47 / 0.71 / 0.96 | 0.29 / 0.47 / 0.70 |
| smooth1@1.0 | 0.01 / 0.02 / 0.05 | 0.00 / 0.01 / 0.01 | 0.00 / 0.01 / 0.01 | 0.04 / 0.07 / 0.14 | 0.03 / 0.05 / 0.11 |

#### Privacy: the weaker attacker (knows only the target's value)

Advantage (TPR - FPR, threshold fitted on half the trials): withdrawal between two releases with no other change / with about 10 % new babies joining; single release (in or replaced).

##### bottle_ml_per_feed, band 10-11 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.50 / 0.21 / 0.05 | 0.40 / 0.20 / 0.04 | 0.29 / 0.15 / 0.03 | 0.14 / 0.07 / 0.01 | 0.06 / 0.01 / 0.01 |
| exact3@none | 0.42 / 0.23 / 0.05 | 0.29 / 0.13 / 0.03 | 0.22 / 0.08 / 0.01 | 0.10 / 0.05 / 0.00 | 0.04 / 0.01 / 0.00 |
| exact1@none | 0.17 / 0.10 / 0.04 | 0.11 / 0.08 / 0.03 | 0.07 / 0.03 / 0.03 | 0.02 / 0.02 / 0.00 | 0.00 / 0.02 / 0.00 |
| em1@1.0 | 0.04 / 0.03 / 0.02 | 0.02 / 0.04 / 0.01 | 0.01 / 0.03 / 0.04 | 0.02 / 0.03 / -0.00 | 0.01 / 0.02 / -0.01 |
| em1@2.0 | 0.11 / 0.08 / 0.07 | 0.08 / 0.07 / 0.03 | 0.01 / 0.07 / 0.03 | 0.03 / 0.01 / -0.00 | -0.01 / 0.01 / 0.00 |
| joint3@2.0 | 0.04 / 0.03 / 0.03 | 0.07 / 0.11 / 0.02 | 0.09 / 0.06 / 0.01 | 0.02 / -0.01 / 0.01 | 0.02 / -0.02 / -0.01 |
| joint3@3.0 | 0.08 / 0.09 / 0.07 | 0.08 / 0.14 / 0.02 | 0.00 / 0.03 / 0.02 | 0.05 / 0.03 / 0.02 | 0.02 / 0.01 / 0.01 |
| hist5@2.0 | 0.07 / 0.04 / 0.04 | 0.06 / 0.03 / 0.04 | -0.03 / 0.01 / 0.03 | 0.07 / 0.00 / -0.01 | 0.00 / 0.00 / -0.00 |
| hist5@3.0 | 0.02 / 0.05 / 0.03 | 0.09 / 0.07 / 0.03 | 0.02 / 0.03 / 0.02 | 0.03 / 0.05 / -0.02 | 0.00 / -0.01 / 0.00 |

##### night_sleep_minutes, band 36-40 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.76 / 0.38 / 0.06 | 0.73 / 0.22 / 0.04 | 0.52 / 0.16 / 0.01 | 0.34 / 0.09 / 0.00 | 0.12 / 0.03 / 0.00 |
| exact3@none | 0.70 / 0.30 / 0.04 | 0.60 / 0.28 / 0.04 | 0.38 / 0.15 / 0.01 | 0.21 / 0.13 / 0.00 | 0.07 / 0.02 / 0.00 |
| exact1@none | 0.30 / 0.17 / 0.03 | 0.26 / 0.14 / 0.03 | 0.17 / 0.06 / 0.02 | 0.07 / 0.05 / 0.00 | 0.03 / 0.02 / 0.00 |
| em1@1.0 | 0.13 / 0.07 / 0.03 | 0.07 / 0.06 / 0.00 | 0.10 / 0.03 / 0.00 | 0.03 / 0.02 / -0.01 | 0.03 / 0.04 / 0.01 |
| em1@2.0 | 0.12 / 0.09 / 0.03 | 0.15 / 0.14 / 0.04 | 0.08 / 0.06 / 0.02 | 0.05 / 0.04 / 0.02 | 0.03 / 0.01 / -0.01 |
| joint3@2.0 | 0.10 / 0.08 / 0.00 | 0.02 / 0.05 / 0.05 | 0.07 / 0.08 / 0.00 | 0.08 / 0.06 / 0.02 | 0.01 / 0.01 / 0.00 |
| joint3@3.0 | 0.12 / 0.06 / 0.01 | 0.07 / 0.08 / 0.05 | 0.07 / 0.12 / -0.00 | 0.07 / 0.09 / 0.03 | 0.02 / 0.00 / 0.01 |
| hist5@2.0 | 0.05 / 0.02 / 0.10 | 0.03 / 0.09 / 0.03 | 0.08 / 0.05 / 0.00 | 0.08 / 0.01 / 0.01 | 0.00 / 0.00 / 0.00 |
| hist5@3.0 | 0.04 / 0.05 / 0.05 | 0.01 / 0.05 / 0.02 | 0.09 / 0.03 / 0.03 | 0.10 / 0.03 / 0.00 | 0.01 / 0.03 / 0.02 |

##### naps_per_day, band 24-26 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.20 / 0.05 / 0.02 | 0.05 / 0.05 / 0.00 | 0.03 / 0.04 / 0.00 | 0.02 / 0.02 / 0.00 | 0.00 / 0.00 / 0.00 |
| exact3@none | 0.19 / 0.06 / 0.02 | 0.05 / 0.03 / 0.01 | 0.02 / 0.01 / 0.00 | 0.01 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 |
| exact1@none | 0.04 / 0.02 / 0.01 | 0.01 / 0.00 / 0.01 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 |
| em1@1.0 | 0.01 / 0.01 / 0.03 | 0.04 / 0.04 / 0.02 | -0.01 / 0.00 / 0.02 | -0.00 / 0.00 / -0.00 | 0.00 / 0.00 / 0.00 |
| em1@2.0 | 0.02 / 0.02 / 0.02 | 0.02 / 0.01 / 0.01 | -0.00 / 0.02 / 0.01 | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 |
| joint3@2.0 | 0.08 / 0.04 / 0.02 | 0.04 / 0.05 / 0.05 | 0.03 / 0.02 / 0.02 | 0.00 / 0.01 / 0.01 | -0.01 / 0.00 / 0.00 |
| joint3@3.0 | 0.08 / 0.05 / 0.01 | 0.04 / 0.03 / 0.00 | 0.00 / 0.03 / 0.00 | 0.02 / 0.01 / 0.01 | 0.00 / 0.00 / 0.00 |
| hist5@2.0 | 0.04 / 0.09 / 0.03 | 0.03 / 0.04 / 0.04 | 0.00 / 0.03 / 0.00 | 0.02 / 0.03 / 0.00 | 0.00 / 0.01 / 0.00 |
| hist5@3.0 | 0.08 / 0.05 / 0.01 | 0.07 / 0.05 / -0.01 | 0.05 / 0.03 / 0.01 | -0.03 / -0.01 / 0.00 | 0.00 / -0.00 / 0.00 |

##### day_sleep_minutes, band 36-40 weeks

| Release | n=20 | n=30 | n=50 | n=100 | n=300 |
|---|---:|---:|---:|---:|---:|
| exact5@none | 0.72 / 0.28 / 0.05 | 0.57 / 0.24 / 0.03 | 0.42 / 0.13 / 0.02 | 0.25 / 0.08 / 0.01 | 0.11 / 0.03 / 0.01 |
| exact3@none | 0.63 / 0.25 / 0.04 | 0.48 / 0.22 / 0.03 | 0.32 / 0.12 / 0.02 | 0.12 / 0.09 / 0.01 | 0.03 / 0.02 / 0.00 |
| exact1@none | 0.34 / 0.16 / 0.04 | 0.20 / 0.11 / 0.05 | 0.12 / 0.07 / 0.01 | 0.06 / 0.02 / 0.01 | 0.03 / 0.01 / 0.01 |
| em1@1.0 | 0.10 / 0.09 / 0.04 | 0.03 / 0.08 / 0.03 | 0.04 / 0.02 / 0.03 | 0.05 / 0.03 / 0.02 | 0.02 / 0.00 / -0.00 |
| em1@2.0 | 0.17 / 0.10 / 0.04 | 0.13 / 0.06 / 0.03 | 0.06 / 0.07 / 0.01 | 0.01 / 0.03 / -0.01 | 0.00 / -0.00 / 0.00 |
| joint3@2.0 | 0.03 / 0.00 / 0.01 | 0.09 / 0.08 / 0.05 | 0.05 / 0.08 / -0.01 | 0.05 / 0.06 / 0.03 | 0.01 / 0.02 / 0.02 |
| joint3@3.0 | 0.10 / 0.08 / 0.02 | 0.08 / 0.15 / 0.01 | 0.05 / 0.09 / 0.01 | 0.05 / 0.04 / 0.01 | 0.00 / 0.04 / 0.00 |
| hist5@2.0 | -0.01 / -0.01 / 0.03 | 0.05 / -0.01 / 0.03 | 0.04 / 0.05 / 0.03 | 0.00 / 0.04 / 0.01 | 0.01 / 0.03 / 0.01 |
| hist5@3.0 | -0.01 / 0.06 / 0.06 | 0.03 / 0.06 / 0.04 | 0.11 / 0.01 / 0.05 | 0.04 / 0.04 / 0.00 | 0.03 / 0.01 / 0.00 |

#### Instances: filling, cells per baby, error a user sees at each week

Every baby of the instance opted in (an instance of N babies is N opted-in babies, about N / 1.3 families); median error over covered weeks of the published median against that week's cohort truth.

##### bottle_ml_per_feed

| Opted-in babies | Grid | Bands published | Weeks covered | Median babies per cell | Cells per baby (median / p90 / max) | Error exact3 | joint3@1 | joint3@2 | joint3@3 | hist5@2 | hist5@3 | em1@1 | em1@2 |
|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | fine | 8 of 39 | 21% | 23 | 1 / 5 / 6 | 9.9 | 23.7 | 11.7 | 10.8 | 9.5 | 8.8 | 9.6 | 8.8 |
| 250 | coarse | 7 of 18 | 42% | 25 | 1 / 3 / 4 | 6.6 | 17.6 | 8.2 | 7.6 | 9.9 | 8.8 | 8.4 | 7.4 |
| 250 | wide | 5 of 6 | 88% | 40 | 1 / 2 / 4 | 8.2 | 15.3 | 8.8 | 7.8 | 9.1 | 8.2 | 8.8 | 8.2 |
| 500 | fine | 31 of 39 | 92% | 37 | 3 / 6 / 16 | 7.7 | 12.9 | 8.0 | 7.0 | 6.4 | 6.6 | 7.1 | 7.1 |
| 500 | coarse | 16 of 18 | 92% | 42 | 2 / 4 / 11 | 7.3 | 11.7 | 7.4 | 6.9 | 6.9 | 6.6 | 6.7 | 6.4 |
| 500 | wide | 6 of 6 | 100% | 68 | 1 / 2 / 4 | 8.6 | 10.7 | 9.7 | 9.1 | 8.9 | 9.1 | 9.1 | 9.3 |
| 1000 | fine | 36 of 39 | 97% | 68 | 3 / 8 / 21 | 5.1 | 7.4 | 5.5 | 5.3 | 5.3 | 5.2 | 5.2 | 5.2 |
| 1000 | coarse | 18 of 18 | 100% | 76 | 2 / 4 / 11 | 5.2 | 7.2 | 6.2 | 5.7 | 6.2 | 5.6 | 5.6 | 5.6 |
| 1000 | wide | 6 of 6 | 100% | 132 | 1 / 2 / 4 | 8.9 | 9.0 | 9.5 | 9.1 | 9.0 | 9.1 | 8.9 | 8.8 |
| 2000 | fine | 37 of 39 | 98% | 146 | 3 / 7 / 22 | 4.3 | 5.5 | 4.5 | 4.8 | 4.6 | 4.5 | 4.7 | 4.7 |
| 2000 | coarse | 18 of 18 | 100% | 160 | 2 / 4 / 11 | 5.0 | 5.3 | 5.1 | 5.0 | 4.8 | 4.8 | 5.0 | 4.9 |
| 2000 | wide | 6 of 6 | 100% | 273 | 1 / 2 / 4 | 8.2 | 8.9 | 9.2 | 9.1 | 8.8 | 8.9 | 8.8 | 8.8 |
| 4000 | fine | 39 of 39 | 100% | 236 | 3 / 7 / 22 | 4.0 | 4.7 | 3.8 | 3.8 | 3.8 | 3.8 | 3.9 | 3.9 |
| 4000 | coarse | 18 of 18 | 100% | 280 | 2 / 4 / 11 | 5.1 | 5.1 | 5.1 | 5.1 | 5.1 | 5.1 | 5.1 | 5.1 |
| 4000 | wide | 6 of 6 | 100% | 488 | 1 / 2 / 4 | 9.1 | 8.9 | 8.8 | 8.9 | 8.7 | 8.7 | 8.9 | 8.7 |

##### night_sleep_minutes

| Opted-in babies | Grid | Bands published | Weeks covered | Median babies per cell | Cells per baby (median / p90 / max) | Error exact3 | joint3@1 | joint3@2 | joint3@3 | hist5@2 | hist5@3 | em1@1 | em1@2 |
|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | fine | 27 of 39 | 88% | 31 | 3 / 6 / 14 | 14.8 | 26.5 | 15.8 | 14.7 | 16.3 | 14.4 | 14.6 | 14.1 |
| 250 | coarse | 16 of 18 | 92% | 39 | 2 / 4 / 10 | 14.3 | 25.0 | 12.9 | 12.5 | 14.8 | 13.2 | 13.0 | 12.4 |
| 250 | wide | 6 of 6 | 100% | 64 | 1 / 2 / 4 | 12.9 | 16.0 | 12.5 | 13.3 | 13.1 | 13.3 | 12.3 | 11.9 |
| 500 | fine | 34 of 39 | 95% | 62 | 3 / 7 / 19 | 10.7 | 14.4 | 11.0 | 10.5 | 10.4 | 10.3 | 10.3 | 9.9 |
| 500 | coarse | 17 of 18 | 96% | 62 | 2 / 4 / 11 | 8.7 | 12.1 | 8.7 | 8.6 | 8.3 | 8.3 | 7.9 | 7.4 |
| 500 | wide | 6 of 6 | 100% | 106 | 1 / 2 / 4 | 6.2 | 7.6 | 6.7 | 6.4 | 7.0 | 6.6 | 6.1 | 6.1 |
| 1000 | fine | 37 of 39 | 98% | 113 | 3 / 7 / 22 | 5.7 | 7.4 | 6.6 | 6.5 | 6.2 | 5.6 | 5.8 | 5.7 |
| 1000 | coarse | 18 of 18 | 100% | 122 | 2 / 4 / 11 | 5.2 | 7.1 | 6.1 | 5.9 | 5.8 | 5.2 | 5.1 | 5.0 |
| 1000 | wide | 6 of 6 | 100% | 214 | 1 / 2 / 4 | 8.9 | 8.5 | 8.4 | 8.4 | 7.7 | 7.9 | 8.5 | 8.6 |
| 2000 | fine | 38 of 39 | 99% | 222 | 3 / 7 / 23 | 4.1 | 4.3 | 4.0 | 3.8 | 4.3 | 4.0 | 4.1 | 4.1 |
| 2000 | coarse | 18 of 18 | 100% | 256 | 2 / 4 / 11 | 4.1 | 4.2 | 3.9 | 4.1 | 4.3 | 4.0 | 4.2 | 4.0 |
| 2000 | wide | 6 of 6 | 100% | 428 | 1 / 2 / 4 | 5.5 | 5.6 | 5.7 | 5.5 | 5.9 | 5.8 | 5.6 | 5.5 |
| 4000 | fine | 39 of 39 | 100% | 383 | 3 / 7 / 22 | 4.0 | 4.6 | 4.5 | 4.3 | 3.9 | 3.8 | 4.2 | 4.1 |
| 4000 | coarse | 18 of 18 | 100% | 467 | 2 / 4 / 11 | 3.8 | 4.0 | 4.2 | 4.1 | 3.8 | 3.9 | 3.9 | 3.9 |
| 4000 | wide | 6 of 6 | 100% | 819 | 1 / 2 / 4 | 6.7 | 6.7 | 6.6 | 6.6 | 6.5 | 6.7 | 6.6 | 6.4 |

##### naps_per_day

| Opted-in babies | Grid | Bands published | Weeks covered | Median babies per cell | Cells per baby (median / p90 / max) | Error exact3 | joint3@1 | joint3@2 | joint3@3 | hist5@2 | hist5@3 | em1@1 | em1@2 |
|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | fine | 27 of 39 | 88% | 31 | 3 / 6 / 14 | 0.1 | 0.3 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 250 | coarse | 16 of 18 | 92% | 39 | 2 / 4 / 10 | 0.1 | 0.2 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 250 | wide | 6 of 6 | 100% | 64 | 1 / 2 / 4 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |
| 500 | fine | 34 of 39 | 95% | 62 | 3 / 7 / 19 | 0.0 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 500 | coarse | 17 of 18 | 96% | 62 | 2 / 4 / 11 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 500 | wide | 6 of 6 | 100% | 106 | 1 / 2 / 4 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |
| 1000 | fine | 37 of 39 | 98% | 113 | 3 / 7 / 22 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 1000 | coarse | 18 of 18 | 100% | 122 | 2 / 4 / 11 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 1000 | wide | 6 of 6 | 100% | 214 | 1 / 2 / 4 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |
| 2000 | fine | 38 of 39 | 99% | 222 | 3 / 7 / 23 | 0.0 | 0.1 | 0.1 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 |
| 2000 | coarse | 18 of 18 | 100% | 256 | 2 / 4 / 11 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 2000 | wide | 6 of 6 | 100% | 428 | 1 / 2 / 4 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |
| 4000 | fine | 39 of 39 | 100% | 383 | 3 / 7 / 22 | 0.0 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.1 | 0.1 |
| 4000 | coarse | 18 of 18 | 100% | 467 | 2 / 4 / 11 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| 4000 | wide | 6 of 6 | 100% | 819 | 1 / 2 / 4 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 | 0.2 |

##### day_sleep_minutes

| Opted-in babies | Grid | Bands published | Weeks covered | Median babies per cell | Cells per baby (median / p90 / max) | Error exact3 | joint3@1 | joint3@2 | joint3@3 | hist5@2 | hist5@3 | em1@1 | em1@2 |
|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | fine | 27 of 39 | 88% | 31 | 3 / 6 / 14 | 7.5 | 29.2 | 10.8 | 9.1 | 10.4 | 9.2 | 9.4 | 9.1 |
| 250 | coarse | 16 of 18 | 92% | 39 | 2 / 4 / 10 | 10.3 | 20.1 | 10.7 | 9.1 | 9.2 | 8.9 | 9.5 | 9.2 |
| 250 | wide | 6 of 6 | 100% | 64 | 1 / 2 / 4 | 11.9 | 14.7 | 13.9 | 13.6 | 13.5 | 13.0 | 14.0 | 13.3 |
| 500 | fine | 34 of 39 | 95% | 62 | 3 / 7 / 19 | 7.2 | 10.1 | 7.4 | 7.3 | 7.3 | 6.9 | 6.9 | 6.9 |
| 500 | coarse | 17 of 18 | 96% | 62 | 2 / 4 / 11 | 7.9 | 9.7 | 7.8 | 7.7 | 7.6 | 7.5 | 7.9 | 7.4 |
| 500 | wide | 6 of 6 | 100% | 106 | 1 / 2 / 4 | 13.4 | 13.7 | 13.2 | 13.1 | 13.1 | 12.9 | 12.9 | 13.0 |
| 1000 | fine | 37 of 39 | 98% | 113 | 3 / 7 / 22 | 5.5 | 6.3 | 5.7 | 5.7 | 5.7 | 5.8 | 5.3 | 5.4 |
| 1000 | coarse | 18 of 18 | 100% | 122 | 2 / 4 / 11 | 6.1 | 7.6 | 7.5 | 7.6 | 7.5 | 7.6 | 7.7 | 7.5 |
| 1000 | wide | 6 of 6 | 100% | 214 | 1 / 2 / 4 | 11.7 | 12.7 | 13.0 | 12.5 | 11.8 | 11.8 | 12.5 | 12.3 |
| 2000 | fine | 38 of 39 | 99% | 222 | 3 / 7 / 23 | 4.2 | 4.7 | 4.6 | 4.5 | 4.3 | 4.3 | 4.4 | 4.4 |
| 2000 | coarse | 18 of 18 | 100% | 256 | 2 / 4 / 11 | 5.5 | 5.7 | 5.6 | 5.6 | 5.6 | 5.5 | 5.5 | 5.5 |
| 2000 | wide | 6 of 6 | 100% | 428 | 1 / 2 / 4 | 11.4 | 11.3 | 11.4 | 11.4 | 11.3 | 11.4 | 11.4 | 11.4 |
| 4000 | fine | 39 of 39 | 100% | 383 | 3 / 7 / 22 | 4.3 | 4.9 | 4.7 | 4.6 | 4.2 | 4.3 | 4.3 | 4.3 |
| 4000 | coarse | 18 of 18 | 100% | 467 | 2 / 4 / 11 | 5.5 | 5.6 | 5.7 | 5.7 | 5.3 | 5.5 | 5.7 | 5.7 |
| 4000 | wide | 6 of 6 | 100% | 819 | 1 / 2 / 4 | 11.5 | 11.5 | 11.5 | 11.5 | 11.4 | 11.5 | 11.5 | 11.5 |

#### What the formal guarantee is worth

Basic composition (pure DP): a baby in C published cells of a statistic per release, R releases a year, spends epsilon x C x R per statistic per year. C measured on the 1000-baby instance (night_sleep_minutes; median / p90 of the babies' published cells; the generator's babies log 2-16 weeks, a baby logged for a whole year is in about 13 coarse cells). Bound on any attacker's advantage tanh(e / 2). A family of s babies spends s times as much.

| epsilon per cell and release | bound per cell and release | Schedule | C (median / p90) | epsilon per baby per year (median / p90) | bound per year (median baby) |
|---:|---:|---|---|---|---:|
| 0.5 | 0.24 | weekly, fine grid | 3 / 7 | 78 / 182 | 1.000 |
| 0.5 | 0.24 | monthly, coarse grid | 2 / 4 | 12 / 24 | 1.000 |
| 0.5 | 0.24 | quarterly, coarse grid | 2 / 4 | 4 / 8 | 0.964 |
| 0.5 | 0.24 | quarterly, wide grid | 1 / 2 | 2 / 4 | 0.762 |
| 1.0 | 0.46 | weekly, fine grid | 3 / 7 | 156 / 364 | 1.000 |
| 1.0 | 0.46 | monthly, coarse grid | 2 / 4 | 24 / 48 | 1.000 |
| 1.0 | 0.46 | quarterly, coarse grid | 2 / 4 | 8 / 16 | 0.999 |
| 1.0 | 0.46 | quarterly, wide grid | 1 / 2 | 4 / 8 | 0.964 |
| 2.0 | 0.76 | weekly, fine grid | 3 / 7 | 312 / 728 | 1.000 |
| 2.0 | 0.76 | monthly, coarse grid | 2 / 4 | 48 / 96 | 1.000 |
| 2.0 | 0.76 | quarterly, coarse grid | 2 / 4 | 16 / 32 | 1.000 |
| 2.0 | 0.76 | quarterly, wide grid | 1 / 2 | 8 / 16 | 0.999 |
| 3.0 | 0.91 | weekly, fine grid | 3 / 7 | 468 / 1092 | 1.000 |
| 3.0 | 0.91 | monthly, coarse grid | 2 / 4 | 72 / 144 | 1.000 |
| 3.0 | 0.91 | quarterly, coarse grid | 2 / 4 | 24 / 48 | 1.000 |
| 3.0 | 0.91 | quarterly, wide grid | 1 / 2 | 12 / 24 | 1.000 |

Runtime: 1555 s (12 worker processes).
