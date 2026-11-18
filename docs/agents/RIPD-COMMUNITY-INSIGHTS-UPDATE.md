# Community Insights: RIPD Update for Phase 1 Aggregation and Serving (2026-11-18)

**Status:** Draft update to docs/design/34a-community-insights-ripd.md (v0.2, 2026-11-11). This document covers the
new processing activities introduced by Phase 1 of community prior blending: the aggregation job that produces pooled
statistics and the serving endpoint that delivers them. It does not replace the existing RIPD; it supplements it with
facts specific to the built infrastructure.

**Not legal advice.** This is a starting point for the owner and a Brazilian lawyer or privacy specialist. Cross-references
use the decision numbers of docs/design/34-community-insights.md section 13 and the COPPA assessment at
docs/agents/COPPA-ASSESSMENT.md.

---

## 1. New processing activity: community statistics aggregation

### 1.1 Description

A weekly background job (`CommunityAggregationJob`, hosted service in the API process) reads opted-in babies' live
events through the same repositories used by the rest of the application, computes per-baby summaries in memory, applies
the safeguards of design 34 section 5 (caps, clipping, bands, k, dominance, complementary suppression, DP noise), and
writes only the published statistics release (`community_statistics_releases` table) and one run log row. No staging
table of per-baby values exists; no copy of individual contributions is stored.

### 1.2 Legal basis

- **Explicit consent (opt-in):** LGPD art. 11, I (sensitive health data) and art. 14, §1 (child's data; consent from at
 least one parent or legal guardian). The consent is per baby, versioned, never bundled, and withdrawable at any time
 (design 34 section 3). The consent record (`community_consents` table) stores the action, text version, policy version,
 guardian confirmation and timestamp.
- **Legitimate interest is NOT the basis for the inputs.** The inputs are personal and sensitive; they are processed
 under consent only. Legitimate interest (art. 7, IX) cannot be used for sensitive data (art. 11). The published
 aggregate may be described as serving the legitimate interest of other families in receiving better context numbers,
 but this does not extend to the processing of the inputs themselves.

### 1.3 Data minimization measures

| Measure | Implementation | Design reference |
| --- | --- | --- |
| Per-baby contribution cap | At most `capPerBaby` values per statistic per band; deterministic keyed sampling by baby id and day | section 5 |
| Clipping | Values clipped to published ranges before aggregation (e.g., bottles 0-400 ml, night sleep 0-16 h) | section 5 |
| Per-baby summaries | One summary value (the baby's own median) per band enters percentile computation; heavy loggers weigh the same as light loggers | section 5 |
| k-suppression | A cell is published only when it has at least k = 20 distinct babies from 20 distinct families; below k the cell is suppressed | section 5 |
| Dominance suppression | A cell where one family contributes more than 25% of the values after capping is suppressed | section 5 |
| Complementary suppression | Suppressed cells cannot be recovered from a published total minus other cells; no totals across bands are published | section 5 |
| Hysteresis | Publish at 20, suppress at 18 once published; prevents flipping on one baby | section 5 |
| Differential privacy | Laplace mechanism on counts and shares; exponential mechanism on percentiles over a fixed grid. Two tiers: strict (epsilon 0.2) and relaxed (epsilon ~5). See docs/design/34-community-insights-tier-b.md | section 5.1 |
| Fixed band edges | Age bands are fixed in the catalog, never derived from data; data-driven edges leak membership | section 5 |
| No query endpoint | Static file with fixed cells; no filters beyond catalog dimensions | section 5 |
| Read-only source access | Job uses a read-only database role on event, baby, membership and consent tables; write access only to `community_runs` and the release table | section 7 |
| Weekly cadence | Publication is weekly (Sunday 03:30 server time), not nightly; overlapping releases compose under DP budget | section 5 |

### 1.4 Retention

| Data | Retention |
| --- | --- |
| Per-baby inputs | In memory during the run only; never stored |
| Published releases | Current and previous (for rollback) only; the previous is deleted on the following run |
| Run log (`community_runs`) | 2 years; no baby ids |
| Consent records | While the baby exists; after withdrawal or erasure, as long as needed to prove consent (needs lawyer, O8; proposal: 5 years, baby id hashed after erasure) |

---

## 2. New processing activity: community statistics serving

### 2.1 Description

The endpoint `GET /api/v1/community/statistics/{statisticKey}` serves the latest active release for a baby's age band,
filtered from the stored release JSON. The path uses `/community/statistics` (no hyphen), per the owner's route naming
preference. The response includes the statistic value, sample size range (never an exact count), confidence label,
release timestamp and suppression reason when applicable.

### 2.2 Access controls

- Requires authentication (any signed-in user with a current core consent).
- Requires an active community insights consent on at least one of the caller's babies (the endpoint checks all of the
 caller's babies and uses the first with consent in force).
- Demo accounts are excluded (`DemoNotAvailableException`).
- Doctors are refused: community statistics are family-level, not clinical (design 34 section 3.4).
- Rate limited per user per hour (`RequestLimitPolicies.CommunityStatisticsRead`).
- Feature flag `CommunityInsights:Enabled` gates the entire endpoint; when off, the guard returns a bare 404.

### 2.3 Caching

- `Cache-Control: private, max-age=300` (five minutes; release changes weekly).
- Strong ETag `"releaseId:statisticKey"`; 304 Not Modified on `If-None-Match`.
- No shared cache (private); each client caches independently.

### 2.4 What is served

Age-band-filtered pooled statistics from the latest active release. The response contains:
- `statisticKey`: the catalog key.
- `ageBandLabel`: the band the caller's baby falls into (e.g., "8w").
- `value`: the pooled mean (or null when suppressed or no data).
- `sampleSizeRange`: a range string ("<20", "20-49", "50-99", "100-199", "200-499", "500+"); never an exact count.
- `confidence`: "high", "moderate" or "low" based on family count and epsilon.
- `releasedAtUtc`: when the release was generated.
- `suppressionReason`: "no_data", "suppressed" or null.

Nothing identifies any baby or family. No free text, no names, no timestamps finer than the release date.

---

## 3. Rights

| Right (LGPD art. 18) | How it applies |
| --- | --- |
| Confirmation and access | Consent state and history shown in the app; the statistics file is visible to authenticated users |
| Correction | Correcting a source record corrects the next aggregation run |
| Elimination | Withdrawal removes the baby from future runs; deleting a record, the baby or the account removes it from the next run (no copy exists). Already published aggregates cannot be separated out and are replaced by the next run |
| Information about sharing | None (no third party receives the data) |
| Revocation (art. 8, §5) | One tap in Settings > Baby > Community insights; effective for the next run |
| Portability | The baby's export includes its records; the consent history is shown in the app (not in the backup file, which forbids account ids) |

**Honest limit on elimination:** statistics already computed are group numbers with no link to any baby. A baby's
contribution cannot be extracted from a published cell. The policy states this plainly: "Group numbers already
calculated cannot be separated out, and are replaced."

---

## 4. Risk assessment update

### 4.1 Residual membership inference risk near k boundary

At cells near k = 20, an attacker who knows a family participates and observes two consecutive releases may detect
entry or exit of that family through changes in the published cell. Mitigations in place:

- Hysteresis (publish at 20, suppress at 18) prevents single-baby flips.
- Weekly cadence limits observation frequency.
- DP noise (Tier A: epsilon 0.2, strong bound; Tier B: epsilon ~5, weak bound) blurs small differences.
- Complementary suppression prevents recovery of suppressed cells from published totals.

**Residual risk:** low for Tier-A statistics; low-medium for Tier-B statistics where the formal DP guarantee is weak
(tanh(5/2) ~ 0.99). The practical protection at Tier B rests on k, caps, clipping, dominance, suppression and
hysteresis, not on the noise alone. This is documented in the policy and accepted by the owner decision of 2026-11-11
(O2). See docs/design/34-community-insights-tier-b.md section 3.3.

### 4.2 Serving endpoint risks

- **Unauthorized access:** mitigated by authentication, consent check, demo exclusion, doctor refusal and rate limiting.
- **Cache poisoning:** ETag is derived from the release id and statistic key; a stale cache entry expires in five minutes.
- **Information leakage through timing:** the endpoint performs the same operations regardless of whether the caller has
 consent (it checks all babies); the response differs but the work does not reveal which baby has consent.

---

## 5. COPPA cross-reference

The COPPA assessment (docs/agents/COPPA-ASSESSMENT.md) identifies Community Insights as high risk for US users if
COPPA applies:

- Section 2.4 recommends not launching Community Insights for US users until COPPA applicability is resolved with counsel.
- Aggregated statistics derived from children's health data could constitute "disclosure" under COPPA if re-identifiable.
- The Tier-B epsilon's weak formal guarantee makes re-identification risk more acute than for Tier-A statistics.
- If COPPA applies, the existing LGPD guardian consent declaration may not satisfy COPPA's verifiable parental consent
 standard (credit card, government ID, video call, signed form).

**Recommendation for this update:** do not serve community statistics to users identified as US-based until COPPA
counsel confirms compliance. The serving endpoint does not currently distinguish by geography; adding a geo-gate is a
code change outside the scope of this documentation task but should be noted as a prerequisite for US availability.

---

## 6. Alignment with existing RIPD (docs/design/34a-community-insights-ripd.md)

This update is consistent with the v0.2 RIPD draft and adds specifics for the built infrastructure:

- Section 2.6 (flow): the endpoint path is now `/api/v1/community/statistics/{statisticKey}` (no hyphen), confirmed in
 code (`CommunityStatisticsEndpoint.Path`).
- Section 5 (risk assessment): R2 (membership inference) residual rating is confirmed as low for Tier A and low-medium
 for Tier B, with the formal guarantee stated.
- Section 6 (measures): all planned measures are implemented in the aggregation job and serving endpoint as described.
- Section 7.2 item 11 (lawyer review of relaxed tier): still required before Tier-B percentile outputs are activated;
 see docs/design/34-community-insights-tier-b.md section 5.

No inconsistency with the existing RIPD was found. The open points listed in RIPD section 7 remain open and are not
resolved by this update.