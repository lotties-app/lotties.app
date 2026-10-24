# Privacy policy: what the owner must decide and confirm

The public privacy policy (`https://lotties.app/privacy`, text in `code/web/src/legal/privacy.pt-BR.ts` and
`privacy.en.ts`) was written from the code and the deploy kit (`docs/design/33-privacy-audit.md`). It never invents
facts, so everything the repository cannot prove is listed here.

**This is not legal advice.** The policy is a careful first version in plain language, not a legal opinion. Before
submitting to the App Store, Google Play or the Alexa certification, have it reviewed by a Brazilian lawyer or privacy
specialist (LGPD; the data is health data about children). Bring this checklist and the audit to that review.

## 1. Build values to set (before any store submission)

They are public (baked into the JavaScript bundle, like `VITE_REPO_URL`): contact details you choose to publish, never
secrets. Empty, the page shows its defaults; it never shows a placeholder.

| Variable | What to put | Default today |
| --- | --- | --- |
| `VITE_PRIVACY_CONTROLLER_NAME` | the controller as it should be published: your full name, or the company name (and, if you want, the CNPJ) | "the Lotties project maintainers" |
| `VITE_PRIVACY_CONTACT_EMAIL` | a mailbox you read for privacy requests (a plain address, e.g. `privacidade@...`) | the repository's public issue tracker plus a private GitHub report |
| `VITE_PRIVACY_DPO` | the encarregado: a name and/or an email (it can be you) | "the contact above" |

Where: `deploy/homelab/.env` (production web image, `deploy.sh` passes them), the root `.env` (docker compose), and
`code/web/.env.native.local` for the iOS/Android build. `missingPrivacySettings()` in
`code/web/src/legal/privacyConfig.ts` lists the ones still on their defaults; `privacyConfig.test.ts` keeps this
table, `docs/DEPLOY.md` and the build wiring in step.

## 2. Who is the controller: individual or company

- [ ] Decide whether the controller is you as a natural person (CPF) or a company (CNPJ, for example an MEI or an LTDA).
  The LGPD accepts both. The name you choose is published on the page and must match the developer accounts:
  - Apple: an individual account publishes under your name; an organisation account needs a D-U-N-S number.
  - Google Play: a personal account created after November 2023 needs the closed test with 12 testers for 14 days; an
    organisation account is exempt (docs/MOBILE-RELEASE.md).
- [ ] Encarregado: ask the lawyer whether the "agente de tratamento de pequeno porte" rules (Resolução CD/ANPD nº 2/2022,
  as we understand it: smaller agents may skip naming an encarregado but must offer a contact channel) apply, given
  that Lotties processes sensitive data about children, which may count as high-risk processing. If in doubt, name one
  (it can be you) in `VITE_PRIVACY_DPO`.

## 3. Facts to confirm (each marked `OWNER TO CONFIRM` in the audit)

| # | Confirm | Why it matters | Policy text it affects |
| --- | --- | --- | --- |
| C1 | Country and place of the home lab; that no cloud provider stores or processes the data | the policy says "a home lab, on their own hardware, not on a cloud provider" | Who is responsible; International transfers |
| C2 | Cloudflare: DNS only, or also proxying `lotties.app` / `auth.lotties.app` | a proxy would see all traffic, including health data, and must be listed as a recipient abroad | Companies table; transfers |
| C3 | Where PostgreSQL runs, who can reach it, whether disks are encrypted | security section claims nothing about encryption at rest; add it only if true | Security |
| C4 | Who has administrator access to the cluster, the database, Keycloak and the logs | the policy says "limited to the maintainer" | Security |
| C5 | Keycloak realm `lotties.app`: registration fields, email verification, password policy, brute-force detection, OTP, whether it is isolated from your other apps' realms, login event logging (IP addresses) and its retention | account row of the data table; security | What we collect; Security; Retention |
| C6 | Keycloak outgoing email: is an SMTP relay (Brevo or another) configured in production? | a relay receives the account email address and the account emails: it must then be added to `THIRD_PARTIES` and both tables (the tests force the three to agree) | Companies table |
| C7 | Log retention: API stdout (kubelet rotation or a log collector), the web container's nginx access log, Traefik access logs (on? query strings?), Keycloak | the policy says "only as long as needed"; a number (for example 30 days) is better once confirmed | Retention |
| C8 | Backups: any routine besides the `pg_dump` before migration deploys? Where are the files, are they encrypted, who deletes them and when? Any database server snapshots? | the policy says copies are deleted when no longer needed and may still hold deleted data | Retention; Security |
| C9 | Production settings outside the repo: `AUTH_ADMIN_CLIENT_ID/SECRET` (Keycloak account deletion; **not** in `deploy/homelab/values/api.yaml`), `Alexa__Enabled`, `AddressLookup__ContactEmail`, the three `PUSH_VAPID_*` | account deletion text, Alexa row, push row | Your rights; Companies table |
| C10 | GitHub private vulnerability reporting is enabled on the repository (the default private contact) | otherwise the default "private report" link does not work: set `VITE_PRIVACY_CONTACT_EMAIL` | Contact |
| C11 | Whether the app stores' statistics and crash reports are shared with you (App Store Connect, Play Console) | the policy mentions them | Companies table |
| C12 | That you can answer a full access request within 15 days (LGPD art. 19) and erase a soft-deleted record on request (a manual database operation today) | the policy promises both | Your rights |
| C13 | That you will announce significant changes before they apply | there is no in-app announcement yet (gap G6) | Changes |
| C14 | That you will notify users and the ANPD of a relevant incident (LGPD art. 48), and how | the policy promises it | Security |

## 4. Decisions to take with the lawyer

- [ ] **Legal bases** (policy section "Why we may use it"): execution of the service (art. 7, V) for the account and
  records; consent (art. 11, I) for health data; specific consent for the doctor invite; consent for optional
  features; legitimate interest (art. 7, IX) for technical logs; legal obligation. The text says consent for health data
  is given "when you choose to record that information": **the app does not collect a separate, highlighted consent
  today** (gap G3). Decide whether that is enough or whether a consent step with a stored record is needed (a Keycloak
  "Terms and conditions" required action with the policy link, or an in-app first-run consent: an API change).
- [ ] **Children (art. 14)**: the policy relies on the child's best interest and the parents' use; art. 14, §1 asks
  for specific and highlighted consent of a parent or guardian. As we read it, ANPD's Enunciado CD/ANPD nº 1/2023
  allows the bases of art. 7 or 11 for children's data when the best interest prevails. Confirm, and whether the app
  must ask that the person creating a baby is its parent or guardian.
- [ ] **International transfers** (art. 33): the text uses art. 33, IX (needed for what the user asked). Confirm, and
  whether ANPD's rules on international transfers and standard contractual clauses (Resolução CD/ANPD nº 19/2024, as we
  understand it) require anything for push services, Amazon or Nominatim.
- [ ] **Retention periods** to replace "kept with the baby" and "as long as needed": the doctor access log (kept with no
  expiry today), invites (kept after use), soft-deleted records (kept until the baby is erased), anonymized user rows,
  logs, backups.
- [ ] **Minimum age** of account holders (the policy says the app is for adults; nothing checks it).
- [ ] **Data about other people** entered by users (doctors' contacts, the mother's RSV vaccination): the policy makes
  the user responsible; confirm the wording.
- [ ] **Doctor's notes after removal**: they stay with the family; decide whether a removed doctor may export or delete
  them (docs/design/16-doctor-access.md section 7).

## 5. Gaps to close before submitting (from the audit, section 8)

- [ ] G1: account deletion does not erase saved doctors and clinics, and the database's `RESTRICT` key probably makes
  `DELETE /me` fail for someone alone on a baby with providers (API fix + test).
- [ ] G2: a doctor-only account has no "Account and data" section in `/doctor/settings` (store rule for in-app deletion).
- [ ] G3: consent capture (section 4).
- [ ] G5: wire `AUTH_ADMIN_CLIENT_ID/SECRET` into the home lab API, so deletion also removes the sign-in account.
- [ ] G6: a "policy updated" notice keyed on `PRIVACY_POLICY_VERSION`.
- [ ] G7: Google Play's deletion URL: until a public `/delete-account` page exists, decide whether
  `https://lotties.app/privacy#privacy-rights` (in-app steps plus the contact) is acceptable.
- [ ] G8/G9: drop query strings of `/api/v1/address/*` from proxy logs; decide the nginx log format; add HSTS.

## 6. Store and certification forms

Answers are in `docs/design/20-store-readiness.md` section 3 (Apple App Privacy, Google Data safety) and
`docs/ALEXA.md` section 8 (Alexa): they now match the audit. Privacy policy URL everywhere:
`https://lotties.app/privacy`.

## 7. Every time the policy changes

1. Change both `privacy.pt-BR.ts` and `privacy.en.ts` (the tests require the same sections and rows in both).
2. Raise `PRIVACY_POLICY_VERSION` and set `PRIVACY_POLICY_LAST_UPDATED` in `code/web/src/legal/privacyPolicy.ts`.
3. Update `docs/design/33-privacy-audit.md` and, for a new data flow or company, `code/web/src/legal/dataFlows.ts`.
4. Check the store forms (section 6) still match.

## 8. Community insights (planned, not built)

The policy has a section "Community insights (optional, not active yet)" / "Comparações com outros bebês (opcional,
ainda não ativo)" that describes a future opt-in use of babies' records in pooled statistics (milk per feed, growth,
tummy time, routines, unusual patterns, crying). It is off and nothing is collected for it; the text says so and the
tests keep it that way. Design and the full list of decisions: `docs/design/34-community-insights.md` (section 13);
audit: `docs/design/33-privacy-audit.md` section 11.

- [ ] **Lawyer review of the section** (both languages): that describing a planned feature in the policy is
  acceptable (or better kept out until it exists), the consent wording of the future screen (design section 3.5), and
  the honest limit of anonymisation (art. 12: "very hard to trace back to one baby, but no method makes that
  impossible in every case").
- [ ] **RIPD before activation** (relatório de impacto à proteção de dados pessoais; outline in design section 8):
  sensitive data of children, consent basis (art. 11, I and art. 14, §1), risk of re-identification in small groups.
- [ ] **Who consents**: per baby, an Owner or a Parent who confirms being the parent or legal guardian (recommended);
  whether one yes is enough or every Owner/Parent must agree; whether the others are notified.
- [ ] **k and noise**: the minimum group size (proposal: 20 babies from 20 families; the policy already says "at least
  20") and whether differential privacy is applied (proposal: yes, as defence in depth, weekly releases at
  epsilon 0.2 per statistic, about 10 per statistic per year, or monthly at 0.5; chosen after the evaluation). If no noise is used, the "random noise" sentence must go before activation.
- [ ] **Retention of consent records** after withdrawal or erasure (proposal: 5 years, baby id hashed after erasure).
- [ ] **Statistics open to every user or only to families that opted in** (proposal: every signed-in user).
- [ ] Before activation: the in-app notice of policy changes (gap G6) must exist, since the policy promises to tell
  families in the app before the feature starts.
