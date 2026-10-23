# 20. Feeding amounts, ended by sleep, and timing bottles

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

- Stored **per baby, on this device**, in localStorage `baby-routine.time-bottles.<babyId>` (`presets/timeBottlesStorage.ts`),
  the same pattern as the pinned presets (`pinnedStorage.ts`): cleared when the baby leaves the device
  (`clearBabyDeviceState`) and on sign-out or account switch (`clearAccountDeviceState`). It is not synced: another
  device has its own choice. Settings > Feeding (shown to roles that log events).
- **Off (default):** the Bottle quick action (the Bottle preset: Track sheet, More sheet, pinned tile) does not start
  a timer. It opens the event sheet for a new bottle as a moment (start = end = now, no "Still running"), which asks
  the prepared and drunk amounts. The Feed tray already logged a bottle at once and keeps doing so, now with the
  drunk row. In the event sheet a **new** bottle is a moment too; editing a stored bottle keeps its times.
- **On:** current behaviour: the Bottle preset starts a timer, the stop sheet asks the amounts, the sheet's new
  bottle is "Still running".
- **Nursing always keeps its timer**, in both settings.

## Doubts and choices to review

- Suggestions use the drunk history (as asked), so a baby that always leaves 40 ml gets chips around the drunk
  amount rather than the prepared one; the "last prepared" chip still shows the previous prepared amount.
- A manual (past) nap or night entered in the sheet also stops a feeding timer that started before that nap and still
  runs; a feeding that started after the nap is left alone.
- Bedtime (`bed_time`) is a marker, not a sleep start, so it does not stop a feeding.
