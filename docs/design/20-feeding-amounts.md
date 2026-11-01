# 20. Feeding amounts, ended by sleep, timing bottles, and the wake-up a night logs

Owner feedback (2026-10-22): a bottle is prepared, then the baby drinks some of it; a feeding that is still
running when the baby falls asleep is over; and a bottle does not need a timer. Three rules, one change.

## 1. Prepared and drunk

A bottle has two amounts in the generic feeding payload (no new table):

| Payload key | Meaning | Rules |
| --- | --- | --- |
| `amount_ml` | amount **prepared** (label "Amount prepared") | number >= 0, visible when method = bottle (unchanged) |
| `amount_drunk_ml` | amount **drunk** (label "Amount drunk") | number >= 0, visible when method = bottle, optional, never above `amount_ml` |

- **Old bottles count as fully drunk.** A bottle with no `amount_drunk_ml` was drunk entirely, so every older bottle
  keeps its totals. The client stores "all" as *no* `amount_drunk_ml` (`withoutRedundantDrunk`), so changing the
  prepared amount later never leaves a stale drunk value above it.
- **API.** Built-in feeding field `amount_drunk_ml` (seed, migration `FeedingAmounts`, stored events untouched) and
  the cross-field rule `BottleAmounts.EnsureDrunkWithinPrepared` (400 `validation_failed`, field
  `amount_drunk_ml`), checked by `EventService` for the built-in feeding type on create and on a payload change.
  Mirrored on the client in `payloadRules.validatePayload` (so a stop the server would reject is asked again, never
  dead-lettered) and in `formModel.formProblems`. The Napper importer is unchanged (it only knows what was given).
- **Where the drunk amount is used.** `drunkMl(payload)` (`web/src/events/bottleAmounts.ts`) = the drunk amount
  (clamped to the prepared one), else the prepared one: bottle ml per day (Insights, `feedingModel`), the formula
  comparison (`formulaComparison`, ml per day and per kg), the hand-over summary (`catchUp`), and the bottle
  suggestions (`bottleSuggestions`: the typical amount, top-ups and frequent amounts come from what the baby
  drank). The last or remembered amount that is always one of the chips stays the last *prepared* amount, because
  the chips fill the prepared field. The Today strip is not touched here (another change owns it).
- **Display.** `80 of 120 ml` (pt-BR `80 de 120 ml`) in the detail line, the Feed tile and the Feed tray toast when
  less was drunk than prepared; `120 ml` when all of it was.
- **Entering it.**
  - Event sheet and the "Finish this feeding" sheet: the drunk field has quick choices for **all, 3/4, half and
    1/4** of the prepared amount (`drunkChoices`: fractions rounded to 5 ml, each amount once, "all" exact) plus the
    stepper for free entry, capped at the prepared amount. Empty means all.
  - Feed tray (Now): after the amount chips, a "How much was drunk" row (default all); the button reads
    "Log 60 of 120 ml formula".
  - The finish sheet is asked until both amounts are set (`planStop` `askedAtStop`); both stay optional, so a stop
    never depends on them.
  - The drunk amount is never remembered as a "last used" value (`recordLastUsed` skips it): it varies per feed.

## 2. A sleep that starts stops the running feeding

`web/src/now/sleepStopsFeeding.ts`, applied where events are created in the web layer:

- `runPreset` (Nap, and Fell asleep which starts the inferred sleep timer; therefore also the Now sleep toggle) and
  `createEventStoppingFeeding` (the event sheet, a new `nap` or `night`, also a manual past one).
- Not a sleep start: Bedtime, Wake-up, Night waking, Fell asleep's own marker, or an edit.
- Every running feeding of the baby that started at or before the sleep start is stopped **at the sleep start**,
  with `ended_by: "sleep"` in its payload (hidden built-in feeding field, select with the single option `sleep`).
  A nursing session closes its open side into its seconds (same payload as Stop); a bottle keeps what it has and is
  never asked for amounts. Pauses are folded into `paused_seconds` by the usual finish.
- It is part of the same local transaction as the sleep (events + outbox), so the stop is one idempotent upsert per
  event and syncs like any stop. `UndoToken.edited` records the feeding's earlier state: Undo re-opens it, and the
  toast's time-shift chips move its end together with the sleep start.
- A running feeding whose payload would need details first (no `method`) is left running and listed in
  `needsFinish`.
- **Roles are unchanged.** Owner and Parent stop any feeding. A Caregiver stops her own, and someone else's only
  when the stop changes nothing but the end and `ended_by` (`isRunningControlChange`, the server's
  `RunningEventControl`): that is a bottle timer; someone else's nursing session stays locked and keeps running.
  Viewer and Doctor log nothing, so they never start a sleep.
- **Shown** in the detail line as "Stopped when sleep started" (pt-BR "Encerrada quando o sono começou").

## 3. Setting: Time bottle feedings (default off)

- A preference of the **signed-in account**: one value for all its babies, because caregivers differ (one parent
  records when the feeding ended, the other does not). **Stored on the server per account** (2026-11-01, so the voice
  assistants can follow it): table `user_feeding_settings` (`time_bottle_feedings`, one row per user, created on the
  first PUT), `GET/PUT /me/feeding-settings` (`{timeBottleFeedings: bool|null, updatedAt}`; `null` before the first
  save, every reader treats it as off), any signed-in role, never in the baby backup file, erased with the account.
  The web keeps a cache in the account's localStorage entries, key `baby-routine.time-bottles`
  (`presets/timeBottlesStorage.ts`), so `loadTimeBottles()` stays synchronous and works offline; it is cleared on
  sign-out or account switch (`clearAccountDeviceState`, `claimDeviceState`) so it never leaks between accounts;
  leaving one baby does not touch it. `presets/timeBottlesSync.ts` keeps it in step (the pattern of the unit
  setting): a toggle writes the cache and marks it pending (`baby-routine.time-bottles-pending`), then PUTs; a failed
  PUT stays pending and is retried on the next load and when the device is back online, and a pending value is never
  overwritten by the server's; on load (`FeedingSettingsSync`, mounted in `App`) the server's value refreshes the cache,
  and when the server has none yet the value this device already has is uploaded once, only if it is on (so people who
  opted in before keep it, and nobody gets a row for "off"). Settings > Feeding, next to Appearance and Language, shown when the user can log events
  on at least one baby; the helper text says it applies to the account on all babies.
- **Migration.** The first version stored it per baby (`baby-routine.time-bottles.<babyId>`). On first read the
  old keys are folded in once: if any baby had it on, the preference is on; the old keys are then deleted.
- **Voice assistants** (docs/design/32-assistants.md section 5): with it on, a bottle by voice (Alexa `BottleIntent`,
  MCP `log_bottle`) starts running with the prepared amount (`amount_ml`, no `amount_drunk_ml`, `ended_at` null, the
  same shape as the Feed tray) and the answer is `bottle_started`; off, it is an instant as before (`bottle_logged`).
  It is stopped, with what was drunk, in the app.
- **Off (default):** the Bottle quick action (the Bottle preset: Track sheet, More sheet, pinned tile) does not start
  a timer. It opens the event sheet for a new bottle as a moment (start = end = now, no "Still running"), which asks
  the prepared and drunk amounts. The Feed tray logs a bottle at once, with the drunk row. In the event sheet a **new** bottle is a moment too; editing a stored bottle keeps its times.
- **On:** current behaviour: the Bottle preset starts a timer, the stop sheet asks the amounts, the sheet's new
  bottle is "Still running".
  The Feed tray follows it too (2026-11-01, owner feedback): its bottle chip starts the timer with the prepared amount
  (the drunk row is not asked, it is known at stop), so nothing has to be marked "Still running" by hand. The widget's
  bottle choices go through the same path. The Day row of a bottle that paused says how many times and the level at each
  pause ("2 pauses · 80 → 30 ml left", `events/bottlePauses.ts`).
- **Nursing always keeps its timer**, in both settings.

## 4. A night that ends logs the wake-up

Owner feedback: stopping the night sleep left the baby "asleep until the next event" for the ring, the day timeline,
the "Last" texts and the predictions, because only the Wake-up preset logged the `woke_up` marker.
`web/src/now/nightEndsWakeUp.ts`, the same pattern as section 2 (a rule that runs inside the command's transaction):

- **Model.** The night is a built-in `sleep` timer with `kind: "night"`; the wake-up is a `sleep` instant
  `{kind: "woke_up"}` (start = end). No new field, no migration.
- **When.** Any stop that ends a running night: Stop on the Running now card, the header pill, the timer sheet and
  the Day screen (all `usePresetActions.stop` -> `useStopTimer` -> `stopLoggingWakeUp`), "Finish this ..." and an
  edit in the event sheet that sets the end of a running night (`editFollowingWakeUp`). The marker is created at the
  night's end, in the same local transaction (events + outbox), as the current user (a Caregiver stopping someone
  else's night: her own marker, the stop itself stays the running-event exception). It works offline and syncs as
  ordinary upserts.
- **Never.** Naps, a pause or resume, night wakings (`night_waking` is not a wake-up), a stop that leaves the night
  running ("Finish this ..." opened).
- **No double.** Nothing is created when the night already has a wake-up: its automatic one, or any live `woke_up`
  from the night's start to 15 minutes after its end (a hand-logged one, or the assistant's, synced). The Woke up /
  Up for the day buttons (the Wake-up preset, `runPreset`) stop the night and log their marker under the night's
  automatic id, so the rule finds it.
- **Deterministic id.** UUID v5 (`util/uuidV5.ts`, the same algorithm as the API's `DeterministicGuid`, synchronous
  so it runs inside the Dexie transaction) of `<sleepId>|wake|<generation>` in the namespace
  `0b7e5d2a-3c41-5f86-9a1d-6e2f8c4b7a90`. A retry or a sync replay upserts the same id. The API keeps a deleted id
  deleted, so after an Undo (the stop's toast removes the marker and reopens the night) the next stop takes the next
  generation (up to 16; then the rule logs nothing). Being one of the night's derived ids is what makes a marker
  "automatic"; there is no payload flag.
- **Edits of a finished night** (event sheet): its end moves -> the automatic wake-up moves with it; the night becomes
  a nap or runs again -> the automatic wake-up is soft-deleted. A hand-logged wake-up is never touched and nothing is
  created for a past night. A Caregiver only changes a marker she logged.
- **Undo.** The stop's toast token lists the marker in `createdIds`: Undo removes it and reopens the night together.
- **Deleting a night** (event sheet, Day timeline, a timer's discard, the Undo of a preset that created it:
  `deleteEventWithWakeUp`) soft-deletes its live automatic wake-up in the same transaction; a hand-logged or
  assistant wake-up stays, and a Caregiver only deletes a marker she logged. Deleting again changes nothing. The
  "deleted" toast's Undo (`restoreDeletedEvent`) writes the night again under a new id (the API keeps a deleted id
  deleted) and its wake-up under the restored night's automatic id, in one transaction.
- **Assistant.** The server's `LogSleepEnd` still logs its `woke_up` under the request-derived id (needed for its
  retry detection; no API change). The web finds that marker by the 15-minute window, so a voice stop followed by a
  sync gives one marker. Known edge: a voice stop and an offline web stop of the same night before either syncs give
  two markers a few minutes apart (both legitimate wake-ups; one can be deleted).

## 5. Drinking stretches of a timed bottle (2026-10-24)

Owner request: each pause/resume should keep the level that was in the bottle and how much the baby drank until the
next pause or the end, asked at the pause and at the stop, optional and one tap, so predictions learn her amounts
and pace. Only timed bottles ("Time bottle feedings" on) have pauses; with it off nothing changes.

- **Data.** Hidden built-in feeding field `segments` (text, visible when `method` = bottle; migration
  `BottleSegments`, seed only). Text because the field kinds have no list or object: `start>left@seconds` per
  stretch, joined by `;`, e.g. `120>70@300;70>0@240`. A stretch runs from the start or a resume to the next pause
  or the stop; `start` is the level when it began (the prepared amount for the first), `left` the level when it
  ended, each whole ml 0-2000 or `?` (unknown: the question was skipped), `seconds` its drinking time (0-86400,
  pauses excluded). At most 20 stretches, 400 characters. Levels rather than drunk amounts are stored so a level
  reported without a known start (no prepared amount) is never lost; what was drunk in a stretch is `start - left`
  when both are known. Old bottles and bottles never paused have no `segments` and work as before.
- **Totals stay single-sourced.** `amount_drunk_ml` (absent = all) is still what every total reads (Insights, the
  formula comparison, the clinical summary, the assistants). The stretches only add detail.
- **Rules** (Domain `BottleSegments.EnsureValid`, 400 `validation_failed` field `segments`, called by `EventService`
  for the built-in feeding type; mirrored by `segmentsProblem` in `web/src/events/bottleSegments.ts`; both read the
  shared vectors `web/src/events/bottleSegmentsVectors.json`): the grammar and bounds; a stretch never ends above its
  start; a stretch starts where the previous one ended (both known and equal, or both unknown); no known level above
  `amount_ml`; what the known levels say was drunk (`amount_ml` minus the last known level) is never above the
  total; once the feeding ended, a known last level matches the total (`amount_ml - left = total`).
- **Writing them** (`web/src/db/eventCommands.ts`, all local and synced as ordinary upserts):
  - `pauseTimer` of a built-in bottle closes the open stretch with an unknown level: start = the previous level
    (or the prepared amount floored), seconds = drinking so far minus the earlier stretches.
  - Then "How much is left in the bottle?" (`events/bottleLevelPrompt.ts` store, `BottleLevelPromptHost` in the app
    shell): a small bottom sheet, the pause already saved. Chips Full, 3/4, Half, 1/4, Empty of the prepared amount
    (rounded to 5 ml, none above the level the stretch started at; a radio group of 44 px chips), an ml stepper with
    Save, and Skip; Esc and tapping outside close it too. Without a prepared amount only the stepper shows. An
    answer fills that stretch only (`recordBottleLevel` with the stretch count, so a late answer never lands on a
    newer one).
  - The stop (`stopEvent`, `finishEvent`, an edit that ends it) closes the last stretch with the level the totals
    give (prepared minus drunk; no drunk amount = all = empty). Stopped while paused: the last stretch takes that
    level instead of a 0 s stretch. Every save keeps the stretches agreeing with the amounts (`settleSegments`: the
    last level follows the total, else becomes unknown, else the field is dropped), so editing the amounts later
    never breaks a stop.
  - "Finish this feeding" of a timed bottle adds a "Left in the bottle" chip row above the drunk amount; a chip
    fills the drunk amount as prepared minus the level (none above where the open stretch started).
- **Roles.** Who may pause may answer: the running-event exception now also lets `segments` change on someone
  else's running bottle (API `RunningEventControl`, web `isRunningControlChange`), like the pause keys.
- **A sleep that stops a bottle** (section 2) closes its last stretch with an unknown level and asks nothing at
  that moment. On Now, under "Running now", a small calm row (`now/bottleFollowUp.ts`, `BottleFollowUpRow`):
  "Lia fell asleep during the bottle. How much was left in it?" with the same chips and Skip. Shown for the latest
  feed only, when it is a built-in bottle with `ended_by: "sleep"`, a prepared amount, no drunk amount and no
  known last level, ended at most 12 hours ago, and only to who may change it. Answering fills the last stretch and
  the drunk total; Skip stores the bottle's id (per baby, per account, cleared with the account's device state) and
  it never comes back for that bottle; unknown stays unknown.
- **Fell asleep while feeding** is derived, never written on the sleep: `fedToSleep(sleep, feedings)` = the
  feeding with `ended_by: "sleep"` that ended at the sleep's start instant (`bottle` or `nursing`). The Day row and
  the read-only detail of that sleep add a quiet "Fell asleep during a bottle" / "Fell asleep during nursing".
- **Predictions** (pure `web/src/events/bottlePatterns.ts`, local log only, `null` without enough data):
  - A bottle a sleep stopped with no amount given has an unknown amount (`hasUnknownFinish`): the totals still
    count it as fully drunk (the old rule), but the bottle suggestions (typical amount, top-ups, frequent amounts)
    and the patterns below now leave it out instead of counting it as fully drunk.
  - Pace (`bottlePace`): median ml per minute of drinking (pauses excluded) of her timed bottles of the last 14 days
    with a known amount (at least 3, 1-60 ml/min), plus her typical stretch (median ml between pauses, 3+ known).
    A running bottle shows "A bottle usually takes about N min" with the same quiet flag and progress bar as a sleep
    target (`BottleTimerTarget`, Running now card and timer sheet): prepared (else her usual amount) over her pace,
    3-90 min, never a goal.
  - Top-up (`topUpAdjustment`): when her latest finished feed is a bottle with a known drunk amount under 70% of her
    usual amount at that part of the day (median of her known amounts, day 07-19 or night 19-07, else all, 3+), the
    next feed is expected earlier by half of the missing share, at most 30% of her usual gap. Used where the client
    computes "time to the next feed": the hunger ramp of "Why is she crying?" (its fact says "that feed was smaller
    than usual"), and the "Next up" feed on the day ring, the ruler and the Next up list (`now/upcoming.ts`, 2026-10-24):
    the same two functions (`topUpAdjustment`, `adjustedFeedGap`) applied to the gap from the last feed to the expected
    time (her own gap, the server basis gap, the age norm gap, or the server's expected time); a server window opens
    as much earlier and keeps its end. The item carries `partialFeed` (drunk, usual, ended by sleep, minutes earlier)
    and its text adds "The last one was smaller than usual (80 of about 120 ml), so a top-up is expected sooner"; the
    expected amount is unchanged. The server's feeding prediction itself is unchanged. No partial feed, an unknown
    amount, a nursing or solid feed last, or a feed running: exactly the old behaviour.
- **Other surfaces.** Voice and MCP log the total only (unchanged). The backup keeps the field like any payload
  member (round trip tested). The Napper import writes none. Insights: no "finished vs interrupted" stat yet (it
  would need a new row in the feeding card, a design change).

## Doubts and choices to review

- Suggestions use the drunk history (as asked), so a baby that always leaves 40 ml gets chips around the drunk
  amount rather than the prepared one; the "last prepared" chip still shows the previous prepared amount.
- A manual (past) nap or night entered in the sheet also stops a feeding timer that started before that nap and still
  runs; a feeding that started after the nap is left alone.
- Bedtime (`bed_time`) is a marker, not a sleep start, so it does not stop a feeding.
