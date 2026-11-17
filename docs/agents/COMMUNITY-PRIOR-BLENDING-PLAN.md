# Community Prior Blending Plan

**Generated**: 2026-11-17
**Source**: Multi-agent workflow (3 researchers, 3 senior developers, 2 reviewers, 1 orchestrator)
**Status**: Approved for Phase 0 implementation

---

## Unified Implementation Plan: Community Prior Blending for Lotties

### Executive Summary

This plan synthesizes three architecture proposals and six adversarial reviews into a phased, privacy-safe implementation of community prior blending. The strategy adopts the **Phase 0 / Phase 1 split** to decouple immediate value from legal/infrastructure risk, integrates the **IPriorProvider abstraction**, and incorporates the **BlendedPrior continuous weighting** model as a Phase 1 enhancement after validation. All reviewer concerns are addressed through explicit design decisions, feature flags, monitoring, and backward-compatible schema evolution.

---

### Phase 0: Static Community Priors + IPriorProvider Abstraction (Weeks 1-2)

**Goal**: Ship immediate cold-start improvement using synthetic-derived static priors, establish the provider abstraction, and enable safe experimentation without live aggregation infrastructure or legal approvals.

#### Step 0.1: Catalog Reconciliation (Day 1-2)

- **Source**: Reviewer concern that catalog contradicts O2 decision.
- **Action**: Update `code/api/data/community-statistics.json` to mark all percentile outputs (`bottle_ml_per_feed`, `naps_per_day`, `day_sleep_minutes`, `night_sleep_minutes`, `feeds_per_day`, `diapers_per_day`, `routine_shift_scale`) as `notInV1: true` with `notInV1Reason` citing O2. Only `cry_outcome_by_cause` (shares) and optionally `tummy_minutes_per_day.share_of_days_with_any` remain eligible for Phase 0.
- **Validator update**: Extend `CommunityStatisticsValidator.cs` to accept `epsilon` as either a number (v1) or an object `{tierA: decimal, tierB: decimal}` (v2). Maintain backward compatibility: v1 parser treats numeric epsilon as tierA. Add unit tests in `CommunityStatisticsValidatorTests.cs`.
- **Files**: `code/api/data/community-statistics.json`, `code/api/src/Lotties.Domain/CommunityInsights/CommunityStatisticsValidator.cs`, `code/api/tests/Lotties.Domain.Tests/CommunityInsights/CommunityStatisticsValidatorTests.cs`.

#### Step 0.2: ColdStartPrior Extension with Backward Compatibility (Day 2-3)

- **Source**: All proposals; Reviewer concerns about breaking changes.
- **Action**: Extend `ColdStartPrior` record with optional fields using default values to preserve positional constructor compatibility:

```csharp
internal sealed record ColdStartPrior(
    EventTypeKey TypeKey,
    TimeSpan MedianGap,
    TimeSpan? TypicalDuration,
    int AgeDays,
    string Metric,
    PriorOrigin Origin = PriorOrigin.PublishedNorm,
    double? PriorWeight = null,
    double? PriorLogSd = null);
```

- **New enum**: `PriorOrigin { PublishedNorm, CommunityStatic, CommunityLive }` in same file.
- **Factory method**: Add `ColdStartMetrics.FromCommunityStatic(...)` parallel to `FromNorm`.
- **Enumeration of construction sites**: Confirmed via grep: `ColdStartPrior.cs` (line 52), `PredictionEngine.cs` (lines 81, 95), `TypePredictor.cs` (line 104), `ColdStartPriorTests.cs`. All use `FromNorm` or direct construction with 5 args; defaults make new fields non-breaking.
- **Test migration**: Add new test cases in `ColdStartPriorTests.cs` verifying Origin/Weight serialization, equality, and factory methods. Existing tests pass unchanged due to defaults.
- **Files**: `code/api/src/Lotties.Domain/Predictions/ColdStartPrior.cs`, `code/api/tests/Lotties.Domain.Tests/Predictions/ColdStartPriorTests.cs`.

#### Step 0.3: IPriorProvider Abstraction + CompositePriorProvider (Day 3-5)

- **Source**: All proposals; Reviewer approval of architectural soundness.
- **Action**:
  - Create `IPriorProvider` interface in `Lotties.Domain/Predictions/IPriorProvider.cs`:

```csharp
public interface IPriorProvider {
    ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays);
}
```

  - Create `AgeNormPriorProvider` (wraps existing `AgeNormSet.PriorFor` logic).
  - Create `CommunityStaticPriorProvider` (loads embedded `community-priors.json`, applies `IsUsableAsPrior` gate: k>=20, dominance<25%, epsilon-tier approved).
  - Create `CompositePriorProvider` in Application layer: chains providers in priority order. **Phase 0 priority: PublishedNorm > CommunityStatic** (per Reviewer correction; synthetic priors are noisier than curated norms for most metrics). Phase 1 will reverse to CommunityLive > CommunityStatic > PublishedNorm.
  - **Feature flag**: Add `PredictionOptions.UseCommunityStaticPriors` (default `true`) as independent kill switch. When false, CompositePriorProvider skips CommunityStatic entirely.
- **PredictionEngine refactor**: Change `Predict` signature to accept `IReadOnlyList<IPriorProvider>? priorProviders = null` alongside existing `AgeNormSet? ageNorms = null`. When `priorProviders` is provided, use it; otherwise fall back to `ageNorms` for backward compatibility. This avoids breaking every caller. Add overload shim if needed.
- **ColdStartSupportedTypes**: Make configurable via `PredictionOptions.ColdStartTypeKeys` HashSet. Default remains `{Feeding}` for Phase 0.
- **Files**: New files `IPriorProvider.cs`, `AgeNormPriorProvider.cs`, `CommunityStaticPriorProvider.cs` in Domain/Predictions; `CompositePriorProvider.cs` in Application/Predictions; modify `PredictionEngine.cs`, `PredictionOptions.cs`.

#### Step 0.4: Static Prior File Generation + Embedding (Day 4-6)

- **Source**: Proposal 3; Reviewer build-time safety concern.
- **Action**:
  - Create script `ml/benchmark/generate_static_priors.py` that reads synthetic study output (`ml/benchmark/community.py` results), filters to tier-A eligible statistics only, and writes `code/api/data/community-priors.json`.
  - **Build-time guard**: Add CI check (GitHub Actions step) asserting `community-priors.json` was generated from synthetic fixtures only (verify script input path is under `ml/benchmark/` and not a database export). Script includes assertion at top.
  - **Schema**: Mirror `age-norms.json` structure with `GeneratedAt`, `ReviewBy` (yearly cycle), `SchemaVersion`. Include provenance metadata (synthetic study parameters, sample size, confidence intervals).
  - **Embedding**: Add as embedded resource in `Lotties.Application.csproj`; load via `CommunityStaticPriorProvider` at startup with validation.
  - **Per-metric promotion gates**: Each statistic must pass synthetic-study threshold (cold-start MAE improvement over norms with CI below zero) before inclusion. Document gates in `docs/design/34-community-insights.md`.
- **Files**: `ml/benchmark/generate_static_priors.py`, `code/api/data/community-priors.json`, `code/api/src/Lotties.Application/Predictions/CommunityStaticPriorProvider.cs`, `.github/workflows/ci.yml` (new step).

#### Step 0.5: Prediction API Origin Metadata + Web Display (Day 5-7)

- **Source**: Reviewer user trust concerns.
- **Action**:
  - Add `Origin` field to `Prediction` record (Domain) and `PredictionsResponse` (Application). Serialize as string enum.
  - Add i18n strings in `code/web/src/i18n/locales/en/predictions.json` and `pt-BR/predictions.json`: explain "community-static" means synthetic study, not real families, used only when baby has insufficient data. Distinct from future "community-live" string.
  - Web component: Display origin badge next to prediction confidence. Link to community insights settings page.
  - **Doctor role**: Predictions seeded by community priors are NOT filtered (prior is aggregated/non-identifiable). Document in `EndpointRoleMatrixTests` row for prediction endpoint.
- **Files**: `Prediction.cs`, `PredictionsResponse.cs`, locale JSON files, web prediction display component, `EndpointRoleMatrixTests.cs`.

#### Step 0.6: Monitoring + Observability (Day 6-8)

- **Source**: Reviewer operational concerns.
- **Action**:
  - **Metrics**: (1) Daily count of predictions using CommunityStatic origin (structured log + metric). (2) Rolling MAE comparison: once baby accumulates >= MinimumSamples personal data, compare CommunityStatic-seeded prediction vs subsequent personal prediction. Log degradation.
  - **Alerts**: Alert if CommunityStatic MAE exceeds published-norm MAE by >10% sustained 48h. Alert if `UseCommunityStaticPriors` disabled unexpectedly.
  - **Health endpoint**: `/health/community-priors` returning static prior file version, GeneratedAt, load status.
  - **Rollback**: Setting `UseCommunityStaticPriors=false` reverts to norms-only within one API restart. Document in runbook.
- **Files**: New health endpoint, structured logging in `CompositePriorProvider`, monitoring config.

#### Step 0.7: Tests + Validation (Throughout)

- Unit tests for `IPriorProvider` implementations, `CompositePriorProvider` priority logic, feature flag behavior.
- Integration test: BYO-database exclusion verification. Use test fixture with both hosted and BYO babies; assert CommunityStaticPriorProvider returns null for BYO.
- Snapshot test migration: Regenerate prediction snapshots with new Origin field. Document one-time command.
- **PredictionEngine.Version**: Bump to `heuristic-1.2` only after all tests pass.

---

### Phase 1: Live Aggregation Pipeline (Weeks 3-6, post-legal)

**Prerequisites**: Lawyer approval of tier-B epsilon, consent text version bump, RIPD finalization, pilot backtest on Phase 0 static priors showing positive signal.

#### Step 1.1: Catalog Schema v2 + Validator (Week 3)

- Finalize tiered epsilon format. Mark percentile outputs as `notInV1` until tier-B approved.
- Deploy validator accepting both v1 and v2 during transition window. Cutover sequence: deploy validator first, update catalog file, enable v2-only validation.

#### Step 1.2: Aggregation Job (T5) (Week 3-4)

- **Source**: Proposal 1, 3; Reviewer concerns.
- **Components**: `CommunityAggregationJob` (IHostedService, weekly timer). Reads opted-in babies via `ICommunityConsentRepository.BabiesInForceAsync`. Applies clipping, per-baby cap (14 days/cell), family dominance suppression (>25%), k-suppression with hysteresis (20->18), tiered DP noise (tier A Laplace 0.2, tier B exponential mechanism >=5.0 pending approval).
- **Transactional writes**: Write to staging table, swap via rename. Use `release_id` as idempotency key.
- **Consent snapshot**: Snapshot consent state at job start time to prevent race condition with mid-run withdrawal.
- **BYO exclusion**: Enforce via `IStoreScope` fail-closed contract. Integration test with mixed fixture.
- **Observability**: Structured logging (included/excluded counts, duration, failures). Alert on missed weekly run or >50% unexpected suppression. Health endpoint `/health/community-statistics` with last successful run timestamp, release age, suppression ratio.
- **Rollback**: Retain exactly two releases (current + previous) with `release_sequence` column. Admin endpoint to trigger rollback. Document manual procedure.
- **Staleness**: Configurable `max_release_age_days` (default 14). CompositePriorProvider falls back to norms when exceeded; logs warning. Expose release age in serving endpoint metadata.
- **Files**: New `CommunityAggregationJob.cs`, `CommunityStatisticsRelease.cs` entity, EF migration, repository, health endpoint.

#### Step 1.3: Serving Endpoint (T6) (Week 4)

- `GET /api/v1/community-statistics/{statisticKey}`: Returns latest release for caller's baby's age band. Gated by `CommunityInsights:Enabled` + caller consent. ETag-cached. Never queryable by baby.
- **Rate limiting**: Max N requests/account/hour. Exclude demo accounts. Log anomalous cross-account patterns.
- **Transparency**: Distinguish "no data yet" vs "suppressed for privacy" in response. Include confidence/sample-size-range indicator (e.g., "20-49 families"). Feedback mechanism for reporting suspicious numbers.
- **Files**: New endpoint, rate limiter config, response DTOs.

#### Step 1.4: BlendedPrior Integration (Week 4-5)

- **Source**: Proposal 2; Reviewer statistical concerns.
- **Action**: Implement `BlendedPrior.Blend` in Domain using conjugate-normal shrinkage math from `ml/benchmark/models.py Shrinkage.posterior`. Continuous weight function driven by effective sample size and prior variance.
- **Smoothing**: Mandate exponential moving average with minimum window for prior weight to prevent oscillation near adaptive look-back regime boundaries. Specify parameters in `PredictionOptions`.
- **DP variance propagation**: Extract DP noise variance from published cell metadata; incorporate into `PriorValue.LogSd`. Unit test verifying posterior variance accounts for DP noise.
- **Kill switch**: `PredictionOptions.BlendingEnabled` (default false). Independent from `CommunityInsights:Enabled`. Rollback procedure: set false, restart API, system reverts to norms-only within one cycle.
- **Per-type validation**: Require log-normal assumption fitness validation against synthetic data for each event type before adding to `ColdStartTypeKeys`. Document which types pass.
- **BedTimePredictor**: Explicitly scoped out for v1. Document decision.
- **Files**: New `BlendedPrior.cs`, `WeightedSampleSet.cs` in Domain/Predictions; modify `TypePredictor.cs`, `PredictionOptions.cs`.

#### Step 1.5: Consent Text + Policy Update (Week 5)

- **Consent screen**: Update text to explicitly state pooled statistics may be used to improve predictions (not just displayed). Bump to `ci-2`. Require re-consent before blending activates (LGPD art. 14 concern).
- **Privacy policy**: Update with specific data flows for blending mechanics. Coordinate with pending BYO wording (design 33 section 17).
- **COPPA assessment**: Before activation, assess whether US families can create accounts. If yes, implement geo-restriction or obtain legal confirmation that self-declared guardian satisfies COPPA. Document in RIPD.

#### Step 1.6: Pilot Backtest + Activation Checklist (T9) (Week 5-6)

- Run backtest against Phase 0 static priors first. Define success metric: MAE improvement over norms with statistical significance. Hard gate before live data reaches users.
- Activation sequence: (1) pilot backtest passes, (2) consent version bump + re-consent, (3) first live aggregation run, (4) RIPD re-issue with final parameters, (5) enable `BlendingEnabled` for cohort, (6) monitor MAE for 2 weeks, (7) full rollout.
- **Phase 0-to-Phase 1 transition**: Use `Weight` property to gradually blend CommunityLive over CommunityStatic across 2-4 weekly releases. A/B error tracking detects regression before full cutover.

---

### Reviewer Concern Resolution Matrix

| Concern | Resolution | Source |
|---------|-----------|--------|
| Catalog contradicts O2 | Step 0.1 reconciles catalog before any implementation | Reviewer 5, 6 |
| ColdStartPrior breaking change | Optional fields with defaults; factory methods; enumeration of call sites confirmed | Reviewer 3, 4, 5, 6 |
| Tier B epsilon weak guarantee | Deferred entirely until lawyer approval; Phase 0 uses only tier A; separate feature flag | All reviewers |
| No monitoring/rollback | Steps 0.6, 1.2 define metrics, alerts, health endpoints, kill switches, rollback procedures | Reviewer 2, 4, 6 |
| Suppression leaks exact counts | Documented residual risk in RIPD; accepted per synthetic study findings at k>=20; hysteresis reduces flip-flop | Reviewer 1, 2 |
| Consent race condition | Snapshot consent at job start time (Step 1.2) | Reviewer 1 |
| Community-to-ColdStartPrior mapping undefined | Phase 0 restricted to shares (no mapping needed); Phase 1 documents that percentile priors seed duration predictions, not gap predictions; separate CommunityPrior record type if needed | Reviewer 1, 2 |
| COPPA unaddressed | Step 1.5 mandates assessment before Phase 1 activation | Reviewer 2, 6 |
| Prior weight oscillation | Mandatory smoothing with EMA; hysteresis on Origin transitions | Reviewer 3, 4 |
| DP variance not propagated | Step 1.4 specifies extraction from cell metadata; unit test required | Reviewer 4 |
| User-facing transparency missing | Steps 0.5, 1.4 add origin display, i18n strings, feedback mechanism | Reviewer 2, 5, 6 |
| BYO exclusion untested | Integration test with mixed fixture in Steps 0.7, 1.2 | Reviewer 5, 6 |
| Account deletion retention | Acceptable under DP guarantees; documented in privacy policy; consent record erased | Reviewer 1, 2 |
| Cloudflare fingerprinting | ETag values are content-hashed, not user-specific; rate limiting prevents enumeration | Reviewer 1, 2 |
| Stale priors during transitions | Staleness policy (14 days); cache invalidation tied to aggregation timestamp; fallback to norms | Reviewer 2, 4 |
| Blending degrades predictions | Kill switch; MAE monitoring; automatic fallback trigger; per-type validation gates | Reviewer 3, 4 |

---

### Parallelism Strategy

**Phase 0 (2-3 senior developers, 1-2 weeks)**:

- **Dev A**: Steps 0.2 + 0.3 (ColdStartPrior extension, IPriorProvider, CompositePriorProvider, PredictionEngine refactor). No external dependencies.
- **Dev B**: Steps 0.1 + 0.4 (Catalog reconciliation, static prior generation script, embedding, build-time guard). Depends on Step 0.1 completing before Step 0.4.
- **Dev C** (optional): Steps 0.5 + 0.6 (API origin metadata, web display, monitoring, health endpoint). Can start after Dev A completes Step 0.3.
- **Reviewer 1**: Privacy/legal surface of Phase 0 scope confirmation (synthetic-only, no policy change needed). Runs in parallel with Dev B.
- **Reviewer 2**: Statistical correctness of CommunityPriorSet safety gates and synthetic-to-static derivation. Runs in parallel with Dev A and Dev B.

**Phase 1 (3 senior developers, 3-4 weeks, post-legal)**:

- **Dev A**: Step 1.2 (Aggregation job, transactional writes, observability). Depends on catalog v2 (Step 1.1).
- **Dev B**: Step 1.3 + 1.4 (Serving endpoint, BlendedPrior integration). Depends on Dev A completing job.
- **Dev C**: Step 1.5 + 1.6 (Consent text, policy, pilot backtest, activation checklist). Runs in parallel with Dev A/B but blocks activation.
- **Reviewer 1**: Privacy/legal (RIPD, consent wording, COPPA, notice to parents). Parallel with Dev A.
- **Reviewer 2**: Statistical correctness (aggregation pipeline, noise calibration, dominance rule, blending math). Parallel with Dev A and Dev B.

---

### Key Design Decisions

1. **Phase 0 priority is PublishedNorm > CommunityStatic** (not community-first). Synthetic priors are noisier than curated norms for most metrics per synthetic study finding 3. Community-first applies only in Phase 1 when live data is available.

2. **ColdStartPrior extension uses optional fields with defaults**, not a new record type. This preserves backward compatibility for all existing callers while enabling Origin/Weight/LogSd for community priors. Positional constructors continue to work.

3. **PredictionEngine accepts both AgeNormSet? and IReadOnlyList<IPriorProvider>?** during transition. The old parameter remains for backward compatibility; new code uses the provider list. Avoids breaking every test and caller in one PR.

4. **Tier B (quantile) infrastructure is built but gated behind a separate flag defaulting to off**. Only tier A (shares at epsilon 0.2) ships initially. This avoids sunk cost on potentially rejected epsilon levels while keeping the architecture ready.

5. **Suppression decisions use exact counts** (non-DP). Residual membership inference risk near k=20/hysteresis=18 boundary is documented in RIPD and accepted per synthetic study conclusion that practical risk is low at k>=20. Noising the suppression decision itself would add complexity without meaningful protection gain at this scale.

6. **Account deletion does not retroactively remove contributions from published releases**. Acceptable under DP guarantees (individual contribution bounded by cap and noise). Documented in privacy policy. Consent record is erased per EfAccountDataEraser rules.

7. **BlendedPrior uses mandatory smoothing** (EMA with minimum window) to prevent prior weight oscillation near adaptive look-back regime boundaries. Origin transitions require N consecutive predictions before switching. Parameters configurable in PredictionOptions.

8. **Phase 0-to-Phase 1 transition uses gradual blending via Weight property** across 2-4 weekly releases, with A/B error tracking. No simultaneous cutover. Detects regression before full promotion.

---

### Chosen Elements

- Phase 0 / Phase 1 incremental split
- IPriorProvider abstraction in Domain layer
- CompositePriorProvider chaining with configurable priority
- BlendedPrior continuous weighting with conjugate-normal shrinkage
- Tiered epsilon: 0.2 for shares, >=5.0 for quantiles gated behind lawyer approval
- K-anonymity suppression with hysteresis (20 publish, 18 withdraw)
- Per-baby contribution cap of 14 days per cell
- Family dominance suppression at 25% threshold
- Static community-priors.json embedded resource mirroring age-norms.json delivery
- ColdStartPrior extension with Origin, Weight, PriorLogSd optional fields
- PredictionOptions.UseCommunityStaticPriors independent kill switch
- PredictionOptions.BlendingEnabled independent kill switch
- PredictionOptions.ColdStartTypeKeys configurable set
- Catalog schema v2 with tiered epsilon support and backward-compatible parser
- CommunityAggregationJob as IHostedService with weekly cadence
- Transactional writes with staging table swap and release_id idempotency
- Consent snapshot at job start time to prevent race conditions
- BYO-database exclusion enforced via IStoreScope fail-closed contract
- GET /api/v1/community-statistics serving endpoint with ETag caching
- Rate limiting and demo account exclusion on serving endpoint
- Mandatory smoothing (EMA) for prior weight to prevent oscillation
- DP noise variance propagation into PriorValue.LogSd
- User-facing origin display with i18n strings distinguishing static vs live
- Monitoring metrics: daily CommunityStatic usage count, rolling MAE comparison
- Health endpoints for static priors and live aggregation job
- Phase 0 priority PublishedNorm > CommunityStatic
- Phase 0-to-Phase 1 gradual transition via Weight property over 2-4 releases
- Pilot backtest as hard gate before live data reaches users
- COPPA applicability assessment before Phase 1 activation
- Consent text bump to ci-2 explaining predictive use before blending activates
- Yearly review cycle for static priors tied to age norms + vaccine schedule
- Build-time CI guard ensuring community-priors.json generated only from synthetic fixtures
- Per-metric Phase 0 promotion gates based on synthetic study MAE thresholds
- Doctor role: predictions seeded by community priors not filtered
- Account erasure removes consent history; aggregated data retains anonymized stand-ins

### Rejected Elements

- Real-time aggregation (all proposals agree on weekly batch)
- Queryable API for community statistics (pre-computed releases only)
- Client-side DP noise application (server-side only)
- Removing tier B infrastructure entirely (kept behind flag for future activation)
- Noising suppression decisions themselves (accepted residual risk per synthetic study)
- Retroactive removal of contributions from published releases on account deletion
- Separate CommunityColdStartPrior record type (optional fields with defaults preserve backward compatibility)
- Geo-blocking US users unconditionally (deferred to COPPA assessment outcome)
- Automatic promotion of community priors over published norms without pilot backtest
- Community-first priority in Phase 0 (corrected to norms-first per synthetic study findings)
- Simultaneous Phase 0-to-Phase 1 cutover (gradual blending via Weight property instead)
- BlendedPrior applied to BedTimePredictor in v1 (scoped out; documented decision)
- Per-family contribution cap applied at blend time instead of aggregation
- Exposing raw counts below kTails threshold
- Free-text advice in community statistics responses (facts-only per CLAUDE.md)

---

### Open Questions Requiring Human Decision

1. LGPD legal review timeline for Phase 1 live aggregation
2. Whether to expose community statistics endpoint before Phase 1 (read-only aggregated data)
3. Consent UX design for opt-in flow
4. Synthetic study parameters for Phase 0 prior generation
5. COPPA assessment outcome for US families
6. Tier-B epsilon value approval from lawyer
7. Per-metric Phase 0 promotion gate thresholds (MAE improvement %)
8. Monitoring alert thresholds (MAE degradation %, suppression ratio %)

---

### Next Steps

1. Begin Phase 0 Step 0.1 (catalog reconciliation) and Step 0.2 (ColdStartPrior extension) in parallel
2. Schedule LGPD legal review for Phase 1 prerequisites
3. Run synthetic study to generate Phase 0 static priors
4. Set up CI build-time guard for community-priors.json provenance
5. Draft consent text version ci-2 for legal review
6. Create worktrees for Phase 0 parallel development tracks