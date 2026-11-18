# 34b. Community insights: Tier-B epsilon for percentile outputs (design, 2026-11-18)

Status: **draft, not active.** This document describes the proposed Tier-B differential privacy parameters for
percentile statistics that are deferred from v1 (docs/design/34-community-insights.md section 5.1). Nothing here is
built or served; activation requires owner approval, lawyer review of the relaxed tier, and a new synthetic study run
that covers these outputs at the proposed epsilon.

Related documents: docs/design/34-community-insights.md (design, sections 4, 5, 5.1), docs/ml/COMMUNITY-SYNTHETIC.md
(synthetic study findings), `ml/benchmark/community.py` (benchmark code), docs/design/34a-community-insights-ripd.md
(RIPD draft, section 7.2 item 11), docs/agents/COPPA-ASSESSMENT.md (US considerations).

## 1. Why Tier B exists

The owner decision of 2026-11-11 (design 34 section 5.1, O2) established two noise tiers:

- **Tier A (strict):** epsilon 0.2 per statistic per weekly release, only for statistics shown to survive that noise
  (crying cause shares in v1).
- **Tier B (relaxed):** epsilon about 5 per statistic per weekly release, for non-percentile statistics that do not
  survive Tier A (tummy-time share of days in v1).

Percentile outputs (medians, p10-p90 bands, p3/p97, ratio percentiles) were deferred entirely because the synthetic
study found them unusable at epsilon 0.2: the exponential mechanism over a 10 ml or 10 minute grid produced errors of
54-76 ml for bottle medians, 50-60 minutes for tummy time medians, and 70-180 minutes for night sleep medians at cells
of 20-99 babies, making the cold-start MAE worse than the published-norms prior everywhere.

This document proposes extending Tier B to cover those percentile outputs, with the understanding that:

1. The formal privacy guarantee at epsilon 5 is weak (section 3).
2. Lawyer approval of the relaxed tier is required before activation (design 34 section 5.1, RIPD section 7.2 item 11).
3. A new synthetic study must confirm utility at this epsilon before any percentile output is promoted (design 34
   section 9).

## 2. Statistics requiring Tier B

All percentile outputs currently marked `notInV1` in the catalog (`code/api/data/community-statistics.json`) and in
design 34 section 5.1:

| Statistic key | Percentile outputs | Current status | Tier-B candidate |
| --- | --- | --- | --- |
| `bottle_ml_per_feed` | p10, p25, p50, p75, p90 of ml per feed; median bottles per day | notInV1 | yes |
| `growth_vs_age` | p3, p15, p50, p85, p97 | notInV1 (O6: WHO curves first) | no (excluded by O6 regardless of noise) |
| `tummy_minutes_per_day` | p25, p50, p75 minutes | notInV1 | yes |
| `naps_per_day` | p10..p90 | notInV1 | yes |
| `day_sleep_minutes` | p10..p90 | notInV1 | yes |
| `night_sleep_minutes` | p10..p90 | notInV1 | yes |
| `feeds_per_day` | p10..p90 | notInV1 | yes |
| `diapers_per_day` | p10..p90 | notInV1 | yes |
| `routine_shift_scale` | p90, p97 of the shift ratio | notInV1 | yes |

Growth (`growth_vs_age`) remains excluded by owner decision O6 (WHO curves first) regardless of noise tier; it is not
a Tier-B candidate.

The tummy-time share of days and crying cause shares remain in their originally assigned tiers (B and A respectively)
and are unaffected by this proposal.

## 3. Epsilon value and composition

### 3.1 Proposed value

**Epsilon = 5.0 per statistic per weekly release**, matching the existing Tier-B value for non-percentile statistics.

### 3.2 Justification from the synthetic study

The sweep in `ml/benchmark/community.py` (10 000 babies, 20% opt-in, seed 1) measured the following errors for
percentile outputs at various epsilon values:

| Output | Exact error | Error at eps=0.2 | Error at eps=5 | Error at eps=10 |
| --- | --- | --- | --- | --- |
| Bottle median (ml) | 5.1 | 54-76 | 6.0 | 5.1 |
| Night sleep median (min) | 7.5 | 70-180 | 9.0 | 8.3 |
| Tummy time median (min) | 1.0 | 50-60 | 1.2 | 1.1 |

At epsilon 5, bottle and tummy-time medians approach exact accuracy; night sleep is within 1.5 minutes of exact. Below
epsilon 5, errors grow rapidly and exceed the published-norms prior. Epsilon 5 is the lowest value at which the pooled
percentiles consistently beat the norms on the synthetic cohort.

### 3.3 Yearly budget and formal guarantee

By basic composition, a baby present in every weekly release spends approximately **260 epsilon per statistic per year**
(52 weeks x 5.0). The withdrawal advantage bound under differential privacy is tanh(epsilon / 2):

- At epsilon 0.2 (Tier A): tanh(0.1) ~ 0.10 (strong formal protection against differencing).
- At epsilon 5.0 (Tier B): tanh(2.5) ~ 0.99 (close to no formal bound against differencing).

**The formal guarantee at Tier B is weak and must be stated as such.** At this level, the practical protections against
membership inference are k-suppression (k = 20 distinct babies from 20 distinct families), per-family contribution
caps, clipping to published ranges, dominance suppression, complementary suppression, hysteresis (publish at 20,
suppress at 18 once published), and weekly (not nightly) release cadence. The DP noise blurs small differences between
releases but does not provide a meaningful worst-case bound against an attacker who can observe many releases.

This is consistent with the existing Tier-B treatment of the tummy-time share of days (design 34 section 5.1).

## 4. Exponential mechanism for percentile noise

Percentile outputs use the **exponential mechanism** rather than Laplace noise, because percentiles are not numeric
queries with bounded sensitivity in the usual sense. The mechanism selects a value from a fixed discrete grid (e.g.,
10 ml steps for bottle amounts, 10 minute steps for durations) with probability proportional to a quality score.

### 4.1 Formula

Given a candidate grid G = {g_1, g_2, ..., g_m}, a dataset D, and a quality function q(D, g) that scores how well
candidate g fits the data (e.g., negative absolute deviation from the true percentile rank), the exponential mechanism
selects g_i with probability:

    P(g_i) = exp(epsilon * q(D, g_i) / (2 * Delta_q)) / Z

where:
- epsilon is the privacy parameter (5.0 for Tier B),
- Delta_q is the sensitivity of the quality function (the maximum change in q when one baby's summary is added or
  removed; bounded by the per-baby cap and clipping),
- Z = sum_j exp(epsilon * q(D, g_j) / (2 * Delta_q)) is the normalizing constant.

### 4.2 Grid and sensitivity

- **Grid:** fixed, published, independent of the data. Bottle amounts: 0, 10, 20, ..., 400 ml. Durations: 0, 10, 20,
  ..., 960 minutes (16 hours). Band edges are never derived from the data.
- **Quality function:** for the p-th percentile, q(D, g) = -|rank(g, D) - p|, where rank(g, D) is the fraction of
  per-baby summaries at or below g. Sensitivity Delta_q = 1/n where n is the number of distinct babies in the cell
  (after capping), bounded below by 1/k = 1/20.
- **Per-baby input to the quality function:** one summary value per baby per band (the baby's own median for the band),
  so a family logging 30 bottles a day weighs the same as one logging 5.

### 4.3 Splitting epsilon across multiple percentiles

When a statistic publishes multiple percentiles (e.g., p10, p25, p50, p75, p90), the total epsilon budget of 5.0 is
split equally across them. For five percentiles, each receives epsilon = 1.0. The synthetic study results in section
3.2 used this splitting; the reported errors reflect the per-percentile budget, not the full 5.0 applied to each.

## 5. Activation prerequisites

Before any Tier-B percentile output is served:

1. **Lawyer review of the relaxed tier** (design 34 section 5.1, RIPD section 7.2 item 11): the lawyer must confirm
   that epsilon 5.0 per statistic per weekly release, with its weak formal guarantee, may be described in the policy
   and consent text as a safeguard, and that the stated practical protections (k, caps, clipping, dominance,
   suppression, hysteresis) are sufficient for children's sensitive health data under LGPD art. 14.
2. **New synthetic study run** covering all Tier-B percentile candidates at epsilon 5.0 with the splitting described
   in section 4.3, using the updated benchmark (`ml/benchmark/community.py`). The study must show that each candidate
   beats the published-norms prior on cold-start MAE with a 95% bootstrap CI above zero (design 34 section 9, promotion
   rule).
3. **Pilot backtest** on real volunteered data (design 34 section 9) confirming the synthetic study's findings.
4. **Owner decision** to promote specific percentile outputs from "notInV1" to active, recorded in design 34 section
   5.1 and the catalog.
5. **Policy and consent text update** (design 34 section 12, task T9): the policy section states the final epsilon
   tiers including Tier-B percentiles, the weak formal guarantee is stated plainly, and the consent text version is
   bumped (re-consent required).
6. **Catalog update**: `code/api/data/community-statistics.json` validator accepts epsilon > 1 for Tier-B entries,
   supports per-output tiers, and marks promoted outputs accordingly.

## 6. COPPA cross-reference

For US users, the COPPA assessment (docs/agents/COPPA-ASSESSMENT.md section 2.4) recommends not launching Community
Insights for US users until COPPA applicability is resolved with counsel. If COPPA applies, aggregated statistics
derived from children's health data could constitute "disclosure" under COPPA if re-identifiable. The Tier-B epsilon's
weak formal guarantee makes this consideration more acute than for Tier-A statistics. No Tier-B percentile output
should be served to US users until COPPA counsel confirms compliance.

## 7. Route convention note

The serving endpoint uses the path `/api/v1/community/statistics/{statisticKey}` (no hyphen in `community`), per the
owner's route naming preference. Design 34 section 6 references this path.