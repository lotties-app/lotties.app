# Plan

Tiers: Light=Haiku, Medium=Sonnet, Careful/Heavy=Opus per user model policy (never Fable). Briefs reference `docs/SPEC.md`.

| # | Task | Tier | Deps | Verify |
|---|------|------|------|--------|
| 1 | Scaffold: `api/` solution (Domain, Application, Infrastructure, Api, test projects), `web/` Vite React TS MUI PWA shell, docker-compose, LICENSE AGPL-3.0, README, CONTRIBUTING, CI workflow, lint/format | Light (done) | — | `dotnet build`, `npm run build`, `docker compose config` |
| 2 | API domain + EF Core model + migrations (User, Baby, BabyMember, Invite, EventType, Event, Medication), built-in type seeds | Careful (done; DB grants for app/readonly users pending) | 1 | migration applies on Testcontainers Postgres; unit tests |
| 3 | OIDC JWT auth + membership authorization policies | Careful | 2 | integration tests: 401/403/200 |
| 4 | Babies, members, invites endpoints | Medium | 3 | integration tests |
| 5 | Event types + medications endpoints | Medium | 3 | integration tests |
| 6 | Events endpoints: idempotent upsert, delta pull, soft delete | Careful | 3 | integration tests incl. retry idempotency |
| 7 | Predictions engine (pure Domain) + endpoint | Careful | 2 | unit tests on fixtures |
| 8 | Web: OIDC login, app shell, routing, API client, theme | Medium | 1 | build, tests |
| 9 | Web: Dexie store + sync engine (queue, delta pull) | Careful | 8 | tests with fake API, offline simulation |
| 10 | Web: home screen (quick actions, running timers), add/edit sheet, medication checklist | Medium | 9, 5 | component tests, manual preview |
| 11 | Web: timeline + filters | Medium | 9 | tests |
| 12 | Web: settings (custom event types, medications, members/invites) | Medium | 8, 4, 5 | tests |
| 13 | Web: predictions cards | Light | 7, 10 | tests |
| 14 | PWA polish: manifest, icons, service worker, install prompt | Light | 8 | Lighthouse PWA check |
| 15 | End-to-end smoke (Playwright) on docker-compose + docs | Medium | all | CI green |

| 16 | Measurements: `Measurement` entity + migration + endpoints; web list/chart | Medium | 2, 8 | tests |
| 17 | Napper CSV importer (API service + web upload + medication mapping step), synthetic fixtures | Careful | 5, 6, 16 | tests on fixtures incl. idempotent re-import |

Parallel groups after 1: {2→3→(4,5,6,7)} and {8} run in parallel; 9 after 8; 10-14 after their deps.
