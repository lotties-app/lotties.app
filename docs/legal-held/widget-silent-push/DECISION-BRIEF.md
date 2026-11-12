# Decision brief: privacy policy for the widgets' silent push

For the owner and the lawyer. Written 2026-11-11. Not legal advice. Detail lives in `README.md` (this folder), the patch,
`audit-changes.md` and `docs/design/37b-widget-silent-push.md`. This page only frames the four decisions and recommends.

## 1. What is being decided

`SILENT_PUSH_ENABLED=true` makes the API send a content-free push (Apple APNs for iOS, Google FCM for Android) to the
family's other app installs when a baby's records change, so their home-screen widgets refresh. Today the flag is off in
production, the server refuses device registrations (409 `silent_push_not_configured`), and the apps do not contact
Apple or Google (the token gate, design 37b section 5.4). The flag cannot go on until the privacy policy says what the
feature collects and who receives it. The policy text is already drafted (both languages) and applies cleanly to main
(`git apply --check` passed 2026-11-11 against policy 12). What is missing is four decisions.

## 2. What the feature does, in plain terms

| | |
| --- | --- |
| Who is affected | Only people who use the iOS or Android app and add a Lotties widget. Web and Alexa users: nothing changes. |
| New data we store | One push token per app install (and its channel, test/production for Apple, dates, failure count). No device name, model, OS, locale or IP. Never returned by the API or logged. |
| New recipients | Apple (iOS) and Google (Android), both outside Brazil. They get the token and a message with no content: no baby id, name, entry, count or entry time. They can see that this app was told to update, and when. |
| What the timing reveals | A push is sent at most once per baby per 5 minutes, right after someone logs something. So the timing hints that the family recorded something then, not what. |
| Who gets pushed | The baby's members except a Doctor, with a current core consent; never for a baby on the family's own database. |
| How it stops | Sign out, last widget removed (checked at each app open), Apple/Google say the token is dead, 10 failures in a row, or 60 days without renewal. Revoked rows are deleted 30 days later. Account deletion erases them. |
| One thing we cannot undo | A token already made while the flag was on stays registered with Apple or Google after we switch the flag off. |

## 3. Decisions

### D1. Legal basis: contract or consent

- **A. Performance of the service the person asked for (LGPD art. 7, V).** Adding a widget is asking for a widget that
  stays current. The token is a device identifier, not health data. The message has no content. It stops when the
  widgets go or the person signs out. This is what the patch says.
- **B. Consent (art. 7, I)**, with a per-device off switch. Cleaner on the cross-border transfer to Apple and Google
  and consistent with web push, which is an optional consent today (design 38 section 2). Costs a new settings control
  and an optional consent kind (a UI and API change, not built).

**Recommendation: A**, because the person's own action (adding the widget) starts it and the message carries nothing, and
B adds a setting for something the person can already stop by removing the widget. Ask the lawyer to confirm two
points: that the timing hint above does not turn the token into health-related data, and that art. 7, V covers the
transfer to Apple and Google. If either answer is "no", take B.

### D2. Material or minor consent version

- **Minor** (a dismissible "policy updated" notice): new recipient for app users only, content-free, started by the
  person's own action. Precedent: policy 10, 11 and 12 were minor.
- **Material** (everyone accepts again once): the honest choice if the lawyer thinks a new third-party recipient needs
  fresh acceptance. Agreed for bring-your-own-database (memory of 2026-11-08): material, at its general release.

**Recommendation: minor**, unless BYOD general release is close. In that case put both changes in the same material
version so people accept once, not twice. Do not make a material version for this alone. Decide when BYOD's release date
is known.

### D3. Cover the widget files on the device?

The app keeps a snapshot of the latest entries in its shared container for the widgets (design 37 section 6). The policy
says "the app's own storage".

**Recommendation: no change.** That is on the device, not a new flow, and is already covered. Add one sentence only if
the lawyer wants the widgets named.

### D4. Say that Android's Firebase library registers the install with Google

On Android the Firebase library, not our code, makes the token and (per Firebase's documentation, not yet observed on a
device) sends Google a Firebase installation id, the package and Firebase app id, and app, Android and library versions.
The draft names Google as a recipient of the token and the messages but not this.

**Recommendation: yes, add it** to the "App push services" row. Leaving it out understates what leaves the phone. Keep
the "per Firebase's documentation" wording until it is observed on a device (design 37b section 14).

## 4. Facts that can still change the text

- **Only one platform ships first.** The text must match the code at release. iOS is blocked until the Apple profile
  (Push Notifications on `app.lotties.app`, new profile, `IOS_PROFILE_BASE64`). If Android ships first, say "Android
  app" and drop the Apple half of every row, then add Apple at the iOS release as a second, minor change.
- **Nothing is observed on a real device yet.** The Firebase quiet start, the receive paths and the token gate are
  unit-tested only. Before the flag: one Android device test (flag off: no registration with Google; flag on in a test
  environment: widget refreshes). The privacy text must not claim more than that test shows.
- **Cold path.** A terminated app cannot refresh its widget from a push (owner decision 2026-11-11: warm only). Any fix
  that lets native code fetch data is a new flow to audit.

## 5. Release steps once decided

1. `git apply --3way docs/legal-held/widget-silent-push/privacy-policy-widget-silent-push.patch`; apply D4 (and D3 if
   wanted); if D1 is B, rewrite the basis line and add the consent kind first.
2. Re-read every sentence against the code (platform scope, 60/30 days, payload).
3. `privacyPolicy.ts`: version 13 and the release date.
4. One consent entry (D2), identical in `code/web/src/legal/consentVersions.json` and
   `code/api/src/Lotties.Domain/Consents/ConsentVersions.cs`, with the `textDigest` that `consentVersions.test.ts` prints.
5. Apply `audit-changes.md` to `docs/design/33-privacy-audit.md`; update design 37b section 11 status.
6. Deploy the policy. Verify `/privacy` in both languages.
7. Then set `SILENT_PUSH_ENABLED=true` in `deploy/homelab/.env` and deploy.
8. Delete `docs/legal-held/widget-silent-push/` in the step 1 to 5 change.

Order matters: policy first, flag second. The reverse would collect tokens before the policy says so.

## 6. Answers needed

1. D1: A (contract) or B (consent)? Lawyer to confirm the two points under D1 if A.
2. D2: minor, material, or bundle with BYOD?
3. D3 and D4: accept the recommendations?
4. Which platform ships first, so the text names the right one?
