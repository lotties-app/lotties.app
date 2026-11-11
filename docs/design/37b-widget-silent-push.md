# 37b. Silent push for fresh widgets

Extends docs/design/37-widgets-siri.md section 16 ("Freshness"), item 16.3.1: entries logged on another phone while this
phone's app is closed. **Owner decision (2026-11-11): a silent push** (a data-only push from the server that wakes the
app so it pulls and rewrites the widget snapshot). Not a widget-side fetch, not OS background polling.

**Status (2026-11-11): server side built, off by default (`SilentPush:Enabled=false`); iOS receive path written, never
compiled or run; Android receive path not built (needs the Firebase Messaging library, section 9); the privacy policy text
is a held draft (docs/legal-held/widget-silent-push/).** Nothing sends until the owner provisions the keys of section 10
and turns the flag on.

## 1. What exists today (inventory, 2026-11-11)

| Piece | State |
| --- | --- |
| Web Push for reminders (VAPID, `push_subscriptions`, scheduler, deliveries) | Built and deployed (docs/design/09). Browser only: the Push API does not exist in WKWebView or the Android WebView |
| Native push for reminders (APNs, FCM) | **Design only** (docs/design/19-native-push.md). No device token is stored, no APNs or FCM sender exists, `push_subscriptions` has no `channel` column |
| `@capacitor/push-notifications` | Not a dependency of `code/web` or `code/mobile` |
| iOS: `aps-environment` entitlement | Absent (`App/App.entitlements` holds only the App Group) |
| iOS: `UIBackgroundModes` / `remote-notification` | Absent from `App/Info.plist` |
| iOS: `didRegisterForRemoteNotificationsWithDeviceToken`, `didReceiveRemoteNotification` | Absent before this change (AppDelegate is the Capacitor template) |
| Android: Google Services Gradle plugin | Classpath `com.google.gms:google-services:4.4.4` in `android/build.gradle` and the conditional `apply plugin` in `app/build.gradle` (Capacitor template): applied only when `app/google-services.json` exists |
| Android: `google-services.json` | Not in the repository (gitignored in `code/mobile/.gitignore`); CI does not provide one |
| Android: `com.google.firebase:firebase-messaging`, a `FirebaseMessagingService` | Absent |
| Server env names for APNs/FCM | Reserved by design 19 section 7 (`PUSH_APNS_*`, `PUSH_FCM_*`), unused before this change |

So silent push needs its own device registration, its own two senders and the native receive code. It does **not** reuse
`push_subscriptions` (section 4.1).

## 2. Flow

```
phone A (or Alexa, MCP)          API                                   Apple APNs / Google FCM        phone B (app suspended)
PUT /babies/{b}/events/{e} --> EventService writes the event
 header Lotties-Push-Device      -> ISilentPushSignal.BabyChanged(b)
                                  -> SilentPushQueue: one batch per baby
                                     (debounce, min interval, origin)
                               SilentPushWorker (every few seconds):
                                  due batch -> members of b (not Doctor,
                                  current core consent) -> their active
                                  devices minus the origin device
                                  -> ISilentPushSender -----------------> content-free push -------> native layer wakes
                                                                                                    -> asks the WebView to sync
                                                                                                    -> sync pull (Dexie)
                                                                                                    -> widgetSyncRunner writes
                                                                                                       widget-snapshot.json
                                                                                                    -> widgets reload
```

The phone does nothing new with the snapshot: the WebView's existing path (sync pull merges into Dexie, the Dexie live
query makes `startWidgetSync` rebuild and write the snapshot, the native `writeSnapshot` reloads the timelines) does all
of it. The push only says "something changed, sync now".

## 3. Payload: no personal data

| Channel | Request |
| --- | --- |
| APNs | `POST /3/device/{token}`, headers `apns-push-type: background`, `apns-priority: 5` (Apple requires 5 for background pushes), `apns-topic: app.lotties.app`, `apns-expiration: now + 1 h`. Body `{"aps":{"content-available":1},"lotties":{"v":1,"t":"sync"}}`: no alert, sound or badge |
| FCM | `POST /v1/projects/{project}/messages:send`, `{"message":{"token":...,"data":{"lotties":"sync","v":"1"},"android":{"priority":"NORMAL","ttl":"3600s","collapse_key":"lotties-sync"}}}`: a data message, no `notification` block |

The payload never carries a baby id, a name, an event type, a time, a count or any other content: the app pulls whatever
changed through its normal authenticated sync. Apple and Google see that a push was sent to this app install at this time
(metadata), nothing else. The collapse key is one constant, so a phone that is offline gets one push when it comes back
(APNs keeps only the last background push per app; FCM keeps one message per collapse key).

## 4. Server

### 4.1 Device registration (table `silent_push_devices`, migration `SilentPushDevices`)

| Column | Meaning |
| --- | --- |
| `id` | Server-generated; the app keeps it and sends it back as the header `Lotties-Push-Device` |
| `user_id` | The account that registered it (foreign key to `users`, cascade) |
| `channel` | `apns` or `fcm` |
| `token` | The APNs device token (hex, lower case) or the FCM registration token, at most 512 characters. Never returned by the API, never logged |
| `token_hash` | SHA-256 of `"{channel}:{token}"`, unique: one token is one row; a token registered by another account moves to it (the latest sign-in owns the device, as Web Push) |
| `apns_environment` | `production` or `sandbox` for APNs (TestFlight and App Store builds are production, an Xcode run is sandbox), null for FCM |
| `created_at`, `last_seen_at`, `last_sent_at`, `consecutive_failures`, `revoked_at`, `revoked_reason` | Lifecycle, as `push_subscriptions` (`user`, `gone`, `invalid`, `inactive`) |

Why a table of its own and not the `channel` column design 19 plans for `push_subscriptions`: a reminder subscription is
an opt-in to visible notifications (permission prompt, quiet hours, locale, deliveries table, retry pass); a silent-push
device is "this install shows widgets and wants change pings", needs no permission prompt on iOS and has none of those
rules. When design 19 is built the same token may be in both tables, each revoked on its own failures; that is accepted.

Routes (both need push on, otherwise 409 `silent_push_not_configured`; rate limit `push-write`):

- `POST /api/v1/push/devices` `{channel: "apns"|"fcm", token, apnsEnvironment?}` -> `201` new / `200` refreshed (last seen
  bumped, un-revoked, moved from another account), body `{id, channel, createdAt, lastSeenAt}`. 400 `validation_failed`
  for a missing or malformed token (`field` `token`), an unknown channel (`channel`), an APNs token without an environment
  or an FCM token with one (`apnsEnvironment`); 409 also when the channel is not configured. At most 10 active devices per
  account: the least recently seen beyond that are revoked (`inactive`). Needs a current core consent (default gate);
  blocked for a demo account (`DemoBlockedRoutes`: it sends data to a third party).
- `DELETE /api/v1/push/devices/{id}` -> `204`, idempotent; another account's id is a no-op. Exempt from the consent gate
  (switching a device off is always allowed).
- Role matrix: both "signed in" (`EndpointRoleMatrixTests`); account deletion erases the rows (`EfAccountDataEraser`,
  `AccountErasureTests`).

### 4.2 The trigger

`EventService` calls `ISilentPushSignal.BabyChanged(babyId, userId)` after every write that changed the store: a create, an
applied edit, a soft delete. An ignored upsert (stale, same content, deleted) signals nothing. Every writer goes through it:
the app's sync, the widget outbox drain (as the app's sync), Alexa, the MCP server (Siri, Android voice), the backup import
(a rolled-back import may send one needless ping: harmless, the sync finds nothing), the demo seeding (a demo account has
no device). With the flag off the signal is a no-op singleton and nothing is queued.

The origin device is the header `Lotties-Push-Device` (the id from 4.1). It is used only when that device belongs to the
caller, so a member cannot silence someone else's phone by sending another id (ids are random and never shown to other
members anyway). Writes without the header (a browser, Alexa, the MCP server) exclude nothing: a Siri entry on phone A
also pings phone A, which is what refreshes its widget (section 8).

### 4.3 Coalescing and limits

`SilentPushQueue` (in memory, one per API instance) keeps at most one batch per baby:

- **Debounce**: a batch is due `SilentPush:DebounceSeconds` (default 20 s) after its **first** change, so a burst (a sync
  push of ten queued entries, an import) is one push, and the first push is never later than the debounce.
- **Minimum interval per baby**: `SilentPush:MinIntervalSeconds` (default 300 s). A change during the interval waits for its
  end (trailing edge): at most one push per baby every 5 minutes, and the last change of a burst is never lost. Apple asks
  for no more than two or three background pushes an hour; iOS throttles beyond its own budget anyway (section 6), so
  this mostly saves server and Apple/Google traffic.
- **Origin**: the batch remembers its sole origin `(user, device)`; a change from another origin (or from no device) makes
  it "mixed". Only a batch with a sole origin device skips that device: two phones writing in the same window both get
  the push (each lacks the other's entry).
- One API instance per deployment today. With several, each coalesces its own writes (at worst a duplicate push); a
  restart drops the pending batches (at worst a missed push; the next app open syncs anyway).

### 4.4 Recipients

For a due batch: the baby's members whose role is Owner, Parent, Caregiver or Viewer (all of them see the baby in the
parents' shell and its widget), with a current core consent (`IConsentService.WithCurrentCoreAsync`, as reminders), their
active devices of a configured channel, minus the origin device. Never:

- a **Doctor** membership: her patients never enter the parents' shell or the full sync (design 19-doctor-dashboard), so
  no widget of hers shows the baby;
- a baby on the family's **own database** (design 47): reminders are off for such a baby in the first version and silent
  pushes follow the same rule (owner question, section 12);
- a **demo** account (it cannot register a device).

### 4.5 Senders and results

`ISilentPushSender.SendAsync(SilentPushTarget, CancellationToken) -> SilentPushOutcome` (`Sent`, `Gone`, `Invalid`,
`Failed`, `Retryable`, `ConfigurationError`, `NotConfigured`). `DispatchingSilentPushSender` picks the configured sender
of the target's channel (a `CanHandle` pick); a channel without credentials answers `NotConfigured` (never throws).
Implementations (`Lotties.Infrastructure/SilentPush`, plain `HttpClient` without request logging, no vendor library, the
JWT and token rules of design 19 sections 5.1 and 5.2):

- `ApnsSilentPushSender`: HTTP/2 to `api.push.apple.com` or `api.sandbox.push.apple.com` by the device's environment;
  ES256 provider token (`kid` = key id, `iss` = team id, `iat`) reused for 30 minutes and signed again after
  `ExpiredProviderToken`. `200` sent; `410` gone; `400` `BadDeviceToken`/`DeviceTokenNotForTopic` invalid; any other
  `400`, `403` (provider token), `404`, `405`, `413` a configuration error (our request or key, never the device's
  fault); `429` and `5xx` retryable; anything else failed.
- `FcmSilentPushSender`: RS256 service-account JWT exchanged at `oauth2.googleapis.com/token` for an access token, kept
  until 5 minutes before expiry, exchanged again once on `401` (a second `401` is a configuration error); a refused
  exchange sends nothing. `200` sent; `UNREGISTERED` gone; `403 SENDER_ID_MISMATCH` invalid; `400 INVALID_ARGUMENT`
  invalid only when the message is about the registration token (a bad payload must never revoke every device), else a
  configuration error, as other `400`/`403`/`404`; `429` and `5xx` retryable.

Outcomes (`SilentPushDevice.RecordOutcome`): `Sent` records `last_sent_at` and clears the failure count; `Gone` revokes as
`gone`, `Invalid` as `invalid`; `Failed` counts a failure (10 in a row revoke as `invalid`); `Retryable`,
`ConfigurationError` and `NotConfigured` change nothing (not the device's fault). There is **no retry** of a silent push
(the next change sends another, the next app open syncs). A configuration error is logged at error level at most once an
hour per channel. Logs carry device ids, counts and outcomes only: never a token, a key or a provider's response body.
Housekeeping in the same worker, on its first pass and then hourly: devices not seen for 60 days are revoked
(`inactive`), revoked rows older than 30 days are deleted.

### 4.6 Configuration (section `SilentPush`)

| Key (env) | Default | Meaning |
| --- | --- | --- |
| `SilentPush:Enabled` (`SILENT_PUSH_ENABLED`) | `false` | Master switch: off = no route works (409), no signal, no worker |
| `SilentPush:DebounceSeconds` | 20 | 0 to 300 |
| `SilentPush:MinIntervalSeconds` | 300 | 0 to 3600, per baby |
| `SilentPush:WorkerTickSeconds` | 5 | 1 to 60 |
| `SilentPush:MaxDevicesPerUser` | 10 | |
| `SilentPush:SendTimeoutSeconds`, `SilentPush:MaxConcurrentSends` | 10, 8 | |
| `SilentPush:FcmPriority` | `normal` | `normal` or `high` (section 6) |
| `PUSH_APNS_KEY_ID`, `PUSH_APNS_TEAM_ID`, `PUSH_APNS_KEY_P8`, `PUSH_APNS_BUNDLE_ID` (default `app.lotties.app`) | none | APNs auth key (the `.p8` text or its base64). Secret. All of key id, team id and key or none |
| `PUSH_FCM_PROJECT_ID`, `PUSH_FCM_SERVICE_ACCOUNT_JSON` | none | Firebase project id and the service-account key (JSON or its base64). Secret. Both or none |

Validated at startup (a half-configured channel, a key that does not parse, or the flag on with no channel fails fast with
a message that names the setting, never its value). The env names are design 19's, so native reminders will share them.

## 5. Client

### 5.1 Registration (web, behind `isNativeApp()`, lazy)

`widgets/silentPush.ts`, started by `WidgetSync` (signed in, account database open, native app only):

1. Ask the native layer whether a Lotties widget is installed (iOS `WidgetCenter.getCurrentConfigurations`). No widget:
   unregister if this install was registered, and stop. No token is stored for a phone without widgets.
2. Ask the native layer for its push token (iOS `registerForRemoteNotifications`, no permission prompt: background pushes
   need none). No token (no entitlement yet, simulator, error): stop quietly.
3. `POST /push/devices`; keep the returned id in this account's local storage; 409 `silent_push_not_configured`: stop
   until the next launch.
4. From then on every API request of the app carries `Lotties-Push-Device: <id>` (`api/pushDeviceHeader.ts`).
5. On every launch and resume the steps run again (tokens rotate after a restore or reinstall; the server dedupes).
6. Sign-out and account erasure: `DELETE /push/devices/{id}` before the session ends (with the Web Push
   `releaseThisDevice` in `endSession`), then the stored id is dropped.

### 5.2 Receiving (warm path)

When the app process and its WebView are alive (suspended in the background, the common case for some hours after the
app was last used):

- iOS: `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)` checks `lotties.t == "sync"`, finds the
  bridge's WebView and runs `window.dispatchEvent(new CustomEvent('lotties:remote-change'))`. The web side runs
  `syncEngine.syncNow()`, waits for the widget runner to be idle, and answers through the `lotties` message handler
  (`silentPushDone`). The completion handler is called then, or after 25 seconds (iOS allows about 30), with
  `.newData` / `.noData`.
- Android (not built, section 9): `FirebaseMessagingService.onMessageReceived` would hand the message to the live
  `LottiesShared` plugin (`notifyListeners("remoteChange")`) and the same web code runs; `WidgetRefresher` redraws on the
  snapshot write.

### 5.3 What a silent push cannot do (cold path)

When the process is not running (iOS terminated it for memory or after a long time; Android killed the process; the
person swiped the app away; Android force stop), the push wakes only native code: on iOS UIKit does not connect a scene
for a background launch, so there is no WebView, and on Android the messaging service starts without the activity. The
native layer has neither the data (it is in the WebView's IndexedDB) nor an access token, so the widget stays as it was
until the app opens. iOS delivers nothing at all to an app the person force-quit, until she opens it again. Options that
would close the gap are owner decisions (section 12, question 1); none is built.

## 6. Platform limits (battery and throttling)

- **iOS**: background pushes are best effort. iOS decides per device (battery, Low Power Mode, how often the person opens
  the app, its background budget) and may delay or drop them; Apple's guidance is two or three an hour at most. Not
  delivered when Background App Refresh is off for Lotties or globally, nor after a force-quit. Each delivery gives the
  app about 30 seconds; using more, or never calling the completion handler, lowers its budget. The widget reload asked
  from the background counts against WidgetKit's daily budget (design 37 section 16.3.5).
- **Android**: `NORMAL` priority (default) data messages are delivered at once while the phone is awake and wait for a
  Doze maintenance window or the screen turning on when it sleeps: the widget is current when the person looks.
  `HIGH` wakes the phone, but FCM deprioritizes high-priority messages that do not show a notification, so it is an
  option, not the default. App Standby buckets ("rare", "restricted") delay messages further; a force-stopped app gets
  nothing until it is opened.
- The server limits of section 4.3 apply on top.

## 7. Failure modes

| What happens | Effect |
| --- | --- |
| Flag off, or channel not configured | Routes 409; signal no-op; app keeps today's behaviour (section 16 of design 37) |
| APNs/FCM down, 429, 5xx | That push is lost (no retry); failure counted; the next change or app open catches up |
| Wrong APNs key or team (403), FCM key revoked (401 after refresh) | `Failed`, logged at error at most once an hour, devices not penalised |
| Token gone (app deleted, reinstall, restore) | Revoked on the answer; the app registers its new token at the next launch |
| Phone offline | One push kept by APNs/FCM (collapse); it arrives when the phone is back, within the 1 h TTL |
| App terminated / force-quit / process dead | No widget refresh (section 5.3) |
| WebView alive but the sync fails (no network, 401) | Completion `.noData`; widget unchanged; the next resume retries |
| Several API instances | Possible duplicate pushes; harmless |
| A member revoked or left the baby | No longer a member: gets no more pushes for it at the next batch |
| Consent withdrawn or outdated | Skipped by the consent filter |
| Account deleted | Rows erased with the account |

## 8. Voice entries (Siri, Android voice)

Siri intents and the Android voice shortcuts write through the MCP server; neither touches the phone's snapshot after a
successful write (design 37 section 16.3.2; checked 2026-11-11: `LottiesSiriIntents.swift` and `voice/VoiceRunner.kt`
only speak the answer). With silent push on, the MCP write has no device header, so the server pings **every** device of
the family, the same phone included: a warm app pulls and the widget shows the entry within the debounce. Applying the
widget buttons' optimistic change after an MCP write (`LottiesLogger.log` without the outbox append on iOS,
`WidgetOutbox.applyToSnapshot` on Android) would make it instant and work with the flag off too, but the MCP answer does
not return the event's fields in a form those functions take (the Siri side would have to map the intent back to an
outbox entry, with the risk of a widget showing an entry the server refused). Left as a follow-up, not built here.

## 9. Android: not built, why

FCM delivery to an app needs `com.google.firebase:firebase-messaging` (a `FirebaseMessagingService` subclass receives the
message; there is no supported way without the library) and a `google-services.json` at build time. Adding a Gradle
library is a dependency change of the mobile project (design 19 section 6 leaves it to the orchestrator, in the main
clone), and an Android build without `google-services.json` must keep working (Firebase not initialised: the service
must check `FirebaseApp.getApps(context)` first). The plan, for the change that adds the library:

1. `app/build.gradle`: `implementation platform('com.google.firebase:firebase-bom:<version>')`,
   `implementation 'com.google.firebase:firebase-messaging'`.
2. `push/LottiesMessagingService.kt` (`<service android:exported="false">` with the `com.google.firebase.MESSAGING_EVENT`
   intent filter): `onMessageReceived` checks `data["lotties"] == "sync"` and calls `SilentPushBus.remoteChange()`;
   `onNewToken` stores the token for the plugin.
3. `LottiesSharedPlugin`: `pushToken()` (`FirebaseMessaging.getInstance().token`, or `{token: null}` without Firebase),
   `widgetsInstalled()` (`AppWidgetManager.getAppWidgetIds` for the three receivers), and `notifyListeners("remoteChange")`
   from the bus while the plugin is loaded; `silentPushDone` resolves nothing on Android (no completion handler).
4. The web code of section 5 is shared; the bridge picks the Capacitor plugin on Android, the WebKit handler on iOS.
5. Unit test the pure part (`data` parsing) in `app/src/test`.

## 10. What the owner provisions (and what the repository has)

| Item | Where | In the repository |
| --- | --- | --- |
| Apple: enable **Push Notifications** on the App ID `app.lotties.app` (developer.apple.com > Identifiers) | portal | no |
| Apple: create an **APNs auth key** (Keys > +, Apple Push Notifications service), note its key id and the team id; download the `.p8` once | portal | no |
| Apple: regenerate the `Lotties App Store` profile (a capability changed) and update `IOS_PROFILE_BASE64` | portal + repo secret | no |
| iOS: `aps-environment` = `production` in `App/App.entitlements` (Xcode adds it with the Push Notifications capability; `development` for Xcode runs is set by the profile) | repo, with the profile | **no, on purpose**: adding it before the profile has the capability breaks the signed build |
| iOS: `UIBackgroundModes` = [`remote-notification`] in `App/Info.plist` (Background Modes capability > Remote notifications) | repo | **no, on purpose**: added together with the entitlement |
| Firebase: a project with the Android app `app.lotties.app` (and `app.lotties.app.debug` if wanted), `google-services.json` | console.firebase.google.com | no (gitignored path exists; the Gradle plugin classpath and conditional apply exist) |
| CI: a secret with `google-services.json` (base64) written to `code/mobile/android/app/` before the Gradle build in `mobile-release.yml` and, if wanted, `android-compile-check.yml` | repo secret + workflow | no |
| Firebase: a **service account** with the "Firebase Cloud Messaging API Admin" role, its JSON key | Google Cloud console | no |
| Server Secret `lotties-secrets`: `PUSH_APNS_KEY_ID`, `PUSH_APNS_TEAM_ID`, `PUSH_APNS_KEY_P8`, `PUSH_FCM_PROJECT_ID`, `PUSH_FCM_SERVICE_ACCOUNT_JSON`, then `SILENT_PUSH_ENABLED=true` | deploy (docs/DEPLOY.md) | no (`deploy.sh` does not pass these keys yet) |
| Android: the Firebase Messaging library and service (section 9) | repo (dependency change) | no |
| Privacy policy activation (section 11) | owner + lawyer | draft only |

## 11. Privacy

New stored data: the device's push token, its channel and environment, per account, with its lifecycle dates (no device
name, model or OS version). New recipients for the native apps: Apple (APNs) and Google (FCM) receive the token and a
content-free message, and so learn that this app install was told "something changed" at that time. That is a new data
flow and a new kind of stored data: the policy (both languages), `legal/dataFlows.ts`, the audit (design 33) and the
policy version must change before the flag is turned on in production. The proposed text is held in
docs/legal-held/widget-silent-push/ (README and patch); nothing shipped changes in this change.

## 12. Open questions for the owner

1. **Cold path** (section 5.3): accept warm-only for a first release and measure, or add one of: (a) a server-rendered
   widget summary (`GET /widget/summary`, the snapshot's facts) fetched by native code with its own OAuth tokens (the Siri
   and Android voice sign-ins already keep tokens natively; the widget extension would still never hold one); (b) a
   "may be out of date" mark on the widget when a push arrived and could not be applied (a UI decision); (c) both.
2. **A setting** to turn widget pings off per device (today: remove the widgets, sign out, or the system's Background App
   Refresh). A settings line is a UI decision; not built.
3. **Own-database babies**: keep them out (today) or include them (the push carries nothing from the store).
4. **Defaults**: debounce 20 s, at most one push per baby every 5 minutes, FCM `normal` priority.
5. **Policy**: which policy version and whether the consent change is minor or material (a new recipient for the app
   users only, content-free).

## 13. Tests

- Domain (`Lotties.Domain.Tests/SilentPush`): token rules per channel and the hash, the device aggregate (create,
  refresh and transfer, revoke, failures, cap), the batch origin rules, the due time (debounce, interval).
- Application (`Lotties.Api.Tests/SilentPush`): queue and worker with a fake clock and a recording sender (one push per
  burst, the interval, origin excluded only for a sole origin and only the caller's own device, Doctor never, no consent
  skipped, own-database baby skipped, outcomes revoke or count); the routes (201/200, 400 cases, 409 when off, transfer,
  cap, delete idempotent, other account's id); the event writes signal (create, edit, delete; ignored upsert does not).
- Infrastructure (`Lotties.Infrastructure.Tests/SilentPush`): APNs and FCM senders against a fake `HttpMessageHandler`
  (URL, HTTP/2 for APNs, headers, body, status mapping, provider-token reuse window, OAuth exchange, refresh on 401, no
  token or key in logs), the JWT signatures verified with the public half of a generated key, options validation; EF
  model test of the table and its unique hash.
- Web (Vitest): `silentPush.ts` registration state machine with a fake native layer and API, the header, the remote
  change handler, sign-out unregister.
- Device (owner, once provisioned): a TestFlight build with a widget, a second account writing an entry while the first
  phone's app is in the background (warm) and after a reboot (cold), Low Power Mode, Background App Refresh off,
  reinstall (token change).

## 14. Unverified

- The iOS code (AppDelegate handlers, the message handler methods, the `lotties:remote-change` event): written without
  Xcode; only the `ios-compile-check` workflow can compile it, and nothing has run on a device.
- Whether a suspended WKWebView runs the sync inside the push's 30 seconds (WebKit may keep its web-content and network
  processes suspended while the app has background time); if it does not, the warm path does nothing on iOS and only the
  cold-path options remain.
- The APNs and FCM senders against the real services (only fakes; no key exists).
- Android (not built).
