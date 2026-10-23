# 30. Mobile overflow and zoom audit (2026-10-23)

Owner report: on phones, pinch zoom and scrollbars misbehave (a stray horizontal scrollbar, the layout wider than the
screen, the page bouncing). Decision: **pinch zoom is never disabled** (no `maximum-scale`, no `user-scalable=no`):
WCAG 1.4.4 Resize text and our axe rules require it, and iOS Safari ignores those values anyway. The causes are fixed
instead, and a Playwright audit keeps them fixed.

## 1. Method

`tests/e2e/design-review/overflow-audit.{config,review,summary}.ts` (command in docs/E2E.md, "Mobile overflow audit").
Credential-free: every developer-only `/dev/*` preview scenario (Now day and night, ring, Day, the event sheets,
Insights, Hub and the pages opened from it: Settings, Updates, About, Doctors and clinics, Import, Export, Import
backup, Credits; Medicines, Formulas, Appointments, Vaccines, doctor access and Family members, the doctor dashboard
pages, proposals, notifications, Landing) plus the public `/credits`, 148 screens. The timers pill is also audited
open. Each screen is loaded once per language (en, pt-BR) and scheme (light, dark) on a touch phone (Playwright
`isMobile` + `hasTouch`: coarse pointer, overlay scrollbars, the mobile layout viewport) and measured at 320, 360, 390
and 430 px wide, with the root text at 100 % and 160 %: 4768 measurements.

A finding is one of:

| Kind | Rule |
| --- | --- |
| overflow | an element sticks out of the viewport sideways and no ancestor clips or scrolls it (outermost reported, with its deepest culprit); or the document is wider than the screen |
| hscroll | an element scrolls sideways with its scrollbar shown (intended carousels hide it) |
| double-scroll | body and html both scroll, or a tall inner box scrolls inside a scrolling page |
| under-dock | with the page scrolled to its end, a control is under the fixed bottom dock |
| vh-unit | a `height`/`min-height`/`max-height` in `vh` (hidden under the mobile browser toolbar) |
| input-font | a text input, select, textarea or contenteditable under 16 px (iOS zooms the page on focus) |
| viewport-meta | the viewport meta caps zoom |

The run fails on any finding. `output/overflow-audit.md` (gitignored) lists findings by group and each distinct one
with the widths, text sizes and languages it shows up in.

Note on the mobile layout viewport: when content is wider than the screen, a phone (and Chromium's mobile emulation)
widens the layout viewport to fit it, so every full-width box grows with it. One real culprit then shows up as many
"wide" boxes; the report names the deepest culprit to tell them apart.

## 2. Findings before (baseline)

8366 findings in the measurements (198 distinct). No double-scroll, under-dock or vh-unit finding: the app already
used `dvh` and `env(safe-area-inset-*)` for the shell, the dock and the sheets.

| Group | overflow | input-font | hscroll |
| --- | --- | --- | --- |
| hub (incl. its pages) | 2776 | 176 | 0 |
| landing + /credits | 2310 | 0 | 2 |
| day | 676 | 0 | 0 |
| meds | 8 | 752 | 4 |
| doctor + family | 28 | 416 | 4 |
| proposals | 46 | 336 | 4 |
| appointments | 50 | 224 | 0 |
| vaccines | 0 | 224 | 0 |
| formulas | 0 | 112 | 10 |
| dashboard | 56 | 96 | 0 |
| sheet | 0 | 48 | 8 |
| now, ring, insights, notifications | 0 | 0 | 0 |

Causes, by weight:

1. **Screen-reader-only text 100 % wide** (all widths, all text sizes): seven local `visuallyHidden` objects wrote
   `width: 1, height: 1`, which MUI `sx` reads as **100 %**. An absolutely placed hidden text a full line wide pushed
   the page sideways: the dock's "N things need attention in the Hub", the Day page title, the timers pill status,
   every "(opens in a new window)" of the credits, provider contacts, notifications. This is the stray horizontal
   scrollbar and the "page wider than the screen" of the report.
2. **Text fields at 15 px** (`body1`): every MUI field, the date picker sections and the hand-made fields of
   `ui/form` (`TextInput`, `NotesRow`, the medication search, the vaccine select, the chooser and provider searches).
   iOS zooms the page into any focused field under 16 px and does not zoom back: the "zoom misbehaves" of the report.
3. **Pinch zoom taken away**: the Day page, its week strip and the doctor's patient timeline set `touch-action:
   pan-y`, which allows vertical panning only; pinch zoom did not work there. Their swipe handler also took a pinch,
   or a sideways pan of a zoomed page, for a day change.
4. **Large text on narrow phones** (160 % at 320-360 px): flex/grid items that cannot shrink: grid columns sized by
   their widest content (`1fr`/auto tracks), a nowrap chip label (form chips, MUI chips), the search inputs' intrinsic
   width (`size=20`), `flexShrink: 0` file buttons and trailing values, a field label with "· optional", the Day
   row's running pill, single long words in headings.
5. **Page bounce**: no `overscroll-behavior` anywhere: reaching the end of a sheet scrolled the page behind it, and the
   page itself bounced (rubber band) on iOS.

## 3. Fixes

Global (`code/web/src/theme/theme.ts`, `MuiCssBaseline`):

- `html`/`body`: `overscroll-behavior-y: none` (no rubber band or scroll chaining past the page ends; in a browser
  tab this also turns off pull-to-refresh, the app syncs on its own), `text-size-adjust: 100%`.
- `.MuiDrawer-paper`, `.MuiDialog-paper`, `.MuiPopover-paper` and everything inside them: `overscroll-behavior:
  contain` (a sheet's scroll never moves the page behind).
- `a, button, input, select, textarea, label, summary, [role=button|tab|switch]`: `touch-action: manipulation`
  (no double-tap zoom delay on controls; pinch zoom and panning stay).
- `@media (pointer: coarse)`: `input, select, textarea, .MuiInputBase-root, .MuiPickersInputBase-root` get
  `font-size: max(16px, 1rem)`. 16 px floor on touch screens only (desktop keeps 15 px); a larger user text size still
  wins through `1rem`. Hand-made fields spread the same rule, `TOUCH_FIELD_FONT` from `ui/form/styles.ts`.
- `body { overflow-wrap: break-word }`, headings `overflow-wrap: anywhere`: a word longer than its line breaks
  instead of pushing the layout.
- `MuiChip` root `min-width: 0`: a chip in a row shrinks (its label ends in "…") instead of widening the row.

Components (minimal, no visual change at normal sizes):

- `visuallyHidden` in pixels (`'1px'`) in `insights/charts/chartStyle.ts` (shared by the dock, Hub rows, the credits
  links, charts), `day/DayScreen`, `notifications/ui/NotificationsSection`, `providers/ProviderContact`,
  `timers/TimerSheet`, `timers/RunningTimerPill`, `timers/TimerParts` (the vaccines one already was).
- `touch-action: pan-y pinch-zoom` on the Day page, the week strip and the patient timeline; `day/useSwipe` ignores
  multi-finger gestures and drags while the page is zoomed in.
- Search inputs (`MedicationPicker`, `ChooserSearch`, `ProviderSearchField`): `width: 0` with `flex: 1` (no
  intrinsic width).
- `ChipGroup` chips: one line while they fit, a label longer than the whole row wraps inside the chip (`max-width:
  100%` instead of `white-space: nowrap`).
- `Field` label row wraps ("· optional" under the label in a narrow column).
- `DayRow`: the running/duration pill goes under the title when it alone fills the card (`flex-wrap`, title basis 0).
- Doctor summary: card column `minmax(0, 1fr)`; a row's trailing value wraps under the title when too long.
- `DayAppointmentsStrip`: columns `minmax(0, 1fr)` (the nowrap title ends in "…" as designed).
- Import and Import backup file buttons: `max-width: 100%` (the label wraps).
- Dev previews only: their page column is `minmax(0, 1fr)` like the app shell's (the app's `main` is a stretched flex
  item, so its content never sizes the column); the Hub preview gained `providers`, `import`, `export`, `backup` and
  `credits` scenarios so the audit reaches those pages.

`index.html` already had `width=device-width, initial-scale=1.0, viewport-fit=cover` with no zoom cap: unchanged.

## 4. After

6 findings (one distinct), from 8366:

- **Landing hero, 320 px, 160 % text, pt-BR only**: the hero title is 2 px wider than its column (a call-to-action
  button's end icon sets the column's minimum). Not fixed here: the landing files belong to another change in
  progress; a `min-width: 0`/wrap on the hero CTA row fixes it.

Everything else passes in both languages, both schemes, all four widths and both text sizes.

## 5. Guards

- `code/web/src/theme/mobileViewport.test.ts` (vitest, source-level because jsdom has no layout): the viewport meta
  keeps `width=device-width`, `initial-scale=1`, `viewport-fit=cover` and never has `maximum-scale`,
  `minimum-scale` or `user-scalable`; the coarse-pointer 16 px floor, overscroll, touch-action and sheet rules are in
  the theme; every hand-made text field uses `TOUCH_FIELD_FONT` (or is 17 px and up); no `touch-action` with `pan-*`
  lacks `pinch-zoom`; no visually-hidden box is sized with bare `width: 1`.
- `code/web/src/day/useSwipe.test.ts`: a swipe changes the day; a pinch or a pan of a zoomed page does not.
- The Playwright audit (exit 1 on any finding): run it before a release.

## 6. Not covered

- Screens that need a signed-in server session and have no preview (the live Settings members list with real
  invites, the first-run "create a baby" card) are only reached through the previews' fixtures.
- The audit runs in Chromium's mobile emulation. iOS Safari's dynamic toolbar and the real safe areas are not
  emulated (`env(safe-area-inset-*)` is 0); the `vh-unit` rule guards the toolbar case by reading the stylesheets instead.
- `TimePanel`'s scrubber keeps `touch-action: none` (a slider needs every drag); pinch zoom works everywhere else.
