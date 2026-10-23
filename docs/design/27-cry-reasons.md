# "Why is she crying?" — ranking what the log suggests (design, 2026-10-23)

Status: phase 1 logic implemented (`code/web/src/now/cryReasons.ts`, tests `cryReasons.test.ts`). The sheet on Now is a
later task built on top of it; its copy, layout and i18n are not part of this document.

A parent with a crying baby opens a sheet on Now and sees a short, ordered list of everyday causes (hungry, sleepy,
diaper, gas, wants comfort) with the facts from her own log behind each one ("2 h 40 min since the last feed, she
usually goes about 2 h 30 min"), plus a fixed list of signs that mean calling someone instead of reading the list.

## 1. Safety framing

- The logic **ranks what the log suggests and nothing else**. It never diagnoses, never names an illness, never outputs
  a dose, a medicine or a treatment, and never says "your baby has ...". The module header says so.
- Every cause is an ordinary, everyday reason for crying that a parent can act on with care alone (feed, nap, change,
  burp or massage, hold). Nothing in the list needs a clinician to rule in or out.
- Scores order the list; they are **never shown as a probability**. The UI shows a level (likely / possible /
  unlikely) and the facts.
- The comfort fallback is always present and never claims anything (no facts). It never outranks a strongly supported
  cause ("likely") nor a cause with nothing logged, so the list never says "she just wants a cuddle" when the log points
  elsewhere or says nothing.
- **Red flags are a constant**, returned on every call regardless of the log (`CRY_RED_FLAGS`): `fever`,
  `inconsolable`, `refusingFeeds`, `unusualSleepiness`, `bulgingOrStiffFontanelle`. The logic never decides whether a
  red flag applies: the UI shows them all, always, as "call your pediatrician or emergency services if ...". The
  stricter fever line for babies younger than 3 months is UI copy (the UI knows the age), not logic.
- No log, an out-of-date log (a sleep timer still running while she cries) or no birth date never produce a confident
  answer: everything stays a neutral "possible" with a `noData` fact.

## 2. API (pure, offline, language-free)

```ts
rankCryReasons(input: {
  events, types, now,           // the baby's events and event types (deleted and future events are ignored)
  birthDate,                    // yyyy-mm-dd or null
  predictions,                  // the cached GET /predictions response, null when missing or offline
  weights?,                     // replaces CRY_WEIGHTS (tests, phase 2)
}): {
  causes: { cause, level: 'likely' | 'possible' | 'unlikely', score /* 0..1 */, facts: CryFact[] }[],
  redFlags: RedFlagKey[],       // always CRY_RED_FLAGS
  basis: 'generic' | 'personal' // 'generic' in phase 1
}

cryOutcomeHistory(events, types, now, limit = 10): {
  spells, none, byCause: Record<CryCause, { helped, total }>
}
```

Also exported: `CRY_CAUSES` (tie order `hunger, sleepy, diaper, gas, comfort`), `CRY_RED_FLAGS`, `CRY_WEIGHTS`,
`cryAgeBand(birthDate, now)`, `outcomeCause(whatHelped)`, `GAS_RELIEF_KEYS`, the types.

`causes` always holds the five causes, sorted by score (descending), ties in `CRY_CAUSES` order; scores are rounded to 3
decimals, so the result does not depend on the order of the events. Levels: `likely` from 0.6, `possible` from 0.3,
`unlikely` below.

### Facts (structured, the UI writes the sentences)

| Fact | Fields | Used by |
|---|---|---|
| `sinceLastFeed` | `minutes`, `usualGapMinutes` (her own, `null` when the age default was used) | hunger |
| `feedingNow` | `minutes` (a feeding timer runs) | hunger |
| `awakeFor` | `minutes`, `windowMinutes` (server wake window, `null` when the age default was used) | sleepy |
| `nightTime` | — | sleepy |
| `sinceLastDiaper` | `minutes`, `usualGapMinutes` (server wet gap or `null`) | diaper |
| `dirtyDue` | `signal` (`afterFeed` / `gap`), `expectedAt` (UTC ISO) | diaper |
| `recentFeedNoBurp` | `minutesSinceFeed` | gas |
| `reliefAfterFeed` | `minutesSinceFeed` (a burp or massage was logged with the feed) | gas |
| `bellyPattern` | `typicalClock` (`HH:mm`) | gas |
| `eveningFussy` | `typicalClock` (her fussy pattern) or `null` (generic evening, under 3 months) | gas |
| `noData` | `reason`: `noLog` (nothing logged for this cause) or `asleep` (a sleep timer runs) | any but comfort |

## 3. Inputs and reuse

Nothing in the ranking duplicates existing maths; it reads the same helpers the Now cards use:

- `eventFacts.ts`: `pastLiveEvents`, `typeIdsForKey`, `minutesBetween`, payload readers.
- `nowState.ts` `deriveNowState`: awake since / asleep (timer or `fell_asleep` marker) / running night waking / unknown,
  and `sleepKindHint` (night from 19:00 to 05:00 or after a bed-time marker).
- `overtired.ts`: `wakeWindowOf` (her usual awake limit, the server's 75th percentile), `overtiredSuggestion` (the
  heads-up signal) and `nightWakingSince`.
- `diaperPredictions.ts`: `diaperPredictionsOf` (her wet median gap), `dirtySuggestion` (a dirty diaper due now, after
  a feed or from the gaps), `latestFeedEnd`.
- `bellyPattern.ts` / `fussyPattern.ts`: `bellyPainPattern`, `fussyPattern`, `windowAround` (her recurring windows on
  the local timeline).
- `events/bottleAgeDefaults.ts` `ageInMonths` for the age bands.
- `catchUp.ts` (hand-over summary) has no signal the ranking needs; it is not used.

Age bands (`cryAgeBand`): `newborn` under 6 weeks (42 days), `weeks6to3m`, `months3to6`, `months6plus`. Without a valid
birth date the `weeks6to3m` band is used.

## 4. Heuristics (phase 1, generic, conservative)

Every number lives in `CRY_WEIGHTS` (one object, per age band), so a later learner can replace it whole. A cause's score
starts at a floor and rises linearly with a ratio "elapsed / usual" between `rampFrom` and `rampTo` up to its `max`
(`ramp`). Age defaults are everyday ranges from common parenting guidance, deliberately on the long side so a cause does
not turn "likely" early.

| Band | Feed gap default | Wake window default | Diaper gap default |
|---|---|---|---|
| newborn | 150 min | 60 min | 120 min |
| 6 w - 3 m | 180 min | 90 min | 150 min |
| 3 - 6 m | 210 min | 120 min | 180 min |
| 6 m + | 240 min | 180 min | 210 min |

**Hunger.** Ratio = minutes since the start of the latest feed / her usual gap. Her usual gap is the median of the
start-to-start gaps of the last 72 h (feeds less than 30 min apart merged as one, gaps over 8 h dropped) when there are at
least 4 gaps; else the server's feeding `basis.medianGapMinutes` (30-720 min); else the age default (and the fact says
`usualGapMinutes: null`). Ramp from 0.5 to 1.1 of the gap (newborn 0.4 to 1.0, 3-6 m 0.55 to 1.1, 6 m+ 0.6 to 1.2), floor
0.05 (newborn 0.1: hunger is the most common reason at that age), max 0.9. A running feeding timer makes hunger
`unlikely` (0.05, fact `feedingNow`). A feed that ended less than 15 min ago caps hunger at 0.1.

**Sleepy.** Ratio = current awake minutes (from `deriveNowState`) / her wake window limit (server) or the age default.
Ramp 0.6 to 1.0, floor 0.05, max 0.85; +0.1 while the overtired heads-up would show. Awake at night (night hint, or a
night waking since the last sleep, or a night waking timer running) keeps sleepy at least 0.45 (`possible`) with a
`nightTime` fact: a night waking usually wants to go back to sleep. No sleep logged: `noData`.

**Diaper.** Ratio = minutes since the latest diaper (any content) / her wet median gap (server) or the age default; ramp
0.7 to 1.5, floor 0.05, max 0.75. +0.3 when the server's dirty-diaper estimate is due now (`dirtySuggestion`: after the
latest feed by her usual lag, or from the dirty gaps; fact `dirtyDue`). No diaper for 4 h or more: at least 0.6
(`likely`). A diaper logged less than 20 min ago caps the cause at 0.1. No diaper ever logged: `noData`.

**Gas.** Base 0.15 under 3 months, 0.1 after. Adds:
- 0.4 (3-6 m 0.35, 6 m+ 0.3) during the 30 min after a milk feed ended (breast, bottle or no method; solids excluded)
  when no burp or belly massage was logged from the feed's start (`recentFeedNoBurp`); only 0.1 (6 m+ 0.05) when one was
  (`reliefAfterFeed`). A burp is any event type with key `burp` or `burping` (no such built-in type exists today; a
  family-made type with that key counts); a belly massage is the built-in `belly_massage`.
- 0.3 inside her belly pain window (`windowAround`, from 45 min before), unless a burp or massage was logged in it.
- 0.15 inside her fussy window (her own "witching hour"); without a fussy pattern, 0.1 from 17:00 to 23:00 for babies
  under 3 months only (generic evening fussiness peaks in the first weeks).
- Capped at 0.9. No feed ever logged and no belly pattern: `noData`.

**Comfort.** Fixed 0.3, `possible`, no facts; kept at most 0.05 under both the `likely` threshold and the no-data score
even if a replaced weights object says otherwise. When everything else is handled (fed, changed, napped, burped) it
comes first, which is the honest answer.

**No data.** A cause with nothing logged for it scores 0.4 (`possible`, `noData: noLog`); a new baby with an empty log
gets four `possible` causes in tie order and comfort last. **Sleep running.** While a sleep timer (or a lone
`fell_asleep` marker) runs and no night waking runs inside it, every cause is `possible` with `noData: asleep`: crying
while logged asleep means the log is behind, not why she cries. The UI can offer to stop the timer.

**Offline.** The predictions are the cached response; with `null` every server number falls back to her local feed
gaps or the age defaults, and the facts carry `null` for "usual".

## 5. Outcome history (hint only)

`cryOutcomeHistory` reads the last `limit` answered `fussy` spells (live, started by now, newest first; spells without a
`what_helped` answer are skipped) and maps the answer to a cause: `feeding` → hunger, `sleep` → sleepy,
`diaper_change` → diaper, `burping` | `massage` → gas, `rocking` | `pacifier` | `holding` → comfort, `other` |
`nothing` → none. Unknown values (a future option, a typo, `__proto__`) map safely to none through an own-property lookup;
non-string answers are ignored; a list of strings (should the field ever become multi-select) counts each cause once.
Per cause it returns `{ helped, total }` with `total` = the answered spells considered, so the UI can say "feeding
helped 4 of the last 10 times". The new option keys and the `suggested_cause` field come with the fussy type change in
the API; the ranking does not read either yet.

## 6. Phase 2: per-baby learning (not built)

`basis: 'personal'` is reserved. The plan, following the ml benchmark (docs/ml/BENCHMARK.md, "Do not ship ML as the
default"):
1. The sheet saves the cause the parent acted on as `suggested_cause` on the fussy spell, with `what_helped` filled in
   afterwards. Together they give labelled outcomes: what the list said, what was tried, what helped.
2. A per-baby learner (start simple: a per-cause adjustment of the generic weights, or a small logistic model over the
   same features: ratios, time of day, age band, time since relief) runs in shadow mode next to the generic weights.
3. It replaces `CRY_WEIGHTS` for a baby (and `basis` becomes `personal`) only when, in that baby's own rolling backtest,
   it ranks the cause that helped higher than the generic heuristic does (e.g. a better mean reciprocal rank of the
   helping cause) with enough answered spells over enough days, by the same kind of gate as the benchmark (improvement
   with a bootstrap interval above zero on two consecutive windows). Otherwise the generic weights answer.
4. The safety framing does not change: no new causes, no diagnoses, red flags constant, comfort never above a strongly
   supported cause.

## 7. Tests (`code/web/src/now/cryReasons.test.ts`)

Each cause rises and falls with its signals (hunger with time and her own or the server's gap, a running feed, a fresh
feed; sleepy with awake time, her wake window, the overtired signal; diaper with time, her wet gap, the stale limit, a
due dirty diaper, a fresh change; gas after a milk feed, with a burp or massage, solids, her belly and fussy windows, the
generic evening by age), age bands (boundaries, the same log read differently at 3 weeks and 8 months), no data / new
baby, a running sleep, a night waking, overnight, offline (null and missing predictions), deleted and future events,
order independence, tie order, comfort kept under a likely cause even with replaced weights, the outcome mapping incl.
unknown and prototype names, and a golden table of 15 scenarios with invariants (comfort never above a likely cause,
scores sorted). Clocks are pinned by passing `now` (local times on a fixed date), as the other Now logic tests.

## 8. Data (what the outcome is stored in)

The built-in `fussy` event type records the outcome (migration `FussyOutcomes`, seed only, stored events untouched):

- `what_helped` (optional select) keeps its options in order and appends `diaper_change`, `burping` and `holding`
  ("Diaper change", "Burping", "Holding / skin to skin"; pt-BR "Troca de fralda", "Arroto", "Colo / pele a pele").
- `suggested_cause` (optional select, **hidden**, label "First suggestion" / "Primeira sugestão"): `hunger`, `sleepy`,
  `diaper`, `gas`, `comfort`. What the app ranked first when the parent used "Why is she crying?", saved with the spell
  so we can later measure whether the ranking helps (compare it with `what_helped`). It is never shown as a diagnosis:
  hidden fields are not drawn in the event sheet nor in the detail line.
- Unknown option values are rejected like any other select (400 `validation_failed` with the field); both fields are
  optional. Export/import round-trips them (the backup import validates against the type definition).
