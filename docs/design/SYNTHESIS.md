# Design synthesis (2026-10-21) — the plan that supersedes docs/DESIGN.md where they differ

Inputs: five independent reviews in this folder (01 UX strategy, 02 visual identity, 03 interaction, 04 insights, 05 heuristic evaluation of the running app). Owner goals: elegant, refined, very user friendly, more icons, "helps parents help their kids get better every day", not a copy of any competitor, en + pt-BR.

## 1. Decisions

### Product shape (from 01, 03, 04; all agree on the core)
- Home becomes **Now**: a live state card (e.g. "Awake 1 h 52 min · nap window 14:05-14:35") whose one big action changes the state, a hero prediction, "last and log" tiles, a handover/catch-up card, running timers. No centre "+" FAB.
- Navigation: three tabs **Now · Day · Insights**. Day = the redesigned timeline. Insights absorbs Growth. Settings and baby profile live in the account/baby menu in the header. (Sec. 11 of DESIGN.md timeline spec still applies to Day.)
- **Sleep is one toggle** (Asleep / Woke up) on Now; kind (nap or night) is inferred from time and bedtime marker; at night Woke up defaults to a night waking with a "Back asleep" button. The five presets stay as data kinds and as entries in the "More" sheet.
- **One-tap logging with forgiveness**: tiles log immediately with smart defaults (last used amount/method); a toast offers Undo and "-5 / -10 / -15 min" time shift; short choice trays for Diaper (wet/dirty/mixed), Bottle (amount chips), Medication (checklist), Belly pain (1-5). The full event sheet is for editing and for "More".
- **Quick-entry command bar** (typed text, en + pt-BR phrasing, live preview) inside the "More" sheet: P1. Voice: out of scope.
- **Handover**: catch-up card on open (who logged what, since when, next medicine dose allowed), shareable as text: P1.
- **Night view**: dim near-black warm theme, three giant buttons, screen wake lock when available, separate left/right nursing timers: P1, offered (not forced) between 22:00 and 05:00.
- **Insights**: baby compared with her/his own baseline; P0 chart = 14-day sleep rhythm (06:00 to 06:00) with feed/diaper/medication layers; then sleep per day, longest stretch, bedtime/wake strips, feeding and diaper charts; visit summary (printable/shareable) in P1.
- Out of scope for now: percentile curves (needs sex at birth, gestational age: sensitive data, ask the owner later), vaccine/milestone schedules (licence conflict with AGPL for Brazil's Caderneta; yearly maintenance), Web Push, voice input, mascot.

### Visual identity (from 02)
Adopt **direction B "Linen and Ink"**: warm paper/ink palette with a terracotta accent, a serif (Fraunces or Newsreader, SIL OFL, self-hosted variable subset) for names, numbers and times, thin outline icons (Tabler Icons, MIT, via `@tabler/icons-react`, one family everywhere, replacing @mui/icons-material usage progressively), the "day ruler" (awake-window bar) instead of a progress ring. Default colour scheme: follow the system; when the system gives no preference use DARK (night parents), using B's warm dark scheme. Add the third scheme **Night feed** (near-black, one warm tone, blue channel <= 0x78, text ~45% brightness, no motion), offered by a banner/toggle in the header menu between 22:00 and 05:00 and a Settings option (Off / Ask / Auto). Fallback if B tests badly with the owner: A "Dusk". Do not build C (mascot trademark risk).
Token values and the MUI mapping are in 02-visual-identity.md section "Token table (B)": implement them as the single source of truth in `code/web/src/theme/tokens.ts`.

### Interaction decisions (resolving 03 vs DESIGN.md)
- Time entry: inline time panel (chips Now/5/15/30 min ago + typed HH:MM + a compact ruler) replaces the MUI X date-time picker for event times. Pure dates (birth date, measurements) use a themed, localized date control (not the browser's native control, which ignores the app locale: finding m5).
- Labels outside the field, filled inputs, 48px height; steppers and chips for numbers; segmented controls with icons; conditional fields honour `visibleWhen`; values of hidden fields are dropped before sending.
- Undo replaces the delete confirmation for events (soft delete restores). Destructive actions on structures (event types, members) keep confirmation dialogs.
- Haptics: light vibration on Android where supported, with a user setting; never required.
- The "+" sheet's text field is not auto-focused (keyboard would cover the tiles).

## 2. Must-fix defects found by the reviews (P0, before any redesign work)
1. **Blocker B1** (05): opening the app after the 5-minute access token expired lands on the sign-in screen even with a stored refresh token; offline this locks the user out. Required behaviour: the app opens from local data whenever a stored session exists, renews the token in the background (online) and only asks for sign-in when renewal definitively fails (refresh token invalid/expired); offline never forces sign-in.
2. **Feeding timer stop bug** (01, 03): quick-start of a timer type with required fields creates an event without them; the API rejects the stop (400) and sync restores the running copy. Required behaviour: stopping a timer whose required fields are missing opens a short sheet to fill them (pre-selected last used values) before completing; sync never silently resurrects a running timer; dead-lettered stops are surfaced to the user with a fix action.
3. The web form ignores `visibleWhen` and sends hidden values (400 from the API): honour the rule, drop hidden values.
4. "+" opens a placeholder Track sheet; the tested preset/undo logic is not wired to any screen.
5. Home tiles ordered by id (Feeding last), "Create baby" shown when the API is down instead of an error/retry state, raw "HTTP 500" text, native date control ignoring the app locale.
6. Accessibility (05): contrast of dark accent text 4.05:1 and light "Overdue" chip 3.11:1; focused Timeline rows hidden behind the bottom nav; unnamed sheets/dialogs; clipping at 200% text; 7.4px chart axis labels; 233 of 441 captured states had axe A/AA violations (report in 05).

## 3. Build order (each wave ends green: lint, prettier, unit tests, build; e2e repaired in the last wave)
1. **Wave 1 (P0 fixes)**: items 2.1 to 2.5 above, plus the quick accessibility fixes of 2.6 that do not depend on the redesign.
2. **Wave 2 (design system)**: tokens for B (light, dark, night feed), serif font, Tabler icon wrapper and migration of icons, MUI overrides, form-field library (segmented, stepper, chips, duration, time panel, notes, medication), skeleton and empty-state components, theme settings (System/Light/Dark + Night feed Off/Ask/Auto, quick toggle in the header menu).
3. **Wave 3 (Now + navigation)**: Now screen, sleep toggle, last-and-log tiles with trays, toast with undo and time shift, timers bar and nursing left/right timers, three-tab navigation, More sheet, onboarding/empty states, baby/account menu holding Settings.
4. **Wave 4 (Day + event sheet)**: Day timeline per DESIGN section 11 and the new event sheet.
5. **Wave 5 (Insights)**: sleep rhythm chart, summary tiles, sleep/feeding/diaper charts, Growth inside Insights, low-data states, "how this is calculated".
6. **Wave 6 (handover, medicine intervals (API: min interval per medication), night view polish, visit summary, command bar)**.
7. **Wave 7**: repair and extend e2e (selectors, pt-BR smoke, axe in CI), measure again with the heuristic harness (tests/e2e/design-review), fix remaining violations.

## 4. Process rules for the build waves
All strings via i18n (en + pt-BR); no raw codes in UI; every new screen gets pt-BR and dark/light/night checks; screenshots with the harness in tests/e2e/design-review before/after (kept out of git); subagents per the model policy (Opus for logic-heavy/auth, Sonnet for UI build, Haiku for mechanical), never Fable.

## 5. Addendum 2026-10-21 (owner shared more Napper screenshots: "how neat Napper looks")
Principles taken (not assets; Napper's artwork must not be copied or traced): richer polish than flat editorial: soft depth/glow, big numerals, illustrated category icons, a calm atmosphere at night, clear hierarchy, friendly microcopy.
Changes to the plan (Wave 4c, after Wave 4):
1. **Original illustrated icon set** (SVG, soft gradients + highlight + subtle glow, one consistent style, light/dark/night aware): sleep/nap, woke up, bedtime, fell asleep, night waking, bottle, nursing, pumping, solid food, diaper, medication, temperature, bath, tummy time, belly pain, custom. Used for hero places (state card, tiles, More sheet, rows, toast, event sheet header); Tabler stays for UI chrome. Own artwork, documented licence (AGPL-compatible, e.g. CC0/our own).
2. **Floating pill navigation** with a centre "+" opening the More sheet (reverses the 'no FAB' decision so Day/Insights have quick logging).
3. **Day**: week strip (7 days with dates, today highlighted, swipe weeks) replaces the date bar; tinted rows with coloured left edge; separators for sleep sessions ('Sleep session ended, 1h 12m').
4. **Estimated nap sheet** from the nap window: time range, duration, calm guidance text (no medical claims), Skip / Log.
5. **Day rhythm ring** (24h arc with nap markers and predicted windows) as an alternative view of the state card; shares geometry with the Insights rhythm chart.
6. **Atmosphere**: subtle star field + glow in the night scheme (respect reduced motion/data saver), soft glow behind hero icons.
7. **Event sheet hero**: large illustrated icon, large serif time numeral with 'Today', fields below.
8. **Microcopy**: warm confirmations in our own voice (en + pt-BR), no pressure; no peer-comparison claims from a user base we do not have: show general age ranges from public guidance (sourced) or omit.

## 6. Addendum 2026-10-21 (owner: "two more functionalities to consider while napping")
Observed in the reference screenshots (patterns only, not assets): pause/resume on a running timer; a persistent mini timer bar above the navigation with elapsed time, a target duration and a progress bar; a full timer sheet (big elapsed time, Pause, Stop, discard, overflow).
Decisions:
1. **Pause/resume for every duration timer** (sleep, nursing, tummy time, bath, pumping, custom). Data (backwards compatible, no new table): payload reserved keys `pause_count` (int), `paused_seconds` (int), `paused_at` (ISO, present only while paused). Effective duration = (end - start) - paused_seconds; elapsed displays exclude paused time; while paused the timer card shows 'Paused 02:10' with Resume. For sleep a pause means the baby stirred or was briefly awake (excluded from sleep totals; predictions use effective duration). Declare these as optional hidden-from-form fields in the built-in definitions (so the API validates ranges) and map Napper's `numberOfPauses`/`pausedMinutes` columns on import (nursing and naps). Forgotten-timer logic uses effective elapsed time and treats a long pause as forgotten too.
2. **Target duration with progress**: a running sleep/nap timer shows a quiet target (the baby's typical duration for that kind from predictions `expectedDuration`, fallback by age band) as a flag and a progress bar; reaching the target never alarms or auto-stops; wording is neutral ('usual nap about 45 min'). Targets are hidden when there is no data.
3. **Global mini timer bar**: all running timers collapse into one floating card above the bottom navigation on every tab (elapsed, target/progress for the main one, pause and stop); several timers show a count chip and expand; the Night view uses giant buttons instead. Tap opens the **timer sheet**: large serif elapsed time, event icon, Pause/Resume and Stop (primary), discard (trash, with Undo), overflow menu: adjust start time, add a note, switch kind (nap <-> night), switch side (nursing).
4. Waves: API (declare pause keys, validation, importer mapping, effective-duration helper in Domain/predictions) and web (pause/resume commands in eventCommands and presets, effective-duration everywhere (Day, Now, Insights), mini bar, timer sheet) are scheduled with wave 4c and the polish pass; unit tests for pause arithmetic across midnight and multiple pauses.

## 7. Addendum 2026-10-21 (sleep details, from the owner's Napper nap-edit screenshot)
Pattern: a nap/sleep detail sheet that records HOW sleep went, beyond times: Start (took a long time to fall asleep, fussy), How (in bed, nursing, carried/held, next to me, bottle, stroller, car, swing), End (child woken, woke naturally), Mood on waking, plus Add pause. The owner's Napper export already carries these (howBabySlept IN_BED/WORN_OR_HELD/BOTTLE..., howBabyWoke WOKE_UP_NATURALLY..., babyMoodOnWakeUp GOOD/NEUTRAL/BAD, timeToFallAsleep).
Decisions (all optional, never required, hidden behind a 'Sleep details' section that is collapsed by default and opens from the timer sheet / event sheet; the quick toggle logging stays one tap):
- Built-in `sleep` fields (API, new migration; `visibleWhen` by kind where it applies: nap, night, not for markers): `how_slept` select (`in_bed`, `nursing`, `held`, `next_to_me`, `bottle`, `stroller`, `car`, `swing`, `other`), `fall_asleep` select (`easy`, `took_long`, `fussy`), `time_to_fall_asleep_minutes` number, `how_woke` select (`naturally`, `woken`), `mood_on_wake` select (`good`, `neutral`, `bad`; replaces the free-text `mood`: keep `mood` readable for old events), pause keys from section 6.
- Importer maps Napper columns howBabySlept (IN_BED->in_bed, WORN_OR_HELD->held, BOTTLE->bottle, plus other Napper values as they are met), howBabyWoke, babyMoodOnWakeUp/babyMoodOnSleep, timeToFallAsleep, numberOfPauses/pausedMinutes into those fields instead of notes lines. Existing imported events cannot be updated by re-import (ids are idempotent): add an explicit 'Enrich existing events from this file' option to the import (updates only these detail fields of matching events, never times, never deletes).
- UI: the sleep detail sheet uses illustrated option tiles (own artwork from the illustration set: crib, nursing, held, next to me, bottle, stroller, car, swing; alarm clock for long to fall asleep, fussy face; bell for woken, rising sun for natural), three sections Start / How / End and a mood row; the Day row summarises ('Nap 1h 05m, in bed, woke naturally'); Insights can later answer 'where does she sleep longest' from this data (P1, descriptive only, no advice).
- i18n: all option labels en + pt-BR (e.g. 'Na cama', 'Amamentação', 'No colo', 'Ao meu lado', 'Mamadeira', 'Carrinho de bebê', 'No carro', 'No balanço', 'Acordou naturalmente', 'Foi acordada(o)' written gender-neutral where possible: 'Despertou naturalmente' / 'Foi acordado').
