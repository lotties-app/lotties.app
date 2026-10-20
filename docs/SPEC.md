# Baby Routine — Spec

Open-source (AGPL-3.0) PWA. Parents log baby events, share a baby with a co-parent, and get explainable behavior predictions. Reference app: Napper; this one adds what Napper lacks.

## Goals
- Fast one-tap logging, works offline, installable.
- Feeding has start AND end (duration); bath, tummy time, medication (pick from catalog), belly pain are first-class.
- Parents create custom event types (suggested templates provided).
- Multiple parents per baby; multiple babies per parent.
- Predictions: next sleep / next feed / typical durations, shown with the reasoning.

## Non-goals (MVP)
SSR, native apps, ML models, push notifications, pro/paid tiers, pediatrician sharing, growth charts.

## Stack
- Web: React 19 + TypeScript + MUI, Vite SPA, `vite-plugin-pwa`, TanStack Query, Dexie (IndexedDB), `oidc-client-ts`. Tests: Vitest + Testing Library.
- API: .NET 8 Web API, layered (Domain / Application / Infrastructure / Api), EF Core + Npgsql, xUnit. Tests: unit + Testcontainers integration.
- DB: PostgreSQL 16.
- Auth: generic OIDC (JWT bearer). Default provider Auth0; Keycloak/Authentik work via config only (`Authority`, `Audience`).
- Deploy: `docker-compose` (postgres + api + web via nginx).

## Layout
```
/api   .NET solution (src/*, tests/*)
/web   Vite React app
/docs  SPEC.md, PLAN.md
docker-compose.yml, LICENSE (AGPL-3.0), README, CONTRIBUTING, CLAUDE.md
```

## Domain model
- `User` (external OIDC subject id, display name).
- `Baby` (name, birth date). `BabyMember` (user, baby, role Owner|Parent|Viewer). `Invite` (token, baby, role, expiry).
- `EventType` (baby-scoped or built-in template): key, name, icon, color, `hasDuration`, `fields` (JSON schema-lite: text/number/select/bool). Built-ins: feeding (breast/bottle/solid, amount, side), sleep, diaper, bath, tummy_time, medication, belly_pain (intensity 1-5), plus custom.
- `Event`: id (client-generated GUID), baby, type, `startedAt`, `endedAt?` (null = running), `payload` JSONB, notes, createdBy, `updatedAt`, `deletedAt?` (soft delete for sync).
- `Medication` (baby-scoped catalog): name, default dose/unit, notes, `isUsual`. Medication event payload = list of `{medicationId, dose?}` selected by the parent.
- Predictions are computed, not stored.

## API (REST, `/api/v1`, bearer auth)
- `GET/POST /babies`, `/babies/{id}/members`, `/babies/{id}/invites`, `POST /invites/{token}/accept`.
- `GET/POST/PUT/DELETE /babies/{id}/event-types`, `/medications`.
- Events: `GET /babies/{id}/events?since=<updatedAt>` (delta), `PUT /babies/{id}/events/{eventId}` (idempotent upsert), `DELETE` (soft).
- `GET /babies/{id}/predictions`.
- Authorization: every route checks `BabyMember`; Viewer is read-only.

## Offline sync
Client writes to Dexie first, queues mutations, replays via idempotent PUT; pulls delta with `since`. Conflict rule: last write wins by `updatedAt` (server clock authoritative on receipt). Running timers (events with null `endedAt`) are plain events.

## Predictions (heuristic v1)
Per baby + event type: take last 14 days, compute median interval between starts and median duration; weight recent days higher; for sleep/feed bucket by age band (0-3m, 3-6m, 6-12m, 12m+) when enough data, else fall back to all data. Output: expected next start window, confidence (by sample count), and a human-readable reason. Pure function in Domain; unit-tested.

## UX decisions
- Home: baby switcher, big quick-action grid (one tap starts timer for duration types / logs instant for others), running timers pinned on top with Stop button, "next predicted" cards, today's timeline below.
- Timeline: day-grouped list, filter by type, tap to edit.
- Add/edit sheet (bottom sheet on mobile): type, start/end, type-specific fields; medication shows catalog checklist (usual meds first) + "add new".
- Settings: event types (enable/disable/create custom), medications, members/invites, theme (light/dark), language en (i18n-ready).
- Mobile-first, one-handed, large touch targets, MUI theme with light/dark.

## MVP definition of done
All goals above work end-to-end against local docker-compose with Auth0 or Keycloak config; offline logging syncs after reconnect; PWA installable; CI green (build, lint, tests).

## Napper import (from real exports)
Parents can import a Napper CSV export. Findings from a real export (1248 events, 2026-08-31 to 2026-10-20, offset -03:00):
- Logs CSV columns: `start,end,category,overallHappiness,babyMoodOnWakeUp,babyMoodOnSleep,diaperWeight,diaperContent,breastLeftSeconds,breastRightSeconds,amountPumpedLeft,amountPumpedRight,feedingAmount,temperature,bottleFeedingType,comment,numberOfPauses,pausedMinutes,units,howBabySlept,howBabyWoke,timeToFallAsleep,createdAt,updatedAt`. Timestamps are ISO-8601 with offset; instant events have `start == end`.
- Categories seen: `BOTTLE`, `CHANGED_DIAPER`, `NAP`, `NIGHT_WAKING`, `MEDICINE`, `BED_TIME`, `WOKE_UP`, `NURSING`. Map to built-in types: BOTTLE->feeding(bottle: `feedingAmount` ml, `bottleFeedingType` FORMULA|BREAST_MILK), NURSING->feeding(breast: left/right seconds, pauses), CHANGED_DIAPER->diaper (`diaperContent` WET|DIRTY|MIXED), NAP/NIGHT_WAKING/BED_TIME/WOKE_UP->sleep family (`howBabySlept`, `howBabyWoke`, moods), MEDICINE->medication.
- Napper medication is free text in `comment` and often lists several (e.g. "Colidis e Puravit", typos like "Flagas"/"Flygas"). Confirms the need for a medication catalog with multi-select; the importer maps comments to catalog entries via a reviewable mapping step (user confirms unmatched names), never silently.
- Measurements CSV: `dateOfMeasurement,weightKg,heightCm,headCircumferenceCm` (cm columns may be empty). Add a `Measurement` entity (baby, date, weightKg?, heightCm?, headCircumferenceCm?) and import it; simple list/chart in UI. This promotes basic growth tracking into MVP scope.
- Import is idempotent: deterministic event ids derived from (baby, category, start, end) so re-importing does not duplicate. Duplicate files must be tolerated (the two log exports provided were byte-identical).
- Real exports contain a child's personal data: never commit them; `docs/samples/` is gitignored, tests use small synthetic fixtures with the same columns.

## Authorization behavior
Unauthenticated -> 401. Authenticated non-member (or unknown baby) -> 403 (does not reveal baby existence differently). Insufficient role -> 403. Users are provisioned on first authenticated request that needs them.
