# 20. Store readiness (Apple App Store and Google Play)

Status: checklist and drafts, 2026-10-22; privacy policy published as a page and form answers checked against the data
flow audit on 2026-10-23 (docs/design/33-privacy-audit.md). Not legal advice: the policy text and the licence points
below must be read by the owner and, before the first public release, by a lawyer (the data is health data about
children, and the law that applies first is Brazil's LGPD, plus the store rules). Technical decisions for the apps are
in docs/design/12-mobile-capacitor.md; push in docs/design/19-native-push.md.

## 1. What the stores need, and where we stand

| Requirement | Apple | Google Play | Status |
| --- | --- | --- | --- |
| Developer account | Apple Developer Program (about US$99/year; an individual account is enough, an organisation needs a D-U-N-S number) | Play Console (US$25 once; a **personal** account created after Nov 2023 must run a closed test with at least 12 testers for 14 days before it can publish) | owner: none yet |
| Account deletion in the app | 5.1.1(v) | Account deletion policy | **built** (branch `feat/account-deletion`): Settings > Account and data |
| Account deletion link on the web | not needed | the Data safety form asks for a URL where users can request deletion | todo: a public page, see section 5 (until then `https://lotties.app/privacy#privacy-rights`, owner to decide) |
| Privacy policy URL | required, in the app and in App Store Connect | required, in the listing and in the app | **built**: `https://lotties.app/privacy` (public, offline, en and pt-BR; Hub, About, Settings, landing footer); legal review and the owner's values pending (docs/PRIVACY-OWNER-CHECKLIST.md) |
| Data disclosure | App Privacy "nutrition labels" | Data safety form | answers in section 3 |
| Health apps | no HealthKit, no medical-device claims (1.4.1: no inaccurate data, medication reminders must not claim to dose) | Health apps declaration form (the app is not a medical device, no Health Connect) | answers in section 6 |
| Sign-in | 4.8 Login Services applies only when the app offers a third-party/social login: it does not (own Keycloak realm) | n/a | nothing to do |
| Minimum functionality | 4.2 (no thin website wrapper) | n/a | bundled offline-first app; push and a widget before the first iOS review (doc 12 section 10) |
| Age rating | questionnaire; not the Kids category (users are parents) | content rating questionnaire (IARC); target audience adults; **not** "designed for children" | section 7 |
| Export compliance (iOS) | `ITSAppUsesNonExemptEncryption`: the app only uses HTTPS (exempt); declare "No" non-exempt, set the Info.plist key to `false` | n/a | todo in the Xcode project |
| Review access | demo account in the review notes | login instructions in the Play Console | section 8 |
| Target API level | n/a | new apps must target the level Google requires that year (Capacitor 8 targets API 36) | check at upload |
| Screenshots, description, icon, feature graphic | 6.9" and 6.5" iPhone screenshots, 1024 icon | phone screenshots, 512 icon, 1024x500 feature graphic | todo: design |

## 2. Account deletion (summary of what is built)

`DELETE /api/v1/me` (docs/SPEC.md "Account deletion"): babies only the user uses are erased with all their records; on
babies other people keep, the user's membership, private notes, reminders, push subscriptions and doctor profile go
and what the user added stays without a name (shown as "Former member"). The only owner of a baby others still use must
transfer ownership first (409). The sign-in account at Keycloak is deleted too when the service account is configured
(docs/DEPLOY.md "Account deletion (Keycloak)"); the home lab kit does not pass `AUTH_ADMIN_CLIENT_ID/SECRET` yet, so in
production the app says the sign-in account stays (audit gap G5). Two more gaps from the audit: saved doctors and
clinics are not erased (and may make the deletion fail, G1), and a doctor-only account has no Account and data
section in `/doctor/settings` (G2). In the app: Settings > Account and data, with a preview of what is
deleted, a data download first on the web, and a permanent-action confirmation. Reviewers test this: keep the demo
account deletable and recreatable.

## 3. Data inventory and form answers

The complete inventory, with purposes, proposed legal bases, retention, who sees what and every recipient, is the audit:
docs/design/33-privacy-audit.md (sections 2 to 4). Summary for the forms:

| Data | Where | Purpose | Linked to the user |
| --- | --- | --- | --- |
| Name, email, password (the realm's registration fields) | Keycloak (our own identity server, home lab) | sign-in. The API never reads or stores the email; it keeps an internal id, the OIDC issuer and `sub`, and a display name | yes |
| Baby profile: name, birth date, vaccine network, gestational age, mother's RSV vaccination | API database | the product | yes |
| Events (feeds, sleep, diapers, crying, milestones, free-text notes), health records (medications, prescriptions and doses, temperature, symptoms, measurements, vaccinations, appointments, formulas), doctors' notes and proposals | API database | the product | yes |
| Care providers (other people's contact details entered by the family) | API database | contact directory | yes |
| Professional profile (self-declared name, specialty, registration number) | API database | doctor access | yes |
| Web Push endpoint and keys, device label, language, time zone, quiet hours | API database | reminders (opt-in per device) | yes |
| Access log of doctors' reads of a baby (no expiry today) | API database | transparency to the parents | yes |
| Notification delivery log (ids, kind, time, status; no text) | API database, purged after 14 days | reliability | yes |
| Internal ids, action and result codes | API logs (no IP, no request line, no content) | operating and debugging | not used for tracking |
| Client IP, path, user agent | the web container's nginx access log (and Traefik's, if enabled) | operating and securing the service | not used for tracking |

Not collected: advertising identifiers, location, contacts, photos, audio (Alexa's audio stays with Amazon), browsing
history, device fingerprint, crash/analytics SDK data (there is no analytics, no ad or crash SDK, no third-party script,
font or CDN in the app; the CSP allows only our own origin and the identity provider). Nothing is sold. Recipients
(docs/design/33 section 3): the browser push services (Google FCM, Mozilla, Apple, Microsoft: they receive an encrypted
payload and cannot read it), Amazon for the opt-in Alexa skill (it hears the voice and speaks our answers, which carry
the baby's name and log facts), BrasilAPI, ViaCEP and Nominatim for the address search (only the typed CEP or text, from
our server), and the links the user taps (Google Maps, WhatsApp). The native apps have **no push** today (APNs/FCM is
docs/design/19-native-push.md, not built).

### Apple App Privacy

- Data used to track you: **none**. No tracking domains; no App Tracking Transparency prompt.
- Data linked to you (all "App Functionality", none for advertising or analytics):
  - Contact Info: Name, Email Address (the sign-in account).
  - Health & Fitness: Health (medications, vaccinations, doses, temperatures, symptoms, growth, notes about the baby)
    and Fitness: no; **Other Data** covers sleep and feeding logs. Declare Health because these are health data (about
    the child, entered by the parent).
  - User Content: Other User Content (notes, the doctors and clinics the family saves), and "Photos or Videos": none.
  - Identifiers: User ID (the account id). **No Device ID**: the iOS app has no push token (native push is not built;
    add Device ID when it ships).
  - Sensitive Info: none beyond the above.
- Data not linked to you: none. Diagnostics, usage data, location: not collected by the app (App Store Connect's own
  analytics and crash reports from users who opt in are Apple's, not an SDK of ours: owner to confirm the answer).

### Google Play Data safety

- Data collected and shared: **collected yes, shared no** (no third-party sharing by the Android app; the server's
  Alexa answers go to Amazon only after the user links the skill, a user-initiated transfer: owner to confirm).
- Types collected: Personal info (Name, Email address, User IDs), Health and fitness (Health info: medications,
  vaccinations, temperatures, symptoms, growth, sleep and feeding logs), App activity (in-app content the user creates:
  "Other user-generated content", which covers notes and saved care providers). **No device or other IDs** (no push
  token in the Android app today; add it with native push).
- Purposes: App functionality, Account management. None for analytics, advertising, personalisation or fraud.
- Security: data is encrypted in transit (HTTPS only); users can request that data is deleted (in-app deletion; the web
  URL, section 5); the app follows the Families policy: **no** (not designed for children).
- Is all collected data required? Name and email: required to have an account. Health info: optional (the user decides
  what to record).

## 4. Privacy policy (published page)

The draft that was here is replaced by the real page: **`https://lotties.app/privacy`** (route `/privacy`, public, no
sign-in, precached so it opens offline, pt-BR and English; also Hub > App > Privacy policy at `/hub/privacy`,
`/doctor/privacy` in the doctor's account menu, and links in the landing footer, About, Settings > Account and data and
Settings > Voice assistants). Use this URL in App Store Connect, the Play Console, the store listings and the Alexa
console.

- Text: `code/web/src/legal/privacy.pt-BR.ts` (primary) and `privacy.en.ts`, rendered by `legal/PrivacyContent.tsx`;
  version and date in `legal/privacyPolicy.ts`. Facts behind every sentence: docs/design/33-privacy-audit.md (which
  also lists the draft statements that were not true).
- Controller, contact and encarregado: build values `VITE_PRIVACY_CONTROLLER_NAME`, `VITE_PRIVACY_CONTACT_EMAIL`,
  `VITE_PRIVACY_DPO` (docs/DEPLOY.md "Privacy policy"); until set the page shows neutral defaults.
- Before the first submission: docs/PRIVACY-OWNER-CHECKLIST.md (values to set, facts to confirm, the lawyer's review).

## 5. Public page to request deletion (Google)

Google's form asks for a web URL where a user (who may not have the app installed) can request deletion. Minimal and
honest: `https://lotties.app/delete-account`, public, explaining the in-app path (Settings > Account and data), what is
deleted and what stays (section 2), and a contact address for people who cannot sign in. A signed-in version of the
same flow is the Settings section. `/privacy` is built (section 4; its chrome strings are in `legal.json`); todo, after
the owner approves the text: the route `/delete-account` as a public page beside it, with its landing footer link.
Until it exists, the policy's "Your rights" section (`https://lotties.app/privacy#privacy-rights`) explains the in-app
path and the contact for people who cannot sign in (owner to decide whether to give Google that URL).

## 6. Health and medication declarations

- Positioning (already the product's rule, docs/design/06-medications.md section 0): a log and reminder tool for what a
  doctor prescribed; **never dosing advice, never diagnosis**. Doses and intervals used in calculations come only from
  the prescription the parent entered; the per-kg suggestion shows its inputs and must be confirmed; "same active
  ingredient" is information. Vaccine data is a schedule with sources, facts only.
- Apple 1.4.1: no inaccurate health claims, no medical-device claim; the listing text must not say "treat", "diagnose",
  "dose" or "safe". Include a short disclaimer in the app description and the first-run screen (already in Settings >
  medications). Apple 5.1.3: health data is not used for advertising or shared with data brokers; stated in the policy.
- Google Health apps declaration: "My app is not a medical device and does not provide medical advice"; it does not
  use Health Connect; it is a "nutrition/tracking" style app (select "Parenting"/"Health and fitness" category as the
  listing fits). Medical-claims policy: same wording rules as Apple.
- Reminders: make the user opt in, never promise delivery ("reminders can be late if your phone is off or restricts
  notifications"): this wording is in the notification settings (docs/design/09).

## 7. Ratings, category, audience

- Apple: category Health & Fitness (or Lifestyle/Parenting; Parenting is a sub-area of Lifestyle). Age rating
  questionnaire: no objectionable content; "Medical/Treatment Information: infrequent/mild" is the honest answer for
  medication tracking, which gives 12+/4+ depending on the year's rules: answer as asked and keep the result. **Not**
  the Kids category.
- Google: category Parenting, target audience 18+ (adults), no ads, no in-app purchases, content rating questionnaire
  answers: no violence, no sexual content, no user interaction with strangers (the only sharing is by invite).
- Payments: none. Do not add a purchase flow without redoing the review (Apple 3.1.1 would apply to anything digital).

## 8. Review notes and demo account

Prepare when the accounts exist (never put real credentials in the repository):

- A dedicated demo user on the production realm with a few days of synthetic events for a fake baby ("Demo"), and a
  second demo user for the sharing flow. A line in the review notes: "Sign in with the credentials below. Settings >
  Account and data deletes the account (a new one can be created at the sign-in page)."
- Explain the sign-in: it opens the system browser (Keycloak) and returns to the app; mention that the app works
  offline after the first sign-in.
- Explain push: reminders are optional and off until enabled in Settings; the reviewer does not need to enable them.
- Contact for the reviewer, and the support URL (the repository's issues page or a mailbox).

## 9. Licence: AGPL-3.0 and the stores

- The App Store's terms add usage rules and DRM that GPL-family licences do not allow a downstream user to be bound by.
  A copyright holder is not bound by the licence of their own code, so **the owner can publish the apps they wrote**. This
  is why a project with outside contributors needs a way to publish their code too.
- Today the repository has one author. The moment a third party's code is merged and ships in the app, the owner needs
  the contributor's permission to distribute it under the stores' terms. Options, simplest first:
  1. A Contributor License Agreement (CLA) or a **Developer Certificate of Origin plus a clause** in CONTRIBUTING:
     "you grant the project owner a perpetual, worldwide licence to distribute your contribution under any licence,
     including through app stores". A bot (CLA assistant) checks every pull request.
  2. Dual-license the project: AGPL-3.0 for the public, a commercial/store licence from the owner for the apps (needs
     the same grant from contributors).
  3. Accept no outside code in the app (documentation and issues only).
  Draft clause for CONTRIBUTING (owner to approve; this is a legal change, so it is not applied here): "By opening a
  pull request you confirm you wrote the change or have the right to submit it, that it is licensed to the project under
  AGPL-3.0, and that you also grant [owner] the right to distribute it, unmodified or modified, under other licences,
  including in the Apple App Store and Google Play."
- Dependencies shipped in the apps must keep permissive licences (Capacitor MIT; check each new plugin). Fonts and
  illustrations are original or under SIL OFL / own work (check `docs/design/ILLUSTRATIONS.md` before release).
- The AGPL source offer stays visible in the app (landing footer, `VITE_REPO_URL`) and in the store description
  ("Open source: [repository URL]"); AGPL section 13 applies to the server, which the owner runs and publishes.
- Not legal advice: confirm with a lawyer before the first release.

## 10. Pre-submission checklist

Owner decisions and accounts first, then the work I can do without them marked (code/doc ready).

- [ ] Developer accounts: Apple Developer Program, Google Play Console (personal accounts: plan the 14-day closed test
  with 12 testers).
- [ ] Keycloak: redirect URIs and web origins for the apps (doc 12 section 4); the service account for account deletion
  (docs/DEPLOY.md); API `CORS_ALLOWED_ORIGINS` for the app origins (doc 12 section 5).
- [x] Account deletion in the app (branch `feat/account-deletion`).
- [x] Placeholder icons and splash replaced (branch `feat/native-assets`); [ ] check them on a device.
- [x] Public `/privacy` page, links in the app (section 4); [ ] the text approved by the owner and a lawyer;
  [ ] the public `/delete-account` page (section 5).
- [ ] Controller identity, contact email and encarregado set as build values; server location, log and backup
  retention confirmed (docs/PRIVACY-OWNER-CHECKLIST.md sections 1 to 3).
- [ ] The audit's gaps before review: account deletion with saved care providers (G1), deletion in the doctor's
  settings (G2), consent capture (G3), Keycloak account removal in production (G5) (docs/design/33 section 8).
- [ ] App Privacy and Data safety forms (section 3); age and content rating (section 7); health declaration (section 6).
- [ ] CLA or the contribution clause decided (section 9).
- [ ] `isNativeApp()` in the notification settings (doc 12 section 7) and native push (doc 19) before the first iOS review.
- [ ] iOS: bundle id, signing, `ITSAppUsesNonExemptEncryption=false`, privacy manifest (`PrivacyInfo.xcprivacy`: no
  tracking, required-reason API declarations for the plugins used; Capacitor ships its own), launch screen checked.
- [ ] Android: signing (Play App Signing), `versionCode` policy (doc 12 section 14), target API, the Data safety form.
- [ ] Listing: name, subtitle, description (no medical claims), keywords, screenshots (en and pt-BR), support URL,
  marketing URL, "What's new".
- [ ] Review notes and demo accounts (section 8).
- [ ] CI builds (doc 12 section 13) and a first internal test (TestFlight, Play internal track).
