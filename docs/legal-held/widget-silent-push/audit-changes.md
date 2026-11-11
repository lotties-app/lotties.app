# Proposed changes to docs/design/33-privacy-audit.md (held)

Apply at the release of the widgets' silent push (README.md in this folder, step 5). Facts as built on 2026-11-11
(docs/design/37b-widget-silent-push.md).

## Data inventory (section 2): a new row after row 12

| # | Store | What | Purpose | Basis | Who sees it | Retention | Deletion | Export |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12a | Silent push devices (`silent_push_devices`, migration `SilentPushDevices`) | per app install: internal user id, channel (`apns`/`fcm`), the push token (APNs device token or FCM registration token, at most 512 characters, never returned by the API or logged), its SHA-256 (lookup), the APNs environment (`production`/`sandbox`), created/last seen/last sent, consecutive failures, revocation time and reason. **No** device name, model, OS version, locale or IP | to tell the family's other app installs that a baby's records changed, so that their widgets update | Contract (art. 7, V) `OWNER TO CONFIRM` (lawyer question 1 of the README) | nobody: the server only; the API returns the id, channel and dates to the person who registered it | revoked when the app reports no widget left, at sign-out, on an APNs 410 / `BadDeviceToken` or FCM `UNREGISTERED` answer, after 10 failed sends in a row, beyond 10 per account (least recently seen), or when not renewed for 60 days; revoked rows deleted 30 days later (`SilentPushRules`) | sign-out (`DELETE /push/devices/{id}`); account deletion (`EfAccountDataEraser`, `AccountErasureTests`) | no |

## Recipients (section 3): replace the row "APNs / FCM native push | nothing | not built"

| Recipient | What | When | Where | Status |
| --- | --- | --- | --- | --- |
| Apple Push Notification service (iOS app), Google Firebase Cloud Messaging (Android app) | the push token and a content-free message: APNs `{"aps":{"content-available":1},"lotties":{"v":1,"t":"sync"}}` (push type `background`, priority 5, expiry 1 hour), FCM data `{"lotties":"sync","v":"1"}` (priority normal, TTL 1 hour, collapse key `lotties-sync`); timing of each push (at most one per baby every 5 minutes by default) and the app's bundle id / Firebase project. **No** baby id, name, entry, count or time of an entry. The server authenticates with an APNs auth key (ES256 provider token) and a Firebase service account (OAuth token from `oauth2.googleapis.com`) | only in the native app, while a Lotties widget is installed (the app checks at every launch and resume) | Apple's and Google's infrastructure, mostly outside Brazil | built behind `SilentPush:Enabled` (off); iOS receive path written, Android receive path not built |

## Device storage (section 5): add to the `localStorage` row

`lotties.silentPushDevice`: the server id of this install's silent push registration (no token), sent as the request
header `Lotties-Push-Device` so the server does not ping the phone that made a change; removed at sign-out and when no
widget is left.

## API logs (row 17): no change of kind

Silent push lines carry user ids, device ids, baby ids, counts and outcomes only; the senders' HTTP clients have no
request logging (`RemoveAllLoggers`: an APNs token is in the request URL), and no push service response body is logged.

## New section: 18. Widget silent push (built off, 2026-11-11, docs/design/37b-widget-silent-push.md)

- What starts it: the person adds a Lotties widget in the iOS (later Android) app; the app registers the push token with
  our API (`POST /push/devices`, current core consent required, refused for demo accounts). Removing the last widget or
  signing out unregisters it.
- What is sent and to whom: section 3 above. Content-free by construction (one constant payload, tested); the server
  never puts a baby id, a name or an entry in it.
- Who gets a push: the baby's members except a Doctor (her patients never enter the parents' shell), with a current core
  consent; never for a baby on the family's own database (as reminders); the device that made every change of the batch
  is skipped.
- Gaps and open points: the legal basis (contract or consent); the cold path (a terminated app cannot refresh its widget
  from a push; any fix that lets native code fetch data is a new flow to audit, design 37b section 12 question 1).
