# 44. Bottle history, editable at any time

Status: design agreed with the owner on 2026-11-02; built 2026-11-02 (web + API, section 8 records the decisions taken in
implementation and what is not verified). Extends [20-feeding-amounts.md](20-feeding-amounts.md)
section 5 (bottle stretches). Facts only: what happened in the feeding, never advice, never "normal / abnormal".

## 1. Why

Owner feedback: pausing a bottle is confusing. What a parent wants is a **history of what happened in that feeding**, and
being able to fix it quickly when she forgot to pause, pressed the wrong button or guessed a level:

```
12:25  Start          120 ml
12:31  Pause          80 ml left   (drank 40 in 6 min)
12:34  Resume
12:47  Pause          15 ml left   (drank 65)
12:53  Baby fell asleep, 15 ml left (asked if unknown)
Total: drank 105 ml
```

Today the app already keeps the level at each pause (`segments`, `start>left@seconds`, asked at each pause and when a
sleep stops the bottle). Gaps: the clock time of each pause and resume is not stored (only `pause_count`, `paused_seconds`
and the open `paused_at`), the screen shows only a summary ("2 pauses, 80 → 30 ml left"), and nothing can be corrected
except the final amounts.

## 2. Decisions (owner)

- **Editable at any time**, while the bottle runs and after it ended. It must be practical: few taps, no mode switch.
- Rows can be changed (time, level), **added** (a missed pause) and **removed**.
- The history is the source; the totals (`amount_drunk_ml`, `pause_count`, `paused_seconds`, effective duration, end time of
  the last stretch) are **recomputed from it on every save**, so nothing disagrees.

## 3. Model

- Keep the hidden built-in feeding field `segments` as the single place, but each stretch also carries when it began and
  ended, so pauses and resumes have clock times. The grammar and its bounds are decided in implementation and written in
  `bottleSegments.ts` (web), `BottleSegments` (Domain), and the shared vectors `bottleSegmentsVectors.json`; this document
  fixes only the rules below. Old bottles (no times, or no `segments`) keep working: their rows show "time unknown" and the
  parent may fill it in.
- The open pause of a running bottle is the last row with a pause time and no resume; the timer, the Now card, the widgets
  and the lock-screen controls read the recomputed values, never a second copy.
- No new table, no migration if the field stays text (the existing `BottleSegments` seed is the precedent). Backup
  (`lotties-backup`) carries the payload as it does today; confirm in `Lotties.Api.Tests/Backups`.
- No new data flow: privacy policy, `dataFlows.ts` and audit 33 are unchanged.

## 4. Rules (same in API and web, same vectors)

1. Times are in order and inside the feeding: start <= pause <= resume <= ... <= end (a running bottle has no end).
2. Pauses never overlap.
3. Levels never go up and never exceed the prepared amount; a stretch starts at the level where the previous ended.
4. An unknown level is allowed (`?`), as today.
5. The totals are derived: drunk = prepared minus the last known level (no known level: unchanged from what was entered);
   paused seconds = sum of pauses; count = number of pauses.
6. An edit that breaks a rule is refused with the existing `400 validation_failed`, field `segments`; the web shows which
   row and why, and never saves a half-changed history.
7. Roles follow the event: Owner and Parent edit any bottle; a Caregiver edits her own. Someone else's **running** bottle
   keeps the existing exception (a Caregiver may only answer the level, not rewrite the history). A Doctor and a Viewer
   do not edit.
8. Offline, idempotent upsert, `ClientUpdatedAt` conflict rule as for any event edit; Undo restores the previous payload.

## 5. UI (practical)

- In the feeding's detail and in the event sheet: a **History** list like section 1, newest last. The sheet shows the
  recomputed totals live above the Save button.
- A row is tapped to change its time (time picker) and its level (the same chips and stepper as the pause question,
  `BottleLevelChips` + `QuantityStepper`); amounts follow the person's unit setting (docs/design/37), storage stays ml.
- **Add pause** between two rows opens the same two controls with a time inside the gap; **Remove** on a pause row merges
  the two stretches around it.
- The pause question ("how much is left?") stays: one tap at the pause, skippable. The history is where it is fixed later.
- Strings through `t()` in `locales/en/feeding.json` and `locales/pt-BR/feeding.json`; times and numbers via the Intl helpers.
- Widgets and Siri: a pause from a widget, the lock screen or Siri also asks the level when the app opens, or leaves it
  unknown, never blocks the pause; the owner checks this on the phone (the native side only sends the pause).

## 6. Tests

Shared vectors for the grammar and the rules (C# and TS); `Lotties.Api.Tests` for the new/changed `segments` validation and
the role rows (`EndpointRoleMatrixTests` unchanged unless a route is added); web tests for the recompute, the row edits,
add and remove pause, the running bottle edit, and an old bottle without times; widget snapshot test for the recomputed
values.

## 7. Out of scope

Editing breast sessions the same way, advice about how much a baby should drink, charts of the history, and assistants
changing the history (voice and MCP still only start, pause, resume and stop).

## 8. As built (2026-11-02)

### Grammar

- A stretch is `start>left@seconds` as before, optionally followed by `+begin`: when the stretch began, in whole seconds
  from the feeding's start (0-86400, no leading zeros), e.g. the owner's example
  `120>80@360+0;80>15@780+540` (start 12:25; pause 12:31 with 80 left; resume 12:34; pause 12:47 with 15 left). A
  stretch ends at `begin + seconds`; the pause after it lasts until the next stretch begins. Max length raised from 400 to
  480 characters (20 stretches with times). Domain `BottleSegments`/`BottleHistory`, web `bottleSegments.ts`/`bottleHistory.ts`,
  shared vectors `bottleSegmentsVectors.json` (new `totals` and `extends` lists, `lengthSeconds` on payload vectors).
- Offsets, not clock instants: DST- and midnight-safe and short. The start and end rows are the event's own `startedAt` and
  `endedAt`, edited with the sheet's time fields; when those move, `rebaseHistory` keeps every pause at its clock time
  (the sheet's `datetime-local` drops seconds, so even a plain save moves the start by up to 59 s).
- A stretch without `+begin` (bottles from before) shows "time unknown"; tapping its pause or resume row gives it a time
  (keeping its drinking seconds). Mixed histories are allowed.

### Rules (decisions the doc left open)

- Times: a timed first stretch begins at 0; a timed stretch begins at or after the end of the timed one before it; once
  ended, no timed stretch ends after the end. A pause of 0 s is allowed (still counted).
- Totals (`historyTotals` / `BottleHistory.Totals`), only when every stretch has a time and the times keep the rules:
  ended: the pauses between stretches plus the last one up to the end when it stopped while paused; running and paused:
  the pauses between stretches (the open one is `paused_at`); running and drinking: every stretch was followed by a pause
  whose resume is not stored (the open stretch is never written), so that last pause keeps its length from
  `paused_seconds` (never below the others). The drunk total is unchanged: it is the sheet's drunk field, and the existing
  `settleSegments` keeps the last level equal to it (a level at the end sets the drunk field).
- **Where the recompute runs:** the web on every save (`withSettledPause`) and the API on every feeding upsert
  (`EventService` applies `BottleHistory.WithTotals` before validating). The API rewrites `pause_count`/`paused_seconds`
  rather than refusing a mismatch, because older app builds (the phone app bundles the web) and the assistants' stop
  (`AssistantPayloads.Stopped` folds the open pause into `paused_seconds` but never bumps `pause_count`) would otherwise be
  refused. A history that breaks the time rules is refused (`400 validation_failed`, field `segments`).
- Add and remove a pause only on a history with times on every stretch (or a bottle with no pause yet); an old
  untimed history can only have its times and levels filled in, so its stored pause totals are never thrown away.
- At the cap of 20 stretches a pause extends the last stretch as before and drops its time (the pause inside it is no
  longer in the history), so the totals stop being derived rather than becoming wrong.
- A stop while paused no longer adds a 1 s stretch from rounding: `closeAtStop` gets `wasPaused`.
- Rule 7: someone else's running bottle may only have its history extended (`BottleHistory.OnlyExtends` in
  `RunningEventControl`, web `historyOnlyExtends` in `isRunningControlChange`): earlier stretches keep their drinking time
  and begin, none removed, levels may change. The web never offers the History editor there (the read-only sheet shows it
  without controls).

### Widgets, lock screen, Siri, assistants (finding)

- Widget / lock screen / Siri: the native side only writes `feed_pause` to `widget-outbox.json`; on app open
  `widgets/outbox.ts` replays it through `pauseTimer` at the entry's time. That closes the stretch with its time and an
  unknown level (`?`) and never opens "How much is left in the bottle?" (the prompt is only opened by the in-app pause), so
  a pause from outside the app never blocks; the level is filled later from the History. `widgets.test.ts` checks the
  stored `segments` and the recomputed totals after pause, resume and stop.
- Alexa / MCP: there is no pause or resume command in `Application/Assistants` (contrary to section 7's wording); their
  stop writes no `segments` and folds an open pause without counting it. The API's recompute now fixes the count for a
  bottle with a timed history.

### Not verified here

- The web test suite, lint and type check did not run in the implementing worktree (no installed `node_modules` in the
  main clone); CI on the PR is the check. The UI was not tried on a phone (owner check: widget/Siri pause, then the History
  edit).
- No migration (the field stays text); the backup round trip test now uses a timed history.
