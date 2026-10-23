# 33. Privacy data flow audit (2026-10-23)

What personal data Lotties handles, where it goes, why, for how long, who sees it, and how it is exported and deleted.
Written from the code (`code/api`, `code/web`, `code/mobile`, `code/keycloak-theme`), the deploy kit (`deploy/homelab`,
`docker-compose.yml`, `code/web/nginx.conf`) and the design docs, as the factual base of the public privacy policy
(`https://lotties.app/privacy`, content in `code/web/src/legal/`). **Not legal advice.** The proposed legal bases are a
starting point for the owner and a Brazilian lawyer or privacy specialist. Every item marked `OWNER TO CONFIRM` is
something the repository cannot prove; the consolidated list is in `docs/PRIVACY-OWNER-CHECKLIST.md`.

Method: every claim below was checked against the code named in its row. "Built" means in the code on `main` at
`62f387b`; "deployed" means the home lab kit passes it to production as committed (the cluster may have values set
outside the repository: `OWNER TO CONFIRM`).

## 1. Where the data lives

| Place | What | Facts |
| --- | --- | --- |
| Web app container (`lotties-web`, nginx) | the SPA files | no personal data stored; its stock access log (the image's default `main` format, `nginx.conf` sets no `access_log`) writes the client address from `X-Forwarded-For`, time, request line, status, size and user agent of each static/page request to stdout |
| API container (`lotties-api`, .NET 8) | no local storage | logs to stdout (below); keeps rate-limit counters and the address-lookup answer cache in memory only; Napper and backup uploads are read in memory, never written to disk (no `File.*` or temp-file use in `code/api/src`) |
| PostgreSQL (external to the cluster) | every server-side record | location `OWNER TO CONFIRM`; encryption at rest `OWNER TO CONFIRM` (nothing in the repo); the API connects with a role limited to `SELECT, INSERT, UPDATE, DELETE` (docs/DEPLOY.md "Database roles") |
| Keycloak (realm `lotties.app`, `https://auth.lotties.app`) | sign-in accounts | runs in the same home lab cluster (namespace `keycloak`, deploy/homelab/README.md), shared with the owner's other apps (docs/DEPLOY.md "Multi-theme"); realm isolation, registration fields, email verification, OTP, brute-force protection and event logging: `OWNER TO CONFIRM` |
| Traefik (external ingress) and cert-manager | TLS termination, routing | `https://lotties.app` routes `/api` to the API and the rest to the web app; HTTP redirected to HTTPS; certificate from Let's Encrypt via DNS-01 at Cloudflare; Traefik access logs on/off and retention `OWNER TO CONFIRM`; whether Cloudflare only serves DNS or also proxies traffic `OWNER TO CONFIRM` (a proxy would see all traffic in clear text) |
| Harbor (`cr.homel4b.dev/lotties`) | container images | no personal data |
| GitHub | source code, CI | no personal data from the app; issues are public |
| The user's device | offline copy and session | section 4 |
| Backup files | `pg_dump` copies | taken by the owner before deploys that apply a migration, kept until the owner deletes them; location, encryption and any other backup (database server snapshots) `OWNER TO CONFIRM` |

Hosting: everything Lotties runs (web app, API, Keycloak) is in the owner's home lab Kubernetes cluster (`home-lab-main`,
k3s), not on a cloud provider. Country and physical site: `OWNER TO CONFIRM`.

## 2. Inventory by category

Legend for "Basis" (proposed, `OWNER TO CONFIRM` with a lawyer): **Contract** = LGPD art. 7, V (performance of the
service the user asked for); **Consent-H** = art. 11, I (specific consent for sensitive/health data); **Consent** = art. 7,
I; **LI** = art. 7, IX (legitimate interest, never for sensitive data); **Legal** = art. 7, II / art. 11, II, a.

| # | Category | Data (from the code) | Purpose | Basis | Who sees it | Retention | Delete | Export |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sign-in account (Keycloak) | the registration fields of the realm (by default username, email, first and last name) and the password (Keycloak keeps a salted one-way hash; it never stores plain passwords), sessions (Keycloak records IP and user agent of each session), login events if enabled | sign-in on every device | Contract | the owner as Keycloak admin; nobody in the app | until the account is deleted | in-app deletion removes it only when `AUTH_ADMIN_CLIENT_ID/SECRET` are set; **the home lab kit does not pass them** (`deploy/homelab/values/api.yaml`), so today the app tells the user it stays and the owner removes it by hand `OWNER TO CONFIRM` | not in the app (Keycloak account console, if enabled) |
| 2 | Lotties user row (`users`) | internal id, OIDC issuer and `sub`, display name (from `name`/`preferred_username`/`nickname`, never an email: `Domain/Users/ExternalIdentity.cs`), created time; the email claim is never read (`Api/Authentication/OidcClaims.cs`) | link records to the account; show the name to co-members | Contract | members of the user's babies see the display name | forever as an anonymized row after deletion (issuer `urn:lotties:deleted`, name "Former member", `deleted_at`) so shared babies keep their history | `DELETE /me` | no |
| 3 | Baby profile (`babies`) | name, birth date, vaccine network (`public`/`public+private`), gestational age in weeks, mother's RSV vaccination in pregnancy (`unknown/yes/no`: health data of the mother, a third person). No sex/gender field, no photo | the product, the vaccine schedule | Contract; Consent-H for the vaccine profile | every member; a Doctor sees name and birth date always, the vaccine profile only with the `vaccines` section (`Domain/Babies/SectionView`) | until the baby is erased | erased with the baby (account deletion when alone; there is no "delete baby" for a shared one) | Hub > Export data (Owner, Parent) |
| 4 | Daily records (`events`, `event_types`) | feeds (method, side, amounts prepared and drunk, formula), sleep (kind, pauses), diapers, baths, tummy time, outdoor, crying/fussy spells, milestones (custom text), nail trim, skin care, nasal suction, breast pump, free-text notes (2000), custom types and their fields, `createdBy` | the product: log, sync, summaries, predictions (computed, never stored, `Domain/Predictions`) | Contract | every member by role; Doctor with `daily_log` only, medication events only with `medications` | until deleted; a deleted entry stays as a soft-deleted row with its content (`deleted_at`) until the baby is erased; there is no purge | entry delete (soft); baby erase | Hub > Export data; Settings > Download my data (device copy) |
| 5 | Health records | medications (name, dose, notes, catalog link), prescriptions (dose rules, schedules, indication, instructions, prescriber text, doctor provenance), medication doses (as events), temperature, symptom, belly pain, spit-up, teething, measurements (weight, length, head), vaccinations (vaccine, dose, date, network, clinic, lot, administered by, notes), appointments (title, type, time, place, doctor name, notes, outcome, reminder offsets), formulas | the health log, schedules computed from what the family entered, reminders | **Consent-H** (sensitive data, art. 11; about a child, art. 14) | every member by role; Doctor per section (`daily_log`, `growth`, `medications`, `vaccines`, `formulas`), never appointments | as row 4 | as row 4 | as row 4 |
| 6 | Care providers (`care_providers`) | name, specialty, registration council/number/region, clinic, address, phone, WhatsApp, email, website, notes, favorite: **data about third persons** entered by the family | contact directory, fill appointments | LI of the family / Contract (`OWNER TO CONFIRM`) | Owner, Parent, Caregiver, Viewer (`BabyReadFamily`); never a Doctor | until the provider is deleted (soft, kept) or the baby is erased | soft delete in the app; **account deletion does not erase them** (gap G1) | Hub > Export data |
| 7 | Notes (`baby_notes`) and reads (`note_reads`) | author, kind note/recommendation, visibility shared/private, body (4000); first read time per member | doctor-family communication | Consent-H (part of the doctor sharing) | shared: every member; private: only the author (filtered in the SQL of every read, `EfNoteRepository`) | until deleted (soft) or the baby is erased; a removed doctor's notes stay | author deletes; account deletion deletes the user's private notes, keeps shared ones under "Former member" | Hub > Export data (shared notes and the exporter's private ones) |
| 8 | Prescription proposals (`prescription_proposals`) | a doctor's suggested prescription, status, decline reason (parent's words), decision | doctor suggestions | Consent-H | Owners, Parents and the author doctor only | never deleted (decided proposals are immutable) until the baby is erased; pending ones of a deleted account are deleted | baby erase | not in the export (by design) |
| 9 | Professional profile (`professional_profiles`) | display name, specialty, registration number (self-declared, `verified` false; nothing in the app checks it) | families know who their doctor is | Contract | members of the babies she follows (via notes, measurements, provenance), Owner in Members | until account deletion | account deletion | no (shown in Settings) |
| 10 | Memberships, invites, doctor scopes | role per baby, joined time, doctor sections; invites: SHA-256 of the token only (`Domain/Babies/InviteToken.cs`), role, creator, expiry, accepted by/at. **No email is stored for invites**: an invite is a link the inviter shares herself | sharing | Contract (Consent-H for a Doctor invite: the consent line names the sections, docs/design/19 section 8) | Owner manages; members list for family roles | memberships until leave/removal; invites kept (hash) also after use or expiry, until the baby is erased | leave, removal, account deletion (unaccepted invites of the user) | no |
| 11 | Doctor access log (`access_log`) | doctor user id, role, `view`, time (at most one per hour per doctor and baby; also per listed patient of `GET /doctor/patients`) | transparency to the Owner | LI / Legal (accountability) `OWNER TO CONFIRM` | Owner (newest 50) | **kept with no expiry** (gap G4) | erased with the baby | no |
| 12 | Push subscriptions (`push_subscriptions`) | Web Push endpoint (a capability URL of the browser vendor), `p256dh`/`auth` keys, locale, device label ("Chrome on Android"), created/last seen/last success, failures, revocation | reminders | Consent (device opt-in) | the user (own device list) | revoked after 90 days unseen, hard-deleted 30 days after revocation (`NotificationRules`); revoked on logout | turn off; logout; account deletion | no |
| 13 | Notification settings and preferences | IANA time zone (a hint of region), quiet hours, show-names, per-baby kinds and leads | reminders at local time | Consent | the user | until changed or account deletion; preferences cascade when leaving | account deletion | no |
| 14 | Delivery log and actions | delivery id, user, baby, kind, base key (ids), times, status, attempts, HTTP status, action token hash; snooze/dismiss rows | reliability, dedupe, snooze | LI | nobody in the app | deliveries 14 days, actions 7 days after last change (`NotificationHousekeeping`) | account deletion | no |
| 15 | Voice assistant settings (`user_assistant_settings`) | default baby id | Alexa commands | Consent (linking) | the user | until changed or account deletion | account deletion; cleared when the baby is erased | no |
| 16 | Shared medicine catalog | products a user adds (name, form, ingredients) become instance-wide; `created_by` stored, never returned (`Application/Catalog`) | catalog | LI | every user sees the product, not who added it | kept | not by the user | no |
| 17 | API logs (stdout) | user id, baby id, record ids, event type id, role, doctor scopes, counts, result and error codes, invite ids, correlation ids, exception types; export/import audit lines (user, baby, counts, checksum). **No** IP address, request line, payload, names, notes, tokens, push endpoints, address search text (HTTP client logging for address lookup is `None`; `Microsoft.AspNetCore` at `Warning`, so no request logging; no `EnableSensitiveDataLogging`) | operate, debug, audit | LI | the owner (cluster access) | kubelet rotation by size unless a collector keeps them `OWNER TO CONFIRM` | not by the user | no |
| 18 | Web server and proxy logs | nginx: client IP (forwarded), time, path, status, user agent (static and page requests only: the Ingress sends `/api` to the API directly). Traefik: whatever its access log is set to, possibly the `/api` request lines with query strings (address search text) | operate, security | LI | the owner | `OWNER TO CONFIRM` | no | no |
| 19 | Backups | full `pg_dump` (everything above), taken before migration deploys | recovery | LI (copies follow the bases of their data) | the owner | until the owner deletes them; deleted data may persist in them | owner | no |
| 20 | Exported files | the per-baby backup (readable JSON, unencrypted, no account ids: stand-ins) and the device JSON | portability | Contract | whoever holds the file | outside our control | user | is the export |

## 3. Third parties and requests that leave our servers

| Recipient | What leaves | Trigger | Country / transfer | Built and deployed |
| --- | --- | --- | --- | --- |
| Browser push services: Google FCM (Chrome, most Android browsers), Mozilla autopush (Firefox), Apple (Safari, Home Screen web apps), Microsoft WNS (Edge) | the endpoint (chosen by the browser), an encrypted payload (RFC 8291 `aes128gcm`: ids, kind, time, language, action token, names only with show-names) they cannot read, TTL/urgency/topic (opaque hash) headers, timing and size; the VAPID subject (the operator's contact, not user data). The text is rendered on the device from the bundled `push.*.json` | the user turns notifications on per device | the vendors' own infrastructure, mostly outside Brazil | built; deployed when the three `PUSH_VAPID_*` values are set `OWNER TO CONFIRM` |
| APNs / FCM native push | nothing | not built (docs/design/19-native-push.md is design only; the Capacitor apps have no push) | | no |
| Amazon (Alexa) | inbound: Amazon records and transcribes the voice; Lotties receives intent, slot values, locale, request ids and the account-linking token (validated like the web's tokens). **Outbound: the spoken answer**, which can contain the baby's name, feed/sleep times and durations, diaper counts, the next appointment's title and time, due vaccine names. Amazon also holds the Keycloak tokens of the linked account (confidential client `lotties-alexa`). Not logged by the API: body, slots, tokens, Amazon user/device ids | the user enables the skill and links the account | United States (Amazon) | built; **off** (`Alexa__Enabled` is not set in the home lab kit) |
| BrasilAPI, ViaCEP (CEP), OpenStreetMap Nominatim (text) | only the CEP digits or the typed text, from the server's IP, with `User-Agent: Lotties-baby-tracker/1.0 (+repo; ContactEmail)`; never a baby, user or the client's IP | the user presses "Find address" in the provider sheet | ViaCEP and BrasilAPI are Brazilian services (hosting location not checked); Nominatim is run by the OpenStreetMap Foundation (United Kingdom) | built; on by default (`AddressLookup:Enabled` true; `ContactEmail` not set in the kit) |
| Amazon S3 (`s3.amazonaws.com/echo.api/`) | a GET of Amazon's public signing certificate | Alexa requests | | only with Alexa on |
| Google Maps, WhatsApp, phone/email apps, calendar apps, the share sheet | what the user's own tap sends: "Open in maps" = Google Maps search of the provider's address (`providers/providerModel.ts`), WhatsApp `wa.me/<digits>`, `tel:`, `mailto:`, `.ics` export, invite links and backups shared by the user | the user taps a link or shares | the chosen service | built |
| Keycloak SMTP relay (Brevo or another) | the account's email address and Keycloak's messages (verification, password reset) | Keycloak account emails | depends on the relay | **not confirmed**: only `configure-realm-smtp.sh` (generic) and docs/DEPLOY.md mention Brevo as one option `OWNER TO CONFIRM` |
| Apple App Store, Google Play | store downloads; aggregate statistics and crash reports the platforms share with developers when the user's device settings allow it | installing the native app | Apple / Google | apps not published yet |
| GitHub | nothing from the app; a person who opens the repository or writes an issue is under GitHub's terms (issues are public) | user action | United States | |
| Let's Encrypt, Cloudflare (DNS) | certificate issuance (no user data); DNS | infrastructure | | Cloudflare proxying `OWNER TO CONFIRM` |
| AI assistants through an MCP server | nothing | **not built** (docs/design/32-assistants.md section 8 is the plan) | | no |
| Bottle amount aggregate (phase 2) | nothing | **not built** (docs/design/10-bottle-suggestions.md) | | no |

Analytics, telemetry, ads, crash SDKs, third-party fonts and CDNs: **none**. Evidence: no such dependency in
`code/web/package.json`, `code/mobile/package.json` or the API projects (the landing test
`LandingPage.test.tsx` "claims no tracking only while the web app has no analytics or telemetry dependency" enforces it
for the web); the web CSP (`code/web/nginx.conf`) is `default-src 'self'; script-src 'self'; font-src 'self';
img-src 'self' data:; connect-src 'self' <OIDC origin>`, and the native build has the same policy in a meta tag
(`code/web/native-csp.ts`); `index.html` loads only own files; the Fraunces font ships in the bundle
(`@fontsource-variable/fraunces`); the Keycloak theme loads only its own files (no external URL in
`code/keycloak-theme/src`). Native apps request only `android.permission.INTERNET`; the iOS `Info.plist` has no usage
description (no camera, photos, location, contacts, microphone). No photo or file of the baby is collected anywhere.

## 4. On the device (web, installed PWA, native WebView)

| Storage | Keys / content | Cleared by |
| --- | --- | --- |
| IndexedDB (Dexie), one database per account (name from issuer + `sub`) | babies, event types, medications, events, prescriptions, catalog products used, latest weights, formulas, appointments, notes, proposals, note reads, vaccinations, vaccine schedules, care providers, age norms, the outbox of unsent changes, sync cursors | sign-out and account deletion (after the unsynced-changes warning, `session/endSession.ts`), leaving a baby purges it |
| `localStorage` (per account entries) | the OIDC user (`oidc-client-ts`: id, access and refresh tokens, profile claims incl. name and email), selected baby, cached predictions per baby, last used values (amounts, medication ids), pinned presets, dismissed cards, nap guidance, last seen, push opt-in record, reminder prompt time, Hub usage counts, doctor dashboard ids (recents, last section) | sign-out (`session/deviceState.ts`) |
| `localStorage` (device preferences) | language, theme, night view, ring view | stay until site data is cleared |
| `sessionStorage` | the pending invite token during a sign-in round trip (removed on use), the doctor landing flag | tab close |
| Service worker caches | the app's own files (precache) only; no API response is cached (`pwa/sw/sw.ts`: navigation route only, `/api` denied) | updates, site data clearing |
| Cookies | the app sets none; Keycloak sets its session cookies on its own origin (in the system browser for the native apps) | Keycloak logout, cookie clearing |

Nothing on the device is encrypted by the app (browser and OS protections only); docs/DEPLOY.md "Token storage trade-off"
explains the token choice.

## 5. People who see a baby's data

- Roles (docs/SPEC.md "Roles and permissions", enforced per route on the server, `EndpointRoleMatrixTests`): Owner and
  Parent read and write; Caregiver logs and changes her own entries; Viewer reads; only the Owner edits the baby,
  invites, changes roles and reads the access log.
- Doctor: only the sections the Owner shares (`BabyScope:*` policies, fields of one section inside another's answer
  filtered by `SectionView`), never appointments, members, care providers, invites, the access log, reminders, export or
  import; her device keeps a lean copy and forgets revoked sections; every read writes an hourly access-log entry the
  Owner sees. Self-declared; registration not verified.
- Private notes never leave the database for anyone but the author.
- The owner of the service (as operator) has technical access to the servers, the database, Keycloak and the logs.
  `OWNER TO CONFIRM`: who else has administrator access to the home lab.

## 6. Deletion and export paths (verified)

- Entry delete: soft (`deleted_at`), the full row stays hidden until the baby is erased. There is no purge job for soft
  deletes (only push housekeeping exists).
- Leave a baby / removal: membership and preferences go; what she wrote stays.
- Account deletion (`DELETE /me`, `EfAccountDataEraser`): babies with no other member are erased with note reads,
  notes, proposals, access log, appointments, vaccinations, formulas, measurements, events, prescriptions, medications,
  custom event types, invites, notification actions, deliveries, preferences, members and the baby row; on kept babies
  her note reads, private notes, pending proposals, unaccepted invites, preferences and membership go; then her
  deliveries, actions, push subscriptions, notification settings, professional profile and assistant settings; the user
  row is anonymized; Keycloak removal only with the admin service account (not wired in the home lab kit).
- Export: Hub > Export data (`GET /babies/{id}/export`, Owner and Parent; complete, server-built, no account ids, other
  members' private notes excluded); Settings > Account and data > Download my data (what the device holds, any role).
  Caregivers, Viewers and Doctors have no complete export (by design, docs/design/24 section 1): their access right is
  served by the screens and a request to the contact.

## 7. Children

All baby data is about a child under 12 entered by an adult (parents, people they invite, a doctor they invite). LGPD
art. 14 asks for processing in the child's best interest and, for consent, a specific and highlighted consent of at
least one parent or legal guardian (art. 14, §1). As we read it, ANPD's Enunciado CD/ANPD nº 1/2023 allows children's
data to be processed under the bases of art. 7 or art. 11 when the best interest prevails (lawyer to confirm). The app
does not check that the person who creates a baby is its parent or guardian, and asks no age of account holders.

## 8. Gaps found

| # | Gap | Where | Suggested fix (not done here: no API change in this task) |
| --- | --- | --- | --- |
| G1 | **Account deletion does not erase `care_providers`** of the babies it erases, and their foreign key to `babies` is `RESTRICT` (`CareProviderConfiguration.cs`): for a user who is alone on a baby with saved doctors or clinics, `DELETE /me` should fail with a database error instead of deleting. No test covers it (`AccountDeletionEndpointTests` has no provider). Suspected from the code, not run | `EfAccountDataEraser.DeleteBabiesAsync` | delete `CareProviders` of the erased babies before the babies; add a test |
| G2 | A doctor-only user has no "Account and data" section in `/doctor/settings` (no in-app deletion or download from her menus; `/settings` works only when typed) | `doctor/PatientPages.tsx` `DoctorSettingsPage` | add `DeleteAccountSection` there (store rule: Apple 5.1.1(v)) |
| G3 | No consent is collected or recorded for health data (art. 11, I) or for children's data (art. 14, §1); the Keycloak "Terms and conditions" action is not enabled (docs/DEPLOY.md) | sign-up and first run | a consent step with the policy link and a stored timestamp, or enable Keycloak's terms action with the policy text; lawyer decides |
| G4 | No retention limits for the access log, invites, soft-deleted records, anonymized users; logs and backups undefined | DB, ops | decide periods, add purge jobs |
| G5 | Keycloak account not deleted in production (`AUTH_ADMIN_CLIENT_*` not in `deploy/homelab/values/api.yaml`) | deploy kit | wire the secret (owner) |
| G6 | No in-app channel to announce policy changes | web | a versioned "policy updated" notice keyed on `PRIVACY_POLICY_VERSION` |
| G7 | No public `/delete-account` page (Google Data safety asks for a deletion URL) | web | until it exists, the policy's "Your rights" anchor explains the in-app path and the contact |
| G8 | The address search text can be in proxy access logs (the API itself never logs it) | Traefik | exclude `/api/v1/address/*` from access logs or drop query strings |
| G9 | nginx access log keeps client IPs and user agents; HSTS not set | web container, Traefik | decide log format/retention; add HSTS middleware (deploy/homelab/README.md) |
| G10 | A removed doctor's notes stay; there is no way for her to export or delete them after removal | API | owner decision (docs/design/16 section 7) |
| G11 | The baby profile stores the mother's RSV vaccination (health data of another person) | `babies.rsv_maternal_vaccination` | mention it (done in the policy) |
| G12 | docs/design/09-push-notifications.md still says "design only, nothing implemented" in its header | docs | fix the status line |
| G13 | GitHub private vulnerability reporting (the default private contact) may be off | GitHub settings | enable it, or set `VITE_PRIVACY_CONTACT_EMAIL` |

## 9. Draft statements (docs/design/20-store-readiness.md section 4, before this change) that were not true

1. "Reminders pass through Apple's and Google's notification services (and your browser's), which see that a reminder
   was sent and its generic text": the built Web Push sends an **encrypted** payload of ids and codes; no push service
   sees any text (the device renders it), and the services are Google, Mozilla, Apple and Microsoft. Native APNs/FCM
   (where Apple/Google would see the text) is not built; the store apps have no push at all today.
2. "IP address, request line: reverse-proxy and API logs": the API logs neither; the web container's nginx log and
   possibly Traefik do.
3. "The legal basis is your consent when you create the account ... health data is processed with your specific
   consent": no consent step exists anywhere (G3).
4. "We tell you in the app before a material change": no such mechanism exists (G6).
5. "Security: ... backups [describe]": there is no backup routine, only manual `pg_dump` copies before migration
   deploys.
6. Data inventory "processors are the owner's own server and, for push, Apple and Google": incomplete: Mozilla and
   Microsoft (push), BrasilAPI, ViaCEP and Nominatim (address search) and Amazon (Alexa, which receives answers with the
   baby's data) were missing.
7. Apple App Privacy "Device ID (the push token)" and Google Data safety "Device or other IDs (push token)": the native
   apps collect no push token (no native push).
8. docs/ALEXA.md "Amazon processes the voice and Lotties receives only the intent and its values": true for the
   request, but the answer sent back to Amazon carries the baby's name and log facts.
9. "The sign-in account at Keycloak is deleted too": only with the service account, which production does not have
   (G5).

## 10. Keeping this current

`CLAUDE.md` now says: any change that adds a data flow or a third party updates `code/web/src/legal/` (content and
`dataFlows.ts`) and this audit. `code/web/src/legal/dataFlows.test.ts` fails when a curated credit
(`code/web/src/credits/curated.json`) has no privacy classification, when a classified recipient has no row in the
policy's sharing table, or when the two languages' tables differ.
