# 05 Heuristic and accessibility evaluation

Evaluated 2026-10-21 against the running app (`main` at 66871c7: web dev server on :5173, API on :5290, real Keycloak and Postgres), signed in as the e2e test account. Benchmarks: Nielsen's 10 heuristics, WCAG 2.2 AA, `docs/DESIGN.md` (sections 1-11).

## Method

- **Data.** One baby, `E2E-design-review-20261021T0529` (born 2026-08-10), seeded through the API with 83 synthetic events over Oct 17-21 and 5 growth measurements. Review contexts saw only this baby (`GET /babies` filtered in the browser), so no baby switcher appears.
- **Matrix.** 390x844, 768x1024 and 1440x900, x dark/light, x en/pt-BR = 12 combinations. Main screens were captured in all 12; deep states (offline, errors, import, invite, text scaling) in 1-3.
- **Output.** 522 screenshots (88 distinct states) in `docs/design/screenshots/`, named `screen-viewport-theme-locale.png` (gitignored). In the evidence column, `*` means all combinations.
- **Checks.**
  - axe-core 4.10 (wcag2a/aa, wcag21a/aa, wcag22aa, best-practice) on 441 states.
  - In-page audits: target sizes, clipped text, overflow, raw codes, English text on pt-BR screens.
  - 200% text, 320 px reflow, landscape, reduced motion, focus order and focus obscured by the nav, rendered font sizes, Playwright timings.
- **Harness and raw numbers.** Harness in `e2e/design-review/`; raw numbers in `e2e/design-review/output/summary.md` (gitignored).
- **Limits.**
  - No Lighthouse.
  - Timings come from the Vite dev server (unbundled modules, local API), so they are not production numbers.
  - Native date inputs follow the browser's locale (English Chromium emulating pt-BR still shows `mm/dd/yyyy AM/PM`). See m5.
  - The import's final write was mocked.
  - The Track sheet is a known stub.

## Verdict

**The basics are sound:**
- No horizontal scroll at 320 px.
- No target under 24 px.
- Visible focus everywhere.
- Reduced motion honoured: the sheet transition drops from 0.2 s to 0.00001 s.
- `<html lang>` and live language switching work.
- No English catalog leaks in pt-BR.
- Sheets open in about 100 ms.

**The interaction layer feels unfinished:**
- A placeholder "+" button.
- A feeding sheet that shows every field.
- GUID-ordered Home tiles.
- "Overdue" and "yesterday" predictions.
- Truncated Timeline rows.
- Developer-language errors.
- A Sign in wall on every cold start after the 5-minute token expires.

On axe, 233 of 441 states have WCAG A/AA violations. They come from a few systemic causes.

## Top 10 things that make the app feel unrefined

1. **The "+" button is a dead end.** It opens "Quick actions will appear here." (`track-sheet-*`).
2. **The feeding sheet shows irrelevant fields.** A bottle feed shows Side, Left/Right breast seconds and Food. A breast feed shows Amount and Bottle content (`sheet-bottle-*`, `sheet-breast-*`).
3. **Home is an unordered wall of eight equal outline tiles.** Belly pain comes first and Feeding last. There is no "last logged" status and no hierarchy (`home-*`).
4. **Predictions read like a monitoring console.**
   - Orange "Overdue" badges and "around yesterday 23:13, between yesterday 22:08 and 08:39".
   - Predictions for Medication and Tummy time.
   - "Need more data for: Bath, Belly pain, and Breast pump".
   - Five identical cards, each with a "Why?" (`home-full-mobile-dark-en`).
5. **The Timeline doesn't say what happened.** Every sleep row is titled "Sleep" and every feed "Feeding". The useful detail is truncated ("Bottle · 120 ml · For…"). Breast sides show as "480 s · 420 s". The filter chips scroll off the edge (`timeline-*`).
6. **Stock Material form chrome.**
   - The outlined "Type" label is cut off on every sheet.
   - Native date pickers take 6-7 tab stops each.
   - Sheet actions are text buttons, Delete sits next to Save, and the footer is not sticky.
   - Validation appears as a red banner instead of under the field.
7. **"Sign in" after five minutes away.** It shows even though a valid offline refresh token is stored (`session-expired-coldstart-*`).
8. **Developer language.**
   - "HTTP 500: Request failed with status 500", untranslated in pt-BR.
   - Raw Napper codes (`BED_TIME`, `CHANGED_DIAPER`).
   - "Instant · 0 fields", "Has duration".
9. **Growth charts.** The axis labels render at 7.4 px, the ticks are odd values (3.1 / 3.8 / 4.5 / 5.3) and only the first and last dates are labelled. The empty state repeats four messages.
10. **Tablet and desktop are a phone column floating in space.** They keep the bottom nav, while sheets are 768 px wide over a 480 px column (`home-desktop-*`, `sheet-bottle-tablet-*`).

## Prioritised issues

Severity: **B** blocker, **M** major, **m** minor, **n** nit. Effort: S under a day, M a few days, L a week or more.

| ID | Sev | Screen | Issue | Evidence | Recommendation | Effort |
|---|---|---|---|---|---|---|
| B1 | B | App start | **Cold start after the ~5 min access token expires lands on "Sign in" despite a stored offline refresh token.** Reproduced naturally by the harness and deterministically by back-dating `expires_at`. Offline, the user is locked out of local data, which defeats the offline-first PWA. | `session-expired-coldstart-*`, `login-*` | Before redirecting in `RequireAuth`, if the stored user is expired and has a refresh token, call `signinSilent()`. When offline, let the cached account through read/write (sync resumes later). | M |
| M1 | M | FAB / Track | The primary centre action opens a placeholder. When open, its "x" is hidden under the drawer. | `track-sheet-*` | Until the Track sheet ships, hide the FAB or make it open the Add event sheet. | S (L for the real sheet) |
| M2 | M | Event sheet | `visibleWhen` from the API is ignored (no reference in `web/src`): every method's fields always show. Invites contradictory data such as an amount on a breast feed. | `sheet-bottle-*`, `sheet-breast-*`, `sheet-*-bottom-*` | Implement conditional visibility in `TypeFields`. Clear hidden values on save. | M |
| M3 | M | Home | Tiles come from Dexie in primary-key (GUID) order: Belly pain, Diaper, Tummy time, Sleep, Bath, Medication, Pump, Feeding. All 8 have equal weight and no status line. | `home-*`, `home-empty-*` | Use the preset catalogue order and the pinned four plus "See all" (DESIGN 3-4). Add the "Last 2h ago" status. | S (order), M (presets) |
| M4 | M | Home | Tapping a duration type starts a timer at once, with no Undo. You can't log a feed that already happened without starting a timer and editing it. | `home-running-*` | Undo snackbar for 5 s (DESIGN 5). Make the Bottle preset an instant sheet. | M |
| M5 | M | Home predictions | "Overdue" badges, "yesterday" wording, a band where expected = latest ("04:26, between 03:11 and 04:26"), medication and tummy-time predictions, a list of unpredicted types. Contradicts DESIGN 4 (calm stale state, never "yesterday") and 10 (never guilt-inducing). | `home-full-mobile-dark-en`, `home-prediction-why-*` | One hero prediction (sleep, else feeding) plus compact chips. Hide stale predictions. Limit to sleep, feeding and diaper. Explain in plain words. | M |
| M6 | M | Home | With the API down on a fresh device, Home says "No baby yet" and offers **Create baby**. Users will create duplicates. | `home-api-down-coldstart-*` | Tell "could not load" apart from "empty": show an error with Retry and keep the form hidden. | S |
| M7 | M | Settings > Sync, Login | Raw technical messages: "HTTP 500: Request failed with status 500" (also in pt-BR); the login page prints `error.message`. Home shows only a red triangle. | `settings-sync-error-*`, `home-sync-error-*` | Route through `describeApiError` / `errors.*`. Give the header icon a one-line explanation (tooltip or snackbar). | S |
| M8 | M | Timeline | Generic titles ("Sleep" for nap, bedtime and night waking). Details truncated on phones (at least 29 distinct strings clipped; the audit records at most 15 per screen). "480 s". Horizontal chip carousel cut at the edge. Duplicate "Synced" chip. Text-only empty state. | `timeline-*`, `timeline-filter-sleep-*`, `timeline-empty-*` | Apply DESIGN 11: kind-based titles and icons, a two-line detail, minutes instead of seconds, a Filter sheet, an empty state with "Add event". | M-L |
| M9 | M | Event sheet | No sticky footer. On phones Save sits below the fold for feeding and sleep; in landscape every sheet hides it; on tablet Save is cut off. | `sheet-bottle-bottom-mobile-*`, `landscape-sheet-diaper-*`, `sheet-bottle-tablet-*` | Sticky footer with a full-width Save (DESIGN 10.5). | S |
| M10 | M | Global | **Contrast (1.4.3)**, measured by axe (634 failing nodes):<br>• dark accent text `#7c6cf0` on surface `#1f1c3f` = **4.05:1** (Why?, Cancel, Sync now, Add event type, outlined buttons)<br>• error `#f44336` on `#1f1c3f` = **4.39:1** (Delete, Leave this baby)<br>• light "Medium confidence" `#0288d1` on white = **3.85:1**<br>• "Overdue" white on `#ed6c02` = **3.11:1**<br>• Timeline "Offline" chip `#ed6c02` on `#f6f5ff` = **2.87:1**<br>**Non-text (1.4.11)**, computed: light-theme tile borders and icons use server colours: Tummy time `#ffa726` **1.80:1**, Pump `#26c6da` **1.91:1**, Bath **2.77:1**, Feeding **2.97:1** on `#f6f5ff`. | `home-*-light-*`, `sheet-sleep-*-dark-*`, `settings-members-*-dark-*`, `timeline-pending-*-light-*` | Use `accentSoft` (`#c4baff`, 9.1:1) for text buttons in dark mode and a lighter error tone (e.g. `#ff8a80`). Use the DESIGN category token pairs instead of the server `color`. Use darker chip palettes in light mode. | S |
| M11 | M | Timeline, Home | **Focus obscured (2.4.11):** tabbing moves rows under the fixed bottom nav. Timeline "Edit Sleep" is 76 px hidden of a 70 px row (fully hidden); Home "Why?" is 30 of 44 px hidden. | `focus-obscured-timeline-mobile-dark-en` | `scroll-padding-bottom: calc(88px + env(safe-area-inset-bottom))` on the scroller. | S |
| M12 | M | Sheets, Timeline | Screen-reader semantics:<br>• Mobile sheets (Drawer) have no accessible name (`aria-dialog-name`, 80 nodes, 11 screens).<br>• Timeline lists contain non-`li` children (`list`, 1.3.1, 195 nodes).<br>• Rows are named "Edit Diaper" and hide the time and details (`label-content-name-mismatch`, 2.5.3, 2662 nodes).<br>• Five buttons all named "Why?". | axe on `sheet-*`, `timeline-*`, `home-*` | `aria-labelledby` pointing at the sheet title. Wrap rows in `li`. Name rows "Edit Diaper, 00:41, Wet" (or drop `aria-label` and keep the text). Name each "Why?" after its prediction. | S |
| M13 | M | Growth | Chart text is 11 px in a 480-wide viewBox, rendered at **7.4 px** on phones (DESIGN floor is 12 px). Tick values are not round numbers. Only the end dates are labelled. | `growth-*`, `extra.json` | Size text by the rendered width or use HTML labels. Use nice ticks and month labels. | S-M |
| M14 | M | Global | **Text at 200% (1.4.4):**<br>• The 64 px nav clips its labels into "HomeTimeline" / "GrowthSettings".<br>• Chips (Synced, Running) clip vertically.<br>• The date input is cramped against its picker icon. | `text200-*` | `min-height` instead of fixed heights. Let nav labels wrap, or keep icons only when the text is large. | M |
| m1 | m | Event sheet | The outlined "Type" label is clipped at the top on every sheet, at every viewport. | `sheet-*` | Labels outside the inputs (DESIGN 10), or more top padding in `DialogContent`. | S |
| m2 | m | Event sheet | Validation is a single bottom Alert ("Content is required."). The segmented control isn't marked as invalid. | `sheet-diaper-validation-*` | Inline helper text under the field, `aria-invalid`, focus on the first error. | S |
| m3 | m | Medication sheet | Dose unit label clipped ("Vitamin D dro…", "Unidade de Vi…"). The inline "New medication / Add medication" row adds clutter, and the pt-BR button wraps. | `sheet-medication-checked-*` | Dose plus unit as one field with a suffix. Move "new medication" into an overflow link. | S |
| m4 | m | Sheets | Belly pain 1-5 has no meaning (no mild/severe anchors). Sleep kind is a 6-option dropdown. Mood is free text. In pt-BR the sheet has two fields both labelled "Tipo". | `sheet-bellypain-*`, `sheet-sleep-*`, `sheet-running-mobile-light-pt-BR` | Anchored scale with icons. Segmented kinds. Mood chips. Rename the sleep kind label. | S |
| m5 | m | Sheets, forms | Native `datetime-local` takes 6-7 tab stops, has no "5/15/30 min ago" chips, and follows the browser locale, not the app language (en browser + pt-BR app = `10/21/2026 02:51 AM`). | `sheet-*-pt-BR`, `a11y-extras.json` | Quick-time chips plus a themed picker (DESIGN 10.2). | M |
| m6 | m | Home running card | Shows "Sleep", not "Night sleep". No "Started 01:08". Stop is red text (destructive colour for a positive action). | `home-running-*` | Kind title, start time, high-contrast Stop pill (DESIGN 4.2). | S |
| m7 | m | Header | Offline and error states hide the pending count: `syncKind` returns offline/error before pending. No offline banner. | `home-pending-*`, `home-offline-*` | Show the count badge on the offline and error icons too. Add a quiet offline strip. | S |
| m8 | m | Logout dialog | "Push now" is offered while offline (it can't succeed). Menu says "Log out", button says "Logout anyway". | `logout-warning-*` | Disable Push when offline, with a reason. "Log out anyway". | S |
| m9 | m | Empty states | Text only, no action: "No events in the last 14 days."; Growth repeats four "No … yet" lines. | `timeline-empty-*`, `growth-empty-*`, `home-empty-*` | One composed empty state with an icon, one sentence and one action (DESIGN 10). | S |
| m10 | m | Growth, Members | A spinner stays while requests fail; still spinning after 3 s of 500s. No skeleton. | `growth-error-*`, `settings-members-error-*` | Skeleton, then an error with Retry after the first failure. | S |
| m11 | m | Tablet, desktop | Phone layout at 1440 px (480 column plus bottom nav). Sheets on tablet span 768 px. Quick tiles go 3 or 4 per row without a column change. | `home-desktop-*`, `timeline-desktop-*`, `sheet-bottle-tablet-*` | Navigation rail at md+, a two-pane Home (actions and Timeline), sheets constrained to the column width. | M |
| m12 | m | Settings | All accordions. "Built-in" chip repeated under a "Built-in" header. "Instant · 0 fields". The owner sees a role select and a remove icon on their own row. Accordion headings are h3 under the h1. | `settings-*`, `settings-members-*` | Grouped list with icons. Plain-language type summaries. Hide self-demote and self-remove. | S |
| m13 | m | Import review | Raw Napper codes in the table. On phones the table scrolls sideways, hiding two columns, and the scroll region isn't keyboard focusable (axe `scrollable-region-focusable`). | `import-2-review-*` | Translate categories. Stack the numbers per row on phones. `tabIndex=0` on the scroller. | S |
| m14 | m | pt-BR | "Linha do tempo" wraps to two lines and misaligns the nav. Duration "15m" in en vs "15 min" in pt. "37 C" lacks "°". | `timeline-mobile-*-pt-BR`, `timeline-desktop-dark-pt-BR` | Shorter label ("Histórico"). Localized unit formatting through `formatUnit`. | S |
| m15 | m | Header | Baby and account avatars are both a letter "E" in a circle, side by side. Long baby names truncate hard. | `home-*` | Account menu as an icon or photo. Drop the second avatar on phones. | S |
| n1 | n | Home | No h1. Document title is "Baby Routine" on every route (2.4.2). No skip link. | axe `page-has-heading-one` | Visually hidden h1 per page. Per-route `document.title`. | S |
| n2 | n | Import result | "0 records were already imported." | `import-5-result-*` | Omit zero counts. | S |
| n3 | n | Inputs | Below 44 px (all above 24 px): Timeline chips 32 px, small selects 37 px, Notes 40 px, "Add medication" 40 px. | `summary.md` | 44 px minimum per DESIGN 1. | S |

## WCAG 2.2 AA summary

| Criterion | Result |
|---|---|
| 1.3.1 Info and relationships | Fail: Timeline list structure (M12). |
| 1.4.3 Contrast | Fail: 5 text pairs (M10). The dark muted text passes: `#9d99c8` on surface is 6.04:1. |
| 1.4.4 Resize text | Fail at 200% (M14). |
| 1.4.10 Reflow | Pass: 0 px horizontal overflow in all 522 states, including 320 px. |
| 1.4.11 Non-text contrast | Fail: light-theme tile borders and icons (M10). |
| 2.1.1 Keyboard | Mostly pass. Import table scroller not focusable (m13). |
| 2.4.3 Focus order | Pass: header, running card, tiles, predictions, nav. |
| 2.4.7 Focus visible | Pass. |
| 2.4.11 Focus not obscured | Fail (M11). |
| 2.5.3 Label in name | Fail (M12). |
| 2.5.8 Target size | Pass. |
| 3.3.1 Error identification | Partial (m2). |
| 4.1.2 Name, role, value | Fail: unnamed sheets (M12). |
| Reduced motion | Pass. |

Best-practice findings: `heading-order` (29 screens), `page-has-heading-one` (11), `region` (Track sheet, login), `aria-allowed-role` (import file buttons).

## Heuristics (Nielsen)

| # | Heuristic | Main findings |
|---|---|---|
| 1 | Visibility of system status | Good timer counters and per-row "not synced" icon. Pending count hidden offline (m7), error icon without reason (M7), endless spinner (m10). |
| 2 | Match with the real world | Seconds, raw codes, "Instant · 0 fields", "Overdue", every sleep titled "Sleep" (M5, M8, m12, m13). |
| 3 | User control and freedom | No Undo after a one-tap timer (M4). Delete next to Save. |
| 4 | Consistency and standards | Three chip styles on Home, mixed button variants, locale-dependent duration format, two "Tipo" fields, "Log out" vs "Logout". |
| 5 | Error prevention | Irrelevant fields (M2), create-baby form while the API is down (M6), self-demote (m12). |
| 6 | Recognition rather than recall | Tiles carry no status. The Timeline needs a tap to see the kind of sleep. |
| 7 | Flexibility and efficiency | No quick-time chips (m5), no pinning, GUID tile order (M3). |
| 8 | Aesthetic and minimalist design | 8 tiles plus 5 prediction cards on Home, 9 fields on a bottle sheet, 8 collapsed accordions. |
| 9 | Recover from errors | "HTTP 500…" (M7), bottom-banner validation (m2), raw login error. |
| 10 | Help and documentation | "Why?" uses statistics language ("17 samples used…"). The import wizard explains itself well. |

## Mobile ergonomics

- **Primary actions sit in the top half.** Tiles start at y=72-170 on an 844 px screen, while the bottom-centre FAB, the natural thumb target, does nothing (M1).
- **Hard-to-reach actions.** Save scrolls out of reach (M9), and Stop is a small top-right text button (m6).
- **Landscape.** The sheet shows 4 fields and no actions.
- **Navigation.** The 64 px bottom nav is well placed.

## i18n

- **Catalog coverage is complete.** No English catalog strings appear on pt-BR screens.
- **Gaps are at the edges:** the HTTP error text, Napper categories, the "C" and "s" units, and native date inputs (m5).
- **Long Portuguese labels clip or wrap:** "Unidade de Vitamin D drops", "Linha do tempo", "Adicionar remédio" (two lines), and Timeline details (14 clipped on the first pt-BR mobile screen alone).

## Perceived performance

| Measure | Median (n) | Range |
|---|---|---|
| Cold load to app shell | 560 ms empty / 580 ms populated (25) | 510-706 ms |
| Shell to Home content | 124-126 ms (25) | 116-261 ms |
| First contentful paint | 504 ms | |
| Home ready | 680 ms | 176 module requests in dev mode |
| Route to Timeline | 345 ms (13) | |
| Route to Growth | 169 ms | |
| Route to Settings | 157 ms | |
| Open event sheet | 101 ms (52) | |
| Open Track sheet | 50 ms | |

- **Production bundle** (`web/dist`, built today): 1.15 MB of JS, about 345 KB gzipped across all chunks. `vendor-mui` alone is 391 KB raw.
- **Feels instant** thanks to Dexie. Two gaps:
  - Spinners instead of skeletons.
  - A cold sync costs about 4 requests per followed baby. With 18 babies, two fresh tabs hit the 300 requests/minute limit (HTTP 429) and Home rendered with no tiles. Batch or throttle the cold sync.

## Quick wins (S effort, high value)

1. Hide the FAB or point it at the Add event sheet (M1).
2. Order tiles by the preset catalogue, Feeding first (M3).
3. Sticky sheet footer (M9), plus top padding that fixes the clipped "Type" label (m1).
4. Contrast:
   - `accentSoft` for text buttons in dark mode, and a lighter error red.
   - Darker info and warning chips in light mode.
   - Category token pairs for tile borders and icons (M10).
5. `scroll-padding-bottom` for the fixed nav (M11).
6. Accessible names:
   - `aria-labelledby` on the sheets.
   - `li` wrappers in the Timeline.
   - Row names with time and details.
   - Unique "Why?" names (M12).
7. Show an error with Retry instead of "No baby yet" when loading fails (M6). Translate sync errors (M7).
8. Format breast seconds as minutes, "37 °C", and one duration style for both locales (M8, m14).
9. Chart labels at 12 px or more (M13).
10. Empty states with one action (m9). Remove the Timeline "Synced" chip.

## Test data created (for deletion)

- **Baby** `E2E-design-review-20261021T0529`, id `5a2ddcd3-72f8-4282-b615-00333e171c2d`, owned by the e2e test account. Nothing was touched on other babies.
- **87 events:**
  - 83 seeded.
  - 1 night sleep used for the running-timer state, stopped afterwards.
  - 3 wet diapers logged in the offline tests at 03:02-03:03 on Oct 21.
- **2 medications:** "Vitamin D drops", "Simethicone".
- **5 measurements:** 2026-08-10 to 2026-10-19.
- **3 invite links:** created and revoked; 0 pending.
- **Not written:** the import used synthetic API test fixtures, and its final write was mocked. The bath logged during the simulated outage never reached the server.
- **Cleanup.** There is no baby delete API, so delete it like other `E2E-` data.
