# 19. Native push for the iOS and Android apps (APNs and FCM)

Status: design only (2026-10-22). Nothing is built. It extends docs/design/09-push-notifications.md (Web Push, built and
deployed) and docs/design/12-mobile-capacitor.md section 7 (decision: native push, no aggregator). Needs vendor accounts
that do not exist yet (Apple Developer Program, Firebase project); the server side can be written and tested first
against fake HTTP handlers.

## 1. Why a second transport

Inside the Capacitor shell the Push API does not exist (WKWebView has none, Android WebView has none) and the service
worker is not registered. The scheduler, the planner, the deliveries table, the snooze/dismiss actions and the privacy
rules stay exactly as they are; only the last step changes: how one message reaches one device. The seam already exists:
`IPushSender.SendAsync(PushTarget, PushMessage)` returns a `PushSendResult` that the retry pass classifies
(`Sent`, `SubscriptionGone`, `SubscriptionInvalid`, `Retryable`, `Failed`). Native senders implement the same result
mapping, so delivery bookkeeping, backoff and revocation need no change.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Transports | APNs (HTTP/2, token auth with a `.p8` key) for iOS, FCM HTTP v1 for Android. No Firebase SDK on iOS, no aggregator (OneSignal, Pusher, Appflow). Firebase is on Android only because `@capacitor/push-notifications` uses it there; the server never uses a Firebase library |
| Server libraries | None new. APNs and FCM are plain HTTPS calls from `HttpClient`; the two auth tokens (ES256 provider token, RS256 service-account JWT exchanged for an OAuth2 token) are built with `System.Security.Cryptography` and cached. A NuGet package (`Google.Apis.Auth`, `FirebaseAdmin`) is rejected: it would add a large dependency for one signed JWT |
| Who renders the text | **The server**, in the subscription's language. The web worker renders `push.{en,pt-BR}.json` itself, but a native app is not running when the push arrives, and iOS can only change a notification's text with a Notification Service Extension (Swift, Mac, App Group) while Android needs custom `FirebaseMessagingService` code. A server-rendered `alert` is shown by the OS with no app code at all. The text is already generic by design (docs/design/09 section 3), so nothing private moves to the server that is not already in the payload |
| Payload | The `v:1` JSON of docs/design/09 section 8, unchanged, sent as custom data next to the visible text; the app reads it on tap |
| Actions | Snooze and Open stay. iOS: a notification category `DOSE` with the two actions; Android: notification actions come from the plugin's action types. Both call `POST /push/deliveries/{id}/actions` with the one-purpose action token from the payload (the app has an access token, but the token path is the one already tested) |
| Registration | The app asks the OS for permission from the same notification settings screen as the PWA, receives the APNs/FCM token and sends it to the API; tokens rotate, so the app sends it again whenever the plugin reports a new one and on every sign-in |

## 3. Data model (one migration, `NativePush`)

`PushSubscription` today is a Web Push subscription: a validated `https` endpoint (allowlisted host) plus the browser's
`p256dh`/`auth` keys, unique on the endpoint's SHA-256. Make it channel-aware without a second table (the deliveries,
retry pass and revocation all hang off it):

| Column | Change |
| --- | --- |
| `channel` | new, `web` (default for existing rows), `apns`, `fcm` |
| `device_token` | new, nullable, max 512 characters; the APNs device token (hex) or FCM registration token. Never returned by the API, never logged |
| `apns_environment` | new, nullable, `production` or `sandbox`. APNs tokens are valid in one environment only (TestFlight and App Store builds are `production`, a build run from Xcode is `sandbox`); the app reports which one it was built for |
| `endpoint`, `p256dh`, `auth` | become nullable |
| `endpoint_hash` | stays the unique key: SHA-256 of the endpoint for `web`, of `"{channel}:{device_token}"` for native, so one device token is one row and the "transferred to another account" logic (revoke reason `Transferred`) works unchanged |
| check constraint | `web` needs endpoint and both keys and no token; native needs a token and no endpoint or keys |

Domain: `PushSubscription.Create` splits into `CreateWeb(...)` (today's) and `CreateNative(channel, token, apnsEnvironment, ...)`;
`PushEndpoint`/`PushKeys` stay value objects used by the web channel only. The 10-subscriptions-per-user limit and the
"revoke after 10 consecutive failures" rule apply to all channels. `PushTarget` becomes a small union
(`WebTarget(endpoint, keys)`, `ApnsTarget(token, environment)`, `FcmTarget(token)`) built by `PushTarget.From(subscription)`.

## 4. API

Reuse the subscription routes; the body gains a discriminator (existing web clients send no `channel`, which means `web`):

- `POST /api/v1/push/subscriptions` with `{channel: "apns", deviceToken, apnsEnvironment, locale, deviceLabel?}` or
  `{channel: "fcm", deviceToken, locale, deviceLabel?}` (400 for a missing token, an overlong one, or a channel that
  conflicts with the fields present). `201` created / `200` refreshed, like Web Push. The endpoint allowlist (SSRF
  check) applies only to `web`.
- `POST /api/v1/push/subscriptions/revoke` takes `{channel, deviceToken}` as well as `{endpoint}` (logout releases this
  device, as `releaseThisDevice` does for the browser).
- `GET /push/config` adds `channels: ["web", "apns", "fcm"]` (the ones configured) so a build knows what to offer; the
  web `pushSupport.ts` uses it plus `isNativeApp()` (today the shell would wrongly tell an iPhone user to add the site to
  the Home Screen).
- Role matrix: same rows as the web subscription routes (signed in, any user); `EndpointRoleMatrixTests` already covers
  the paths.
- Account deletion (docs/design/12 section 10) already deletes the user's push subscriptions, whatever the channel.

## 5. Senders

`DispatchingPushSender : IPushSender` replaces `WebPushSender` in DI and picks by target type; each channel is an
`IChannelPushSender` registered only when configured. A target whose channel is not configured returns `Failed` with a
log line (never an exception) so a half-configured server keeps its web pushes working.

### 5.1 APNs (`ApnsPushSender`)

- `POST https://api.push.apple.com/3/device/{token}` (sandbox: `https://api.sandbox.push.apple.com`), HTTP/2 only
  (`HttpRequestMessage.Version = 2.0`, `VersionPolicy = RequestVersionExact`); connection reuse matters (Apple asks for
  few, long-lived connections), so one named `HttpClient` with `PooledConnectionLifetime` of an hour.
- Provider token: JWT `ES256`, header `{alg, kid: <key id>}`, claims `{iss: <team id>, iat}`, signed with the `.p8`
  (`ECDsa.ImportPkcs8PrivateKey`). Reuse one token for 30 minutes (Apple rejects tokens older than 60 minutes and
  tokens refreshed more often than every 20 minutes with `TooManyProviderTokenUpdates`).
- Headers: `apns-topic: app.lotties.app`, `apns-push-type: alert`, `apns-priority: 10` for `Urgency.High` and `5` for
  the rest, `apns-expiration` = now + time to live (Unix seconds; a late reminder is worse than none, the same rule as
  Web Push TTL), `apns-collapse-id` = `PushMessage.Topic` (32 characters, under the 64-byte limit: a snooze re-send
  replaces the earlier one).
- Body: `{"aps": {"alert": {"title", "body"}, "sound": "default", "category": "DOSE", "thread-id": "<babyId>"}, "lotties": <v:1 payload>}`.
  4 KB limit (the payload is under 1 KiB). `interruption-level` stays `active`; no `time-sensitive` (needs an
  entitlement and would break quiet hours).
- Result mapping: `200` sent; `410` (`Unregistered`) and `400 BadDeviceToken`/`DeviceTokenNotForTopic` gone/invalid
  (revoke); `400 PayloadTooLarge` and other `400` failed (our bug, loud log); `403` (`InvalidProviderToken`,
  `ExpiredProviderToken`, `BadCertificate...`) is a **server configuration error, not the subscription's fault**:
  `Failed`, do not count against the subscription, log at Error once per hour; `429 TooManyRequests` and `5xx` retry
  with `Retry-After`.

### 5.2 FCM (`FcmPushSender`)

- `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send` with `Authorization: Bearer <oauth token>`.
  The token comes from the service account: sign an RS256 JWT (`iss`/`sub` = service-account email, `scope` =
  `https://www.googleapis.com/auth/firebase.messaging`, `aud` = `https://oauth2.googleapis.com/token`), exchange it
  for an access token (about 1 hour), cache it until 5 minutes before expiry, refresh once on a `401`.
- Body: `{"message": {"token", "notification": {"title", "body"}, "android": {"priority": "HIGH"|"NORMAL", "ttl": "3600s", "collapse_key": <topic>, "notification": {"channel_id": "reminders", "tag": <topic>, "click_action"?: none}}, "data": {"lotties": "<v:1 payload as a string>"}}}`.
  A message with a `notification` block is displayed by the system when the app is in the background, with no app code;
  `data` carries the payload to the app. `HIGH` only for `Urgency.High` (Android throttles high priority that users do
  not interact with).
- The Android notification channel `reminders` (name, importance default) is created by the app at start (a plugin
  call); a message naming a missing channel falls back to a default one on old Android, is dropped on 8+ with no
  channel configured at all, so creating it is a must-have (listed in the checklist below).
- Result mapping: `200` sent; `404 UNREGISTERED` and `400 INVALID_ARGUMENT` for the token field gone/invalid;
  `403 SENDER_ID_MISMATCH` invalid (the token belongs to another Firebase project, for example a debug build);
  `401` refresh once, then retryable; `429 QUOTA_EXCEEDED` and `5xx`/`503 UNAVAILABLE` retry with `Retry-After`.

### 5.3 Server-rendered text

`NotificationText` (API, Application layer): `Render(kind, language, names?, at, zone) -> (title, body)` from two
embedded catalogs `push.en.json` and `push.pt-BR.json`. The web worker keeps its own copy of these files today
(`code/web/src/i18n/locales/push.*.json`); to avoid drift the API embeds the **same files** (linked as embedded
resources from the web folder, as the vaccine schedule is linked from `code/api/data`), and a test asserts every
`kind` of `NotificationKind` has a title and a body in both languages. Times are formatted in the subscription's
`time_zone` and language with `TimeZoneInfo` and `CultureInfo` (no Intl in .NET: only `HH:mm`/`h:mm tt`, which is all the
texts use). Names appear only when the recipient turned on "Show names on notifications" (unchanged rule).

## 6. Client (Capacitor)

- Plugin: `@capacitor/push-notifications` (same major as the other plugins; it is a dependency change in both `code/web`
  and `code/mobile`, so it is made by the orchestrator in the main clone, not in a feature worktree). Android also
  needs `google-services.json` from the Firebase project (gitignored already) and the Google Services Gradle plugin;
  iOS needs the Push Notifications capability and the `aps-environment` entitlement in the Xcode project (and the APNs
  key in App Store Connect), both added on the Mac.
- Web code behind `isNativeApp()` (lazy import, like `capacitorPlugins.ts`): a `nativePushDevice` that implements the
  same interface as `browserPushDevice` (`support()`, `permission()`, `subscribe()`, `current()`, `unsubscribe()`), so
  the existing reconcile logic (`pushActions.ts`) and the Settings section work unchanged. `subscribe()` calls
  `requestPermissions()`, `register()`, waits for the `registration` event and POSTs it with the channel.
  `registrationError` becomes the existing "could not subscribe" state.
- Taps and actions: `pushNotificationActionPerformed` maps `actionId`/`notification.data.lotties` to the same code the
  worker runs (`clickTarget.ts` builds the URL from validated ids; `snooze` calls the delivery action route with the
  token). A foreground push (`pushNotificationReceived`) shows the app's own in-app reminder or nothing (the Now screen
  already shows what is due), never a duplicate system banner.
- Badge count: not used (no unread concept).
- Reconcile on every launch and sign-in: if the OS permission was revoked or the token changed, POST the new token (the
  server revokes the old row as `Transferred` or on first `410`).

## 7. Configuration and secrets

| Setting (env) | Meaning |
| --- | --- |
| `PUSH_APNS_KEY_ID`, `PUSH_APNS_TEAM_ID`, `PUSH_APNS_KEY_P8` | APNs auth key (the `.p8` text or base64), team and key ids. Secret |
| `PUSH_APNS_BUNDLE_ID` | default `app.lotties.app` |
| `PUSH_FCM_PROJECT_ID`, `PUSH_FCM_SERVICE_ACCOUNT_JSON` | Firebase project and the service-account key (JSON, base64 in the env). Secret |

All in the Secret `lotties-secrets` next to the VAPID keys (docs/DEPLOY.md), validated at startup like the VAPID keys
(all-or-none per channel; a wrong key fails fast with a clear message; the values are never logged). `GET /push/config`
reports only which channels are on.

## 8. Privacy and security

- The APNs token and FCM registration token are device identifiers: stored, never returned, never logged, deleted with
  the subscription and with the account (docs/design/12 section 10). Delivery logs keep ids, kind, time and status only
  (unchanged, purged after 14 days).
- Apple and Google see the notification text and the sizes and timing: the same exposure as Web Push through their push
  services, and the reason the default text is generic ("A scheduled dose for 08:00 is not logged yet"), and names are
  opt-in. Say it in the privacy policy (docs/design/20-store-readiness.md).
- The Apple key and the service account can send to every installed device of the app: they live in the Secret only,
  rotate by replacing the Secret, and the sender never accepts a target outside its own channel.
- SSRF: the hosts are constants (`api.push.apple.com`, `api.sandbox.push.apple.com`, `fcm.googleapis.com`,
  `oauth2.googleapis.com`); a token is data, never a URL.

## 9. Tests (all without accounts)

- Fake `HttpMessageHandler` for each sender: URL, method, headers (`apns-topic`, `apns-push-type`, `apns-priority`,
  `apns-expiration`, `apns-collapse-id`; `Authorization: Bearer` for FCM), body shape and size, the status mapping table
  above, the provider-token reuse window (inject `TimeProvider`), the OAuth refresh on `401`, no secret or token in any
  log (a logger spy).
- JWT builders: verify the signature with the public half of a generated test key (ES256 and RS256), header and claims.
- Domain and persistence: `CreateNative` rules, unique hash per channel and token, the check constraint (model/snapshot
  tests; SQLite tests skip the check constraint like other Postgres-only behaviour), migration `NativePush` rule-based
  tests.
- API: subscribe/revoke with each channel (400 cases, 201/200, transfer between users), config `channels`, role matrix.
- Text: every `NotificationKind` renders in both languages, times in two zones, names only with the opt-in.
- Client (Vitest, mocked plugin): `nativePushDevice` state machine, reconcile on token change, action routing.
- On devices (once accounts and a Mac exist): sandbox push to a TestFlight/Xcode build, FCM to a debug build, doze and
  background, tap and snooze from the lock screen, token rotation after reinstall, logout releases the token.

## 10. Order of work and effort

1. Domain and migration (`NativePush`), API routes, config `channels`: 1 day.
2. `DispatchingPushSender`, `ApnsPushSender`, `FcmPushSender`, JWT helpers, `NotificationText` + catalogs, tests: 2 to 3 days.
3. Client `nativePushDevice`, tap/action routing, Settings wording for the app: 1 to 2 days (after the plugin dependency
   is added).
4. Accounts and device testing: Apple Developer Program (push capability, APNs key), Firebase project (Android app
   `app.lotties.app`, `google-services.json`, service account), then the device checklist: 1 to 2 days.

Steps 1 and 2 need no vendor account and can be merged and deployed dark (no channel configured, `channels` stays
`["web"]`).

## 11. Open questions for the owner

1. Firebase project: one project for debug and release builds is simpler; separate projects keep test tokens out of
   production (`SENDER_ID_MISMATCH` shows up if the two are mixed). Default: one project, two Android apps
   (`app.lotties.app` and `app.lotties.app.debug`).
2. Text catalogs shared with the web worker (linked embedded resource, section 5.3) versus a copy in the API: the link
   keeps one source of truth; the cost is that the API project references a file under `code/web`.
3. Android 13+ asks for the notification permission at runtime: show our own explainer first (as the PWA does) or ask
   at first launch. Default: the explainer from the notification settings, never at first launch.
4. Whether a missing Firebase/APNs configuration should hide the "reminders" section in the app (default) or show it
   disabled with an explanation.
