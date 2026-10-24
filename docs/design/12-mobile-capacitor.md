# 12. Native apps with Capacitor (iOS and Android)

Status: shell started 2026-10-22 (code/mobile). Builds and syncs on Windows; never run on a device yet (no Mac, no
Android SDK on the dev machine, no developer accounts). Payments are out of scope.

## 1. Decisions

| Topic | Decision |
| --- | --- |
| Shell | Capacitor 8.5.3 (current stable), package `code/mobile`, exact pinned versions (`.npmrc save-exact`) |
| Web content | The web build is **bundled** (`webDir: ../web/dist`). No `server.url`: the app starts and works offline from its own assets (offline-first, and Apple guideline 4.2 rejects thin website wrappers) |
| App id / name | `app.lotties.app` / `Lotties` (Android `applicationId`, iOS bundle id) |
| Local origins | Android `https://localhost` (`androidScheme: https`), iOS `capacitor://localhost` (`iosScheme: capacitor`), both pinned in `capacitor.config.ts`. Not `lotties://`: the content scheme must not collide with a link scheme the app registers, and `capacitor` is the origin every Capacitor/CORS guide expects. **Permanent**: IndexedDB and localStorage belong to the origin, so changing a scheme or `hostname` after a release empties every device (unsynced changes lost) |
| API | `https://lotties.app` (the API is at `/api/v1`); Vite mode `native` (`code/web/.env.native`) |
| Sign-in | System browser (`@capacitor/browser`: SFSafariViewController, Android Custom Tab), back through the URL scheme `app.lotties.app://auth/callback` and `app.lotties.app://auth/logout` (RFC 8252 private-use scheme in reverse-DNS form, PKCE S256) |
| `allowNavigation` | **None** (the brief suggested `https://auth.lotties.app`; deliberately left out). Token and userinfo calls are fetch requests (CORS), not navigations; without the entry, any stray navigation to the identity provider opens in the system browser instead of the WebView, so a password is never typed into an embedded view. Capacitor documents `allowNavigation` as not meant for production |
| Plugins | `@capacitor/app` (URL events), `@capacitor/browser` (sign-in), `@capacitor/keyboard` (resize), `@capacitor/splash-screen`. Status bar through the **core** `SystemBars` plugin of Capacitor 8 (the `@capacitor/status-bar` options `overlaysWebView`/`backgroundColor` no longer work on Android 15/16 edge-to-edge). `@capacitor/filesystem` + `@capacitor/share` (files leave the app through the share sheet: `platform/saveFile.ts` writes the file to the cache directory and shares it; a download link goes nowhere in the WebView; used by Export data, the account data download and the calendar `.ics`). Haptics and Preferences: not added (nothing uses them yet) |
| iOS dependencies | Swift Package Manager (Capacitor 8 default; `ios/App/CapApp-SPM/Package.swift`). No CocoaPods, no `pod install` |
| Service worker | Not registered inside the shell (the bundled assets are the offline copy; a store release is the update). PWA path unchanged |

## 2. Architecture

```
 iOS / Android app (code/mobile)                              lotties.app (home lab)
 ┌───────────────────────────────────────────┐               ┌──────────────────────────┐
 │ WKWebView / Android WebView                │  fetch + JWT  │ /api/v1  (.NET API)       │
 │  origin capacitor://localhost | https://localhost ─────────▶│  CORS: those two origins  │
 │  bundled code/web/dist (Vite mode native)  │               └──────────────────────────┘
 │  Dexie (per account) + localStorage (OIDC) │  token, userinfo (CORS)
 │                                            │──────────────▶ auth.lotties.app (Keycloak)
 │ native: App, Browser, Keyboard, Splash,    │                       ▲
 │         SystemBars                         │  system browser       │ sign-in page
 └───────────────┬────────────────────────────┘───────────────────────┘
                 ▲  app.lotties.app://auth/callback?code&state (URL scheme)
```

- Build: `npm --prefix code/mobile run build:web` runs `code/web` `build:native` (type checks, then `vite build --mode
  native`) through `scripts/build-web.mjs`, which stamps `APP_VERSION` (set, else `LOTTIES_VERSION_NAME`, else
  code/mobile/package.json) so About shows the store version; `npm --prefix code/mobile run sync` checks that both packages pin the same `@capacitor/*` versions
  (`scripts/check-plugin-versions.mjs`: the JS side is bundled from code/web, the native side compiled from
  code/mobile) and copies `dist` into `android/app/src/main/assets/public` and `ios/App/App/public` (both gitignored).
  `npm run android` / `npm run ios` build, sync and open Android Studio / Xcode (Xcode needs a Mac).
- Native build values (`code/web/.env.native`, committed, public): `VITE_API_BASE_URL=https://lotties.app`,
  `VITE_OIDC_AUTHORITY=https://auth.lotties.app/realms/lotties.app`, `VITE_OIDC_AUDIENCE=` (audience mapper),
  `VITE_REPO_URL`. `VITE_OIDC_CLIENT_ID` is left empty: set it in `code/web/.env.native.local` (gitignored) or the
  shell (`VITE_OIDC_CLIENT_ID=... npm run build:web`); without it the app shows its setup message. Every key is listed
  so nothing from a developer's `.env.local` leaks into the store build.
- Web code: one check, `isNativeApp()` (`code/web/src/platform/nativeApp.ts`, reads `Capacitor.isNativePlatform()` from
  the bridge the shell injects, so `@capacitor/core` is never loaded by the PWA). Everything native is behind it:
  - `platform/nativeShell.ts`: the `NativeShell` adapter; Capacitor plugins load lazily from one chunk
    (`platform/capacitorPlugins.ts`). Verified in the build output: `@capacitor/*` code is only in the lazy
    `capacitorPlugins-*.js` (8.1 kB) and two `web-*.js` shims (1.2 kB); the entry chunk carries only the sign-in
    adapter (about 2.2 kB raw, 1 kB gzip). The service worker still precaches those lazy chunks (about 10 kB).
  - `platform/startNativeShell.ts` (lazy from `main.tsx`): status bar style follows the app theme.
  - `auth/nativeAuth.ts` + `auth/OidcAuthProvider.tsx`: sign-in (section 3).
  - `pwa/ReloadPrompt.tsx` registers no service worker, `pwa/useInstallPrompt.ts` offers no install button or iOS hint.
- Status bar, safe areas, keyboard: `index.html` already has `viewport-fit=cover` and the layout pads with
  `env(safe-area-inset-*)`. iOS `contentInset: never`; Android `SystemBars.insetsHandling: css` (edge-to-edge with real
  `env()` values, plus `--safe-area-inset-*`), `initialViewportFitValueHint: cover`. The bar content follows the app's
  theme (`data-light` dark content, `data-dark`/`data-night` light content, `platform/systemBars.ts`), which can differ
  from the device appearance. Keyboard: iOS `resize: native` (the WebView shrinks, bottom sheets stay above the
  keyboard), Android `resizeOnFullScreen: true` (needed edge-to-edge). Back button: Capacitor default (WebView history,
  then exit).

## 3. Sign-in and sign-out

1. `login()` calls `signinRedirect` as on the web. The `UserManager` is built with the native redirect URIs and a
   custom redirect navigator (`NativeAuthRedirects.navigator`) that opens the authorization URL with `Browser.open`
   instead of navigating the WebView. The request (state + PKCE verifier) is stored in localStorage as before.
2. The provider redirects the system browser to `app.lotties.app://auth/callback?code=...&state=...`; the OS opens the
   app (Android intent filter scheme `app.lotties.app`, host `auth`; iOS `CFBundleURLTypes`), `App` emits
   `appUrlOpen`.
3. `NativeAuthRedirects.attach` (mounted by `OidcAuthProvider`) accepts the URL only if its `state` is a request this
   device stored and has not completed (duplicates, a launch URL read again after a reload and foreign links are
   ignored), closes the browser, calls `userManager.signinCallback(url)` (code exchange, user stored, react-oidc-context
   gets `userLoaded`) and navigates to `returnTo`, exactly like the web callback.
4. The sign-in promise stays pending until its redirect arrives (the auth state is "loading", as on the web whose page
   unloads). When the user closes the browser, it fails after a 1.5 s grace (Android also reports "browser finished"
   right after a successful redirect) and the landing page shows its failed-sign-in notice with a retry.
5. If the OS stopped the app while the browser was open, the redirect starts the app: `App.getLaunchUrl()` is
   completed the same way (a failure goes to the landing page with the failed notice).
6. Account creation (`register`) uses the same navigator (Keycloak `/registrations`).
7. Sign-out: unchanged clean-up first (`useSignOut`: outbox warning, account database deleted, user removed), then the
   end-session URL opens in the system browser (so the next sign-in asks again) and returns to
   `app.lotties.app://auth/logout`, which closes the browser and goes to `/`.

Unchanged: the user store (localStorage), `offline_access` refresh tokens and `SessionRenewal`, the per-account Dexie
database named from issuer + sub, the ended-session marker. Unit tests: `auth/nativeAuth.test.ts` (real
`UserManager`, fake shell), `auth/nativeSignIn.test.tsx` (provider), `platform/*.test.ts` (mocked Capacitor plugins).

Later option: iOS `ASWebAuthenticationSession` (a plugin) shares Safari's session and returns without a registered
scheme; Android App Links / iOS universal links (`https://lotties.app/auth/native-callback`) remove the private scheme
from the redirect entirely (section 9).

## 4. Keycloak client changes (owner)

On the realm `lotties.app` (`https://auth.lotties.app`), the public SPA client named in `VITE_OIDC_CLIENT_ID`; nothing
was changed by this work. Add, when the apps go to testers:

| Setting | Add |
| --- | --- |
| Valid redirect URIs | `app.lotties.app://auth/callback` |
| Valid post logout redirect URIs | `app.lotties.app://auth/logout` |
| Web origins | `https://localhost`, `capacitor://localhost` |

Keep the existing web values (`https://lotties.app/auth/callback`, `https://lotties.app/login`, `https://lotties.app`).
Web origins matter: the WebView calls the token and userinfo endpoints with `fetch`, so Keycloak must answer with CORS
for the app origins (`+` does not cover them). To verify on the first device run: that the admin console accepts
`capacitor://localhost` as a web origin. Alternative if the owner prefers isolation: a second public client
(`lotties-mobile`) with only the native values, then `VITE_OIDC_CLIENT_ID` differs per build.

## 5. API CORS changes (owner)

`CORS_ALLOWED_ORIGINS` (comma-separated, exact match) must list the WebView origins next to the web origin:
`https://lotties.app,https://localhost,capacitor://localhost`. The API already supports several origins (and a
non-http scheme: test `Preflight_NativeAppOrigins_AreAllowedNextToTheWebOrigin`). The home lab kit hardcoded the web
origin; `deploy.sh` now reads `CORS_ALLOWED_ORIGINS` from `deploy/homelab/.env` (default unchanged:
`https://<PUBLIC_HOST>`, validated as a list of origins). Bearer tokens, no cookies: allowing `https://localhost` exposes
nothing a page on the user's own machine could not already do with a token it does not have.

## 6. Offline and local data

- Same data model as the PWA: Dexie (IndexedDB) per account, the outbox, localStorage for the OIDC user and settings.
  It lives in the app container (WKWebView data store / Android `app_webview`) and is removed only with the app.
- Versus Safari: a website's script-writable storage is deleted after 7 days of Safari use without a visit (ITP), and
  storage can be evicted under pressure; a home-screen PWA has its own counter. In the app the origin is the app's own
  bundle, used every time the app opens. To verify on device: WebKit's documented behaviour for non-browser apps (the
  7-day cap is described for browsers and home-screen web apps).
- First launch works offline after install (assets bundled); sign-in and sync need the network, as in the PWA.
- Android backup: decided **off** (`allowBackup="false"`, `fullBackupContent="false"` and `res/xml/data_extraction_rules.xml` excluding cloud backup and device transfer). The WebView storage holds the refresh token and the unsynced outbox; a restored token on another phone is a session nobody opened, and everything else comes back from the server after sign-in.
- Content-Security-Policy: the nginx header does not exist in the app (no server), so the native build gets the same policy as a `<meta>` tag (`code/web/native-csp.ts`, only in `vite build --mode native`): own bundle only, `connect-src` = the API and identity provider origins read from `.env.native`, no inline or remote script, `form-action 'none'`. **Untested on a device**: if the first run shows a blank screen, look for a CSP violation in the WebView console (chrome://inspect, Safari Web Inspector) before suspecting anything else.

## 7. Push notifications (decision, not built; full design in docs/design/19-native-push.md)

Inside the shell Web Push is not available (WKWebView has no Push API; Android WebView neither), and the service worker
is not registered. Plan: native push.

- Client: `@capacitor/push-notifications` (APNs token on iOS, FCM token on Android), permission prompt from the same
  notification settings, registration sent to the API with the platform.
- Server: a second sender next to `WebPushSender` (`Lotties.Infrastructure/Push`) implementing `IPushSender`
  (`SendAsync(PushTarget, PushMessage)`): APNs over HTTP/2 with token auth (`.p8` key, key id, team id) and FCM HTTP v1
  (service account JSON). A dispatching sender picks by the subscription's channel (`web`, `apns`, `fcm`);
  `PushSubscription` gets a channel and a device token besides the Web Push endpoint (migration). Payload stays the
  `v:1` contract (docs/design/09-push-notifications.md); snooze/open become notification categories/actions handled by
  the app (`pushNotificationActionPerformed`) calling the same delivery-action endpoint.
- "No hosted vendor": APNs and FCM are the platform transports (unavoidable for native push, just as Web Push already
  goes through Apple/Google/Mozilla push services); no aggregator (OneSignal, Pusher, Ionic) and no Firebase SDK on
  iOS. Trade-off: FCM still needs a Google Cloud project and its service account (secret), APNs needs the Apple key
  (secret); both are free.
- Until then: the notification settings should treat the shell as "not supported" (today `pushSupport.ts` would tell an
  iPhone user to add the site to the Home Screen inside the app). Follow-up for the notifications owner: one
  `isNativeApp()` check in `browserPushDevice.support()`.
- Effort: 5 to 8 days (API sender + migration + tests 3 to 4, client 1 to 2, device testing 1 to 2).

## 8. Widgets and quick actions (plan, not built)

Data the widget needs (per selected baby, written by the app, never read from the network by the widget): baby
name, sleep state (`asleep`/`awake`) and `startedAt`, last feed (time, kind, amount or side), last diaper (time, kind),
`updatedAt`. Times are absolute; the widget renders "x min ago" itself (timeline / relative text), so it stays right
without the app.

- iOS: a WidgetKit extension (SwiftUI) in the Xcode project, App Group `group.app.lotties.app` shared by app and
  widget; a small custom Capacitor plugin writes the JSON to the group's `UserDefaults` and calls
  `WidgetCenter.shared.reloadAllTimelines()`. Lock-screen widget variants hide names (privacy setting).
- Android: an App Widget (Jetpack Glance or RemoteViews) reading the same JSON from `SharedPreferences`, updated by the
  same plugin (`AppWidgetManager.updateAppWidget`).
- Fed from the web app after every local event write and after each sync pull (one writer function behind
  `isNativeApp()`), so the widget is right offline too.
- Quick actions: widget buttons, iOS home-screen quick actions (`UIApplicationShortcutItems`) and Android app shortcuts
  (`shortcuts.xml`) open deep links such as `lotties://quick/bottle`, `lotties://quick/diaper`, `lotties://quick/sleep`
  (a short scheme registered next to `app.lotties.app`, or `app.lotties.app://quick/...` reusing it). The app routes
  them through `appUrlOpen` to the existing sheets with a validated, allow-listed action (never a free path). Whether a
  quick action logs at once or opens the prefilled sheet is a UX decision still open.
- Effort: 5 to 10 days (iOS extension 3 to 5, Android widget 2 to 3, plugin + web writer 1 to 2). Needs a Mac.

## 9. Universal links / App Links (later, document only)

`https://lotties.app/...` links (invites, notification deep links) could open the app: serve
`/.well-known/apple-app-site-association` (team id + bundle id, `application/json`) and
`/.well-known/assetlinks.json` (package name + signing certificate SHA-256) from the web image's nginx, add the
Associated Domains entitlement (`applinks:lotties.app`, needs the Apple account) and an `autoVerify` intent filter. The
same mechanism can replace the private scheme in the OAuth redirect (claimed `https` redirect, safer than a scheme any
app can register; PKCE already blocks code interception).

## 10. Store requirements

- Accounts: Apple Developer Program about US$99 per year; Google Play Console US$25 once (new personal accounts must
  run a closed test with testers for 14 days before production).
- Privacy policy URL (both stores) and the data forms: Apple App Privacy (health and fitness, contact info (email),
  identifiers, linked to the user, no tracking), Google Play Data safety (health info, personal info; encrypted in
  transit; deletion available). Google Play also has a Health apps declaration. Medication reminders: no medical
  advice claims (Apple 1.4.1); age rating questionnaire; not the Kids category (the users are parents).
- **Account deletion (built, branch `feat/account-deletion`; spec in docs/SPEC.md, Keycloak step in docs/DEPLOY.md)**: `GET /me/deletion-preview` + `DELETE /me`, Settings > Account and data (web and app), data download first on the web (the app has no file-share plugin yet, so it points to the web; a share/filesystem plugin needs a dependency change). The original analysis follows.
- **Account deletion (analysis)**: Apple 5.1.1(v) and Google Play require deleting the account from inside the
  app (Google also a web link) when the app can create accounts (it can: Keycloak registration). The app has no account
  deletion today (`/api/v1/me` is read-only). API work: `DELETE /api/v1/me` that removes the user's memberships, deletes
  babies where the user is the only member (events, measurements, medications, prescriptions, invites, notification
  preferences, push subscriptions), refuses (409) when the user is the last owner of a shared baby until ownership is
  transferred, deletes the user row; then the identity: Keycloak account deletion (the realm's "Delete Account" required
  action via `kc_action=delete_account`, or the API with a service account). Web/UI: a Settings entry with the unsynced
  outbox warning, then the local clean-up of `useSignOut`. Effort 3 to 5 days.
- Apple 4.2 (minimum functionality) mitigations: bundled offline-first app (no remote URL), native sign-in sheet,
  native push (section 7), widgets and quick actions (section 8), no web chrome inside the app (no install prompts, no
  "open in browser"), correct icons/splash/launch screen, keyboard and safe areas handled. Push and at least one
  widget should exist before the first iOS review.
- Icons and splash: generated from the brand icons (docs/design/icons, concept B) by `npm --prefix code/mobile run assets` (`code/mobile/scripts/generate-native-assets.mjs`, uses `sharp` from code/web; no new dependency). Android: legacy, round, adaptive foreground (background colour `#F5EFE4`) and monochrome (themed icons) mipmaps, pre-Android 12 `splash.png` per density, Android 12+ splash from `values/styles.xml` (`windowSplashScreenBackground` + the foreground icon; dark `#1B1814` in `values-night`). iOS: 1024 px opaque app icon, `Splash.imageset` with light and dark 2732 px images. Splash colours: light `#f5efe4`, dark `#1b1814` (the web first-paint colours). Not checked on a device: the glyph sits in the adaptive icon safe zone by construction (0.78 of the canvas, as the maskable art), look at it on a launcher first.

## 11. AGPL-3.0 and the App Store

The App Store terms (usage rules, DRM) add restrictions that GPL-family licences forbid passing on, which is why
third-party GPL code was pulled from the store before. A copyright holder is not bound by the licence of their own code,
so the owner can publish code they wrote. Third-party contributions are different: before accepting outside
contributions that ship in the apps, require a CLA (or a contributor licence grant that allows store distribution), or
dual-licence the project; add it to CONTRIBUTING and a CLA check to pull requests. Dependencies must stay permissive
(MIT/Apache/BSD; Capacitor is MIT). The AGPL source offer stays visible in the app (landing footer, `VITE_REPO_URL`).
Not legal advice: confirm with a lawyer before the first release.

## 12. Signing and secrets

Nothing secret is in the repository (`code/mobile/.gitignore` refuses keystores, `.p8`/`.p12`, provisioning profiles,
`google-services.json`, `GoogleService-Info.plist`).

- Android: Play App Signing (Google holds the app signing key); the upload keystore lives outside the repository and in
  GitHub secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`);
  `app/build.gradle` gets a `signingConfigs.release` that reads environment variables (to add with the first release).
- iOS: App Store Connect API key (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`) in GitHub secrets; distribution
  certificate and profile via Xcode automatic signing on CI (API key) or fastlane match (encrypted private repo).
- APNs `.p8` key and the FCM service account (section 7) are API secrets: the Secret `lotties-secrets`, like the VAPID
  keys.

## 13. CI plan (built as `.github/workflows/mobile-release.yml`, unrun; how to use it: docs/MOBILE-RELEASE.md)

- Android (ubuntu-latest): Node 22, Temurin JDK 21, `npm ci` in code/web and code/mobile, `build:web` (client id from a
  repository variable), `npx cap sync android`, `./gradlew assembleDebug` on pull requests (artifact); on a `v*` tag
  `./gradlew bundleRelease` signed with the secrets, upload to the Play internal track (Play Developer API service
  account secret, `r0adkll/upload-google-play` or fastlane supply).
- iOS (macos-latest; about 10x the Linux minute cost): `npm ci`, `build:web`, `npx cap sync ios`, `xcodebuild archive`
  (SPM resolves packages) with the API key, upload to TestFlight (`xcrun altool` / fastlane pilot). Only on tags.
- Keep `scripts/check-plugin-versions.mjs` in both jobs (it runs in `npm run sync`).

## 14. Versioning and updates

- One release number for web, API and apps: the `vX.Y.Z` tag `deploy.sh` already produces. `versionName` /
  `CFBundleShortVersionString` = `X.Y.Z`; `versionCode` / `CFBundleVersion` = a monotonic integer
  (`X*10000 + Y*100 + Z`, or the CI run number when several builds of one version reach the stores). Set by CI, not
  hand-edited (today `versionCode 1`, `versionName "1.0"` from the template).
- Updates are store releases: the bundled web app only changes with a new build, so the API must keep serving older
  app versions (stay on `/api/v1`, additive changes; a minimum-version check can come later).
- Live updates (replace the bundle without a store release; allowed by Apple for JS/HTML that does not change the app's
  purpose) are optional and later: Ionic Appflow/Capgo are hosted vendors (against the "no hosted vendor" stance), a
  self-hosted Capgo updater is possible. Start without.

## 15. Roadmap

| Stage | Content | Effort |
| --- | --- | --- |
| 0. Shell (this change) | code/mobile, auth adapter, CORS/Keycloak docs, design | done |
| 1. Device spike | Android Studio + emulator, a Mac (or CI) for the simulator; Keycloak and CORS values set; sign-in, sync, offline, safe areas, keyboard checked; brand icons and splash | 2 to 3 days |
| 2. Store prerequisites | developer accounts, privacy policy page, account deletion (API + UI), store forms, `isNativeApp()` in push support | 4 to 7 days + account approval |
| 3. Internal testing | signing, CI Android build, Play internal testing, TestFlight internal | 2 to 3 days |
| 4. Native push | APNs/FCM senders, channel in subscriptions, plugin, actions | 5 to 8 days |
| 5. Widgets + quick actions | iOS WidgetKit, Android widget, shared-data plugin, deep links | 5 to 10 days |
| 6. Release | closed test (Google 14 days), App Review with 4.2 mitigations in place, staged rollout | 2 to 3 days + review time |
