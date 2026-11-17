# Phase 0 Monitoring Notes: Community Static Priors

This document describes the monitoring, alerting and rollback procedures for the community static priors feature introduced in Phase 0 of the prediction improvements plan (`docs/agents/COMMUNITY-PRIOR-BLENDING-PLAN.md`).

## Metrics to Log

The `CompositePriorProvider` (in `code/api/src/Lotties.Domain/Predictions/CompositePriorProvider.cs`) is the natural instrumentation point. When a prior is selected, log structured events with the following fields:

- **`prediction.prior.selected`** -- emitted each time `GetPrior` returns a non-null result.
  - `origin` (string): the `PriorOrigin` value (`PublishedNorm`, `CommunityStatic`, `CommunityLive`).
  - `type_key` (string): the event type key that received the prior.
  - `age_days` (int): the baby's age in days at lookup time.
  - `provider_index` (int): zero-based position in the chain where the hit occurred.

- **Daily roll-ups** (computed from the raw events above, not logged inline):
  - `community_static_usage_count`: number of predictions seeded by `CommunityStatic` per calendar day (UTC).
  - `mae_community_static_vs_published_norm`: mean absolute error comparing cold-start predictions from `CommunityStatic` against those from `PublishedNorm` for the same type key and age band, measured on babies who later accumulated enough personal data for a data-driven prediction. This metric quantifies whether the community prior is closer to reality than the published norm.

## Alert Thresholds

| Metric | Threshold | Window | Severity |
|--------|-----------|--------|----------|
| `mae_community_static_vs_published_norm` degradation | >10% worse than baseline MAE | Sustained 48 hours | Warning |
| `community_static_usage_count` | Drops to zero when expected non-zero | 24 hours | Info (may indicate config drift) |
| Health endpoint `/health/community-priors` status | `failed` or `not-configured` | Any check | Critical |

The baseline MAE is the rolling 7-day average computed before the current window. Degradation is `(current_mae - baseline_mae) / baseline_mae`.

## Rollback Procedure

If an alert fires and investigation confirms the community static priors are degrading prediction quality:

1. Set `UseCommunityStaticPriors=false` in the API configuration (`appsettings.json` or environment variable).
2. Restart the API pods (the setting is read at startup when the `CompositePriorProvider` chain is built).
3. Verify `/health/community-priors` still returns `loaded` (the catalog remains available; only the provider chain skips it).
4. Monitor MAE for 24 hours to confirm recovery.
5. File a follow-up to investigate the root cause before re-enabling.

Rollback does not require a code deploy or database migration. The `CommunityStaticPriorProvider` checks the flag before returning a prior, so toggling it is safe at any time.

## Implementation Checklist for Instrumentation

When adding the structured logging described above:

- [ ] Add an `ILogger<CompositePriorProvider>` dependency to the constructor.
- [ ] Emit `prediction.prior.selected` inside the `foreach` loop after a non-null return.
- [ ] Ensure the log level is `Information` (these are operational metrics, not errors).
- [ ] Add a Serilog enricher or OpenTelemetry attribute mapping so the fields appear in dashboards.
- [ ] Write a unit test that verifies the log event is emitted with the correct properties when `CommunityStatic` wins over `PublishedNorm`.