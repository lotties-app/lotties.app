# 03 Interaction design: fast logging

Lens: how a tired parent logs an event (one hand, dark room, maybe offline, twins, two caregivers). This is a code audit: `screenshots/` is empty. Platform facts come from web search (sources at the end). Nothing was tested on real devices.

Prototypes (390 px, inline CSS and JS, with an EN/PT-BR toggle):
- `mockups/03-quick-log.html`: Home dock, choice trays, receipt toast (undo and time shift), timer bar (nursing L/R, Wake-up, a forgotten timer) and twins.
- `mockups/03-command-bar.html`: the + sheet with suggestions, repeat, and a natural-language entry with a live preview.
- `mockups/03-event-sheet.html`: the full sheet and field library: time ruler, steppers, conditional fields, medication, validation, undo, 130/160 % text.

## 1. Audit

| # | Problem (evidence) | Effect |
|---|---|---|
| A1 | Home tiles are raw event types (`BabyHome` → `QuickActions`): 8+ tiles of 96 px at the top of the page. `runPreset`/`undoPreset` (Wake-up auto-stop, Fell-asleep inference) is tested but not wired to the UI. The FAB opens `TrackSheet`, which is a placeholder. | The "+" is a dead end; tiles sit out of thumb reach. |
| A2 | The Feeding tile starts a timer with `{}`; Stop completes it with no required `method`, and the API rejects it. | Silent dead-letter, seen only as a sync warning. |
| A3 | The web has no `visibleWhen`: all 7 feeding fields render, and `buildPayload` sends any filled one (e.g. `side` after switching to Bottle). | The API rejects the save (400) and the event dead-letters. Hidden required fields block Save. |
| A4 | Feeding sheet = **11 controls** + 2 buttons, with Save below the fold; Diaper = 4 controls for 1 decision. Changing Type silently wipes the values. | Load, scrolling, lost input. |
| A5 | Every time is a native `datetime-local`: "15 min ago" takes ≥ 3 taps of wheel work, and the picker can't be themed. End reads "Leave empty while it is still running". | The slowest step, and the owner's "ugly calendar". |
| A6 | Breast fields are raw seconds (`s`); bath uses `C`; `mood` is free text. Sleep `kind` is a 6-option dropdown that includes markers (`woke_up`) on a duration event. | Typing 480 for 8 min; contradictory records. |
| A7 | Notched outlined labels; the medication unit field is ~100 px wide with "Unidade de {name}". | Clipped labels. |
| A8 | All errors go in one `Alert` below Notes, with no field marked and no focus move. Sync rejections show only an icon with a tooltip, and tooltips don't work on touch. | Unseen, unfixable errors. |
| A9 | Medication: checkboxes plus free-text amount and unit ("needs a unit"); no search, no "same as last". | Slow, and error-prone. |
| A10 | A running tile is disabled at 50 %; Stop is red; no way to say "started 10 min ago"; timers only on Home; no live region, no forgotten state, no "who". | Looks broken, wrong times, lost timers. |
| A11 | No Undo; delete needs a modal; instant logs give no confirmation. Custom types get generic controls. | Fear of mis-taps; custom types feel second-class. |

## 2. Interaction model: tap logs, the toast forgives, hold reveals

Three depths:
1. **One tap** commits with smart defaults: Nap, Wake up, Bedtime, Fell asleep, Night waking, Nursing, Tummy time, Bath, Repeat chips.
2. **Two taps**: a tile with one required choice opens a **choice tray**, a short sheet rather than a form. Diaper: Wet/Dirty/Mixed commits. Bottle and Medication: "Same as last", or chips/checklist and Log. Belly pain: 1-5. Trays add *For* (twins), *When* chips and "More details".
3. **Full sheet**: from a long-press on a tile, Edit in the toast, More details, or a timeline row.

**Receipt toast**, after every create, stop and delete:
- Shows a summary in words ("Bottle · 90 ml · Formula", "Woke up · Nap 1h 12m").
- Offers **Undo**, time-shift chips **Now / −5 / −10 / −15**, **Also Bia** (twins) and **Edit**.
- Stays 6 s, pauses while touched or focused, one at a time.
- The shift chips capture "started 10 min ago" and "woke 5 min ago" with no picker.

**Defaults** come from the latest *synced* event, so both caregivers share them:
- Method, amount and content: the last value, labelled "· last".
- Nursing side: opposite to where the last feed ended.
- Medication: "Same as last" is one tap.
- Diaper content is never defaulted: a wrong silent value costs more than one tap.

**Long-press** (500 ms, haptic tick) is only a shortcut; each target also has a visible path. Timeline rows get a ⋯ menu (Repeat now, Edit, Delete with undo). **No row swipes**: §11 uses swipe to change day.

**Command bar** (prototype B):
- Lives in the + sheet, docked at the bottom and *not* auto-focused.
- Uses a local, deterministic grammar that reads English and Portuguese at once.
- Shows a live chip preview: tap a chip to fix it, press Enter to commit. Missing required values are asked as chips; unknown words become "→ note" chips.
- No LLM and no network, so it works offline.
- Above it: **Likely now** (from predictions) and **Repeat** (the last 3 combinations).

| en | pt-BR | Result |
|---|---|---|
| `bottle 120 breast milk 10 min ago` | `mamadeira 120 leite materno há 10 min` | bottle, logged 10 min ago |
| `poop` / `wet diaper` | `cocô` / `fralda xixi` / `xixi e cocô` | diaper |
| `nap 15 min ago`, `nap 13:10-14:05` | `soneca há 15 min`, `soneca das 13h10 às 14h05` | timer started earlier / finished nap |
| `nursing left 8 right 6` | `mamou esquerdo 8 direito 6` | finished feed, seconds per side |
| `colidis 5 drops`, `colidiz`, `meds` | `colidis e puravit`, `remédios` | medication (fuzzy match; bare = same as last) |
| `woke up 5 min ago` | `acordou há 5 min` | wake marker, stops the running sleep |

**Time entry.** Chips first: Now / 5 / 15 / 30 min ago. "Other time" opens an *inline* panel with:
- Day: Today / Yesterday / Other day (a 14-day strip, no month calendar).
- A large **HH : MM** you can type into (it auto-advances) or step, with hold-to-repeat. 24 h in pt-BR, AM/PM in en.
- A **time ruler**: drag, wheel or arrow keys, 4 px per minute. Other events show as dots ("after the 13:10 diaper"); the future is hatched and blocked.

Drop the MUI X picker from logging. Duration types show **Start · duration chip · End**:
- Editing the duration moves the end.
- A **Still running** switch replaces "leave empty".
- A zero-length Feeding (bottle) shows one pill plus "Add an end time". This also solves backlog #18 (bath with an optional duration).

**Twins and caregivers**: trays offer *For: Alice | Bia | Both*, and the toast offers "Also Bia". "Both" writes two events in one transaction. Nobody is asked who they are; initials appear when someone else logged ("by Rafa", from `createdBy`).

## 3. Timers

- **Timer bar on every screen**, above the bottom nav: at most 2 bars, then "+n". The clock is tabular and `aria-hidden`. The main action depends on the timer:
  - sleep → **Wake up** (marker + stop)
  - night waking → **Back asleep**
  - nursing → **L | R** with per-side clocks, plus Stop
  - anything else → Stop

  Tapping the bar opens a sheet with start shift (−15 … +5), kind (Nap/Night) and Discard (with undo).
- **Running tiles toggle**: a tap stops the timer, with undo. Never disabled.
- **Nesting**: night waking runs inside a night. Wake up stops both; Nap stops any other sleep.
- **Nursing segments**: a side switch closes a segment; Stop writes the per-side seconds and `side`.
- **Stop never creates an invalid event**: if required fields are empty, Stop opens the tray for them.
- **Forgotten timers**: threshold = max(2 × the baby's median duration, a default). Defaults: nap 3 h, night 14 h, nursing 60 min, tummy 30 min, waking 2 h.
  - The bar turns amber: "Still asleep? Nap running for 3h 40m".
  - It offers **Ended 12:17** (start + median, or the time of the next logged activity) and **Still going** (snoozes 1 h). No modal.
- **Two caregivers**: if sync shows two running timers of the same preset that started within 10 min of each other, offer "2 naps running (you, Rafa) · Keep earliest".
- **Awake window**: derived from events and shown in the hero, not run as a timer.
- **Notifications**: push is an MVP non-goal, and closed-app reminders need push (Notification Triggers was abandoned). So: in-app now, server push in P2.

## 4. Feedback and forgiveness

- **Optimistic by construction**: the Dexie write is the commit. The toast appears in under 100 ms, with no spinners.
- **Undo instead of confirmation**: create, stop, Wake-up (which re-opens the timer), delete (drop `ConfirmDeleteDialog`), type change, discard. Undo uses the same commands, so it syncs.
- **Quiet sync**: one header icon. A row dot appears only when a change is pending for more than 60 s or has failed. No "Synced" toasts; offline is a state, not an error.
- **Prevent rejections**: mirror `visibleWhen` and required-on-completion in `formModel`, and strip hidden values. Anything that still fails gets a fix path: "1 change wasn't saved: Feeding at 02:10 needs *How*. **Fix**" opens the sheet focused on that field.
- **Copy**: say what to do, at the field, without repeating the label. "Choose one to save" / "Escolha uma opção para salvar". "Up to 400 ml" / "Até 400 ml". "End is before the start" / "O fim está antes do início". "Can't be later than now" / "Não pode ser depois de agora".
- **Haptics**: Android only. 10 ms on commit and 10-40-10 on undo, behind a setting. This revises DESIGN §5's "haptic-free".

## 5. Platform capabilities

| Capability | Support (Oct 2026) | Use | Pri |
|---|---|---|---|
| Manifest `shortcuts` | Chromium Android/desktop; not iOS | "Start nap", "Log bottle", "Diaper", "Wake up" → `/?action=…` commits for the last baby, then shows the toast | P1·S |
| Vibration | Android Chromium only | commit/undo ticks | P1·S |
| `visualViewport` / `interactive-widget` | broad | keeps the command bar above the keyboard | P1·S |
| Screen Wake Lock | Chromium; Safari 16.4+, broken in Home Screen apps until ~iOS 18.4 | opt-in "Keep screen on" for nursing and tummy timers; release on stop or hide | P2·S |
| Web Speech | Chrome sends audio to Google by default; on-device `processLocally` is limited (Edge lists pt-PT, not pt-BR) | opt-in mic with the privacy notice (prototype B). Keyboard dictation already feeds the parser today | P2·M |
| Push with actions | needs a server; actions on Android, not documented on iOS | forgotten timer, "Rafa started a nap", Stop / Switch side | P2·L |
| Badging | iOS 16.4+ Home Screen (needs notification permission); Chromium | running-timer count, off by default | P2·S |

Web Share (day summary) is P2. Skip widgets: only Windows/Edge supports them.

## 6. Accessibility

- **Targets**: at least 48 px, 56 for primary actions. Toast chips are 36-40 px with 8 px gaps.
- **Reach**: every logging action sits in the bottom ~45 % of the screen. The sheet's X is backed by swipe-down, Back, Esc and the scrim.
- **Focus**: trays focus their first choice. Closing returns focus to the trigger. The toast never steals focus; Undo is reachable with Tab and with Ctrl/Cmd+Z.
- **Screen readers**:
  - The toast is `role=status`; timers announce start and stop only.
  - Segmented controls are radiogroups with a roving tabindex.
  - The ruler is a `slider` with valuetext ("02:20, 23 minutes ago"): ±1 / ±15 min, Home = now.
  - Errors use `aria-invalid` and `aria-describedby`, announce "1 thing to fix" and move focus to the field.
- **Timing**: the undo window pauses on interaction (WCAG 2.2.1). The row ⋯ menu covers later deletes.
- **Reduced motion and forced colours**: no slide, scale or progress animation. Forced colours get borders. Selection also shows a check or a weight change.
- **Text scaling**: labels above controls wrap. Container queries stack segmented options under 320 px. Prototype C shows no horizontal overflow at 100/130/160 % × en/pt × 8 scenarios.
- **Colour-blind**: sleep indigo vs night-waking violet, and health rose vs diaper amber, merge for deutan and protan users. Icon + label is always required.

## 7. Field library

Shared rules: the label sits above the field (12/500, muted) and wraps. Optional fields say "· optional"; there are no asterisks. Errors appear under the field. Save never disables; it explains. Viewers see plain text.

| Component | When | Behaviour |
|---|---|---|
| Segmented | select, ≤ 4 options (≤ 3 if a label is over 12 characters) | Icon + label. Re-tapping clears an optional field, never a required one. Arrow keys move. Stacks when narrow. States: default, selected (fill + ring + weight), focus, error. |
| Choice tiles | the one required choice (diaper) | 96 px tinted tiles; in a tray, a tap commits |
| Chips | 5-12 options or optional attributes (mood, custom "Where") | Wrap, never scroll sideways. Over 12 options → searchable list. |
| Stepper | number | Big value, −/+ at 56 px. Step per field: ml 10, °C 0.5/0.1, drops 1, ml-dose 0.5, mg 5. Hold repeats (400 ms, then every 90 ms). Tap to type (`inputmode=decimal`, locale comma). Clamps with "Up to 400 ml". Quick chips include "· last". |
| Duration | `*_seconds` | Typed in minutes, stored in seconds. L/R shown as a pair. Prefer filling it from the timer. |
| Time | start/end | Chips + pill + inline panel (§2). Never in the future; end ≥ start. |
| Text / Notes | short text / every type | One line with chips of previous values (food). Notes stay collapsed until tapped, then auto-size, with a counter from 1800/2000. |
| Medication | medication | "Find or add" (a miss offers "Add 'x'"). Cards with a check, a Usual tag, a dose stepper and the **unit as a choice** (drops/ml/mg). "Same as last". Save reads "Save · 2 medications". |
| Scale | intensity 1-5 | Five 60 px buttons, anchored Mild … Severe |
| Bool | yes/no | A full-width switch row; the label is the row |

## 8. Recommendations and tap counts

| Pri | Recommendation | Effort |
|---|---|---|
| P0 | Mirror `visibleWhen` and required-on-completion on the web; never send hidden values (A2, A3) | S-M |
| P0 | Wire presets into Home and the Track sheet; split Feeding into a Bottle tray and a Nursing timer | M |
| P0 | Receipt toast with Undo and time shift for every log, stop and delete; remove the delete confirm | M |
| P0 | Time chips, pills and the inline panel replace `datetime-local`; add the "Still running" switch | M |
| P0 | Errors at the field, with focus and announcement; a Fix path for dead-lettered events | S-M |
| P1 | Choice trays with "Same as last" and last-used defaults taken from events | M |
| P1 | Timer bar on every screen, toggling tiles, nursing L/R segments, start and wake offsets | M |
| P1 | Field library; translated units (°C, min); mood as chips; sleep kind limited to session kinds | M |
| P1 | Forgotten-timer state and duplicate-timer merge | S-M |
| P1 | Command bar with the local en/pt-BR parser | M-L |
| P1 | Manifest shortcuts, haptics, keyboard-safe command bar | S |
| P1 | Twins *For* row and "Also Bia"; caregiver initials | S-M |
| P2 | Opt-in voice; push with actions; badge; wake lock; share; left-hand mirror | M-L |

Counting rules: deliberate touches only, keystrokes counted separately, and a native picker counts as ≥ 3.

| Task | Today | Proposed |
|---|---|---|
| Wet diaper, now | 3 (Diaper, Wet, Save) | **2** (Diaper, Wet) |
| Bottle 90 ml formula, 10 min ago (90 = last) | ≥ 12 + 2 keys (no bottle tile: Feeding starts a timer, card, Bottle, amount, Formula, picker ≥ 3, Save, Stop) | **3** (Bottle, Same as last, −10) |
| Nap that began 10 min ago | ≥ 8 (Sleep, card, picker ≥ 3, kind 2, Save) | **2** (Nap, −10) |
| Baby woke 5 min ago | ≥ 7 (Stop, Timeline, row, picker ≥ 3, Save) | **2** (Wake up, −5) |
| Nursing: left 8 min, right 6 min | 9 + 6 keys, plus converting to seconds | **3** (Nursing, R, Stop) |
| Two usual medications | 4 (Medication, ✓, ✓, Save) | **2** (Medication, Same as last) |

Undoing a mis-tap goes from 4 taps (Timeline, row, Delete, Confirm) to **1**.

**Divergences from DESIGN.md for the owner to confirm**:
1. The inline time panel replaces the MUI X picker (§10).
2. Bottle, Diaper and Medication open trays instead of the sheet (§5).
3. Undo replaces the delete confirm.
4. Light haptics.
5. The + sheet field is not auto-focused.

Sources: [MDN shortcuts](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts), [WebKit iOS 16.4](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit 254545](https://bugs.webkit.org/show_bug.cgi?id=254545), [Chrome Wake Lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock), [MDN processLocally](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally), [Edge speech](https://learn.microsoft.com/microsoft-edge/web-platform/speech-recognition-api), [Huckleberry](https://huckleberrycare.com/product/free). Huckleberry has timers, widgets, lock-screen updates and paid AI logging. Baby Buddy users ask to edit a running timer's start.

## Summary

1. Today's logging breaks in three places: "+" is a placeholder, a Feeding timer completes into an invalid event, and hidden feeding fields are sent and rejected.
2. The preset/undo layer is already built and tested; wiring it in is the highest-value fix.
3. Model: one tap logs, a 6 s toast forgives (Undo + time shift), long-press opens the full sheet.
4. High-variance required choices are always asked in a two-tap tray; low-variance values get visible "last" defaults.
5. Toast chips (−5/−10/−15) capture "started 10 min ago" and "woke 5 min ago" without a picker.
6. A timer bar on every screen (Wake up, Back asleep, nursing L/R, forgotten state) replaces the disabled tiles.
7. Time entry: chips, then an inline HH:MM and a draggable ruler; no calendar while logging.
8. A local, offline en/pt-BR command bar with a chip preview; voice is opt-in, and keyboard dictation works today.
9. Accessibility: actions in the bottom zone, radiogroups, a valuetext slider, errors at the field, reflow at 160 %, never colour alone.
10. The six core tasks drop from 3-12+ taps to 2-3, and fixing a mis-tap takes 1 tap instead of 4.
