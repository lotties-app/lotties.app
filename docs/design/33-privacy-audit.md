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
| API container (`lotties-api`, .NET 10) | no local storage | logs to stdout (below); keeps rate-limit counters and the address-lookup answer cache in memory only; Napper and backup uploads are read in memory, never written to disk (no `File.*` or temp-file use in `code/api/src`) |
| PostgreSQL (external to the cluster) | every server-side record | location `OWNER TO CONFIRM`; encryption at rest `OWNER TO CONFIRM` (nothing in the repo); the API connects with a role limited to `SELECT, INSERT, UPDATE, DELETE` (docs/DEPLOY.md "Database roles") |
| Keycloak (realm `lotties.app`, `https://auth.lotties.app`) | sign-in accounts | runs in the same home lab cluster (its own namespace), shared with the owner's other apps (docs/DEPLOY.md "Multi-theme"); realm isolation, registration fields, email verification, OTP, brute-force protection and event logging: `OWNER TO CONFIRM` |
| Traefik (external ingress) and cert-manager | TLS termination, routing | `https://lotties.app` routes `/api` to the API and the rest to the web app; HTTP redirected to HTTPS; certificate from Let's Encrypt via DNS-01 at Cloudflare; Traefik access logs on/off and retention `OWNER TO CONFIRM`; whether Cloudflare only serves DNS or also proxies traffic `OWNER TO CONFIRM` (a proxy would see all traffic in clear text) |
| Container registry (the owner's private Harbor; `REGISTRY` in deploy/homelab/.env) | container images | no personal data |
| GitHub | source code, CI | no personal data from the app ("Report a problem" prefills four technical values, section 15); issues are public |
| The user's device | offline copy and session | section 4 |
| Backup files | `pg_dump` copies | taken by the owner before deploys that apply a migration, kept until the owner deletes them; location, encryption and any other backup (database server snapshots) `OWNER TO CONFIRM` |

Hosting: everything Lotties runs (web app, API, Keycloak) is in the owner's home lab Kubernetes cluster (k3s),
not on a cloud provider. Country and physical site: `OWNER TO CONFIRM`.

## 2. Inventory by category

Legend for "Basis" (proposed, `OWNER TO CONFIRM` with a lawyer): **Contract** = LGPD art. 7, V (performance of the
service the user asked for); **Consent-H** = art. 11, I (specific consent for sensitive/health data); **Consent** = art. 7,
I; **LI** = art. 7, IX (legitimate interest, never for sensitive data); **Legal** = art. 7, II / art. 11, II, a.

| # | Category | Data (from the code) | Purpose | Basis | Who sees it | Retention | Delete | Export |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sign-in account (Keycloak) | the registration fields of the realm (by default username, email, first and last name) and the password (Keycloak keeps a salted one-way hash; it never stores plain passwords), sessions (Keycloak records IP and user agent of each session), login events if enabled | sign-in on every device | Contract | the owner as Keycloak admin; nobody in the app | until the account is deleted | in-app deletion removes it when `AUTH_ADMIN_CLIENT_ID/SECRET` are set: the home lab kit passes them from `deploy/homelab/.env` (G5, resolved in the kit); whether the owner has created the client and set them in production `OWNER TO CONFIRM` (docs/KEYCLOAK-ACCOUNT-DELETION.md). Without them, or when Keycloak fails, the app says so before and after the deletion and the owner removes it by hand | not in the app (Keycloak account console, if enabled) |
| 2 | Lotties user row (`users`) | internal id, OIDC issuer and `sub`, display name (from `name`/`preferred_username`/`nickname`, never an email: `Domain/Users/ExternalIdentity.cs`), created time; the email claim is never read (`Api/Authentication/OidcClaims.cs`) | link records to the account; show the name to co-members | Contract | members of the user's babies see the display name | forever as an anonymized row after deletion (issuer `urn:lotties:deleted`, name "Former member", `deleted_at`) so shared babies keep their history | `DELETE /me` | no |
| 3 | Baby profile (`babies`) | name, birth date, vaccine network (`public`/`public+private`), gestational age in weeks, mother's RSV vaccination in pregnancy (`unknown/yes/no`: health data of the mother, a third person). No sex/gender field, no photo | the product, the vaccine schedule | Contract; Consent-H for the vaccine profile | every member; a Doctor sees name and birth date always, the vaccine profile only with the `vaccines` section (`Domain/Babies/SectionView`) | until the baby is erased | erased with the baby (account deletion when alone; there is no "delete baby" for a shared one) | Hub > Export data (Owner, Parent) |
| 4 | Daily records (`events`, `event_types`) | feeds (method, side, amounts prepared and drunk, formula), sleep (kind, pauses), diapers, baths, tummy time, outdoor, crying/fussy spells, milestones (custom text), nail trim, skin care, nasal suction, breast pump, free-text notes (2000), custom types and their fields, `createdBy` | the product: log, sync, summaries, predictions (computed, never stored, `Domain/Predictions`) | Contract | every member by role; Doctor with `daily_log` only, medication events only with `medications` | until deleted; a deleted entry stays as a soft-deleted row with its content (`deleted_at`) until the baby is erased; there is no purge | entry delete (soft); baby erase | Hub > Export data; Settings > Download my data (device copy) |
| 5 | Health records | medications (name, dose, notes, catalog link), prescriptions (dose rules, schedules, indication, instructions, prescriber text, doctor provenance), medication doses (as events), temperature, symptom, belly pain, spit-up, teething, measurements (weight, length, head), vaccinations (vaccine, dose, date, network, clinic, lot, administered by, notes), appointments (title, type, time, place, doctor name, notes, outcome, reminder offsets), formulas | the health log, schedules computed from what the family entered, reminders | **Consent-H** (sensitive data, art. 11; about a child, art. 14) | every member by role; Doctor per section (`daily_log`, `growth`, `medications`, `vaccines`, `formulas`), never appointments | as row 4 | as row 4 | as row 4 |
| 6 | Care providers (`care_providers`) | name, specialty, registration council/number/region, clinic, address, phone, WhatsApp, email, website, notes, favorite: **data about third persons** entered by the family | contact directory, fill appointments | LI of the family / Contract (`OWNER TO CONFIRM`) | Owner, Parent, Caregiver, Viewer (`BabyReadFamily`); never a Doctor | until the provider is deleted (soft, kept) or the baby is erased | soft delete in the app; erased with the baby by account deletion (gap G1, resolved); on a baby others keep, the ones she added stay for the family under "Former member" | Hub > Export data |
| 7 | Notes (`baby_notes`) and reads (`note_reads`) | author, kind note/recommendation, visibility shared/private, body (4000); first read time per member | doctor-family communication | Consent-H (part of the doctor sharing) | shared: every member; private: only the author (filtered in the SQL of every read, `EfNoteRepository`) | until deleted (soft) or the baby is erased; a removed doctor's notes stay | author deletes; account deletion deletes the user's private notes, keeps shared ones under "Former member" | Hub > Export data (shared notes and the exporter's private ones) |
| 8 | Prescription proposals (`prescription_proposals`) | a doctor's suggested prescription, status, decline reason (parent's words), decision | doctor suggestions | Consent-H | Owners, Parents and the author doctor only | never deleted (decided proposals are immutable) until the baby is erased; pending ones of a deleted account are deleted | baby erase | not in the export (by design) |
| 9 | Professional profile (`professional_profiles`) | display name, specialty, registration number (self-declared, `verified` false; nothing in the app checks it) | families know who their doctor is | Contract | members of the babies she follows (via notes, measurements, provenance), Owner in Members | until account deletion | account deletion (also from `/doctor/settings`) | `/doctor/settings` > Account and data > Download my data: the profile, the notes and proposals she wrote, the measurements she recorded |
| 10 | Memberships, invites, doctor scopes | role per baby, joined time, doctor sections; invites: SHA-256 of the token only (`Domain/Babies/InviteToken.cs`), role, creator, expiry, accepted by/at. **No email is stored for invites**: an invite is a link the inviter shares herself | sharing | Contract (Consent-H for a Doctor invite: the consent line names the sections, docs/design/19 section 8) | Owner manages; members list for family roles | memberships until leave/removal; invites kept (hash) also after use or expiry, until the baby is erased | leave, removal, account deletion (unaccepted invites of the user) | no |
| 11 | Doctor access log (`access_log`) | doctor user id, role, `view`, time (at most one per hour per doctor and baby; also per listed patient of `GET /doctor/patients`) | transparency to the Owner | LI / Legal (accountability) `OWNER TO CONFIRM` | Owner (newest 50) | **kept with no expiry** (gap G4) | erased with the baby | no |
| 12 | Push subscriptions (`push_subscriptions`) | Web Push endpoint (a capability URL of the browser vendor), `p256dh`/`auth` keys, locale, device label ("Chrome on Android"), created/last seen/last success, failures, revocation | reminders | Consent (device opt-in) | the user (own device list) | revoked after 90 days unseen, hard-deleted 30 days after revocation (`NotificationRules`); revoked on logout | turn off; logout; account deletion | no |
| 13 | Notification settings and preferences | IANA time zone (a hint of region), quiet hours, show-names, per-baby kinds and leads | reminders at local time | Consent | the user | until changed or account deletion; preferences cascade when leaving | account deletion | no |
| 14 | Delivery log and actions | delivery id, user, baby, kind, base key (ids), times, status, attempts, HTTP status, action token hash; snooze/dismiss rows | reliability, dedupe, snooze | LI | nobody in the app | deliveries 14 days, actions 7 days after last change (`NotificationHousekeeping`) | account deletion | no |
| 15 | Voice assistant settings (`user_assistant_settings`) | default baby id; `say_baby_name` (bool, default false: whether answers may say the baby's name, policy version 7, migration `AssistantSayBabyName`); `say_medicine_names` (bool, default false: whether answers may say the names of the family's medicines, never an amount, policy version 8, migration `AssistantSayMedicineNames`) | Alexa and MCP commands | Consent (linking) | the user | until changed or account deletion | account deletion; cleared when the baby is erased | no |
| 16 | Shared medicine catalog | products a user adds (name, form, ingredients) become instance-wide; `created_by` stored, never returned (`Application/Catalog`) | catalog | LI | every user sees the product, not who added it | kept; `created_by` cleared by account deletion | not by the user | no |
| 17 | API logs (stdout) | user id, baby id, record ids, event type id, role, doctor scopes, counts, result and error codes, invite ids, correlation ids, exception types; export/import audit lines (user, baby, counts, checksum). **No** IP address, request line, payload, names, notes, tokens, push endpoints, address search text (HTTP client logging for address lookup is `None`; `Microsoft.AspNetCore` at `Warning`, so no request logging; no `EnableSensitiveDataLogging`) | operate, debug, audit | LI | the owner (cluster access) | kubelet rotation by size unless a collector keeps them `OWNER TO CONFIRM` | not by the user | no |
| 18 | Web server and proxy logs | nginx: client IP (forwarded), time, path, status, user agent (static and page requests only: the Ingress sends `/api` to the API directly). Traefik: whatever its access log is set to, possibly the `/api` request lines with query strings (address search text) | operate, security | LI | the owner | `OWNER TO CONFIRM` | no | no |
| 19 | Backups | full `pg_dump` (everything above), taken before migration deploys and on a scheduled basis; encrypted offsite copies (e.g. Backblaze B2); UPS protects the server against power loss | recovery, resilience | LI (copies follow the bases of their data) | the owner | until the owner deletes them; deleted data may persist in them | owner | no |
| 20 | Exported files | the per-baby backup (readable JSON, unencrypted, no account ids: stand-ins) and the device JSON | portability | Contract | whoever holds the file | outside our control | user | is the export |
| 21 | Cry monitor (2026-10-24, section 12) | **on the device only**: the microphone signal while the monitor page listens, analysed in memory (AudioWorklet and a worker) and discarded at once, never recorded, stored or sent; **saved**: fussy spells with `auto_detected` (rows of category 4) and the parent's `cry_confirmed` answer; **device**: the consent (`{version, at}`) and the sensitivity | notice crying, log it, alert opted-in family members | Consent-H (specific, per device, art. 11, I and art. 14, §1) `OWNER TO CONFIRM` with the lawyer | the spells as row 4; nothing of the sound reaches anyone | spells as row 4; consent until withdrawn or sign-out | withdraw on the page; spells as row 4 | spells as row 4 |
| 22 | Measurement unit setting (`user_unit_settings`, 2026-10-25, policy 6, docs/design/37-measurement-units.md) | one text value per user (`auto`, `metric` or `us`) and the time it changed; not sensitive, no baby data | show, say (voice) and accept amounts in ml or fl oz, kg or lb, cm or in, degrees C or F; storage of every record stays metric | Contract (the service the user asked for) | the user | until changed or account deletion | account deletion (`EfAccountDataEraser`, a rule and a fixture row in `AccountErasureTests`); never in the baby backup file | no |
| 22a | Feeding settings (`user_feeding_settings`, 2026-11-01, docs/design/20-feeding-amounts.md section 3) | one boolean per user ("Time bottle feedings") and the time it changed; not sensitive, no baby data | lets the web and the voice assistants start a bottle as a timer the same way | Contract (the service the user asked for) | the user | until changed or account deletion | account deletion (`EfAccountDataEraser`, a rule and a fixture row in `AccountErasureTests`); never in the baby backup file | no |
| 23 | Consent records (`user_consents`, `user_consent_history`, 2026-10-27, policy 9, docs/design/38-consent-and-terms.md) | per person and kind (`core`, `push`, `alexa`, `mcp`): internal user id, the consent version (the pair terms version + policy version), when it was given or withdrawn, the language of the text she read and, for the core consent, the capacity she declared (the child's parent or legal guardian, or an adult they authorised); an append-only history line for each grant or withdrawal. **No IP address, no device data**; not baby data | to show that a person consented to the terms and the policy before any baby data was reached, to ask again after a material change, to keep the optional choices (reminders, Alexa, AI assistants) | Legal / Contract (proof of the consent that is the basis of the health data: art. 11, I, art. 14, §1; `OWNER TO CONFIRM`) | the person herself (`GET /me/consents`, Settings > Privacy and data); the server uses the core record to gate every baby route | until the account is deleted (a minimal proof kept after deletion is a question for the lawyer, docs/PRIVACY-LAWYER-BRIEF.md) | erased by account deletion (`EfAccountDataEraser`, rules in `AccountErasureTests`) | shown in Settings > Privacy and data; a request to the contact |
| 24 | Caregiver rest estimate (`user_rest_settings`, `user_rest_mornings`, 2026-10-30, policy 10, docs/design/41-caregiver-rest.md; **off by default for everyone**) | per person: on/off, time zone, work windows, night window, two minute values; optionally one "I am up" time per night. The **estimate is not data held**: the server computes it on request from the baby's log (rows of categories 4 and 5), returns it only to the caller and stores it nowhere. It can say when an adult works and rested, so it may be read as health-adjacent | show the person, and only her, a rough range of when she may have rested | Consent (art. 7, I; art. 11, I if read as health data) given by the person's own toggle, `OWNER TO CONFIRM` with the lawyer whether a separate explicit consent is needed (doc 41 sections 6 and 10 item 5) | the person herself only; never another member, the Owner, a Doctor, an assistant (Alexa, MCP), the backup file, the sync or a log line; no third party, nothing leaves our infrastructure | until changed, deleted by the person, or account deletion | `DELETE /me/rest-settings` (settings and every morning answer); account deletion (`EfAccountDataEraser`, rules and fixture rows in `AccountErasureTests`); never in the baby backup | no |

## 3. Third parties and requests that leave our servers

| Recipient | What leaves | Trigger | Country / transfer | Built and deployed |
| --- | --- | --- | --- | --- |
| Browser push services: Google FCM (Chrome, most Android browsers), Mozilla autopush (Firefox), Apple (Safari, Home Screen web apps), Microsoft WNS (Edge) | the endpoint (chosen by the browser), an encrypted payload (RFC 8291 `aes128gcm`: ids, kind, time, language, action token, names only with show-names) they cannot read, TTL/urgency/topic (opaque hash) headers, timing and size; the VAPID subject (the operator's contact, not user data). The text is rendered on the device from the bundled `push.*.json` | the user turns notifications on per device | the vendors' own infrastructure, mostly outside Brazil | built; deployed when the three `PUSH_VAPID_*` values are set `OWNER TO CONFIRM` |
| APNs / FCM native push | nothing | not built (docs/design/19-native-push.md is design only; the Capacitor apps have no push) | | no |
| Amazon (Alexa) | inbound: Amazon records and transcribes the voice; Lotties receives intent, slot values, locale, request ids and the account-linking token (validated like the web's tokens). **Outbound: the spoken answer**, which (policy version 7, data minimisation) carries **no baby name unless the parent turns on `sayBabyName`** (Settings > Voice assistants, off by default) **no medicine name unless the parent turns on `sayMedicineNames`** (and never an amount, dose, unit, schedule or interval), **no free text or names of people** (no appointment title, formula name, note) and **no data about a doctor or clinic** (name, clinic, location, notes, phone, address, e-mail, registration) except the **specialty code** of the next appointment ("with a pediatrician") when the typed specialty is a known one (policy version 8), and can contain what was just logged by voice (a bath, a temperature reading as a number, a symptom or milestone from a built-in list, belly pain level, "a medication dose was given", as said, never judged), the count of the family's own medicine reminders that are due and the time of the next one (always with "these are reminders of the medicines you registered in Lotties, not recommendations from Lotties"), and can contain feed/sleep times and durations, diaper counts, the next appointment's date and time (and its kind only when it is a built-in coded kind), due vaccine names (the published schedule's), and (policy version 5) answers worked out from the log by the same Domain functions the app uses: the expected next nap window, feed and diaper change (clock times), the average diapers a day over the last complete days, the average and last of the last five bottles (ml), sleep minutes and naps so far today, the last diaper, and for "why is she crying" the top likely causes (hunger, sleepy, diaper, gas) with the logged facts behind each (minutes since the last feed or diaper, awake time, usual gaps) and always the red-flag sentence. Nothing is stored by Amazon on our side, no new field is sent to anyone but the spoken text. The MCP adapter returns the same facts as JSON to the AI provider the user connects (docs/MCP.md). Amazon also holds the Keycloak tokens of the linked account (confidential client `lotties-alexa`). Not logged by the API: body, slots, tokens, Amazon user/device ids. **Echo Show night panel (design 42, 2026-11-01): reviewed, no new data flow**: the screen shows the same facts as the spoken answers (last feed / diaper times, sleep status, the expected next feed and nap as estimates), built from the same read commands, under the same name rules (no baby name unless `sayBabyName`, no medicine, no free text, no medication tile), sent to the same recipient (Amazon, to the user's own device); the policy text, `legal/dataFlows.ts` and the version are unchanged. The only difference is operational: the screen can stay on in a room for longer than a spoken answer, which the owner decides by launching it | the user enables the skill and links the account | United States (Amazon) | built; **off** (`Alexa__Enabled` is not set in the home lab kit) |
| BrasilAPI, ViaCEP (CEP), OpenStreetMap Nominatim (text) | only the CEP digits or the typed text, from the server's IP, with `User-Agent: Lotties-baby-tracker/1.0 (+repo; ContactEmail)`; never a baby, user or the client's IP | the user presses "Find address" in the provider sheet | ViaCEP and BrasilAPI are Brazilian services (hosting location not checked); Nominatim is run by the OpenStreetMap Foundation (United Kingdom) | built; on by default (`AddressLookup:Enabled` true; `ContactEmail` not set in the kit) |
| Amazon S3 (`s3.amazonaws.com/echo.api/`) | a GET of Amazon's public signing certificate | Alexa requests | | only with Alexa on |
| Google Maps, WhatsApp, phone/email apps, calendar apps, the share sheet | what the user's own tap sends: "Open in maps" = Google Maps search of the provider's address (`providers/providerModel.ts`), WhatsApp `wa.me/<digits>`, `tel:`, `mailto:`, `.ics` export, invite links and backups shared by the user | the user taps a link or shares | the chosen service | built |
| Keycloak SMTP relay (Brevo or another) | the account's email address and Keycloak's messages (verification, password reset) | Keycloak account emails | depends on the relay | **not confirmed**: only `configure-realm-smtp.sh` (generic) and docs/DEPLOY.md mention Brevo as one option `OWNER TO CONFIRM` |
| Apple App Store, Google Play | store downloads; aggregate statistics and crash reports the platforms share with developers when the user's device settings allow it | installing the native app | Apple / Google | apps not published yet |
| GitHub | nothing sent by Lotties itself; a person who opens the repository or writes an issue is under GitHub's terms (issues are public). Since policy version 11 (2026-11-03): tapping "Report a problem" (footer, Hub > About) opens the repository's bug form with four technical values in the URL query, so GitHub receives them when the page loads: app version, platform (`Web browser` / `iOS app` / `Android app`), UI language, and the route path with every segment that is not a plain route word replaced by `:id` and the invite token removed (`landing/outboundLinks.ts` `withIssueForm`, `issueScreen`; `useProblemReportUrl.ts`). No account, baby, name, record, token or query string; nothing is posted until the person submits the form (section 15) | user action | United States | built; only when `VITE_ISSUES_URL` or `VITE_REPO_URL` points at a github.com new-issue page |
| Let's Encrypt, Cloudflare (DNS) | certificate issuance (no user data); DNS | infrastructure | | Cloudflare proxying `OWNER TO CONFIRM` |
| Origin marker of assistant writes (2026-10-25, policy 5) | the event payload members `via` / `updated_via` = the adapter name (`alexa`, `mcp`), no text, id or token | marks entries made by voice or AI in the app | no new data flow: it is part of the event the user already stores and syncs; the deletion request adds `delete_requested_via` (adapter name) and `delete_requested_at` (a time) to the same event, nothing else | stored with the event | with the event | with the event |
| AI assistants through an MCP server | the tool results (text and structured JSON) of the facts the assistant asks for, to the provider of the client the user connects; since policy version 7 with **no baby name unless `sayBabyName`** and no free text or names of people (same rule as Alexa, docs/design/32-assistants.md section 7); since version 8 no doctor or clinic data but the specialty code, the logging tools take only the built-in options of each field, and there is no medication tool (a medicine name would only be in a result with `sayMedicineNames`) | the user connects a client and grants `lotties.read` (and `lotties.write`) | the provider's (for Claude: Anthropic) | built; **off** unless `Mcp__Enabled` is set (docs/MCP.md) |
| Community insights: opt-in pooled statistics (includes the bottle amount aggregate of docs/design/10 phase 2) | nothing | **not built** (section 11, docs/design/34-community-insights.md) | none planned (own servers) | no |

Analytics, telemetry, ads, crash SDKs, third-party fonts and CDNs: **none**. Evidence: no such dependency in
`code/web/package.json`, `code/mobile/package.json` or the API projects (the landing test
`LandingPage.test.tsx` "claims no tracking only while the web app has no analytics or telemetry dependency" enforces it
for the web); the web CSP (`code/web/nginx.conf`) is `default-src 'self'; script-src 'self'; font-src 'self';
img-src 'self' data:; connect-src 'self' <OIDC origin>`, and the native build has the same policy in a meta tag
(`code/web/native-csp.ts`); `index.html` loads only own files; the Fraunces font ships in the bundle
(`@fontsource-variable/fraunces`); the Keycloak theme loads only its own files (no external URL in
`code/keycloak-theme/src`). Native apps request only `android.permission.INTERNET`; the iOS `Info.plist` has no usage
description (no camera, photos, location, contacts, microphone). No photo or file of the baby is collected anywhere.
The web app asks for the microphone only for the cry monitor (section 12), when a person starts it; its model and WASM
are served by our own web container (`/models/cry/`), so no third party is contacted at run time.

## 4. On the device (web, installed PWA, native WebView)

| Storage | Keys / content | Cleared by |
| --- | --- | --- |
| IndexedDB (Dexie), one database per account (name from issuer + `sub`) | babies, event types, medications, events, prescriptions, catalog products used, latest weights, formulas, appointments, notes, proposals, note reads, vaccinations, vaccine schedules, care providers, age norms, the outbox of unsent changes, sync cursors | sign-out and account deletion (after the unsynced-changes warning, `session/endSession.ts`), leaving a baby purges it |
| `localStorage` (per account entries) | the OIDC user (`oidc-client-ts`: id, access and refresh tokens, profile claims incl. name and email), selected baby, cached predictions per baby, last used values (amounts, medication ids), pinned presets, dismissed cards, nap guidance, last seen, push opt-in record, reminder prompt time, Hub usage counts, doctor dashboard ids (recents, last section), the cry monitor consent (`lotties.cry-monitor.consent`: version and time) | sign-out (`session/deviceState.ts`); the consent also by "Withdraw consent on this device" |
| `localStorage` (device preferences) | language, theme, night view, ring view, cry monitor sensitivity (`lotties.cry-monitor.sensitivity`) | stay until site data is cleared |
| Service worker runtime cache `lotties-cry-assets-*` | the cry monitor's model and WASM (our own files, no personal data) | a new model or MediaPipe version, site data clearing |
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
  notes, proposals, access log, appointments, care providers, vaccinations, formulas, measurements, events,
  prescriptions, medications, custom event types, invites, notification actions, deliveries, preferences, members and
  the baby row; on kept babies her note reads, private notes, pending proposals, unaccepted invites, preferences and
  membership go, and what she added for the family stays under the anonymized row; then her deliveries, actions, push
  subscriptions, notification settings, professional profile, assistant settings, unit setting, feeding settings, rest settings and morning answers, consent records and history, and the `created_by` of catalog
  products she added; her consent records and their history, the user row is anonymized. Every column of the model that points at a baby or a user has a rule
  in `code/api/tests/Lotties.Api.Tests/Endpoints/AccountErasureTests.cs` (model-driven: a new one fails the test), and
  the test erases a fixture with a row in every such table (alone on a baby; Owner, Parent, Caregiver, Viewer and
  Doctor on a baby others keep). Keycloak removal with the admin service account (wired in the home lab kit; the owner
  creates the client: docs/KEYCLOAK-ACCOUNT-DELETION.md); the answer says `removed`, `not_configured` or `failed`, and
  the app tells the user before and after.
- Export: Hub > Export data (`GET /babies/{id}/export`, Owner and Parent; complete, server-built, no account ids, other
  members' private notes excluded); Settings > Account and data > Download my data (what the device holds, any role);
  for a doctor, `/doctor/settings` > Account and data > Download my data (her professional profile, the notes and
  proposals she wrote and the measurements she recorded; never the patients' records). Caregivers, Viewers and Doctors
  have no complete export of a baby (by design, docs/design/24 section 1): their access right is served by the screens
  and a request to the contact.

## 7. Children

All baby data is about a child under 12 entered by an adult (parents, people they invite, a doctor they invite). LGPD
art. 14 asks for processing in the child's best interest and, for consent, a specific and highlighted consent of at
least one parent or legal guardian (art. 14, §1). As we read it, ANPD's Enunciado CD/ANPD nº 1/2023 allows children's
data to be processed under the bases of art. 7 or art. 11 when the best interest prevails (lawyer to confirm). The app
does not check that the person who creates a baby is its parent or guardian, and asks no age of account holders.

## 8. Gaps found

| # | Gap | Where | Suggested fix (not done here: no API change in this task) |
| --- | --- | --- | --- |
| G1 | **Resolved** (branch commits `1fd2fe3` test, `e64abdd` fix). Confirmed real: the model-driven test `AccountErasureTests.Delete_AloneOnABabyWithARowInEveryTable_ErasesEverything` failed with `SQLite Error 19: 'FOREIGN KEY constraint failed'` (500) on `DELETE /me` for a user alone on a baby with a care provider; the eraser now deletes `care_providers` of erased babies and clears `products.created_by`. The other tables were already covered | `EfAccountDataEraser` | done; the rules table in `AccountErasureTests` keeps it complete |
| G2 | **Resolved** (branch commit `64cb824`): `/doctor/settings` has "Account and data" (`DeleteAccountSection variant="professional"`: the same preview and confirmation; the download holds only her own data; the privacy link stays in `/doctor`) | `doctor/PatientPages.tsx` `DoctorSettingsPage`, `account/exportProfessionalData.ts` | done |
| G3 | **Closed in the repository** (2026-10-27, docs/design/38-consent-and-terms.md): every person consents for herself on a screen before any baby data (the terms of use, the privacy policy, a declaration of being the child's parent or guardian or an adult they authorised); the record (user id, version, time, language, capacity; no IP) is kept in `user_consents` and `user_consent_history`; the API refuses every baby route with `403 consent_required` until it exists; reminders, Alexa and MCP wait for it too. **Still the lawyer's**: whether the texts and the "authorised adult" declaration are enough (docs/PRIVACY-LAWYER-BRIEF.md items 9 to 14); the Keycloak "Terms and conditions" action stays off | sign-up and first run | done; the lawyer reviews the texts |
| G4 | No retention limits for the access log, invites, soft-deleted records, anonymized users; logs and backups undefined | DB, ops | decide periods, add purge jobs |
| G5 | **Resolved in the repository** (branch commits `4f22b5c` API, `3ab18ca` kit, `64cb824` web): the kit passes `AUTH_ADMIN_CLIENT_ID/SECRET` from `deploy/homelab/.env` into the Secret (both or none, checked by `deploy.sh` and at API start); `DELETE /me` answers `identity` `removed`/`not_configured`/`failed` and the preview `identityRemovable`, and the app says plainly before and after whether the sign-in account stays. **Owner still to do**: create the Keycloak client and set the two values (docs/KEYCLOAK-ACCOUNT-DELETION.md); until then production keeps the sign-in account and says so | Keycloak, `deploy/homelab/.env` | owner |
| G6 | **Closed in the repository** (2026-10-27): `consentVersions.json` lists every version of the terms and the policy as material or minor; a material change shows the consent screen again, a minor one a dismissible "policy updated" notice with a link (`PolicyUpdatedNotice`; dismissing stores the version seen on the device, per account) | web | done |
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
   consent": no consent step existed anywhere (G3, closed 2026-10-27 by the consent screen).
4. "We tell you in the app before a material change": no such mechanism existed (G6, closed 2026-10-27 by the consent
   versions, the consent screen and the notice).
5. "Security: ... backups [describe]": there is no backup routine, only manual `pg_dump` copies before migration
   deploys.
6. Data inventory "processors are the owner's own server and, for push, Apple and Google": incomplete: Mozilla and
   Microsoft (push), BrasilAPI, ViaCEP and Nominatim (address search) and Amazon (Alexa, which receives answers with the
   baby's data) were missing.
7. Apple App Privacy "Device ID (the push token)" and Google Data safety "Device or other IDs (push token)": the native
   apps collect no push token (no native push).
8. docs/ALEXA.md "Amazon processes the voice and Lotties receives only the intent and its values": true for the
   request, but the answer sent back to Amazon carries log facts (since policy version 7 the baby's name only when the
   parent turns on `sayBabyName`; never free text typed by people; since version 8 also no medicine name unless `sayMedicineNames`, no amount or dose ever, and no doctor or clinic data but a coded specialty).
9. "The sign-in account at Keycloak is deleted too": only with the service account, which production does not have
   (G5). The app's own "sign-in account ... deleted too" line in the deletion dialog was also unconditional; it now
   follows `identityRemovable`, and the policy says the app tells before the confirmation.

## 10. Keeping this current

`CLAUDE.md` now says: any change that adds a data flow or a third party updates `code/web/src/legal/` (content and
`dataFlows.ts`) and this audit. `code/web/src/legal/dataFlows.test.ts` fails when a curated credit
(`code/web/src/credits/curated.json`) has no privacy classification, when a classified recipient has no row in the
policy's sharing table, or when the two languages' tables differ.

## 10a. Internal project board (built 2026-10-24, off by default)

`/api/v1/board` (docs/design/36-project-board.md) is the owner's and the AI assistant's project tracker, not a feature
for families, so it is not in the public policy: it collects nothing from app users.

- **No baby data**: no table or route references a baby, a family or a record of the app; it is never shown in the app's
  shell, sync, exports or assistants. Items are project text (tasks, gaps, decisions, notes) written by the operator and
  the assistant.
- **Personal data**: only the author's `users` row id (which holds the Keycloak `sub`) and display name snapshot on
  items, history entries and API keys. No email, no IP address (API keys keep a last-use time and a counter only), no
  third party, no new outbound request.
- **Who sees it**: Keycloak users with one of the realm roles `lotties-board-reader`/`-writer`/`-admin` (assigned by the
  owner by hand, never by default) and holders of a board API key an admin created (only its SHA-256 is stored). The
  owner as operator, like every table.
- **Retention**: until the owner decides (soft-deleted items and revoked keys stay; no purge job; covered by G4). Lives
  in the same database and `pg_dump` backups; `GET /board/export` is a JSON copy without key material.
- **Deletion**: account deletion keeps the rows (they are the project's), clears the user links and replaces the name
  snapshots with "Former member" (`EfAccountDataEraser`; `AccountErasureTests.Rules` rule `Clear` for the three columns).

## 11. Planned flow: community insights (not built, 2026-10-23)

Status: **planned, not built, off everywhere.** No code collects, reads or publishes anything for it: there is no
consent table, no aggregation job, no statistics endpoint, no flag (checked: no code in `code/api` or `code/web`
combines records of different babies; the other `community`/`pooled` hits are the medicine catalog's
user-added products, row 16, and database connection pooling). The policy describes it in its own section
"Community insights (optional, not active yet)" / "Comparações com outros bebês (opcional, ainda não ativo)"
(`#privacy-community-insights`), so that families know before it exists; it is **not** a row of "What we collect"
(nothing is collected) but a separate `planned` table (caption "Planned, not collected today"). `dataFlows.ts`
`PLANNED_FLOWS` pins it (status `planned`, trigger `optIn`, off by default, consent by Owner or Parent only, no
recipients, minimum group size 20), and `dataFlows.test.ts` fails if the section loses its "not active yet" / "off
for everyone" wording while the flow is planned, if its planned table rows differ from the flow, or if it appears as
a data category.

What the text promises for the future, all to be true before activation (design: docs/design/34-community-insights.md):

| Promise in the policy | Design that delivers it (34) |
| --- | --- |
| a separate opt-in screen, never bundled; per baby; Owner or a Parent who confirms being parent or guardian; Caregiver, Viewer, Doctor cannot | section 3.1, 3.5 |
| a record of who, which baby, when, which text version | section 3.2 (`community_consents`) |
| legal basis art. 11, I and art. 14, §1 | section 8 |
| inputs: age in weeks, amounts, durations, counts, growth measurements, crying outcome and part of day; never names, birth dates, exact times, notes, photos, locations, providers, medicines, vaccines, symptoms, temperatures | section 4 |
| aggregates only, no copy of records, own servers, no recipient | section 5 (no staging table, in-memory) |
| at least 20 babies of different families per statistic; small groups left out | section 5 (k, dominance, suppression) |
| per-family weight limit, capped extremes | section 5 (per-baby cap, clipping, per-baby summaries) |
| fixed statistics, no queries; optional noise (differential privacy) | sections 5, 6 (static file, no query endpoint; O2) |
| no sale, ads, profiling or decisions | section 1 non-goals |
| open code, published list of statistics | sections 4 (catalog), 7 |
| anonymity strong but not absolute; RIPD before activation | section 8 (art. 12 analysis, RIPD outline) |
| results only as in-app comparisons; doctors' access unchanged | sections 3.4, 6 |
| withdrawal: next calculation excludes the baby; computed aggregates cannot be separated and are replaced; records never shared | section 3.3 |
| section updated, version raised and an in-app notice before activation | section 12; needs gap G6 (no in-app notice exists yet) |

Activation is a policy change of its own (docs/design/34 task T9): the section is rewritten from "not active yet" to
the final text, the flow gets status `active` and a data category row, `PRIVACY_POLICY_VERSION` is raised, this
section and docs/design/20 section 3 are updated, and the tests are changed on purpose.

## 12. On-device flow: the cry monitor (built, web only, 2026-10-24)

Status: **built, opt-in, web app only** (docs/design/35-cry-engine.md section 8). Policy version 3 of 2026-10-24
describes it; `dataFlows.ts` `ON_DEVICE_FLOWS` pins it (opt-in, off by default, Owner/Parent/Caregiver, raw signal
`{stored: false, sent: false}`, model from our own server, recipient `pushServices`, data row `cryMonitor`, web only)
and `dataFlows.test.ts` fails when either language stops saying it or still says the app never asks for the
microphone.

| Fact | Where in the code |
| --- | --- |
| The microphone is asked only when a person presses "Start monitoring" on `/hub/cry-monitor`, after a separate per-device consent (two checkboxes, versioned, stored as `{version, at}` in localStorage, cleared at sign-out, withdrawable on the page) | `cryMonitor/useCryMonitor.ts`, `cryMonitor/monitorStorage.ts`, `session/deviceState.ts` |
| Roles: Owner, Parent, Caregiver of the selected baby; never Viewer or Doctor; not in the native shell | `hub/hubEntries.ts`, `cryMonitor/CryMonitorPage.tsx` |
| Processing off (`echoCancellation`, `noiseSuppression`, `autoGainControl` false), mono, resampled to 16 kHz in an AudioWorklet; 0.975 s frames go to a worker and come back for reuse; only a score and a time reach the page; nothing is written to storage or the network | `cry/capture.ts`, `cry/captureWorklet.ts`, `cry/classifier.worker.ts`, `cry/engine.ts` |
| Model and WASM are same-origin (`/models/cry/`), runtime-cached by the service worker; no CDN, no third party at run time; CSP `script-src 'self' 'wasm-unsafe-eval'`, `Permissions-Policy: microphone=(self)` | `cry/modelAssets.ts`, `pwa/sw/cryAssets.ts`, `code/web/nginx.conf` |
| Saved: a running `fussy` event with `auto_detected: true` from the cry's start to its end, through the normal outbox (server author = the signed-in member); the parent's `cry_confirmed` answer | `cryMonitor/autoSpells.ts` |
| Leaving the page, `pagehide`, Stop, a stall or a lost microphone stop capture and the worker | `cryMonitor/useCryMonitor.ts`, `cry/engine.ts` |
| The alert to the family is the existing `cry_detected` Web Push (encrypted codes only, docs/design/09 section 2.12); the monitor device closes its own copy by tag | `cryMonitor/monitorNotifications.ts` |

Points for the owner and the lawyer (docs/PRIVACY-OWNER-CHECKLIST.md): the consent text and its legal basis (art. 11,
I and art. 14, §1, LGPD; a child's sound is processed even though never stored), the ECA Digital (Lei 15.211/2025)
read, the people in the room (the page and the policy ask the parent to tell them), and the retention of auto spells
(ordinary records, no separate period). Store labels: the audio is processed only on the device and never sent, which
Apple's App Privacy and Google's Data safety do not count as collected (docs/design/31 section 6); the native apps do
not offer the monitor today.

## 13. Consent and the terms of use (built 2026-10-27, docs/design/38-consent-and-terms.md)

- **What is recorded** (inventory row 23): user id, kind, version, time, language, declared capacity. No IP address. Kept
  until the account is deleted.
- **Gate**: the API group is behind one middleware (`ConsentGateMiddleware`); a route is gated unless it carries
  `AllowWithoutConsent(reason)` and is listed in `ConsentGateCoverageTests.Exempt`. Exempt: `/me/*` (profile, deletion,
  settings, consents), the version and health probes, reference data (catalog, vaccine schedule, age norms), the address
  proxy, the public push key and switching a device off, the Alexa and MCP endpoints (their command layer answers a person
  without consent), and the project board. Everything about a baby, the doctor's patients, export and import, invites,
  push settings, reminders and sync is gated.
- **Reminders**: `NotificationClaimer` skips a person without a current core consent (a reminder carries a baby's data).
- **Alexa and MCP**: `AssistantSubjects` answers `consent_required` before reading anything.
- **Withdrawal**: the core consent is withdrawn by exporting and deleting the account (Settings > Privacy and data
  explains it and leads there); an optional one by turning the feature off, which is recorded.
- **On the device**: the last accepted version, the notice seen and optional changes not yet sent (`consentStorage.ts`),
  cleared with the account's other device state.
- **Policy**: the privacy policy (version 9) has a "Your consent and the terms of use" section and a data row; the terms
  of use are public at `/terms` (version 1).

## 14. Caregiver rest estimate (2026-10-30, policy 10, docs/design/41-caregiver-rest.md)

- **What is stored** (inventory row 24): the person's own settings (`user_rest_settings`) and optional morning answers
  (`user_rest_mornings`). Not stored: the estimate, which is recomputed on each request from the baby's log.
- **Who sees it**: only the person. Not another member, the Owner, a Doctor, an assistant, the sync, the export or the
  backup file; the work windows and the estimate never appear in a log line.
- **Default and consent**: off for everyone; each person turns it on for herself. The policy lists it as an optional
  feature with its own legal-basis line, retention line and withdrawal path (turn it off, delete its data, or delete the
  account). The feature stays off for everyone until the owner settles the lawyer question on a separate consent.
- **Third parties**: none. **Consent version**: a `minor` entry (`2026-10-30.1`, policy 10): the feature is off, opt-in
  and adds no recipient, so the policy change is a notice, not a new acceptance for everyone; the owner may promote it
  to material after the lawyer answers (a later entry, never an edit).

## 15. "Report a problem" prefills the GitHub bug form (2026-11-03, policy 11)

- **What leaves the device**: when `VITE_ISSUES_URL` or `VITE_REPO_URL` points at a github.com new-issue page, the
  "Report a problem" link (landing footer, Hub > About) opens `.../issues/new?template=bug.yml` with four values in the
  query: the app version, the platform (`Web browser`, `iOS app`, `Android app`), the UI language and the route path with
  every segment that is not a plain route word (a UUID, a number, a token) replaced by `:id`, the segment after `invite`
  always replaced, no query or hash (`landing/outboundLinks.ts` `withIssueForm` and `issueScreen`,
  `landing/useProblemReportUrl.ts`). No account, baby, name, record or token.
- **Who receives it**: GitHub, only when the person taps the link: her browser loads the page, so GitHub sees the four
  values in the address (and, under its own terms, what any page visit carries). Lotties sends nothing itself. Nothing is
  posted until she submits the form; an issue is public. Other addresses (`VITE_ISSUES_URL` not on GitHub) are opened
  untouched; the `mailto:` fallback carries the subject and the app version in an email she sends herself (the
  `userLinks` row).
- **Policy**: the GitHub row of "Companies and services that receive data" said "Nothing from the app"; version 11
  names the four values and the trigger, in both languages. `legal/dataFlows.ts` keeps `github` as `userAction`, abroad.
- **Consent version**: a `minor` entry (`2026-11-03.1`, policy 11). Under the material rule of
  `Lotties.Domain.Consents.ConsentVersions` (new data collected, a new recipient or purpose, a change in rights or in who
  is responsible) this is none of those: GitHub was already a listed recipient for a person's own action, the four values
  are technical and not personal data, and the flow happens only on her tap. People who accepted an earlier version see
  the dismissible "policy updated" notice once; nobody is asked to accept again. The owner may promote it to material
  (a later entry, never an edit).

## 13. Try-it demo accounts (docs/design/45-try-it-demo.md, 2026-11-06)

Decision: **no policy change.** A demo account is created by the visitor's tap, holds a random account id (issuer `urn:lotties:demo`),
a throwaway baby and synthetic events generated by the server, and is deleted automatically after `Demo:LifetimeDays` (default 3)
through the account-erasure path. It stores nothing about a person: no name, e-mail, device, locale beyond `en`/`pt-BR` on its consent
row, and no address (the remote address is only the in-memory key of the rate limiter, as on every anonymous route). No third
party is called (address lookup, push, assistants and export are blocked for demo accounts), so there is no new data category, no
new recipient and no new sensor. The policy text, `legal/dataFlows.ts` and the consent versions stay as they are; if a later change
makes the demo collect anything about the visitor (an e-mail for follow-up, analytics), it is a policy change first. The demo core
consent is recorded with capacity `demo` (never `guardian`); the visitor is told on the landing button that continuing accepts the
terms and the privacy policy and that no real data should be typed.
