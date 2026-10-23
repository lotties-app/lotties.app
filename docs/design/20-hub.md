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

## 4. Running-timer pill

- Replaces the floating bar. Lives in the header, takes no page space, hides on Now (Running now cards) and in the Night view. Controls follow `canLog`, with the Caregiver rules unchanged. Same commands (`useTimerCommands`, `usePresetActions`) and sheets (`TimerSheetHost`) as before, so Pause/Resume/Stop/Undo behave identically.

## 5. Check for updates and About

- `ReloadPrompt` still registers the service worker (`registerType: 'prompt'`); it now also publishes the registration, the "new version waiting" flag and the reload function to `pwa/updateStore.ts`. The Updates screen calls `registration.update()` and waits for an installing worker to finish; states: checking, up to date, ready (reload on demand), error, unsupported (native app or no service worker).
- About reads `__APP_VERSION__` (package.json `version`), `__APP_BUILT_AT__` (build time) and `__APP_COMMIT__` (`APP_COMMIT` env, else `git rev-parse --short HEAD`) defined in `vite.config.ts`, so every deploy stamps its own build. The Dockerfile accepts `ARG APP_COMMIT`.

## 6. Checks

Unit tests: `hub/hubModel.test.ts` (visibility per role, shortcut choice, stored prefs, search, appointments soon). Component tests: `hub/HubScreen.test.tsx`, `hub/UpdatesAbout.test.tsx`, `timers/RunningTimerPill.test.tsx`, `layout/AppShell.test.tsx`, `pages/SettingsPage.test.tsx`. Screenshots: `tests/e2e/design-review/hub-preview.review.ts` (320, 390 and 430 px, light, dark, large text).
