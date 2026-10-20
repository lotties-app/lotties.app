# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Baby event-tracking PWA (React + .NET 8 + Postgres), open source AGPL-3.0. Spec: `docs/SPEC.md`. Plan/status: `docs/PLAN.md`. Navigation: `docs/filemap.md` (update when adding/moving files).

## Stack
- `web/`: React 19 + TS + MUI, Vite SPA (no SSR), Dexie offline store.
- `api/`: .NET 8, layers Domain / Application / Infrastructure / Api; EF Core + Npgsql.
- Commands (fill in at scaffold): `dotnet build api`, `dotnet test api`, `npm --prefix web run dev|build|test|lint`, `docker compose up`.

## Conventions
- Event model is generic (typed `Event` + JSONB payload); never add a table per event kind.
- Client generates event GUIDs; writes are idempotent upserts; deletes are soft.
- Auth is generic OIDC; never hardcode Auth0 specifics outside config.
- Persistence: Entity Framework Core (Npgsql), code-first migrations only; no raw SQL schema changes.
- Predictions are pure Domain functions, no I/O.
- All AI-produced docs, plans, specs, reports and graphs go in `docs/` (graphify writes to `docs/graphify`, set via `.claude/settings.json`). Only CLAUDE.md, README, LICENSE, CONTRIBUTING stay at root.
- Use skills `develop:dotnet8` (api) and `refactor:react` (web).
- Subagents: Opus plans/orchestrates, Sonnet medium-hard, Haiku simple, never Fable.
