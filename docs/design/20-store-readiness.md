# 20. Store readiness (Apple App Store and Google Play)

Status: checklist and drafts, 2026-10-22. Not legal advice: the policy text and the licence points below must be read by
the owner and, before the first public release, by a lawyer (the data is health-adjacent data about children, and the
law that applies first is Brazil's LGPD, plus the store rules). Technical decisions for the apps are in
docs/design/12-mobile-capacitor.md; push in docs/design/19-native-push.md.

## 1. What the stores need, and where we stand

| Requirement | Apple | Google Play | Status |
| --- | --- | --- | --- |
| Developer account | Apple Developer Program (about US$99/year; an individual account is enough, an organisation needs a D-U-N-S number) | Play Console (US$25 once; a **personal** account created after Nov 2023 must run a closed test with at least 12 testers for 14 days before it can publish) | owner: none yet |
| Account deletion in the app | 5.1.1(v) | Account deletion policy | **built** (branch `feat/account-deletion`): Settings > Account and data |
| Account deletion link on the web | not needed | the Data safety form asks for a URL where users can request deletion | todo: a public page, see section 5 |
| Privacy policy URL | required, in the app and in App Store Connect | required, in the listing and in the app | draft in section 4; page todo |
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
(docs/DEPLOY.md "Account deletion (Keycloak)"). In the app: Settings > Account and data, with a preview of what is
deleted, a data download first on the web, and a permanent-action confirmation. Reviewers test this: keep the demo
account deletable and recreatable.

## 3. Data inventory and form answers

What Lotties stores, from the data model (docs/SPEC.md, docs/design/09 section 5), and what it does not:

| Data | Where | Purpose | Linked to the user |
| --- | --- | --- | --- |
| Name and email, password | Keycloak (our own identity server) | sign-in. The API never reads or stores the email; it keeps only a display name from the token | yes |
| Baby name, birth date | API database | the product | yes |
| Events (feeds, sleep, diapers, notes), measurements (weight, height), medications, prescriptions and doses, appointments, vaccinations, notes of doctors | API database | the product | yes |
| Push token / Web Push endpoint, device label, language, time zone | API database | reminders | yes |
| Access log of doctors' reads of a baby | API database | transparency to the parents | yes |
| Notification delivery log (ids, kind, time, status; no text) | API database, purged after 14 days | reliability | yes |
| IP address, request line | reverse-proxy and API logs on the owner's server | operating and securing the service | not used for tracking |

Not collected: advertising identifiers, location, contacts, photos, audio, browsing history, device fingerprint,
crash/analytics SDK data (there is no analytics, no ad or crash SDK, no third-party script in the app). Nothing is sold
or shared with third parties; processors are the owner's own server and, for push, Apple and Google's push services
(they see timing and the generic text, see doc 19 section 8).

### Apple App Privacy

- Data used to track you: **none**. No tracking domains; no App Tracking Transparency prompt.
- Data linked to you (all "App Functionality", none for advertising or analytics):
  - Contact Info: Name, Email Address (the sign-in account).
  - Health & Fitness: Health (medications, vaccinations, doses, notes about the baby) and Fitness: no; **Other Data**
    covers sleep and feeding logs. Declare Health because medication and vaccination records are health data (about the
    child, entered by the parent).
  - User Content: Other User Content (notes), and "Photos or Videos": none.
  - Identifiers: User ID (the account id) and Device ID (the push token) for App Functionality.
  - Sensitive Info: none beyond the above.
- Data not linked to you: none. Diagnostics, usage data, location: not collected.

### Google Play Data safety

- Data collected and shared: **collected yes, shared no** (no third-party sharing; the push services are a service
  provider transfer, not sharing, but state the push token as collected).
- Types collected: Personal info (Name, Email address, User IDs), Health and fitness (Health info: medications,
  vaccinations, sleep, feeding notes), App activity (in-app content the user creates: "Other user-generated content"),
  Device or other IDs (push token).
- Purposes: App functionality, Account management. None for analytics, advertising, personalisation or fraud.
- Security: data is encrypted in transit (HTTPS only); users can request that data is deleted (in-app deletion + the web
  page, section 5); the app follows the Families policy: **no** (not designed for children).
- Is all collected data required? Name and email: required to have an account. Health info: optional features.

## 4. Privacy policy (draft for the owner and a lawyer)

To be published at `https://lotties.app/privacy` (public, no sign-in, English and Portuguese, linked from the landing
footer, the sign-in page, Settings and both store listings). Replace the bracketed items. Plain language, because the
readers are parents.

> **Privacy policy of Lotties** (version 1, [date])
>
> **Who we are.** Lotties is a free, open-source app to keep track of a baby's day (feeds, sleep, diapers, medicines,
> growth, vaccines and visits). The controller of your data is [name of the owner or company], [contact email]. The
> source code is public at [repository URL].
>
> **What we keep.** Your sign-in account (name, email, password, kept by our own sign-in server; the app itself does not
> read your email); your babies' names and birth dates; what you or the people you invited record about them (events,
> measurements, medicines and doses, appointments, vaccines, notes); reminders settings and the address your phone or
> browser gives us to send reminders; a short list of who opened the baby's data when a doctor has access. We do not
> use advertising, analytics or tracking tools, and we do not sell or share your data for marketing.
>
> **Why.** Only to run the app: to show your records on all your devices, to share them with the people you invite and
> to send the reminders you turn on. The legal basis is your consent when you create the account and the performance of
> the service you ask for (LGPD art. 7, I and V); health data is processed with your specific consent (art. 11, I).
>
> **Who sees it.** The people you invite to a baby, with the role you give them; a doctor you invite sees what that
> role allows and every doctor's access is logged for you. Our server host [provider/location]. Reminders pass through
> Apple's and Google's notification services (and your browser's), which see that a reminder was sent and its generic
> text, never more; names appear only if you turn that on.
>
> **Where.** [Country and place of the server]. [International transfer note if any.]
>
> **How long.** Until you delete it. Entries you delete are kept hidden for syncing your other devices until the baby or
> the account is deleted. Reminder delivery logs are deleted after 14 days. Server logs: [period].
>
> **Your rights.** Access, correction, deletion, portability, withdrawing consent and complaint to the ANPD. Delete your
> account and its data any time in Settings > Account and data (or at [delete-account page URL] and by writing to
> [email]); download a copy of your data in the same place on the web. Deleting the account erases babies only you use;
> for a baby other people keep, your access ends and what you added stays for them without your name.
>
> **Children.** Lotties is for parents and caregivers, not for children. The data it holds is about babies and was
> entered by their parents; we ask no one under 18 to use the app.
>
> **Security.** Encrypted connections, per-baby access control, tokens that expire, backups [describe].
>
> **Changes and contact.** We tell you in the app before a material change. Contact: [email]. Version history in the
> repository.

Notes for the owner: name a controller (LGPD requires an identified controller and, for a company, an encarregado/DPO
contact); decide the server location and backup retention; confirm the health-data consent wording with a lawyer.

## 5. Public page to request deletion (Google)

Google's form asks for a web URL where a user (who may not have the app installed) can request deletion. Minimal and
honest: `https://lotties.app/delete-account`, public, explaining the in-app path (Settings > Account and data), what is
deleted and what stays (section 2), and a contact address for people who cannot sign in. A signed-in version of the
same flow is the Settings section. Todo (small web change, after the owner approves the text): route `/delete-account`
and `/privacy` as public pages (the landing already has public routes), strings in a `legal.json` catalog, links in
the landing footer.

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
- [ ] Public `/privacy` and `/delete-account` pages with the approved text (section 4, 5); links in the app.
- [ ] Controller identity, contact email, server location, log retention filled into the policy.
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
