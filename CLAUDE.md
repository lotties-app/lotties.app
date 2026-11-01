# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Baby event-tracking PWA (React + .NET 8 + Postgres), open source AGPL-3.0. Spec: `docs/SPEC.md`. Plan/status: `docs/PLAN.md`. Open review findings: `docs/REVIEW.md`. Deploy: `docs/DEPLOY.md`. Navigation: `docs/filemap.md` (update when adding/moving files).

## Stack
- Layout: application code under `code/` (`api`, `web`, `keycloak-theme`), the Playwright suite in `tests/e2e/`, the Python benchmark in `ml/`; docs, workflows, `docker-compose.yml` and the root `.env` stay at the root.
- `code/web/`: React 19 + TS + MUI, Vite SPA (no SSR), Dexie offline store.
- `code/api/`: .NET 8, layers Domain / Application / Infrastructure / Api; EF Core + Npgsql.
- Commands: `dotnet build code/api/Lotties.sln`, `dotnet test code/api/Lotties.sln`, `npm --prefix code/web run dev|build|test|lint`.
- E2E (real Keycloak + DB, needs root `.env` incl. `E2E_*`): `npm --prefix tests/e2e install`, then `cd tests/e2e && npx playwright test`; see `docs/E2E.md`.

## Conventions
- Event model is generic (typed `Event` + JSONB payload); never add a table per event kind.
- Client generates event GUIDs; writes are idempotent upserts; deletes are soft.
- Auth is generic OIDC; never hardcode Auth0 specifics outside config.
- Persistence: Entity Framework Core (Npgsql), code-first migrations only; no raw SQL schema changes, no `EnsureCreated` outside the SQLite test host. Migrations are applied with `dotnet ef database update` (default) or, opt-in, at API startup with `DB_AUTO_MIGRATE=true` (migrator role, advisory lock); see docs/DEPLOY.md "Applying migrations".
- Predictions are pure Domain functions, no I/O.
- All AI-produced docs, plans, specs, reports and graphs go in `docs/` (graphify writes to `docs/graphify`, set via `.claude/settings.json`). Only CLAUDE.md, README, LICENSE, CONTRIBUTING stay at root.
- UI text: every user-visible string goes through i18n `t()` (en + pt-BR catalogs in code/web/src/i18n/locales); dates/numbers via Intl helpers; see docs/DESIGN.md section 9. Add keys to both catalogs.
- Use skills `develop:dotnet8` (api) and `refactor:react` (web).
- Subagents: Opus plans/orchestrates, Sonnet medium-hard, Haiku simple, never Fable.
- Container runtime is Podman inside WSL (archlinux distro), not Docker: run `wsl -- podman ...` or `podman-compose`. The WSL host runs the user's OTHER containers (traefik on :80, databases, etc.): never stop, remove or prune anything not named `br-*`; use only your own names and high ports. Rootful bridge networks fail there (nftables), use `--network host`.
- Secrets live only in the gitignored root `.env` (never read, print or commit it); the API reads `DB_*`, `AUTH_*`, `CORS_ALLOWED_ORIGINS` from env. No Docker/nginx on the dev machine: compose/Dockerfile/nginx changes can only be reviewed by eye.
- Sync contract: server `updatedAt` is the delta cursor; conflicts compare client `updatedAt` against stored `ClientUpdatedAt` (see SPEC "Events sync contract"). Never compare client clock with server `updatedAt`.
- Web local data is per account (Dexie DB named from issuer+sub); logout/leave must warn about unsynced outbox and clear it. Server-provided keys (icons, field keys) go through `util/ownProperty.ts`.
- API tests run on SQLite (no Docker/Postgres): Postgres-only behavior (jsonb, xmin) is verified by the model/snapshot tests only. EF migrations are generated with `dotnet ef migrations add` (local tool manifest in code/api); no SQL script is checked in (generate one on demand with `dotnet ef migrations script --idempotent`, never commit it).
- Real Napper exports contain a child's data: never commit them (`docs/samples/` is gitignored); tests use synthetic fixtures.
