# Design spec (pass 1: foundation, Home, Track sheet, sleep presets)

Inspiration: Napper's layout patterns (hero prediction, one-tap track grid, centre "+" action). Own look: no copied artwork, names or icons. Decided with the user on 2026-10-21: night-sky dark by default (light follows the system setting), "Fell asleep" = marker AND timer start, pass 1 = foundation + Home + Track sheet + sleep presets. Pass 2 (later): Timeline polish, Insights charts (sleep area chart, bedtime/wake bars), Growth, Settings polish.

## 1. Foundation (theme)
MUI theme with CSS variables, `colorSchemes` light + dark; default dark unless the OS says light; the manual toggle in Settings > Appearance stays (system / dark / light).

Dark ("night"): background `#15132e`, surface `#1f1c3f`, surface-raised `#2a2468`, hairline `#2a2652`, text `#eceaff`, text-muted `#9d99c8` (must pass AA 4.5:1 on surface), accent `#7c6cf0`, accent-soft `#c4baff`.
Light ("day"): background `#f6f5ff`, surface `#ffffff`, surface-raised `#ebe8ff`, hairline `#e0ddf5`, text `#1b1838`, text-muted `#5d5a82`, accent `#5b4bd6`, accent-soft `#4a3cc0`.
Category colours (icon on a tinted circle; tint = colour at ~18% over surface, icon = the stronger tone; define as theme tokens `category.{sleep,feeding,diaper,health,care,custom}.{bg,fg}` for both modes): sleep indigo (`#3a2f7a`/`#c4baff` dark), feeding teal (`#16423f`/`#7ee0b8`), diaper amber (`#4a3322`/`#ffc58a`), health rose (`#4b2a33`/`#ff9fb2`), care sky (`#183f55`/`#8fd8ff`), activity yellow (`#4a3d1a`/`#ffd77a`), night-waking violet (`#4a2f55`/`#f0b6ff`), custom neutral. Derive light-mode pairs with the same hues (light tint bg, dark fg), contrast AA for the icon on the tint.
Shape: cards radius 18px, tiles 16px, chips/pills 999px, bottom sheet top radius 24px. No hard borders on cards in dark (use surface contrast); 1px hairline only for dividers. Elevation: none in dark, a soft shadow in light. Typography: system UI stack; sizes: title 20/500, card title 15/500, body 14/400, caption 12/400 (never below 12px), numbers in hero 28-32/500 with tabular numerals. Touch targets >= 44px. Motion: 150-200ms ease-out; respect `prefers-reduced-motion` (no ring animation, no sheet slide).
PWA `theme_color`: dark `#15132e`, light `#f6f5ff` (media meta) and manifest `background_color` `#15132e`.
App shell: content column max-width 480px centered on wide screens, page background fills the viewport; safe-area insets honoured (`viewport-fit=cover` already set).

## 2. App shell
- Header (not a heavy coloured bar): transparent over the background. Left: baby avatar (initial on a colour derived from the baby id; photo later) + name (title) + age line ("2 months, 3 weeks", "11 days", "1 year, 2 months") in caption/muted; tap opens the baby switcher when >1 baby. Right: sync indicator icon button (cloud-done = synced, cloud-upload with count badge = pending, cloud-off = offline, error = warning tone; tap opens Settings > Sync) and the account avatar menu.
- Bottom navigation: Home, Timeline, centre FAB "+" (elevated 56px accent circle, opens the Track sheet; becomes "x" while open), Growth (ruler/chart icon, different from Timeline), Settings. Labels shown for the four items, FAB has aria-label "Add event". Hidden for Viewers? No: FAB is hidden for Viewers (read-only), nav otherwise unchanged.

## 3. Presets (the Track tiles)
A preset = one-tap action backed by an event type: `{ id, label, categoryColour, icon, typeKey, mode: 'timer' | 'instant' | 'sheet', payloadDefaults }`. Built-in presets are defined in web code (`web/src/presets/`), keyed by built-in type keys; every enabled custom event type automatically becomes a preset (`timer` if hasDuration else `sheet`, `custom` colour). Order as in the Track sheet below; the Home shortcuts show the user's pinned four (default: Wake-up, Feeding, Diaper, Nap; "Edit" in the Track sheet lets the user pin/reorder, persisted per baby in localStorage).
Built-ins (typeKey, mode, payload):
1. Wake-up: sleep, `instant`, kind `woke_up`. If a sleep timer (nap/night) is running, tapping Wake-up also stops it at the same moment (one transaction, two outbox entries).
2. Nap: sleep, `timer`, kind `nap` (start of the timer = when the baby fell asleep).
3. Bedtime: sleep, `instant`, kind `bed_time`.
4. Fell asleep: sleep, `instant` marker, kind `fell_asleep`, AND starts a sleep timer in the same tap with kind inferred: `night` if a bedtime marker was logged in the last 3 hours or local time is 19:00-05:00, else `nap`. The inferred kind is shown on the running-timer card and editable.
5. Night waking: sleep, `timer`, kind `night_waking`.
6. Bottle: feeding, `sheet` (amount_ml, bottle_feeding_type), method `bottle`, instant end=start.
7. Nursing: feeding, `timer`, method `breast`, with left/right seconds fields in the stop sheet.
8. Diaper: diaper, `sheet` (content required).
9. Medication: medication, `sheet` (catalog checklist).
10. Belly pain: belly_pain, `sheet` (intensity 1-5).
11. Bath: bath, `sheet` (instant; optional end time field is a later backlog item #18).
12. Tummy time: tummy_time, `timer`.
13. Custom (dashed tile): opens Settings > Event types (Parent+).
Tiles in the Track sheet: two columns, each tile = tinted icon circle, name (15/500), and a status line (12, muted): "Last 2h ago" / "Last 07:05" (>= 12h shows time) / "Not tracked today" / "Running 0:42" (accent colour). Running timers are visually highlighted (accent ring). Viewers: tiles disabled with the status line only.

## 4. Home screen (top to bottom)
1. Hero prediction card (`surface`, 18px): label "Next nap" (or the soonest relevant prediction: sleep, else feeding), progress ring 128px (stroke 8, track = hairline, progress = accent, round caps) with centre text "in 24 min" (28/500) and "around 14:20" (caption). Ring progress = elapsed since the last event of that type / expected interval, clamped 0-100%. Under it: confidence chip (Low / Medium / High, tinted) and a "Why?" text button opening a small sheet with `reason`. Staleness: if the expected time is more than 2 hours in the past or the last event of that type is older than 24 h, replace the ring by a calm empty state ("Log a few events and predictions will appear here", with the Track button) instead of "Overdue/yesterday" wording; if expected is within the past 2 hours show "due now". Wording: relative times ("in 24 min", "due now"), clock times in local 24h or the locale; never "yesterday 07:18".
2. Running timers: pinned card(s) in surface-raised: category icon circle, "Nap running", "Started 13:02, 0:42" (live), Stop button (pill, high contrast). Several timers stack. Tap the card to edit.
3. Other predictions: a horizontal row of compact chips ("Feeding around 15:10", "Diaper around 14:40"), hidden when stale; "Not medical advice" line only inside the Why? sheet and once as a quiet footer caption on Home (12px muted).
4. "Today" strip: three metric cards (Sleep total "5h 10m" incl. running sleep, Feeds count, Diapers count) for the local day, from Dexie.
5. Track: section header "Track" + "Edit" (pin/reorder); four pinned preset tiles (compact vertical tiles, icon + label); a "See all" link opens the Track sheet.
Empty state (no baby yet): friendly illustration-free card with the create-baby form. Skeletons while Dexie loads. Large screens: same single column, max 480px.

## 5. Track sheet
Opened by the FAB: modal bottom sheet (24px top radius, drag handle, max height 90vh, scrollable), title "Track" + "Edit". Grid as in section 3. Choosing a preset: `timer` starts immediately (haptic-free, with an Undo snackbar 5 s), `instant` logs immediately with an Undo snackbar for the pure markers (Wake-up, Bedtime, Fell asleep); `sheet` presets close the Track sheet and open the existing EventSheet prefilled (type, payload defaults, start = now).
Undo = soft delete of the just-created event(s) (and restores a stopped timer for Wake-up).

## 6. Copy
Sentence case, no exclamation marks, no "successfully", contractions fine ("Couldn't save. Try again"). Relative times in the hero, absolute times in lists. Empty states invite an action.

## 7. Accessibility
All icon-only buttons have aria-labels; the ring has an accessible text equivalent ("Next nap in 24 minutes, around 14:20, medium confidence"); focus-visible rings in accent; contrast AA for all text/tile combinations in both themes; timers announce start/stop via a polite live region; supports 200% zoom and landscape.

## 8. Acceptance
Matches the mockup structure; light and dark both usable; no horizontal scroll at 320px width; Lighthouse accessibility >= 95 if measurable (not available locally: verify with axe-core in unit/e2e tests instead); existing unit and e2e tests updated and green.

## 9. Internationalization (en, pt-BR first)
Decided 2026-10-21. Languages: English (`en`, source/fallback) and Brazilian Portuguese (`pt-BR`). More languages must be addable by dropping in one catalog file and one entry in the language list.
- Library: `i18next` + `react-i18next` (+ `i18next-browser-languagedetector` only if it stays small; otherwise detect manually from `navigator.languages`). Catalogs are JSON in `web/src/i18n/locales/{en,pt-BR}.json`, namespaced by feature (`common`, `nav`, `home`, `track`, `presets`, `timeline`, `settings`, `growth`, `import`, `errors`, `eventTypes`, `predictions`, `auth`, `pwa`). Non-English catalogs are lazy-loaded (dynamic import); `en` is bundled.
- Locale selection: setting `system | en | pt-BR` in Settings > Language (also first in the Appearance area), default `system` (match `navigator.languages`, `pt`/`pt-PT` map to `pt-BR`, otherwise `en`), persisted in localStorage (try/catch). Sets `<html lang>`. Changing it applies immediately without reload.
- Every user-visible string goes through `t()` (including aria-labels, placeholders, snackbars, dialog buttons, empty states, validation messages, document title and PWA install hints). No string concatenation: use interpolation and ICU-style plurals via i18next plural keys (`_one`, `_other`; pt-BR also uses `_many` only if needed). Never build sentences from fragments.
- Dates, times, numbers, durations, relative times: only through `Intl` (`DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `ListFormat`) with the active locale, via small helpers in `web/src/i18n/format.ts` (formatTime, formatDate, formatDuration, formatRelative, formatAge, formatNumber, formatUnit). 24-hour clock for pt-BR. First day of week from the locale.
- Server-provided text: the API keeps returning stable machine codes and keys; the web owns the wording.
  - Built-in event types, their fields and select options are rendered from the key: `eventTypes.<typeKey>.name`, `eventTypes.<typeKey>.fields.<fieldKey>.label`, `...options.<optionValue>`; fall back to the server `name`/`label` when no translation exists. User-created types, fields, options and medication names are user content and are never translated.
  - Problem details: map `code` to `errors.<code>`; fall back to a generic localized message, never show server `detail` text raw.
  - Predictions: render the sentence from the structured `basis` and numbers (median gap, sample count, look-back days, age band, day phase), not the server `reason` string; the server `reason` stays English as a debugging fallback only.
- Copy style per language: English sentence case (see section 6). pt-BR: informal "você", sentence case, no exclamation marks, natural not literal ("Registrar", "Hora de dormir", "Soneca", "Despertar noturno", "Acordou", "Adormeceu", "Cólica/dor de barriga"), units in metric (ml, kg, cm), decimal comma.
- Tests: a unit test fails when `en` and `pt-BR` catalogs have different key sets or placeholders (including missing plural forms); a lint-level check (`eslint-plugin-i18next` `no-literal-string` in `markup-only` mode, warnings -> errors for new code) or an equivalent test prevents new hard-coded UI strings; render tests for key screens in both locales; the e2e suite runs in English (set the locale explicitly) plus one pt-BR smoke spec.
- PWA manifest: `lang` en; name stays "Baby Routine" (brand, not translated); `description` may be localized later via a second manifest, out of scope.
- The API's own text is not user-facing except problem `title`/`detail` fallbacks, kept in English.
