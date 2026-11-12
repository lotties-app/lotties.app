# Held: privacy policy for the widgets' silent push

Status: **draft, held, not shipped**. Nothing here is part of the app, the privacy page or the consent the app asks for.
Written 2026-11-11 with the silent push for the widgets (docs/design/37b-widget-silent-push.md), which is off by default
(`SilentPush:Enabled=false`) and needs owner provisioning (APNs key, Firebase project) before it can send anything.

## Why it is held

The feature adds a new kind of stored data (the push token of an app install, per account) and new recipients for the
iOS and Android app users (Apple APNs and Google FCM receive the token and a content-free message). Per the project rule
the policy (both languages), `legal/dataFlows.ts`, the audit (docs/design/33-privacy-audit.md) and the policy version
must change, but the owner and the lawyer decide when and with which consent version. Until the flag is turned on in
production nothing is collected or sent, so production keeps the shipped policy.

## What is here

- `DECISION-BRIEF.md`: the four decisions below framed for the owner and the lawyer, with a recommendation for each
  (written 2026-11-11).
- `privacy-policy-widget-silent-push.patch`: proposed changes under `code/web/src/legal/` (made against `main` at
  `3b6adcb`, policy 12 of 2026-11-06):
  - `privacy.en.ts`, `privacy.pt-BR.ts`: a "Widget updates" row in "What we collect" (`widgetUpdates`), an "App push
    services" row in "Companies and services that receive data" (`appPushServices`), a legal-basis line (art. 7, V: see
    question 1 below), how to stop it (rights), its retention and its transfer line; the summary names widgets among
    the features that reach other companies;
  - `dataFlows.ts`: the data category `widgetUpdates` and the third party `appPushServices` (`trigger: 'userAction'`:
    adding a widget; `abroad: true`; no credit);
  - `dataFlows.test.ts`: both languages must say the message has no content, name Apple or Google in the data row, the
    "last widget" stop in the retention section and Apple in the transfers section;
  - `PrivacyPage.test.tsx`: the recipients table length follows `THIRD_PARTY_IDS` (the same line the own-database patch
    changes; whichever lands second resolves a trivial conflict).
  - It does **not** change `privacyPolicy.ts` (version, date) or add a consent version: the release does (below).
  - Checked 2026-11-11: with the patch applied every test in `src/legal` passes except the consent digest guard of
    `consentVersions.test.ts` (expected until step 4).
- `audit-changes.md`: the proposed changes to docs/design/33-privacy-audit.md (inventory rows and a new section).

## Rules while held

- Nothing under `code/` imports from `docs/legal-held/` (`code/web/src/legal/heldLegal.test.ts`).
- `SilentPush:Enabled` stays `false` in production until this policy is released. The server refuses device
  registrations while it is off (409 `silent_push_not_configured`), so no token is stored before the policy says so.
- The repository secret `ANDROID_GOOGLE_SERVICES_JSON_BASE64` (set by the owner on 2026-11-11) no longer has to wait
  for this policy: since the gate of design 37b section 5.4 the app asks the phone for a token only after the server
  says silent pushes are on, and the Android manifest keeps Firebase quiet at start-up (no FCM auto-init, no Analytics,
  no automatic data collection). With `SilentPush:Enabled=false` an Android build with `google-services.json` makes no
  registration with Google (by design and unit tests; not yet observed on a device, design 37b section 14). The flag
  itself is what waits for this policy.
- Added 2026-11-11 with the Android receive path: the patch was written before it; it names Google FCM as a recipient,
  but not that on Android the Firebase library in the app registers the install with Google itself (a Firebase
  installation id and app/OS/library versions; `audit-changes.md` section 3, second row). Question 4 below.

## Questions for the owner and the lawyer

1. **Legal basis.** Drafted as performance of the service the person asked for (LGPD art. 7, V): adding a widget asks
   for a widget that stays current, the message carries no content, and removing the widgets or signing out stops it.
   The alternative is consent (art. 7, I) with a setting to turn it off per device (a settings line would be a UI
   decision, not built). The token is a device identifier, not health data; the timing of a push can hint that the
   family logged something at that time.
2. **Material or minor.** A new recipient for app users only, content-free, started by the person's own action (adding
   a widget). The owner decides whether the consent entry is material (everyone accepts again) or minor (a notice).
3. Whether the draft should also cover the widget files on the device (the snapshot of the latest entries kept in the
   app's shared container for the widgets, design 37 section 6), which the shipped policy only covers as "the app's own
   storage".
4. Whether the "App push services" row should also say that, in the Android app, the Firebase library sends Google an
   installation id and app/OS/library versions when it makes the token (Firebase's documented behaviour, not yet
   observed on a device), besides the token and the content-free messages.

## How to release

1. Apply the patch: `git apply --3way docs/legal-held/widget-silent-push/privacy-policy-widget-silent-push.patch`;
   resolve conflicts by hand if the policy changed since (another held patch, a newer version).
2. Re-check every sentence against the code at that time (design 37b: what is stored, the 60/30 day housekeeping, the
   payload, Android built or not: if only iOS ships, say "iOS app" and drop the Google half of the rows).
3. `code/web/src/legal/privacyPolicy.ts`: `PRIVACY_POLICY_VERSION` = the next number, `PRIVACY_POLICY_LAST_UPDATED` =
   the release date.
4. Add one consent entry, the same in `code/web/src/legal/consentVersions.json` and
   `code/api/src/Lotties.Domain/Consents/ConsentVersions.cs` (material or minor, question 2), with the `textDigest`
   that `consentVersions.test.ts` prints.
5. Apply `audit-changes.md` to docs/design/33-privacy-audit.md and update the status line of design 37b section 11.
6. Only then set `SILENT_PUSH_ENABLED=true` in production (docs/DEPLOY.md); for Android, the repository secret
   `ANDROID_GOOGLE_SERVICES_JSON_BASE64` must be in the release build that users have (set 2026-11-11).
7. Delete this folder in the same change.
