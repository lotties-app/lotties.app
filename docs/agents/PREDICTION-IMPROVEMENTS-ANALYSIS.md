# Prediction Engine Improvement Analysis (Workstream A)

**Engine version analysed**: `heuristic-1.1` (`PredictionEngine.cs:25`)
**Date**: 2026-11-15
**Scope**: Per-baby accuracy improvements and cross-baby learning integration

---

## A. Per-Baby Improvements (No Cross-Baby Data Needed)

### A1. Adaptive Look-Back Window

**Current state**: Fixed 14-day window (`PredictionOptions.cs:11`, `LookBack = TimeSpan.FromDays(14)`). The `InWindow` filter at `PredictionEngine.cs:50-54` discards everything outside this range unconditionally.

**Problem**: A 14-day window is too short for babies with sparse logging (e.g., diaper changes logged only a few times per week yield fewer than `MinimumSamples` gaps), and too long for babies undergoing rapid developmental transitions where data from two weeks ago is actively misleading.

**Proposed design**: Replace the fixed `LookBack` with an adaptive function that takes the sample density and variance stability as inputs.

```
AdaptiveLookBack(sampleCount, varianceRatio, minDays, maxDays) -> TimeSpan
```

**Triggers for extension** (beyond 14 days, up to `maxDays = 28`):
- When usable gap count after outlier removal (`SampleSelector.cs:45-54`) is below `MinimumBucketSamples` (5) but above zero, extend in 7-day increments until either enough samples are found or `maxDays` is reached.
- This directly addresses the cold-start problem within a single baby's history: a baby with 3 feeds per day has ~42 feeding gaps in 14 days (well above thresholds), but a baby whose parent logs only morning naps may have 7-10 nap gaps, right at the edge of `MinimumBucketSamples`.

**Triggers for shrinkage** (below 14 days, down to `minDays = 7`):
- When the coefficient of variation (CV) of the most recent 7 days of gaps exceeds 2x the CV of the full 14-day set, the older half is adding noise. Shrink to 7 days.
- This is a regime-change signal (see A3 below); the adaptive look-back acts as a coarse first pass before the finer regime detector kicks in.

**Edge cases**:
- Extension must never include events before the baby's birth date (already handled by `PredictionContext.BirthDate` at `PredictionContext.cs:9`).
- Extension beyond 14 days increases memory and computation linearly; at 28 days with 8 feeds/day the gap array is ~224 entries, well within bounds for the current O(n log n) sort in `WeightedStatistics.Quantile` (`WeightedStatistics.cs:13-21`).
- The bed-time predictor uses its own `BedTimeSampleCount = 14` (`PredictionOptions.cs:63`) independent of `LookBack`; adaptive look-back should not affect it unless explicitly opted in.
- Diaper predictions already use separate look-backs (`DiaperPredictionOptions.cs:18,24`: 7 days wet, 14 days dirty); adaptive logic would need per-statistic configuration.

**Implementation note**: The `PredictionOptions` record would gain `MinLookBack`, `MaxLookBack`, and `LookBackAdaptationEnabled` properties. The adaptation itself is a pure function over the gap array, preserving the purity constraint. The adapted value replaces `options.LookBack` inside `TypePredictor.Predict()` (`TypePredictor.cs:39-46`) before calling `_selector.Select()`.

### A2. Prediction Error Tracking

**Current state**: No error tracking exists. Predictions are computed and returned (`PredictionSet` at `Prediction.cs:67-76`) but never compared against actual outcomes. The `IPredictionHistoryRepository` (`IPredictionHistoryRepository.cs:7-14`) loads events for prediction input only; there is no write path for prediction outcomes.

**Proposed schema** (new Domain entity, stored via a new repository interface):

```csharp
record PredictionOutcome(
    Guid BabyId,
    EventTypeKey TypeKey,
    DateTimeOffset PredictedAt,      // when the prediction was made
    DateTimeOffset AnchorAt,         // the anchor the prediction used
    DateTimeOffset ExpectedNextStart,// the median prediction
    DateTimeOffset? ActualNextStart, // null until the next event of this type occurs
    TimeSpan? ErrorMinutes,          // |ActualNextStart - ExpectedNextStart|, null until resolved
    string EngineVersion,            // "heuristic-1.1" etc.
    int SampleCount,                 // samples behind the prediction
    AgeBand? AgeBand,
    DayPhase? Phase);
```

**MAE computation**: A pure Domain function over resolved `PredictionOutcome` records:

```csharp
static TimeSpan Mae(IReadOnlyList<PredictionOutcome> outcomes) =>
    TimeSpan.FromMinutes(outcomes
        .Where(o => o.ErrorMinutes is not null)
        .Average(o => o.ErrorMinutes!.Value));
```

Computed per `(TypeKey, AgeBand?, Phase?)` bucket, matching the existing narrowing dimensions in `SampleSelector.cs:23-43`.

**Feedback into parameter tuning**: The MAE by bucket becomes input to the auto-tuning loop (A4). Crucially, the feedback is **not** applied during prediction (which stays pure); it is applied between prediction runs by producing a new `PredictionOptions` instance that the Application layer passes in.

**Storage considerations**: Outcomes are written asynchronously after the next event of the same type arrives (or after a timeout marking the prediction as unresolved). This is an Application-layer concern; the Domain only defines the entity and the MAE function.

### A3. Regime Change Detection

**Current state**: Recency weighting (`WeightedStatistics.RecencyWeight` at `WeightedStatistics.cs:58-59`) with a 4-day half-life smoothly downweights older data, but cannot distinguish a gradual drift from a sudden regime change (sleep regression, growth spurt, introduction of solids). After a regime change, the 4-day half-life still gives substantial weight to pre-change data for several days.

**Proposed algorithm**: CUSUM (Cumulative Sum Control Chart) on the gap series, computed as a pure function.

1. Compute the running mean of gaps over a baseline window (e.g., the oldest 7 days of the current look-back).
2. For each subsequent gap, accumulate the deviation from the baseline mean: `S[i] = max(0, S[i-1] + (gap[i] - baselineMean - slack))`.
3. When `S[i]` exceeds a threshold (e.g., 3x the baseline standard deviation), flag a regime change at index `i`.
4. After a flagged change, set the effective recency half-life to 1 day for the transition period (3-5 days), then ramp back to the configured half-life.

**Integration point**: Inside `TypePredictor.Predict()` (`TypePredictor.cs:39-46`), after `_strategy.CollectGaps()` returns the raw gaps and before `_selector.Select()` narrows them. The regime detector inspects the chronological gap sequence and, if a change is detected, returns an adjusted half-life that `WeightedStatistics.Quantile` receives via the options.

**Reweighting strategy**: Rather than discarding pre-change data entirely (which would drop sample count below thresholds), apply a secondary weight multiplier: gaps before the change point get multiplied by `0.1`, effectively removing their influence while keeping them in the array for count purposes. This avoids the cliff effect of truncation.

**Sleep regressions specifically**: The awake-window strategy (`AwakeWindowStrategy` at `NextStartStrategies.cs:24-52`) collects wake-to-next-sleep gaps. A sleep regression manifests as a sudden increase in these gaps. The CUSUM on awake windows detects this directly. Growth spurts manifest as increased feeding frequency (decreased start-to-start gaps); the same algorithm on feeding gaps catches them.

**Edge cases**: 
- With fewer than 7 baseline gaps, skip detection (too noisy).
- Multiple regime changes in one look-back window: use the most recent one.
- The detector must be deterministic and order-independent (sort gaps by `.At` first, which they already are from `CollectGaps`).

### A4. Parameter Auto-Tuning

**Tunable parameters** (all in `PredictionOptions.cs`):

| Parameter | Current Default | Tuning Signal | Safe Range |
|-----------|----------------|---------------|------------|
| `RecencyHalfLife` (line 14) | 4 days | Minimise MAE (A2) on recent predictions vs older ones | 1-10 days |
| `OutlierFactor` (line 32) | 3.0 | Ratio of false-positive outlier drops to true-positive drops (from error tracking: did a dropped gap match the next actual?) | 2.0-5.0 |
| `MinimumBucketSamples` (line 20) | 5 | Balance between specificity (narrow band/phase) and having enough data; tune by comparing MAE of narrowed vs widened predictions | 3-10 |
| `WindowLowerQuantile` / `WindowUpperQuantile` (lines 35-38) | 0.25 / 0.75 | Calibration: share of actual next starts falling inside the predicted window; target ~50% for the middle half | 0.15-0.35 / 0.65-0.85 |

**Convergence safeguards**:
- **Bounded updates**: Each tuning cycle adjusts a parameter by at most 10% of its safe range. No single cycle can jump from 4-day to 10-day half-life.
- **Minimum evidence**: Tuning requires at least 30 resolved prediction outcomes in the relevant bucket. Below that, the default stands.
- **Monotonicity guard**: If MAE increased after the last adjustment, revert to the previous value and halve the step size.
- **Per-baby isolation**: Tuned parameters are stored per baby, never shared. One baby's erratic logging does not shift another's defaults.
- **Version pinning**: Tuned parameters carry the engine version they were optimised for. A heuristic version bump resets tuning to defaults.

**Implementation architecture**: A new pure function `TuneParameters(currentOptions, outcomes) -> PredictionOptions` in the Domain. It takes the current options and the resolved outcomes, returns new options. The Application layer calls it periodically (e.g., daily) and stores the result. The prediction call site passes the tuned options instead of `PredictionOptions.Default`.

---

## B. Cross-Baby Integration (Depends on Community Insights T5-T8)

### B1. Bayesian Blending Formula

The community catalog (design 34 section 4) publishes per-age-band statistics. For prediction parameters, the relevant outputs are **percentiles of per-baby medians** (currently deferred from v1, section 5.1) and **shares** (crying causes, tier A).

When percentile statistics become available, the blending formula for a prediction parameter theta (e.g., median awake window) is:

```
posterior_median = (community_prior * prior_weight + individual_median * individual_weight) 
                   / (prior_weight + individual_weight)
```

Where:
- `community_prior` = the published p50 for the baby's current age band and dimension
- `individual_median` = the baby's own recency-weighted median from `WeightedStatistics.WeightedMedian` (`WeightedStatistics.cs:23-24`)
- `prior_weight` = f(individual_sample_count) (see B2)
- `individual_weight` = individual_sample_count

This is a conjugate normal-normal update approximation. The community distribution provides the prior mean and variance; the individual data provides the likelihood.

### B2. Weight Function

The prior weight should decay as individual evidence accumulates:

```
prior_weight(n) = max_weight * exp(-n / half_influence)
```

Where:
- `n` = individual sample count (gaps) in the current age band
- `max_weight` = equivalent sample count of the community prior (e.g., 10, meaning the prior counts as much as 10 individual observations at n=0)
- `half_influence` = the sample count at which the prior's influence halves (e.g., 15)

At n=0: prior_weight = 10 (full cold-start benefit)
At n=15: prior_weight = 5 (equal to individual data)
At n=30: prior_weight = 1.35 (individual dominates)
At n=50: prior_weight = 0.36 (effectively negligible)

**Calibration**: `max_weight` and `half_influence` should themselves be tunable per statistic type. Sleep rhythms are more universal (higher prior weight warranted); diaper patterns are more individual (lower prior weight).

### B3. Catalog-to-Parameter Mapping

| Community Statistic (catalog key) | Prediction Parameter Affected | Mechanism |
|-----------------------------------|-------------------------------|-----------|
| `night_sleep_minutes` p50 | `DurationEstimator` for night sessions (`DurationEstimator.cs:15-25`) | Prior on typical night duration; blended with individual median |
| `naps_per_day` p50 | Indirectly affects awake window expectations | More naps = shorter awake windows; could inform `RecencyHalfLife` for sleep (faster adaptation expected at high-nap ages) |
| `bottle_ml_per_feed` p50 | Feeding interval expectations (larger feeds = longer intervals) | Prior on feeding gap median via `StartIntervalStrategy` (`NextStartStrategies.cs:55-68`) |
| `cry_outcome_by_cause` shares | Not a prediction parameter directly; informs the crying pattern feature (separate workstream) | N/A for predictions |
| `tummy_minutes_per_day` share of days | Not a prediction parameter | N/A |

**Key gap**: The current community catalog does not publish **interval distributions** (time between feeds, awake window lengths). It publishes per-day aggregates (naps per day, night sleep minutes). To directly inform prediction gaps, either:
1. Add new catalog entries for interval percentiles (requires extending the aggregation pipeline), or
2. Derive approximate interval priors from per-day counts (e.g., 4 naps/day with 12h awake time implies ~3h awake windows), accepting the loss of precision.

Option 2 is viable for v1 and can be implemented as a pure function in the Domain.

### B4. Cold-Start Improvement Estimate

From the synthetic study (`ml/benchmark/community.py`):
- At 10,000 babies, 20% opt-in, epsilon 0.2: pooled median error for night sleep was 70-180 minutes worse than the published-norms prior (section 5.1, line 231-233). This means **at epsilon 0.2, pooled percentiles are worse than norms for cold start**.
- At epsilon 5-10: pooled median error matched exact (night sleep 8-9 min vs 7.5 exact; bottles 5-6 ml vs 5.1 exact). At these epsilons, cold-start MAE improved over the prior.
- The tummy-time share of days (tier B, relaxed epsilon) was not simulated but shares are more robust to noise than percentiles.

**Practical estimate**: With percentile statistics deferred from v1, the immediate cold-start improvement comes from:
1. **Published norms** (`code/api/data/age-norms.json`) already serve as a static prior. The prediction engine currently ignores them. Integrating norms as a fallback when `sampleCount < MinimumSamples` would provide immediate cold-start value without any community infrastructure.
2. **Crying cause shares** (tier A, available in v1): useful for the crying pattern feature, not for timing predictions.
3. **Future percentile availability**: when the noise budget allows (epsilon 5+ or a better mechanism), expect cold-start MAE reduction of 20-40% for night sleep duration and feeding intervals based on the synthetic study's exact-vs-prior deltas.

---

## C. Implementation Risks and Safeguards

### C1. Purity Constraint

**Rule**: All prediction logic in `Lotties.Domain/Predictions/` must remain pure functions with no I/O. This is enforced architecturally: the Domain project has no dependency on EF Core, HTTP clients, or file systems.

**How new features respect this**:
- **Error tracking**: The `PredictionOutcome` entity is a Domain record. Computing MAE is a static method. Writing outcomes to storage happens in the Application layer via a new `IPredictionOutcomeRepository` interface injected at the orchestrator level, never called from within `PredictionEngine.Predict()`.
- **Auto-tuning**: `TuneParameters(options, outcomes) -> options` is a pure function. The Application layer calls it on a schedule and stores the result. The prediction call receives the tuned options as a parameter.
- **Regime detection**: Pure function over the gap array. No external state.
- **Community prior blending**: The prior values are passed as parameters to the prediction function (e.g., a new optional `CommunityPrior?` parameter on `PredictionOptions`). Fetching the prior from the API/file is the Application layer's job.
- **Adaptive look-back**: Pure function over the gap array and sample counts. The adapted look-back is computed inside `TypePredictor.Predict()` before any selection.

### C2. Backward Compatibility and Versioning

**Current versioning**: `PredictionEngine.Version = "heuristic-1.1"` (`PredictionEngine.cs:25`). Every `PredictionSet` carries `EngineVersion` (`Prediction.cs:75`).

**Versioning strategy for changes**:
- **Minor parameter tweaks** (e.g., changing `OutlierFactor` default from 3.0 to 2.8): stay at `heuristic-1.1`. Document in changelog. Existing stored predictions remain valid.
- **New signals** (regime detection, adaptive look-back): bump to `heuristic-1.2`. Old predictions retain their version; new predictions use the new version. The `PredictionReason` record (`PredictionReason.cs:15-23`) gains optional fields (e.g., `RegimeChangeDetected`, `EffectiveLookBack`) that are null for old-version predictions.
- **Structural changes** (Bayesian blending, new prediction types): bump to `heuristic-2.0`. The `PredictionSet` shape may change; consumers (web app at `predictionModel.ts`) must handle both versions during migration.
- **Per-baby tuned parameters**: Stored alongside the baby profile, keyed by engine version. A version bump resets to defaults. The tuned parameters are serialised as a JSON blob in the database, not as a schema migration.

**Web compatibility**: The web `readBasis` function (`predictionModel.ts:70-82`) already handles unknown fields gracefully (returns null for missing keys). New basis fields should be additive. The `describeReason` function (`predictionModel.ts:88-122`) builds text from structured parts and falls back to the server's English `reason` string when basis is unavailable, providing backward compatibility automatically.

### C3. Test Strategy

**New test categories needed**:

1. **Adaptive look-back tests** (in `PredictionEngineTests.cs`):
   - Sparse data extends look-back beyond 14 days
   - High-variance recent data shrinks look-back below 14 days
   - Extension respects birth date boundary
   - Disabled adaptation behaves identically to current engine

2. **Error tracking tests** (new file `PredictionOutcomeTests.cs`):
   - MAE computation over known outcomes
   - Unresolved predictions excluded from MAE
   - Per-bucket MAE segmentation matches `SampleSelector` dimensions

3. **Regime detection tests** (new file `RegimeDetectionTests.cs`):
   - Sudden gap increase triggers detection
   - Gradual drift does not trigger false positive
   - Fewer than 7 baseline gaps skips detection
   - Post-regime half-life adjustment produces correct weighted median

4. **Auto-tuning tests** (new file `ParameterTuningTests.cs`):
   - Bounded update: parameter moves at most 10% of range per cycle
   - Revert on MAE increase
   - Minimum evidence threshold respected
   - Version mismatch resets to defaults

5. **Community prior blending tests** (new file `CommunityPriorTests.cs`):
   - Zero individual samples returns prior unchanged
   - High individual sample count ignores prior
   - Prior weight decays exponentially with sample count
   - Null prior falls back to current behaviour

6. **Regression tests**: Every existing test in `PredictionEngineTests.cs` (lines 10-316) must continue to pass with default options. The adaptive/tuning features are opt-in via new `PredictionOptions` properties; defaults reproduce current behaviour exactly.

### C4. Performance Impact

**Current complexity**: `PredictionEngine.Predict()` processes events in O(n log n) where n is the event count in the look-back window. The dominant cost is sorting in `WeightedStatistics.Quantile` (`WeightedStatistics.cs:16`).

**Impact of adaptive look-back (up to 28 days)**:
- Worst case: 2x events. At 8 feeds/day + 5 naps/day = 13 events/day, 28 days = 364 events vs 182 at 14 days. Sorting 364 items is negligible (< 1ms on modern hardware).
- Memory: `TimedSample` is a readonly struct (16 bytes). 364 samples = ~5.7 KB. No concern.

**Impact of regime detection**:
- CUSUM is O(n) over the gap array. Adds one linear pass before the existing sort. Negligible.

**Impact of error tracking**:
- Zero impact on prediction latency. Outcome resolution is asynchronous. MAE computation is offline.

**Impact of auto-tuning**:
- Zero impact on prediction latency. Tuning runs on a schedule, not inline.

**Impact of community prior blending**:
- Lookup of the prior is O(1) (dictionary by age band). Blending is arithmetic. Negligible.

**Conclusion**: None of the proposed changes introduce meaningful latency risk. The engine remains suitable for real-time prediction on every page load.

---

## Summary of Dependencies

| Improvement | Depends On | Can Start Now? |
|-------------|-----------|----------------|
| Adaptive look-back | Nothing | Yes |
| Error tracking schema | New DB table + repository | Yes (Domain entity now, infra later) |
| Regime detection | Error tracking (for validation only) | Yes (detection itself is standalone) |
| Parameter auto-tuning | Error tracking | Partially (structure now, needs outcomes for real tuning) |
| Norms-based cold start | `age-norms.json` (exists) | Yes |
| Community prior blending | T5 (aggregation job), T6 (endpoint), percentile stats (deferred) | No (blocked on community infrastructure) |
| Crying shares integration | T5, T6 (tier A available in v1) | Partially (available when T5-T6 ship) |

**Recommended implementation order**: Adaptive look-back -> Error tracking -> Regime detection -> Norms-based cold start -> Parameter auto-tuning -> Community prior blending (when unblocked).