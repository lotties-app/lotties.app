# 38. Consent, terms of use and the beta notice (design, 2026-10-27)

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
