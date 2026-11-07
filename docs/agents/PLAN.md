# Plan

Tiers: Light=Haiku, Medium=Sonnet, Careful/Heavy=Opus per user model policy (never Fable). Briefs reference `docs/SPEC.md`.

| # | Task | Tier | Deps | Verify |
|---|------|------|------|--------|
| 1 | Scaffold: `code/api/` solution (Domain, Application, Infrastructure, Api, test projects), `code/web/` Vite React TS MUI PWA shell, docker-compose, LICENSE AGPL-3.0, README, CONTRIBUTING, CI workflow, lint/format | Light (done) | — | `dotnet build`, `npm run build`, `docker compose config` |
| 2 | API domain + EF Core model + migrations (User, Baby, BabyMember, Invite, EventType, Event, Medication), built-in type seeds | Careful (done; DB grants for app/readonly users pending) | 1 | migration applies on Testcontainers Postgres; unit tests |
| 3 | OIDC JWT auth + membership authorization policies | Careful (done) | 2 | integration tests: 401/403/200 |
| 4 | Babies, members, invites endpoints | Medium (done) | 3 | integration tests |
| 5 | Event types + medications endpoints | Medium (done) | 3 | integration tests |
| 6 | Events endpoints: idempotent upsert, delta pull, soft delete | Careful (done) | 3 | integration tests incl. retry idempotency |
| 7 | Predictions engine (pure Domain) + endpoint | Careful (done) | 2 | unit tests on fixtures |
| 8 | Web: OIDC login, app shell, routing, API client, theme | Medium (done) | 1 | build, tests |
| 9 | Web: Dexie store + sync engine (queue, delta pull) | Careful (done) | 8 | tests with fake API, offline simulation |
| 10 | Web: home screen (quick actions, running timers), add/edit sheet, medication checklist | Medium (done) | 9, 5 | component tests, manual preview |
| 11 | Web: timeline + filters | Medium (done) | 9 | tests |
| 12 | Web: settings (custom event types, medications, members/invites) | Medium (done) | 8, 4, 5 | tests |
| 13 | Web: predictions cards | Light (done) | 7, 10 | tests |
| 14 | PWA polish: manifest, icons, service worker, install prompt | Light (done) | 8 | Lighthouse PWA check |
| 15 | End-to-end smoke (Playwright) against local API + Keycloak + real DB (done, see docs/E2E.md) | Medium | all | 14 specs green |

| 16 | Measurements: `Measurement` entity + migration + endpoints; web list/chart | Medium (done) | 2, 8 | tests |
| 17 | Napper CSV importer (API service + web upload + medication mapping step), synthetic fixtures | Careful (done) | 5, 6, 16 | tests on fixtures incl. idempotent re-import |
| 23 | Diaper predictions (wet gap, dirty gap, lag after feeds; heuristics, see docs/ml/BENCHMARK.md) in `GET /predictions` and on Now (cards + Why sheets), opt-in heads-ups `diaper_wet_headsup` / `diaper_dirty_headsup` (3 a day per kind, 60 min apart, quiet hours), migration `DiaperHeadsUpPrefs` (not applied) | Careful (done 2026-10-22) | 7, 21 | Domain/API/web tests; docs/design/11-patterns.md section 8 |
| 38 | Consent, terms of use and the beta notice (docs/design/38-consent-and-terms.md): `user_consents` + history (migration `Consent`), `GET/PUT /me/consents`, server gate `403 consent_required` on every baby route (gated by default, exempt-routes test), Alexa/MCP/reminders wait for it, web `ConsentGate` + consent screen + `/terms` + beta line + policy-updated notice + Settings > Privacy and data, privacy policy version 9; closes audit gaps G3 and G6 | Careful (built on `feat/consent`, not deployed; the lawyer reviews the texts) | 37 | API and web tests |

Parallel groups after 1: {2→3→(4,5,6,7)} and {8} run in parallel; 9 after 8; 10-14 after their deps.

## Backlog
| # | Task | Tier | Notes |
|---|------|------|-------|
| 15 | E2E smoke (Playwright) against the stack with Keycloak (realm `baby-routine` on the owner's Keycloak) and the `baby_routine` DB | Medium | Blocked on Keycloak client + test user; migrations applied 2026-10-21; DB grants for the app role via docs/sql/grant-app-role.sql |
| 18 | Bath with OPTIONAL duration (user may add an end time, not required): quick action logs an instant bath; sheet allows adding an end time. Needs a decision on modelling (`durationMode: none/optional/required` on EventType vs allowing EndedAt on any type) | Medium | Decided by user 2026-10-21: optional |
| 19 | Upgrade to .NET 10 LTS (net8.0 EOL 2026-11-10) | Medium | REVIEW #20 |
| 20 | Issuer backfill clean-up for legacy user rows; Postgres-specific tests (xmin concurrency, jsonb) via a real database or Testcontainers on Podman | Careful | REVIEW wave-2 doubts |
| 21 | Push notifications (self-hosted Web Push, VAPID): v1 = scheduled dose due, nap window, test; co-parent activity in v1.1 | Careful/Medium per task | Spec docs/design/09-push-notifications.md: tasks N1-N12 (section 19; web N6 runs parallel to API N1-N5), owner open questions (section 20) |
| 22 | Bottle suggestions phase 2: opt-in anonymous aggregate of per-feed amounts by age-in-months bucket (server-side medians/percentiles only, k >= 20 distinct babies, consent per account, GDPR/LGPD deletion) | Careful | Owner request; phase 1 (own history + static age table) done 2026-10-21, see docs/design/10-bottle-suggestions.md |
| 46 | Privacy-first onboarding (docs/design/46): names optional with labels, birth stored as the week, doctors share per field; policy 12, consent `2026-11-06.1` | Careful | In review on branch claude/privacy-first-onboarding-3a33ba; not merged or deployed |

## UI redesign track (2026-10-21)
Order: [done] theme+shell+presets (A) -> [running] API conditional fields + breast pump -> i18n foundation (en, pt-BR) -> form rework (conditional fields, MUI X date-time picker, label clipping audit, theme toggle in account menu) -> Home + Track sheet (B) -> fix e2e selectors (6 specs currently fail on the new header) + add pt-BR smoke spec -> Insights/Timeline/Growth polish (pass 2).
Timeline redesign (DESIGN section 11) runs after the form rework and before/with Home B; see docs/DESIGN.md.
