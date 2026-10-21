# End-to-end smoke tests

Playwright suite in `e2e/` (Chromium only, one worker). It drives the real SPA against the real API and PostgreSQL database, and signs in through the real Keycloak login page. There is no mocking of auth or of the server (one spec hides the baby list from the first sync to reach the "create the first baby" screen).

## Run

```
npm --prefix e2e install
(cd e2e && npx playwright install chromium)      # once
(cd e2e && npx playwright test)
```

Playwright starts both servers itself (`webServer`) and reuses them when they already answer (locally only):

| Server | Command | URL |
| --- | --- | --- |
| API | `dotnet run --project api/src/BabyRoutine.Api --no-launch-profile` | `http://localhost:5290/health` |
| Web | `npm --prefix web run dev -- --port 5173 --strictPort` | `http://localhost:5173` |

The API port is 5290 (override with `E2E_API_URL`): 5000 and 5080 are commonly taken by other local services, and a foreign server answering on the port would be silently reused. The API runs with `RequestLimits__PermitsPerMinute=6000` because the suite polls the API while the app syncs and would otherwise hit the default 300 requests/minute per user (HTTP 429).

## Required environment

Read from the gitignored root `.env` (never printed; only the variables below are loaded, see `e2e/support/loadEnv.ts`) or from the process environment, which wins:

| Variable | Used for |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD` | API database (schema already migrated, app role has DML grants) |
| `AUTH_AUTHORITY`, `AUTH_AUDIENCE` | API token validation |
| `CORS_ALLOWED_ORIGINS` | must include `http://localhost:5173` |
| `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_AUDIENCE` | SPA login (public PKCE client) |
| `E2E_USERNAME`, `E2E_PASSWORD` | Keycloak test user |

The loader is not `dotenv`: `dotenv` treats an unquoted `#` in a value as a comment and silently truncates passwords. Like docker compose, `#` only starts a comment after whitespace.

## How it works

- `setup` project (`tests/auth.setup.ts`) logs in on Keycloak (`#username`, `#password`, `#kc-login`, tolerating first-login screens) and saves `e2e/.auth/user.json`. The app keeps the OIDC user in localStorage, so that file is the whole session; the per-account IndexedDB is recreated from the server on first load.
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

## Test data

There is no baby delete API, so every run leaves `E2E-<label>-<timestamp>` babies (and their events, medications, custom types) in the database. Use the `E2E-` prefix to find them. Nothing in Keycloak or other databases is touched.

## CI

`.github/workflows/e2e.yml` is manual (`workflow_dispatch`) because it needs secrets: `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_NAME`, `E2E_DB_APP_USER`, `E2E_DB_APP_PASSWORD`, `E2E_AUTH_AUTHORITY`, `E2E_AUTH_AUDIENCE`, `E2E_OIDC_CLIENT_ID`, `E2E_USERNAME`, `E2E_PASSWORD`. The database host must be reachable from GitHub-hosted runners. On CI there is one retry and a trace on the first retry (never for the login specs); the report is uploaded when the run fails.
