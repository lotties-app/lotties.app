# 48. Her rhythm (design, 2026-11-10)

Status: **API and web built** (web: section 9). Owner request: the app learns each baby's own pattern from the events already
logged and shows it as plain facts: when she usually goes to bed and wakes up, how long the night is, how many naps and
feeds a day and the usual gap between feeds, and descriptive associations such as "nights after 3 or more evening feeds
vs. fewer" or "nights after a day with a dirty diaper vs. none".

## 0. Guardrails

- **Lia against Lia** (docs/design/04-insights-delight.md section 0, docs/design/28-age-norms.md section 0): only this
  baby's own events, never another baby, never an aggregate of babies, never an age norm. No "normal/abnormal", no
  target, no "better/worse", no judging colours, no advice. The API returns numbers and statuses only, no prose.
- **Nothing is stored.** Computed on every request like `GET /predictions` and the rest history (design 41 section
  12). No new table, no migration, no new column, no cache.
- **Nothing is guessed.** Every metric has a minimum sample; below it the metric is `not_enough_data` with its count
  and no value.
- **Associations are descriptive.** Two groups of the baby's own nights, their sizes, the medians of an outcome and the
  difference. Never causal wording, never a p-value, a score or a "significant" flag (section 4).

## 1. Inputs and time

- Events: the baby's non-deleted events (soft-deleted rows never reach the Domain: the repository's global filter, as
  for the predictions), read through the existing `IPredictionHistoryRepository` from the start of the local day 29
  days before today (`BabyRhythm.LoadSince`). A fussy spell answered "Not crying" (`ObservedEvent.ConfirmedNotCrying`, the
  cry monitor's false alarm) is dropped first; fussy spells are not used anyway. Events after now are ignored. Only
  sleep, feeding and diaper events are read, all of the daily log section, so a Doctor (who needs `daily_log`, section 5)
  sees exactly what a parent sees; no medication, formula or note is read.
- Sleep sessions come from `SleepSessions.Build` (no duplicate logic): `bed_time` to `woke_up` (at most 16 h) and logged
  `night` timers are nights, everything else that is sleep is a nap, `night_waking` episodes are not sleep, a timer
  right after `fell_asleep` inside a bed-time night is that night.
- Diaper content through `DiaperContents.IsDirty` (`DIRTY` or `MIXED`).
- Local time through `LocalClock.ForZoneOrOffset(timeZone, utcOffsetMinutes)` exactly as `/predictions`: with an IANA
  zone every instant gets the offset in force at that instant; without one a fixed offset. Durations are always elapsed
  time between instants, so a daylight-saving night is never an hour longer or shorter than it was.
- **Window.** The last 28 local days before today (today is never counted: it is not finished). Nights are placed on
  their **evening**: the local date of the bed time read on a day that starts at 04:00 (a 00:30 bed time belongs to the
  previous evening, as the bed-time prediction does). Nights of the evenings today-28 to today-1 count.

## 2. Nights

For one evening, the finished night sessions that start on it are merged: **bed time** = the earliest start, **wake-up**
= the latest end, **night length** = wake-up - bed time (elapsed). The night's sleep is the union of those sessions
minus the logged night wakings that start inside it; what is left are the night's **stretches** (pieces under 1 minute
are dropped).
- **Longest stretch** = the longest of them. **First stretch** = bed time to the first logged waking (a gap between two
  night sessions is a waking too), or to the wake-up when no waking was logged. A waking that was not logged is not
  seen: these are facts about the log.
- A night still running (any of its sessions without an end, or ending after now) is left out.
- A merged night under 3 hours or over 16 hours is left out (a mis-tagged nap, a forgotten timer).

## 3. Metrics (rules, minimums)

| Metric | Value | Minimum | Status |
|---|---|---|---|
| Bed time | circular mean of the bed-time clocks (24 h circle, so 23:50 and 00:10 are 20 min apart) and the circular standard deviation, to the minute (the `RecurringTimeOfDayPattern` maths, shared `CircularSummary`) | 5 nights | `ok`; `varies` when the spread is over 90 min (no usual time given, spread and count given); `not_enough_data` |
| Wake-up | the same over the wake-up clocks | 5 nights | as bed time |
| Night length | 25th percentile, median, 75th percentile (linear interpolation, whole minutes) | 5 nights | `ok` / `not_enough_data` |
| Longest stretch | the same over the nights' longest stretches | 5 nights | `ok` / `not_enough_data` |
| First stretch | the same over bed time to first waking | 5 nights | `ok` / `not_enough_data` |
| Naps per day | 25th percentile, median, 75th percentile of the nap count of each **bracketed day**: a day between two counted nights (from the wake-up of evening D-1 to the bed time of evening D); naps = finished nap sessions that start inside it | 5 bracketed days and at least one nap counted in them | `ok` / `not_enough_data` |
| Usual nap starts | `RecurringTimeOfDayPattern.Detect` with its own default rules (14 days, 4 of the last 7, spread up to 45 min, 60 % coverage) over the nap starts; after each pattern found, the nap starts inside its window are removed and the detector runs again, at most 4 times; sorted by usual time | the detector's own | a list, empty when none |
| Feeds per day | 25th percentile, median, 75th percentile of the feeds that started on each local day of the window **with at least one feed** (a day with nothing logged is not a day without feeds) | 5 days | `ok` / `not_enough_data` |
| Gap between feeds | 25th percentile, median, 75th percentile of the start-to-start gaps between consecutive feeds starting in the window, over 0 and at most 8 hours (`FeedingSummaries.MaxFeedGap`: a longer gap is a feed that was not logged) | 10 gaps | `ok` / `not_enough_data` |

Counts are rounded to 1 decimal, minutes to the whole minute (halves away from zero).

## 4. Associations (descriptive)

Two factors, each split over the counted nights whose **day** (the evening date from 04:00 local up to that night's
bed time) qualifies:
- **`evening_feeds`**: feeds that started in the 4 hours before bed time. The night qualifies only when its day has at
  least one feed logged. The split point N is the median of the qualifying nights' evening feed counts, rounded up, at
  least 1: "with" = N or more evening feeds, "without" = fewer than N. N is returned (`threshold`).
- **`dirty_diaper_day`**: the day had at least one dirty diaper. The night qualifies only when its day has at least one
  diaper logged, so "without" means diapers were logged and none was dirty, never "nothing logged".

For each factor and each outcome (`night_length`, `longest_stretch`, `first_stretch`):
- `nightsWith`, `nightsWithout` always; `spreadMinutes` = the median absolute deviation of the outcome over all the
  qualifying nights (the baby's own night-to-night spread), when there are any.
- Status **`not_enough_data`** when either group has fewer than **7** nights (of the last 28 days).
- Otherwise the two medians (whole minutes) and `differenceMinutes` = median with - median without. Status **`ok`** only
  when the absolute difference is at least **20 minutes** and greater than `spreadMinutes`; else
  **`no_clear_difference`**. Medians and the difference are `null` unless the status is `ok`, so a client cannot show a
  difference the rule did not pass.

Why so strict, and why no score: the groups are small (7 to 21 nights), the nights are not independent (a cold, a growth
spurt, a trip, a new daycare change several nights in a row), and the factors move together with other things (an
evening with more feeds may be an evening with a later bed time, a fussier day, another caregiver). Six comparisons are
made, so one of them may look different by chance. A p-value or "significance" on such data would read as proof of a
cause it cannot give. The rule only says that, in this baby's own log, the two groups of nights looked this different;
the wording on screen must stay descriptive ("after days with ..., her night was usually ...; after days without, ..."),
never "because", "causes", "helps", "should".

## 5. Route and roles

`GET /api/v1/babies/{babyId}/rhythm?utcOffsetMinutes=&timeZone=` in the baby-scoped group, behind the consent gate (the
group default). `utcOffsetMinutes` is optional, -840 to 840 (else a 400 validation problem on `utcOffsetMinutes`, the
same answer as `/predictions`, `UtcOffsetQuery`); `timeZone` is optional, an unknown id falls back to the offset. A baby
the caller is not a member of (or that does not exist) is 403 from the baby policy, like every baby route; the service
answers 404 only if the baby vanished between the policy and the read.

Roles exactly as `/predictions`: any member (`BabyRead`: Owner, Parent, Caregiver, **Viewer**, Doctor) and, for a
Doctor, the `daily_log` scope (`BabyScope:DailyLog`). The route reads only daily-log types, so no per-type filter is
needed. Rows in `EndpointRoleMatrixTests` (`Access.Read`, `DoctorScope.DailyLog`). Not a demo-blocked route (no third
party, no invite, no export). No assistant tool, no push, no notification.

## 6. Wire shape

```json
{
  "babyId": "6f1c2a52-0000-4000-8000-000000000001",
  "generatedAt": "2026-01-29T15:00:00+00:00",
  "timeZone": "America/Sao_Paulo",
  "firstDay": "2026-01-01",
  "lastDay": "2026-01-28",
  "nights": 26,
  "bedTime": { "status": "ok", "usual": "20:10", "spreadMinutes": 18, "nights": 26 },
  "wakeUp": { "status": "ok", "usual": "06:35", "spreadMinutes": 22, "nights": 26 },
  "nightLength": { "status": "ok", "count": 26, "p25Minutes": 600, "medianMinutes": 625, "p75Minutes": 645 },
  "longestStretch": { "status": "ok", "count": 26, "p25Minutes": 230, "medianMinutes": 280, "p75Minutes": 330 },
  "firstStretch": { "status": "ok", "count": 26, "p25Minutes": 200, "medianMinutes": 240, "p75Minutes": 300 },
  "naps": {
    "status": "ok", "count": 24, "p25": 3, "median": 3, "p75": 3.5,
    "usualStarts": [
      { "usual": "09:05", "windowStart": "08:35", "windowEnd": "09:35", "spreadMinutes": 12, "days": 12, "eventDays": 13 }
    ]
  },
  "feeds": {
    "status": "ok", "count": 27, "p25": 7, "median": 8, "p75": 9,
    "gap": { "status": "ok", "count": 205, "p25Minutes": 150, "medianMinutes": 170, "p75Minutes": 195 }
  },
  "associations": [
    {
      "factor": "evening_feeds", "threshold": 2,
      "outcomes": [
        { "outcome": "night_length", "status": "ok", "nightsWith": 12, "nightsWithout": 10,
          "medianWithMinutes": 640, "medianWithoutMinutes": 600, "differenceMinutes": 40, "spreadMinutes": 15 },
        { "outcome": "longest_stretch", "status": "no_clear_difference", "nightsWith": 12, "nightsWithout": 10,
          "medianWithMinutes": null, "medianWithoutMinutes": null, "differenceMinutes": null, "spreadMinutes": 35 },
        { "outcome": "first_stretch", "status": "no_clear_difference", "nightsWith": 12, "nightsWithout": 10,
          "medianWithMinutes": null, "medianWithoutMinutes": null, "differenceMinutes": null, "spreadMinutes": 30 }
      ]
    },
    {
      "factor": "dirty_diaper_day", "threshold": null,
      "outcomes": [
        { "outcome": "night_length", "status": "not_enough_data", "nightsWith": 20, "nightsWithout": 4,
          "medianWithMinutes": null, "medianWithoutMinutes": null, "differenceMinutes": null, "spreadMinutes": 15 }
      ]
    }
  ],
  "rule": {
    "lookBackDays": 28, "eveningDayStartsAt": "04:00", "minimumNights": 5, "minimumDays": 5, "minimumFeedGaps": 10,
    "maximumClockSpreadMinutes": 90, "minimumNightMinutes": 180, "maximumNightMinutes": 960,
    "maximumFeedGapMinutes": 480, "eveningFeedWindowMinutes": 240, "minimumGroupNights": 7,
    "minimumDifferenceMinutes": 20
  }
}
```

(`dirty_diaper_day` outcomes shortened.) Stable contract:
- Every metric object is always present; `status` is one of `ok`, `not_enough_data`, `varies` (bed time and wake-up
  only), `no_clear_difference` (association outcomes only). Values are `null` unless `status` is `ok`; for `varies` the
  `spreadMinutes` and `nights` stay.
- Clocks are local `HH:mm` in the zone (or offset) of the request; `timeZone` is `null` when the fixed offset was used.
  A nap window crosses midnight when its end is earlier than its start. `firstDay`/`lastDay` are the local dates of the
  window (`yyyy-MM-dd`). `nights` is the number of counted nights.
- `associations` always holds both factors in this order, each with the three outcomes in this order. `threshold` is
  `null` for `dirty_diaper_day`, and for `evening_feeds` when no night qualified.
- `spreadMinutes` of an outcome is `null` when no night qualified.
- `naps.usualStarts` is empty when no pattern was found; it comes from the detector's own rules, independent of the
  naps-per-day `status`.
- A clock's `spreadMinutes` is `null` when the clocks cancel out exactly (only possible with `varies`).

## 7. Privacy

No new data is stored, no new kind of data is collected, nothing is sent to a third party, and nothing personal is
logged (the service logs only the baby id and counts, at debug level, like the predictions). The rhythm is the same
purpose as row 4 of docs/design/33-privacy-audit.md ("summaries, predictions (computed, never stored)"), so the privacy
policy, `legal/dataFlows.ts`, the audit and the consent versions stay unchanged. `AccountErasureTests`, the eraser and
the backup need nothing (no table). Bring-your-own-database: the events are read through the existing store-scoped
repository, so an unreachable store is the usual retriable 503.

## 8. Code and tests

- Domain `code/api/src/Lotties.Domain/Rhythm/`: `BabyRhythm` (`Measure`, `LoadSince`), `RhythmNights`, `RhythmMetrics`,
  `RhythmAssociations`, `RhythmStatistics`, `RhythmOptions` (`Default`), `RhythmModels`; `Patterns/CircularSummary.cs`
  (moved out of `RecurringTimeOfDayPattern`, unchanged maths).
- Application `code/api/src/Lotties.Application/Rhythm/` (`IRhythmService`, `RhythmService`, `RhythmResponse`); Api
  `Endpoints/RhythmEndpoints.cs`.
- Tests: `Lotties.Domain.Tests/Rhythm/BabyRhythmTests.cs` (regular, irregular, too little data, midnight wrap, a
  daylight-saving night, associations present / absent / too small, input order, "Not crying" and future/old event
  exclusion, short / long / running nights, wakings and split nights, naps and feeds),
  `Lotties.Api.Tests/Endpoints/RhythmEndpointTests.cs` (200 with the wire shape, a soft-deleted night left out, query
  validation, roles and doctor scope, unknown baby 403, empty baby), `Application/RhythmServiceTests.cs` (unknown baby
  null, load window).

## 9. Web

- `code/web/src/rhythm/`: `rhythmApi.ts` (types, defensive `parseRhythm`: an unknown status becomes `unknown`, a value
  is kept only with `ok` and real numbers, an `ok` outcome without a difference, or an `evening_feeds` one without a
  threshold, is not shown; `getRhythm` maps 403/404 to `null`), `useRhythm.ts` (react-query, memory cache only, never
  Dexie, localStorage or the outbox; online only; no retry on 4xx), `rhythmModel.ts` (what a metric still needs from the
  `rule` of the answer, clocks and ranges through the Intl helpers, one descriptive sentence per `ok` outcome, the
  rule in plain words), `RhythmSection.tsx`, `rhythmFixtures.ts` (synthetic answers), strings
  `i18n/locales/{en,pt-BR}/rhythm.json`.
- Shown in Insights under the insight cards (`pages/InsightsPage.tsx`), titled with the baby's name (no pronoun: the app
  has no gender setting). Cards: Sleep (bed time and wake-up "around 19:45" or "Varies" with the spread, night length
  and the two stretches as p25 to p75 with the median), Naps (per day, usual starts), Feeds (per day, time between
  feeds), What the log shows (the sentences; when none passed, "Not enough nights to compare yet." with the nights so
  far, or "No clear difference between the nights in the log yet." when a comparison had enough nights but did not
  pass). A metric not ready says what it needs ("Needs 2 more nights in the log"), never a value. Footer: the rule in one
  line and "How this is worked out" with the rule values.
- States: skeleton while loading, a muted line with Reload on error, a muted line offline with nothing cached (the
  cached answer is shown otherwise), nothing at all on 403/404 or an answer not shaped like a rhythm.
- No chart (the optional night-length range bar was not built).
- Preview `/dev/rhythm?state=ok|partial|empty|varies|error`; showcase screenshot `rhythm` (docs/showcase-media.md).
- Tests `rhythm/rhythm.test.tsx`: parser, model (missing counts, plural forms, sentences in en and pt-BR, varies), the
  section states, no causal, judging or advising word in either catalog or any rendered scenario, axe in light, dark and
  night.
