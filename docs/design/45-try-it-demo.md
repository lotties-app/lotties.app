# 45 - Try it: a demo account for visitors

Status: implemented (branch `claude/try-it-demo-2d7ade`, not deployed). Owner decision: a **real server** demo account, not a
local-only demo. A visitor who does not know the app opens a sandbox with one click, no sign-up, and uses the real
app (logging, Now, predictions, insights, vaccines) on a baby with about a week of believable sample events. The
sandbox is deleted automatically after a few days.

## 1. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| 1 | The API mints a **demo token**: an HS256 JWT, issuer `urn:lotties:demo`, audience `lotties-demo`, `sub` = random id, `exp` = the account's expiry. Signed with `Demo:SigningKey` (a deployment secret, >= 32 bytes; demo is **off** while it is blank). | No human login, no identity-provider account, nothing in Keycloak. The OIDC scheme stays generic: the demo token is validated by a second JWT bearer scheme (`Demo`); the default scheme forwards to it only when the unverified `iss` equals the demo issuer (`ForwardDefaultSelector`). Everything else (`sub` required, `MapInboundClaims=false`) is shared. A real token can never claim the demo issuer: the real scheme validates against `Auth:Authority`. |
| 2 | `users.issuer = 'urn:lotties:demo'` **is** the demo marker (`User.IsDemo`), plus a new nullable column `users.demo_expires_at`. | The issuer already exists on every row, is unique together with `sub`, and every code path holds a `User`. The column makes the cleanup a plain indexed query and lets the lifetime config change without orphaning old accounts. One migration: `TryItDemo`. |
| 3 | `POST /api/v1/demo/start` (anonymous, exempt from the consent gate) creates the account, the baby and the sample data and returns `{ accessToken, expiresAt, lifetimeDays, babyId }`. `GET /api/v1/demo` (anonymous, exempt) returns `{ enabled, lifetimeDays }` so the landing page shows the button only when it works. | One request, no polling. The route is anonymous by nature. |
| 4 | Abuse plan, no captcha: (a) rate limit `demo-start` per remote address (default 3 per hour, `Demo:StartPermitsPerHour`; the address is only the limiter's in-memory key, never stored); (b) a **global cap** on live demo accounts (`Demo:MaxLiveAccounts`, default 200): over it `503 demo_capacity` ("try again later"); (c) each demo is small (one baby, ~7 days of events) and the normal per-user limit (300/min) applies to it; (d) the start request body is ignored except an optional `locale` (`en`\|`pt-BR`); (e) demo accounts are deleted after `Demo:LifetimeDays` (default 3) so the cap frees itself. | A captcha adds a third party (a data flow, privacy policy change) and friction. The cap bounds the worst case in rows; the per-address limit bounds a single source. Proof-of-work or a captcha can be added later behind the same route without a contract change. |
| 5 | The demo **core consent** is recorded by the server at start, with capacity `demo` (a value only the demo service writes; `PUT /me/consents/core` still accepts only `guardian`/`authorised`). The landing button's text says that continuing means accepting the terms and the privacy policy for the demo, with links, and tells the visitor not to type real data. No consent text changes, so `consentVersions.json` / `ConsentVersions` are **not** bumped. | The gate stays honest: a demo user passes it with a record that says exactly what happened, not a false "guardian" claim. Optional consents (push, Alexa, MCP) are blocked for demo accounts. |
| 6 | Sample data is generated **through the normal application services** (`IBabyService`-level create + the event service), so validators and the sync contract apply, with UUID v5 event ids derived from the demo baby id and a slot number (idempotent: running it twice yields the same ids). | Same code path as real writes; no raw inserts. |
| 7 | Cleanup: a hosted `DemoCleanupService` (every `Demo:CleanupMinutes`, default 30; first run 1 minute after start) hard-deletes every demo user with `demo_expires_at <= now` through `IAccountDataEraser.EraseAsync` (the existing path), then removes the anonymized user row. Idempotent, per-account failure isolated, logs counts only. A second API replica running the same loop is harmless (erasing is idempotent; a unique constraint race is caught). | Reuses the account-erasure rules and its test, so a future table that points at a user cannot leak into a demo. |
| 8 | The web client keeps the demo session in `localStorage` (`lotties.demo.session`: token, expiry, account id) and replaces the OIDC provider with a demo auth provider for that session. Local data is a **separate Dexie database per demo account** (account id `urn:lotties:demo\|<sub>`, hashed like any other). Leaving the demo deletes that database. | Zero change to every consumer of `useAuth`. A demo can never share a database with a real account. |
| 9 | A permanent banner "Demo - the data is deleted in N days" (with the exact time on hover/long form) and a "Create my real account" button that ends the demo (deleting the local database and forgetting the token, **not** copying demo data) and opens the identity provider's sign-up. The server account simply expires. | Demo data is fake and temporary; carrying it over would put invented events in a real baby's history. |
| 10 | Statistics: demo users are excluded by `users.issuer <> 'urn:lotties:demo'` (see section 8). | One stable, indexed column. |

## 2. What a demo cannot do

Enforced on the server by `DemoBlockedRoutes` (a list of `METHOD /route` keys read by a middleware after the consent gate;
`403 demo_not_available`; a test fails when a key matches no route), not by hiding buttons:

- invites and invite acceptance (`POST/GET/DELETE .../invites`, `POST /invites/accept`, `/invites/{token}/accept`), member removal;
- Doctor access, proposals and notes of other people (no Doctor can exist without an invite);
- push: subscriptions, settings, tests and notification preferences writes (no device can be registered, so no reminder is ever sent to a demo account);
- Alexa and MCP: linking needs an identity-provider token a demo does not have; the optional consents `alexa`, `mcp`, `push` answer `403 demo_not_available`;
- export to other people: the backup export/restore and the professional export routes; no e-mail is ever sent (the API sends none anyway);
- address lookup (`/address/*`): no third-party call may carry demo input;
- creating a second baby, importing from Napper, catalog product creation (the shared instance-wide catalog must not take visitor text);
- the cry monitor: unchanged, the microphone audio is never stored or sent (web only); the demo uses it like any account.

Allowed: everything that stays inside the demo baby: events, timers, medications of the registered kind, measurements, vaccines,
notes, formulas, appointments, predictions, insights, settings, language, units, and deleting the account early.

## 3. Identity and authentication

```
visitor --POST /api/v1/demo/start--> API
          (rate limit per address; cap on live accounts; demo enabled)
API: create User(issuer=urn:lotties:demo, sub=<random 128 bit>, demo_expires_at=now+lifetime), core consent (capacity demo),
     baby (owner = the user), sample events
API --> { accessToken (HS256, exp = demo_expires_at), expiresAt, babyId, lifetimeDays }
visitor: Authorization: Bearer <accessToken> on every request (same as an OIDC access token)
```

`Demo:*` options (section `Demo`, env `Demo__...`): `SigningKey` (secret, empty = off), `LifetimeDays` (3),
`MaxLiveAccounts` (200), `StartPermitsPerHour` (3), `CleanupMinutes` (30). `DemoOptionsValidator` fails startup for a signing key
shorter than 32 bytes or a non-positive number; a blank key only switches the feature off (`GET /demo` -> `enabled:false`,
`POST /demo/start` -> 404).

The token is **not** refreshable: it lives as long as the account. A stolen demo token opens a throwaway account with
fake data and nothing else (it fails the real scheme, and the demo scheme only ever authorizes `urn:lotties:demo`
users, which every blocked route above refuses).

## 4. Data model

- `users.demo_expires_at timestamptz null` + index `ix_users_demo_expires_at` (partial where not null on PostgreSQL;
  a plain index is fine on SQLite). `User.StartDemo(...)`, `User.IsDemo`, `User.DemoExpiresAt`.
- `AccountErasureTests.Rules`: the new column points at nothing (it is a timestamp), so it needs no rule; the test lists
  columns that reference a baby or user only. The demo flow adds **no** new table, so the erasure path is unchanged.
- Consent capacity `demo`: `ConsentCapacities` gets `Demo` (never parsed from a request).

## 5. Sample data

`DemoSampleData.Build(babyId, now, locale)` (pure, Domain/Application) returns events for the last 7 days: the baby is
about 4 months old (born 120 days ago): per day 6-8 feeds (breast with side, bottle with `amount_ml` 120-180), 4-5
sleeps (naps and a night block), 6-8 diapers (wet/dirty mix), one bath every second day, one weight/height
measurement a week ago, a registered vaccine given to the baby per the Brazilian schedule's first doses (so the
vaccine screen has done, due and upcoming items), and a few medication-free notes. Deterministic: values come from a
small seeded generator keyed by `babyId` (no `Random.Shared`), times are relative to `now`. Event ids are UUID v5 of
`(babyId, slot)`. Written through the event service as the demo user. Names: baby "Demo Baby" / "Bebê Demo".

## 6. Cleanup job

`DemoCleanupService` (hosted, Infrastructure) -> `IDemoCleanup.RunOnceAsync(now)` (Application): page through demo users
with `demo_expires_at <= now` (up to 100 per run), for each `IAccountDataEraser.EraseAsync`, then delete the anonymized
row (`IDemoAccountRepository.DeleteAsync`). Logs: "Demo cleanup removed {Count} accounts, {Failed} failed". No ids,
names or data. `Demo:CleanupMinutes` <= 0 or demo off: the loop does not start.

## 7. Web

- `auth/demo/`: `demoSession.ts` (read/write/clear the stored session, expiry check), `DemoAuthProvider.tsx` (an
  `AuthContext` value: `isAuthenticated`, `accountId`, `getAccessToken`, `renewAccessToken` = no new token, `login` = end the
  demo and sign in, `logout` = end the demo), `startDemo.ts` (`POST /demo/start`, store, full page load of `/`).
- `App.tsx` chooses the provider once at start: a valid stored demo session -> `DemoAuthProvider`, else `OidcAuthProvider`.
- `landing`: a secondary "Try the demo" button in the hero (only when `GET /demo` says `enabled`) with a one-line
  explanation and the consent sentence; strings in `locales/{en,pt-BR}/demo.json` (top-level key `demo`).
- `layout/DemoBanner.tsx` above the app content: remaining time (`formatRelative`), "Create my real account" (ends demo
  and opens `/?signup=1`, which the landing page turns into the register redirect) and "Leave the demo".
- Hub/settings hide the blocked areas for a demo user (family invites, assistants, push, export); the server is the authority.
- An expired token (401 on the demo) ends the demo locally and shows the landing page with a notice "The demo ended".

## 8. Statistics (for the dashboards repo; not edited here)

The Grafana accounts dashboard counts `users`. Exclude demo accounts with `WHERE issuer <> 'urn:lotties:demo'` (next to the
`deleted_at IS NULL` it already uses). A demo lives at most `Demo:LifetimeDays` plus the cleanup interval, so
`SELECT count(*) FROM users WHERE issuer = 'urn:lotties:demo'` is a "demo accounts now" panel, and
`SELECT count(*) FROM users WHERE issuer = 'urn:lotties:demo' AND created_at > now() - interval '1 day'` is "demo starts today".
No metric or event is added (it would be a new data flow without value). Any panel that joins `babies`, `baby_members` or
`events` to `users` should join and exclude the same issuer, because demo babies and events exist while their account lives.

## 9. Privacy

A demo stores nothing about the visitor: a random account id, fake data, no name, e-mail, device or address (the remote
address is the rate limiter's in-memory key only, the same as every anonymous route today). It adds no data category and no
third party, so the privacy policy, `legal/dataFlows.ts` and the consent texts are **unchanged** (no policy version bump, no
`consentVersions.json` entry); `docs/design/33-privacy-audit.md` records the decision (section 13). The web keeps the demo token
in `localStorage` (a throwaway credential that opens only a fake account) until the demo ends.

## 10. What the owner configures before going live

1. `Demo__SigningKey` (random, >= 32 bytes; e.g. `openssl rand -base64 48`) in the API's secret. Without it the demo stays off.
2. Optional: `Demo__LifetimeDays`, `Demo__MaxLiveAccounts`, `Demo__StartPermitsPerHour`, `Demo__CleanupMinutes`.
3. Deploy applies migration `TryItDemo` (one nullable column + index): take the usual `pg_dump` first.
4. No Keycloak change, no ingress change (the routes are under `/api/v1/demo`, already proxied). The web needs no new build variable.
5. Dashboards: add the issuer filter of section 8.
6. Smoke test (docs/E2E.md "Demo"): open `/`, press "Try the demo", log a feed, wait for the banner, "Create my real account".
