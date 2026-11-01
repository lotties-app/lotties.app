# 10. Bottle amount suggestions

Motivation (owner request): the bottle amount chips were fixed small numbers (40, 60, 90...). The
owner's baby drinks 120 ml and sometimes asks for 60 ml more, so the low chips were useless and
the right ones missing. Amounts should follow the baby as it grows.

## Phase 1 (built): own history + a static age table

Offline, private, nothing leaves the device. Pure functions in
`code/web/src/events/bottleSuggestions.ts` and `code/web/src/events/bottleAgeDefaults.ts`.

**From the baby's own bottles** (at least 3 live bottle events with `amount_ml > 0` in the last
30 days, the newest 20 at most, soft-deleted ignored):

- typical amount: median of the newest 7, rounded to 10 ml;
- top-up pair: typical + 30 and typical + 60, shown as totals (120 / 150 / 180), for "asks for more";
- the 3 most frequent distinct amounts (rounded to 10 ml; ties go to the most recent);
- the last (or remembered) amount is always a chip, kept as is;
- priority order last, typical, top-ups, frequent; never zero, inside the field's min/max,
  deduplicated, at most 5 chips, shown ascending. The stepper steps by 10 ml and stays free entry.

**Cold start** (fewer than 3 bottles): chips from a small age table keyed by whole months since
the birth date. Values are 30 ml steps inside each range (the range top is added when at least
20 ml from the last step). Typical ranges, not medical advice, review with the pediatrician:

| Age (whole months) | Typical per feed | Chips |
| --- | --- | --- |
| 0 | 30-90 ml | 30, 60, 90 |
| 1 | 90-120 ml | 90, 120 |
| 2 | 120-150 ml | 120, 150 |
| 3 | 120-180 ml | 120, 150, 180 |
| 4 | 160-200 ml | 160, 190 |
| 5-6 | 180-240 ml | 180, 210, 240 |
| 7+ | 180-240 ml | 180, 210, 240 |

The 3 and 4 month rows follow the owner's own observation (about 120-180 ml at 3 months,
160-200 ml at 4 months); the others are common published pediatric ranges.

**Published norms first (2026-10-23, docs/design/28-age-norms.md section 15.2)**: when the device has
the age norms (`GET /age-norms`, cached), the cold-start range is the published formula volume per
feed for the baby's age in days (`feed_volume_ml_per_feed`, formula; SBP Manual de Alimentação 2024
and AAP): days 7-29 60-120 ml, days 30-60 90-150, 61-90 150-180, 91-182 180-200, 183-364 180-240,
chips built the same way (30 ml steps, top kept when 20 ml away). The table above stays the
fallback: the first week (that band needs review: SBP and AAP disagree), from 12 months (no band),
and whenever the norms are not on the device yet. The caption still says "Typical for N months"
(whole months). Without a birth date
(or with a malformed or future one) the neutral set 60 / 90 / 120 / 150 / 180 shows and nothing is
said about age.

**Where**: the event sheet's amount field (add, edit, the "Finish this feeding" stop flow and any
preset that opens the sheet for a missing amount) and the Now Feed tray's bottle chips. Chips are
live: they change as new bottles sync in.

**Copy**: a quiet caption under the chips. Cold start: "Typical for N months. Based on common
ranges, not advice." (newborns: "Typical for newborns..."). From history: "From your recent
feeds". Neutral set: no caption. Never judgement words (too little, too much) and never a target
or a recommendation: the chips are shortcuts, the parent decides.

## Drunk amount (2026-10-22, docs/design/20-feeding-amounts.md)

Bottles now record an amount prepared (`amount_ml`) and an amount drunk (`amount_drunk_ml`, absent = fully drunk). The history the chips are computed from (typical amount, top-ups, frequent amounts) reads the **drunk** amount; the last or remembered amount that is always a chip is still the last prepared one.

## Phase 2 (later, not built): opt-in anonymous aggregate

Superseded by docs/design/34-community-insights.md (2026-10-23): the same idea for every pooled estimate, per-baby
consent by an Owner or Parent, k = 20 babies from different families, per-family caps and weekly static statistics;
the privacy policy describes it as "not active yet". The notes below are kept as the original sketch.

Idea: on a shared instance, show what babies of the same age typically drink, as a cold-start
improvement over the static table. Constraints, all required before building:

- explicit opt-in per account (consent recorded, revocable), off by default;
- server-side aggregates only: per age-in-months bucket, medians and percentiles of per-feed
  amounts; no raw events leave a baby's data, no baby, account or event ids in the aggregate;
- k-anonymity: nothing is shown for a bucket until it holds at least 20 distinct babies;
- GDPR / LGPD: withdrawing consent or deleting the account removes the baby's contribution on the
  next recomputation; the aggregate is derived data, documented in the privacy notice;
- self-hosted instances have their own small population, so a bucket may never reach k and the
  static table stays the fallback forever there;
- same guardrails as phase 1: informational, not advice, no judgement words.
