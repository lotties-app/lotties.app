# 20. Hub navigation, timer pill and update check

Owner-approved redesign of 2026-10-22. Screens and tokens are in `docs/DESIGN.md` ("App shell", "Running-timer pill", "Hub"); this note records the decisions and the rules behind them.

## 1. Why

- Settings had become a long accordion holding everything that is not a daily tab (medicines, formulas, members, import, links to vaccines and appointments). Nothing there could be found without opening sections one by one.
- The mini timer bar covered the page and forced a reserved padding (`--timer-bar-offset`) on every screen.
- The centre "+" in the pill made the navigation look like the app it was inspired by. The owner asked for a different shape: a dock plus a separate quick-add button.

## 2. Navigation

- Dock: Now, Day, Insights, Hub (`layout/BottomNav.tsx`). Quick add: a separate 56 px round button at the bottom right, absent when `canLog` is false (Viewer, Doctor, no baby). The Doctor keeps her patient-centric flow: she lands on `/patients` when she has no baby of her own, and the Hub lists Patients, Notes and My proposals for her; her dock has no "+".
- The Hub tab is current on every route reached from the Hub (`HUB_ROUTES`), so back-navigation always lands on a lit tab.
- Old links keep working: `/settings` (sync icon `#sync`, account menu `#baby`, `#appearance`, reminder prompts `#notifications`), `/appointments`, `/vaccines`, `/notes`, `/patients`, `/proposals`, `/from-doctor`, `/invite`. Sections that moved redirect: `/settings#medications` to `/hub/medicines`, `#formulas` to `/hub/formulas`, `#import` to `/hub/import`, `#members` to `/hub/family`.

## 3. Hub

- One catalogue (`hub/hubEntries.ts`): id, section, icon, route, visibility rule. Visibility reuses `baby/permissions.ts`; the server still enforces every rule.
- Shortcuts: counted per device in `localStorage` (`lotties.hub.v1`, a UI preference like the theme, guarded and tolerant of damaged values). Default order before any use: vaccines, appointments, growth, medicines. A manual pick wins and is kept to what the person can still see. App entries (Settings, Import, Updates, About) are never shortcuts.
- Attention (`hub/useHubAttention.ts`): local data only. Vaccines due or overdue (same engine as the Now card), appointments starting within 3 days, the doctor inbox (proposals plus unread recommendations) for Owners and Parents, unread recommendations on Notes. The dot on the Hub tab sums vaccines, appointments and the inbox (Notes repeats the inbox, so it is not added).
- Search matches word starts in the localized title, hint and keywords, ignoring case and accents.
- App > "Cry monitor (beta)" (`cryMonitor`, microphone icon, `/hub/cry-monitor`, 2026-10-24, docs/design/35-cry-engine.md section 8): after Import backup, for Owners, Parents and Caregivers of the selected baby (`canLog`), hidden for a Viewer, the Doctor, in the native app (`native`) and in a browser without the microphone API, AudioWorklet, WebAssembly or workers (`HubContext.cryMonitorSupported`, detected once by `cryMonitor/support.ts`). Like every App entry it is never a shortcut.

## 4. Running-timer pill

- Replaces the floating bar. Lives in the header, takes no page space, hides on Now (Running now cards) and in the Night view. Controls follow `canLog`, with the Caregiver rules unchanged. Same commands (`useTimerCommands`, `usePresetActions`) and sheets (`TimerSheetHost`) as before, so Pause/Resume/Stop/Undo behave identically.

## 4b. Catch-up button ("Since you last looked")

- Owner feedback: the inline catch-up card in the middle of Now cluttered the page. It now sits behind a header icon button (`now/ui/CatchUpButton.tsx`, in `TopBar` between the sync icon and the avatar), 44 px, `history` icon, with a count badge of the new entries (MUI Badge, `max` 9 so "9+"; the number is text, not colour only). Hidden when nothing is new; no animation or blink.
- Same rules as the card: the Now screen still owns the period (`useHandover`, `catchUp.ts`) and offers its catch-up through `now/catchUpSlot.ts` only on the day view (not the Night view, not first-run); the header button shows only the offer for the baby it is keyed to. Viewers see it as before; the Doctor never has the parents' shell.
- Tap opens the same content (`now/ui/CatchUpContent.tsx`: who-did-what rows from `catchUpText.ts`, Share as text, Got it) in a popover on `sm` and up, a bottom sheet (`SheetFrame`) on phones. Got it marks it seen (the button goes); Esc, the scrim or Close leave it for later and give focus back to the button. The accessible name carries the count ("What changed since your last look, 3 new" / "O que mudou desde a sua última olhada, 3 novos").
- Later candidates for the same pattern (not moved): the doctor inbox card and the overtired, belly pain, fussy pattern and diaper suggestion cards are informational and dismissible; the next appointment and vaccines due cards are informational but link to their pages. The reminder prompt card is actionable (it sets up notifications) and stays inline.

## 5. Check for updates and About

- `ReloadPrompt` still registers the service worker (`registerType: 'prompt'`); it now also publishes the registration, the "new version waiting" flag and the reload function to `pwa/updateStore.ts`. The Updates screen calls `registration.update()` and waits for an installing worker to finish; states: checking, up to date, ready (reload on demand), error, unsupported (native app or no service worker).
- About reads `__APP_VERSION__` (the release `APP_VERSION` stamped by deploy/homelab/deploy.sh, else `dev`; package.json `version` is no longer used), `__APP_BUILT_AT__` (`APP_BUILD_TIME`, else the build time) and `__APP_COMMIT__` (`APP_COMMIT`, else `git rev-parse --short HEAD`) defined in `vite.config.ts` through `build-info.ts`, so every deploy stamps its own build. The Dockerfile accepts `ARG APP_VERSION`, `APP_COMMIT`, `APP_BUILD_TIME` (docs/DEPLOY.md "Versions").
- Running version (2026-10-24, owner: "would be nice to have the current running version of the site somewhere"). About shows two facts: "App (this device)" `v0.1.38 · commit abc1234 · built <date>` and "Server" the same from the public `GET /api/v1/version` (fetched after the screen renders, 4 s timeout, no token; "Checking the server…", then the stamp or "Server version unavailable"; it never blocks the screen). The update hint is driven only by the service worker update state from `pwa/updateStore.ts` (a new app version installed and waiting, the same signal as Check for updates): an info alert "An update is available." with the reload note and Reload to update. It never compares versions or commits: the deploy rebuilds only the image that changed (an API-only release makes the server newer while the app is current, and the build commit differs between images even when the web source did not change), so comparing would raise false alarms. When the two versions differ and no update is waiting, About adds only a neutral caption, "The server was updated separately." (orchestrator review 2026-10-24). "Copy version info" copies `Lotties app v0.1.38 (commit abc1234), server v0.1.38 (commit def5678)` (Clipboard API, else a hidden textarea and `execCommand('copy')`; the result is announced). No "Report a problem" link exists in the app today, so no issue body is prefilled.
- The quiet version line (`ui/VersionLine.tsx`, real text, caption size, a visually hidden "App version:" prefix): `v0.1.38` at the bottom of Settings and of the Hub (a link to `/hub/about`, 44 px tall), `Lotties v0.1.38` in the landing footer (before "Source code", `·` between) and in a footer under `/credits` and `/privacy`. The doctor's account menu has an About entry (info icon, the version right-aligned in caption) that opens `/doctor/about`, the same About inside her shell (its credits and privacy links stay in `/doctor`).

## 6. Checks

Unit tests: `hub/hubModel.test.ts` (visibility per role, shortcut choice, stored prefs, search, appointments soon). Component tests: `hub/HubScreen.test.tsx`, `hub/UpdatesAbout.test.tsx`, `timers/RunningTimerPill.test.tsx`, `now/ui/NowScreen.views.test.tsx` (catch-up button), `layout/AppShell.test.tsx`, `pages/SettingsPage.test.tsx`. Screenshots: `tests/e2e/design-review/hub-preview.review.ts` (320, 390 and 430 px, light, dark, large text).
