# End-to-end smoke tests

Playwright suite in `tests/e2e/` (Chromium only, one worker). It drives the real SPA against the real API and PostgreSQL database, and signs in through the real Keycloak login page. There is no mocking of auth or of the server (one spec hides the baby list from the first sync to reach the "create the first baby" screen).

## Run

```
npm --prefix tests/e2e install
(cd tests/e2e && npx playwright install chromium)      # once
(cd tests/e2e && npx playwright test)
```

Playwright starts both servers itself (`webServer`) and reuses them when they already answer (locally only):

| Server | Command | URL |
| --- | --- | --- |
| API | `dotnet run --project code/api/src/Lotties.Api --no-launch-profile` | `http://localhost:5290/health` |
| Web | `npm --prefix code/web run dev -- --port 5173 --strictPort` | `http://localhost:5173` |

The API port is 5290 (override with `E2E_API_URL`): 5000 and 5080 are commonly taken by other local services, and a foreign server answering on the port would be silently reused. The API runs with `RequestLimits__PermitsPerMinute=6000` because the suite polls the API while the app syncs and would otherwise hit the default 300 requests/minute per user (HTTP 429).

## Required environment

Read from the gitignored root `.env` (never printed; only the variables below are loaded, see `tests/e2e/support/loadEnv.ts`) or from the process environment, which wins:

| Variable | Used for |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD` | API database (schema already migrated, app role has DML grants) |
| `AUTH_AUTHORITY`, `AUTH_AUDIENCE` | API token validation |
| `CORS_ALLOWED_ORIGINS` | must include `http://localhost:5173` |
| `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_AUDIENCE` | SPA login (public PKCE client) |
| `E2E_USERNAME`, `E2E_PASSWORD` | Keycloak test user |

The loader is not `dotenv`: `dotenv` treats an unquoted `#` in a value as a comment and silently truncates passwords. Like docker compose, `#` only starts a comment after whitespace.

## How it works

- `setup` project (`tests/auth.setup.ts`) logs in on Keycloak (`#username`, `#password`, `#kc-login`, tolerating first-login screens) and saves `tests/e2e/.auth/user.json`. The app keeps the OIDC user in localStorage, so that file is the whole session; the per-account IndexedDB is recreated from the server on first load.
- Every other spec reuses that storage state. Specs that log in or out themselves (`login-redirect.spec.ts`, `logout.spec.ts`) start without it, use their own Keycloak session and run with tracing off (traces record typed values such as the password).
- Each spec creates its own baby through the API (`support/app.ts`, `createAndOpenBaby`) and selects it via the app's `baby-routine.selected-baby` localStorage key, so specs are independent. The create-a-baby-through-the-UI spec is the exception.
- Server state is asserted with `expect.poll` against `GET /api/v1/babies/{id}/events` using the access token from localStorage. No fixed sleeps.
- No `data-testid` attributes are needed: selectors are roles, labels and accessible names.

## What is covered

| Spec | Covers |
| --- | --- |
| `auth.spec.ts`, `login-redirect.spec.ts` | signed-in user lands on Home; signed out, a protected route redirects to `/login` and the Keycloak login returns to the requested route |
| `baby.spec.ts` | create a baby via the UI (owner, birth date in the API), baby switcher with two babies |
| `timer.spec.ts` | quick action: start and stop a feeding timer, Timeline row with duration, server event stopped |
| `event-sheet.spec.ts` | instant diaper event: required field validation, edit, soft delete (`deletedAt` on the server) |
| `medication.spec.ts` | medication added in Settings, logged from the checklist, shown in the Timeline summary and in the server payload |
| `custom-type.spec.ts` | custom event type with a text field, quick action on Home, logged event payload |
| `offline.spec.ts` | event logged offline shows locally with the "Not synced yet" badge and an Offline chip, then syncs; timer started and stopped offline; timer started online then stopped offline (offline-edit regression) |
| `logout.spec.ts` | logout with unsynced changes shows the warning dialog; after logout and a new login the data is pulled back |
| `invite.spec.ts` | owner creates an invite link of the form `/invite#<token>` (not accepted; revoked afterwards) |
| `predictions.spec.ts` | predictions section renders without error for a baby without history |

## Demo (manual smoke, no spec yet)

The try-it demo (docs/design/45-try-it-demo.md) needs `Demo__SigningKey` on the API under test, so it is not in the default suite. Smoke test against a deployment that has it: signed out, open `/`, press "Try the demo" (the button shows only when `GET /api/v1/demo` says `enabled`), check the Now screen has about a week of events and the banner "Demo - the data is deleted in 3 days", log a feeding, open Insights and Vaccines, then "Create my real account" (lands on the identity provider's sign-up; the demo data is not carried over). A Playwright spec can start a demo with `POST /api/v1/demo/start` and seed `localStorage` key `lotties.demo.session`.

## Test data

There is no baby delete API, so every run leaves `E2E-<label>-<timestamp>` babies (and their events, medications, custom types) in the database. Use the `E2E-` prefix to find them. Nothing in Keycloak or other databases is touched.

## Mobile overflow audit (before releases)

A separate, credential-free Playwright run (no API, no Keycloak, no `.env`) that loads every developer-only `/dev/*` preview scenario and `/credits` on a touch phone at 320, 360, 390 and 430 px, in English and Portuguese, light and dark, with the root text at 100 % and 160 %. It fails (non-zero exit) on horizontal overflow, a visible sideways scrollbar, nested page scrollers, a control left under the bottom dock, a `vh` height, a text field under 16 px (iOS focus zoom) or a viewport meta that caps zoom. Method and findings: `docs/design/30-mobile-overflow-audit.md`.

```
(cd tests/e2e && npx playwright test -c design-review/overflow-audit.config.ts)
# narrower: AUDIT_ROUTES=hub,now AUDIT_WIDTHS=320 AUDIT_LOCALES=en AUDIT_SCHEMES=dark AUDIT_TEXT=160
```

It starts its own Vite dev server on port 5191 (`AUDIT_PORT`), runs 3 workers (`AUDIT_WORKERS`) and takes about 12-15 minutes for the full matrix. The report is `tests/e2e/design-review/output/overflow-audit.md` (gitignored), with the raw findings per group in `output/overflow-audit/*.json`.

## Showcase media

Screenshots and the demo video of the landing page and README come from a separate credential-free run, `tests/e2e/showcase` (docs/showcase-media.md); like the mobile audit it needs no API, Keycloak or `.env`.

## CI

`.github/workflows/e2e.yml` is manual (`workflow_dispatch`) because it needs secrets: `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_NAME`, `E2E_DB_APP_USER`, `E2E_DB_APP_PASSWORD`, `E2E_AUTH_AUTHORITY`, `E2E_AUTH_AUDIENCE`, `E2E_OIDC_CLIENT_ID`, `E2E_USERNAME`, `E2E_PASSWORD`. The database host must be reachable from GitHub-hosted runners. On CI there is one retry and a trace on the first retry (never for the login specs); the report is uploaded when the run fails.
