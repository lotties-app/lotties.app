# 38. Consent, terms of use and the beta notice (design and implementation, 2026-10-27)

**Status: built on branch `feat/consent` (not deployed).** Section 9 records how it was built and where it differs from the design above.

Owner request: a consent term for using people's data while the service is still a test (non-production) environment; the
data is never sold, but a leak is possible. This closes gap G3 (no highlighted consent for health data of children) and
gap G6 (no "policy updated" notice) of [33-privacy-audit.md](33-privacy-audit.md). Drafts of the texts for the lawyer are
in [../CONSENT-AND-TERMS-DRAFT.md](../CONSENT-AND-TERMS-DRAFT.md). **Not legal advice.**

## 1. What a consent does and does not do

- It is the **legal basis** for processing a child's health data (LGPD art. 11, I) with the **specific and highlighted
  consent of a parent or guardian** (art. 14, §1), and it records that the person was told the service is in testing.
- It does **not** remove the controller's duties: security measures (art. 46), notifying the ANPD and the people affected
  of a relevant incident (art. 48) and liability for damage (arts. 42-45). A clause that tries to waive liability for
  negligence is not reliable. "Non-production" does not change the law: real personal data is processed.
- So the consent is paired with real measures: invite-only beta, minimisation (no baby name or free text in assistant
  answers by default), backups, and the privacy options in the owner's notes (encryption levels).

## 2. Decisions

1. **One core consent, required to use the app**, given by each person for herself (the Owner, an invited Parent, a
   Caregiver, a Doctor): she declares she is the child's parent or legal guardian, **or** an adult the parent authorised
   (caregiver, family member, doctor). The core consent covers: the terms of use, the privacy policy of that version, and
   processing of the child's health data to run the service.
2. **Optional consents, separate and off by default**, recorded when the person turns the feature on: web push, the
   Alexa skill, the MCP assistant connection, and the assistant options (say the baby's name, say medicine names). They
   already are opt-in settings; this adds a timestamped record and wording that states what leaves our control.
3. **Versioned.** `CONSENT_VERSION` = the pair (terms version, privacy policy version). Each change is marked
   **material** or **minor** in a single list. Material: everyone must accept again before continuing. Minor: a
   dismissible "policy updated" notice with a link (closes G6).
4. **Server-side gate.** A person without a current core consent cannot read or write baby data: the API answers
   `403 consent_required` on every baby route (and on Alexa/MCP: "open the Lotties app to accept the terms"). Only `/me`,
   the consent routes, account export and account deletion stay open, so she can always leave and take her data.
5. **Withdrawal.** Withdrawing the core consent means stopping the processing: the app explains it and offers the
   existing account deletion (and the export first). Optional consents are withdrawn by turning the feature off.
6. **Decline.** Declining signs the person out; nothing about a baby is stored. The sign-in account itself stays until
   she deletes it.
7. **Existing users** (the test accounts and the owner's) see the screen at their next sign-in.
8. **What the consent record keeps:** user id, kind, version, accepted-at, locale and the declared capacity (parent or
   guardian / authorised adult). No IP address. Deleted with the account (a lawyer may want a minimal proof kept: an open
   question in the lawyer brief).

## 3. Flow (web and the native shells)

```
sign in ──> GET /me/consents
              │ coreAccepted && version current ──> app
              │ material change or never accepted ──> Consent screen ──[Accept]──> PUT /me/consents/core ──> app
              │                                               └──[Decline]──> sign out, short explanation
              │ minor change only ──> app with a "policy updated" banner (dismiss stores the seen version locally)
```

Consent screen (every string through i18n, en and pt-BR): short plain-language summary (what is kept, who sees it,
never sold, never used for ads, a beta with bugs and possible data loss, a leak cannot be ruled out, not a medical
device), a **required** checkbox for the parent or guardian declaration, links to the full terms and policy, then
**Accept and continue** and **Decline**. A second, calmer line explains that sensitive data is protected by the measures
in the policy and that she can export or delete everything at any time.

## 4. API

- `GET /api/v1/me/consents` -> `{ "currentVersion": "2026-10-27.1", "core": { "accepted": true, "version": "...", "acceptedAt": "...", "capacity": "guardian"|"authorised" } | null, "optional": { "push": ..., "alexa": ..., "mcp": ... }, "requiresAcceptance": bool, "minorChangeSince": null | "2026-10-27.1" }`
- `PUT /api/v1/me/consents/core` body `{ "version": "...", "capacity": "guardian"|"authorised" }` -> 200; refuses an old version (409) or a missing capacity (400).
- `PUT /api/v1/me/consents/optional/{push|alexa|mcp}` `{ "granted": bool }` (the web calls it when the matching switch changes).
- Any signed-in user, any role (Doctors included). Rows in `EndpointRoleMatrixTests` (`Access.SignedIn`); the gate is a
  shared policy/filter and the matrix test lists which routes are exempt.
- One EF migration: table `user_consents` (`user_id` FK cascade, `kind`, `version`, `accepted_at`, `withdrawn_at`
  nullable, `capacity` nullable, `locale`; primary key `(user_id, kind)` with history kept by appending to a small
  `user_consent_history` or by an audit log line: decide in the implementation, keep it minimal). Account erasure rule and
  fixture row (CLAUDE.md "Account deletion").
- The versions come from code constants next to `PRIVACY_POLICY_VERSION` (web) and a C# mirror, with a test that fails
  when the two disagree and when the policy text changed without a version bump.

## 5. Web

- `ConsentGate` between the auth guard and the app shell (signed-in only, before the per-account database opens any
  baby screen). Offline: the last accepted version is cached per account; a new version is checked when online.
- Screens: `Consent` (the flow above), a "Terms of use" page (`/terms`, public, like `/privacy`), the policy-updated
  banner, Settings > Privacy and data: current consents, withdraw, export, delete.
- Landing page and sign-up: one line "Lotties is a beta" linking the terms.
- Native shells open the same pages; the store forms use the same URLs.

## 6. Texts

Written with the lawyer: [CONSENT-AND-TERMS-DRAFT.md](../CONSENT-AND-TERMS-DRAFT.md) (consent screen copy, beta notice,
terms of use, optional consents, the "policy updated" notice, all in pt-BR and en). The implementation reads the copy
from the i18n catalogs; changing a word that changes meaning is a **material** change and needs a new `CONSENT_VERSION`.

## 7. Tests

API: consent round trip, old version 409, gate on a baby route (403 without, 200 with), exempt routes, every role, Alexa
and MCP answers when consent is missing, account deletion removes the record, the matrix rows. Web: the gate (accept,
decline, material vs minor), both languages, offline cached version, the Settings screen, the policy-updated banner. A test
that the terms and the policy carry the same version constants as the code.

## 8. Open questions for the lawyer

See `docs/PRIVACY-LAWYER-BRIEF.md` (new items): the guardian declaration for authorised adults, a minimal proof of consent
kept after deletion, how to word the limit of liability for a free service, whether the beta notice changes any duty, and
the right wording for the leak-risk sentence.

## 9. As built (2026-10-27)

**Persistence.** Migration `Consent`: `user_consents` (primary key `(user_id, kind)`, kind `core|push|alexa|mcp`, `version`,
`accepted_at`, `withdrawn_at`, `capacity`, `locale`) and the append-only `user_consent_history` (one line per grant or
withdrawal, same facts plus the action). Both cascade from `users` and are erased by `EfAccountDataEraser`. No IP, no device.

**Versions.** `code/web/src/legal/consentVersions.json` is the one list; `Lotties.Domain.Consents.ConsentVersions` mirrors it
and `ConsentVersionTests` (Domain.Tests links the file) fails when they disagree. Each entry: consent `version`, `terms` and
`privacyPolicy` versions, `material`, `date`, `textDigest`. `consentVersions.test.ts` fails when the privacy policy, the
terms or the meaningful parts of the consent screen changed without a new `textDigest` (a typo fix updates the digest; a
change of meaning adds an entry). The current entry is `2026-10-27.1` (terms 1, privacy policy 9, material).

**API.** As section 4, plus: `PUT .../core` accepts an optional `locale`; accepting again with the same capacity at the same
version records nothing; `PUT .../optional/{kind}` is 404 for `core` or an unknown kind, 400 without `granted`, and turning off
a consent that was never on records nothing.

**The gate.** One middleware (`ConsentGateMiddleware`, after authorization, before binding) reads endpoint metadata: the API
group carries `ConsentGatedMetadata` (`RequireConsent()`), and a route opts out with `AllowWithoutConsent(reason)`.
`ConsentGateCoverageTests` lists every exempt route with the reason and fails for a route that is neither gated nor listed,
for a listed route that is gated, and for a baby, doctor or invite route that is exempt. Exempt: `/health`, `/version`,
`/me` (profile, deletion preview, deletion, professional profile, assistant and unit settings, the consent routes), the
catalog, the vaccine schedule, age norms, the address proxy, `GET /push/config`, listing and revoking push devices, the
anonymous push action, `/alexa`, the MCP routes (and the well-known documents), and the project board (REST and MCP). Gated:
every `/babies...` route (including export, import and restore), `/doctor/patients`, `/invites/...`, and the push routes that
use baby data (subscribe, settings, preferences, test). Account export of the user's own data is the device export (no
server route), so there is nothing to exempt.

**Adapters and reminders.** `AssistantSubjects` answers the new `AssistantResultCode.ConsentRequired` before reading any
baby: Alexa speaks it ("open the Lotties app and accept the terms of use", en and pt-BR), MCP returns a tool error with code
`consent_required`. `NotificationClaimer` skips a person without a current core consent, so no reminder (which carries a
baby's data) is sent to her.

**Test host.** `ApiFactory` registers a `SaveChanges` interceptor (`TestConsentGrant`): whenever a `User` row is added (a first
request provisioning her, or a seed) it adds a real current core consent and its history line in the same save. So the whole
existing suite passes unchanged. `ApiFactory.GrantConsentToNewUsers = false` turns it off (the consent tests), and
`RevokeConsentAsync` / `SetCoreVersionAsync` take a user's record away or age it.

**Web.** `ConsentProvider` (above `AccountDataProvider`) asks `GET /me/consents` and exposes `status`
(`signed-out|checking|accepted|required`) and `syncAllowed` (the sync engine does not start without it); `ConsentGate` is a
layout route between `RequireAuth` and the shells (the app, `/invite`, `/doctor`); the project board route is outside it.
`ConsentScreen`: the draft's section 1 copy, a capacity choice (parent or guardian / authorised adult) and the required
declaration checkbox, Accept and Decline (Decline explains, then signs out; it warns about changes on the device that the
sign-out loses), and a "Leave Lotties instead" panel with the existing download and account deletion. `/terms` is a public
lazy page. The beta line is next to "Create an account" and in the landing footer. `PolicyUpdatedNotice` shows for a minor
change in the app and the doctor's shell; dismissing stores the version seen per account.

**Offline decision.** The device remembers the version the server last confirmed (per account). A remembered version that is
still current opens the app at once, offline too (nobody is locked out of reading her own cached data), and sync runs; the
server is asked in the background and its answer wins. The gate applies when the version is known to be stale: the server says
`requiresAcceptance`, or the remembered version is older than the newest material entry the build carries. Accepting needs the
server, so a stale account offline sees the consent screen with an offline note. With nothing remembered and no answer from the
server (a first start with the server down) the local data stays readable and nothing syncs until the server answers (the
server refuses baby data to anyone without a consent anyway).

**Optional consents.** Recorded through `ConsentProvider.recordOptional`: it stores the change on the device and sends it; a
failed call never blocks the feature, stays pending and is retried on the next start and when back online (the newest answer
per kind wins). Push is recorded when this device's switch is turned on (after the subscription succeeds) and off; with several
devices the last switch wins. Alexa and the MCP connection have no switch in the app, so Settings > Voice assistants gets one
for each ("I use the Lotties skill with Alexa", "I connect an AI assistant", the latter only when the server has MCP on) with the
draft's sentence: **these are records, not locks** (the adapters work for anyone with the core consent). The baby-name and
medicine-name switches show their draft sentences and are not recorded as separate consents (the API has the three kinds of
section 4). Settings > Privacy and data lists the core consent (version, date, capacity), the three optional ones (on, off,
never) and how to withdraw.

**Withdrawal.** The core consent is withdrawn by downloading the data and deleting the account: the button explains it and
leads to the existing flow. There is no "withdrawn core" state on the server (nothing to gate once the account is gone).

**Differences from the text above.** (1) The draft's clause 14 (venue) is not shown: the lawyer decides it (brief item 18);
the clause says only "Brazilian law applies". (2) The landing page and the sign-up button carry the beta line; the Keycloak
registration page itself is not changed (it is a separate theme package). (3) Push reminders to a person without a consent are
skipped (not in the first design).

**Not done.** The Keycloak "Terms and conditions" required action stays off; the Playwright helper `acceptConsentIfShown` is
written but was not run here.

