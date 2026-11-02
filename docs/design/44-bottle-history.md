# 44. Bottle history, editable at any time

Status: design agreed with the owner on 2026-11-02, nothing built. Extends [20-feeding-amounts.md](20-feeding-amounts.md)
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
