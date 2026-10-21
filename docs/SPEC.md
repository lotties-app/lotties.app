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
- `Medication` (baby-scoped catalog): name, default dose/unit, notes, `isUsual`. Medication event payload = `{medications: [{medicationId, name, dose?}]}` selected by the parent (`name` is a copy).
- Predictions are computed, not stored.

## API (REST, `/api/v1`, bearer auth)
- `GET/POST /babies`, `/babies/{id}/members`, `/babies/{id}/invites`, `POST /invites/{token}/accept`.
- `GET/POST/PUT/DELETE /babies/{id}/event-types`, `/medications`.
- Events: `GET /babies/{id}/events?since=<updatedAt>` (delta), `PUT /babies/{id}/events/{eventId}` (idempotent upsert), `DELETE` (soft).
- `GET /babies/{id}/predictions`.
- Napper import: `POST /babies/{id}/import/napper/preview`, `POST /babies/{id}/import/napper` (see "Napper import API").
- Authorization: every route checks `BabyMember`; Viewer is read-only.

## Offline sync
Client writes to Dexie first, queues mutations, replays via idempotent PUT; pulls delta with `since`. Conflict rule: last write wins by `updatedAt` (server clock authoritative on receipt). Running timers (events with null `endedAt`) are plain events.

### Events sync contract (implemented, task 6)
Base `/api/v1/babies/{babyId}`; JSON camelCase; timestamps ISO-8601, returned in UTC with microsecond precision. `EventDto` = `{id, babyId, typeId, startedAt, endedAt|null, payload (JSON object), notes|null, createdBy, createdAt, updatedAt, deletedAt|null}`. Errors are RFC 7807 `application/problem+json` with extensions `code` (stable domain code) and, for validation, `field`.
- `PUT /events/{eventId}` (Parent/Owner). Body `{typeId, startedAt, endedAt?, payload?, notes?, updatedAt?}`. Creates (201 + `Location`) or edits (200); returns the stored `EventDto`. Server stamps `updatedAt` on receipt. Replaying the same body returns the same representation (unchanged details do not bump `updatedAt`; payload compared as JSON values). Optional `updatedAt` = client edit time: if older than the stored `updatedAt` the write is ignored (200, stored copy returned); absent = receipt order wins. A soft-deleted event stays deleted: PUT is a no-op returning the deleted copy (200). The type must be built-in or the baby's own (else 422 `event_type_not_available`); an id that belongs to another baby is 409 `event_baby_mismatch`; invalid input (notes > 2000, payload not an object or > 16 KiB, end before start, malformed JSON) is 400.
- `DELETE /events/{eventId}` (Parent/Owner): soft delete, always 204 (also when already deleted, unknown, or belonging to another baby, which is left untouched). No tombstone is created for unknown ids.
- `GET /events?since=&after=&limit=` (any member): JSON array of `EventDto` incl. soft-deleted, ordered by `(updatedAt, id)` asc. `since` is inclusive (`updatedAt >= since`; boundary rows may repeat). Page size `limit` 1-500 (default 500). When more rows follow, header `X-Next-Cursor` (CORS-exposed) holds an opaque cursor; pass it as `after` (takes precedence over `since`) until the header is absent. The `(updatedAt, id)` keyset never skips rows that share an `updatedAt`.
- `GET /events/{eventId}` (any member): the `EventDto`, soft-deleted included; 404 `event_not_found` when unknown or of another baby.

### Babies, members, invites, event types, medications (implemented, tasks 4-5)
Base `/api/v1`; JSON camelCase; roles are strings `Owner|Parent|Viewer` (case-insensitive on input); errors are problem+json with `code`. Status of every code is in `Api/Errors/DomainExceptionStatusCodes`.
- Babies. `GET /babies` -> `[{id, name, birthDate (yyyy-MM-dd), role, createdAt}]` (role = the caller's). `POST /babies {name, birthDate}` -> 201, the creator is Owner. `GET /babies/{id}` (any member). `PUT /babies/{id} {name, birthDate}` (Owner). No delete in the MVP (DELETE is 405).
- Members. `GET /babies/{id}/members` (any member) -> `[{userId, displayName, role, joinedAt}]`. `PATCH /babies/{id}/members/{userId} {role}` and `DELETE /babies/{id}/members/{userId}` (Owner). `DELETE /babies/{id}/members/me` (any member leaves). Demoting or removing the last Owner is 409 `last_owner_required`; unknown member 404 `member_not_found`.
- Invites. `POST /babies/{id}/invites {role, expiresInDays?}` (Owner; default 7, 1-30) -> 201 `{id, babyId, role, createdBy, createdAt, expiresAt, token}`; the plain token is returned only here, 256-bit random, and only its SHA-256 (base64url) is stored. `GET /babies/{id}/invites` (Owner) -> pending (not accepted, not expired) without tokens. `DELETE /babies/{id}/invites/{inviteId}` (Owner, 204, idempotent). `POST /invites/{token}/accept` (any signed-in user) -> 200 `BabyDto` of the joined baby; unknown/malformed/revoked 404 `invite_not_found`, expired 410 `invite_expired`, used 409 `invite_already_accepted`, caller already a member 409 `member_already_exists` (invite stays usable).
- Event types. `GET /babies/{id}/event-types` (any member): built-in templates first, then the baby's custom types: `{id, babyId|null, key, name, icon, color, hasDuration, fields:[{key, label, kind (text|number|select|bool), isRequired, options?, min?, max?, unit?}]}`. `POST` (201; `{key, name, icon, color(#rrggbb), hasDuration, fields?}`), `PUT /{typeId}` (`{name, icon, color, hasDuration, fields?}`; the key is immutable), `DELETE /{typeId}` (204): Parent/Owner. Built-ins reject writes with 409 `event_type_built_in_read_only`; duplicate key (also against built-ins) 409 `event_type_key_taken`; deleting a type any event (soft-deleted included) references 409 `event_type_in_use` (no archive flag); a type of another baby is 404 `event_type_not_found`. Field keys are lower snake_case.
- Built-in fields: feeding `method` (required select breast|bottle|solid), `side`, `amount_ml`, `bottle_feeding_type` (FORMULA|BREAST_MILK), `breast_left_seconds`, `breast_right_seconds`; sleep `kind` (nap|night|night_waking|bed_time|woke_up; the last two are instant markers, migration `SleepKindBedWake`), `mood`; diaper `content` (required select WET|DIRTY|MIXED); bath `temperature_c`; tummy_time `mood`; belly_pain `intensity` (required 1-5). Seed changes ship in migration `BuiltInFieldFixups`.
- Medications. `GET /babies/{id}/medications` (any member; usual first, then by name) -> `[{id, babyId, name, defaultDosage:{amount,unit}|null, notes, isUsual, createdAt}]`. `PUT /babies/{id}/medications/{medicationId} {name, defaultDosage?, notes?, isUsual}` (Parent/Owner, client GUID, idempotent: 201 created / 200 edited; an id of another baby is 409 `medication_baby_mismatch`). `DELETE` (Parent/Owner) is a hard delete, 204 and idempotent; events keep their own medication copy in the payload, so nothing dangles.

### Measurements (API implemented, task 16)

- `GET /babies/{id}/measurements` (any member; date descending, then newest created) -> `[{id, babyId, date:"YYYY-MM-DD", weightKg|null, heightCm|null, headCircumferenceCm|null, notes|null, createdBy, createdAt, updatedAt}]`.
- `PUT /babies/{id}/measurements/{measurementId} {date, weightKg?, heightCm?, headCircumferenceCm?, notes?}` (Parent/Owner, client GUID, idempotent, full state: 201 created with Location / 200 edited; a replay with identical state does not bump `updatedAt`). Rules: at least one of the three values (else 422 `measurement_without_values`); weight 0.3-40 kg, height 20-130 cm, head 20-60 cm (else 400 `validation_failed` with the field); values are rounded to 2 decimals; `date` between 2000-01-01 and today+1 (UTC) (else 400); notes max 1000. An id of another baby is 409 `measurement_baby_mismatch`. Several measurements per day are allowed.
- `DELETE /babies/{id}/measurements/{measurementId}` (Parent/Owner): hard delete, 204 and idempotent (unknown id or another baby's id is a no-op). No soft delete or delta sync: the web client fetches the list online.

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

### Napper import API (implemented, task 17)
Two phases, both `POST`, Parent/Owner (Viewer/non-member 403, anonymous 401), JSON body (not multipart) with the CSV texts; errors are problem+json with `code` plus the extensions listed.
- Body `NapperImportRequest` = `{logsCsv?, measurementsCsv?, medicationMappings?: [{token, action: "existing"|"create"|"ignore", medicationId?, name?}], options?: {categories?: ["NAP", ...]}}`. At least one CSV (else 400 `validation_failed`). Each CSV max 5 MB UTF-8 (413 `import_file_too_large`, ext `field`, `maxBytes`) and 20000 data rows (400 `import_too_many_rows`, ext `field`, `maxRows`); unterminated quote, empty file or missing required column (logs: `start,end,category`; measurements: `dateOfMeasurement`) is 400 `import_invalid_file` (ext `field`). Unknown `action` is 400. `options.categories` (case-insensitive) limits the Napper categories imported; others are skipped as `excluded_category`.
- CSV: RFC 4180 (quotes, `""`, embedded commas/line breaks), BOM, CRLF/LF/CR, blank lines ignored, columns found by name in any order (case-insensitive), extra columns ignored. Timestamps must be ISO-8601 with `Z` or `±hh:mm` (no offset = row skipped), stored in UTC. Numbers invariant (a lone decimal comma accepted). Measurement dates `yyyy-MM-dd` or an ISO timestamp (its local calendar date). `createdAt`/`updatedAt` are ignored.
- `POST /babies/{id}/import/napper/preview` -> 200 `{logs: NapperLogsSummary|null, measurements: NapperMeasurementsSummary|null, medicationSuggestions: [...], unmappedTokens: [string]}`; writes nothing. `NapperLogsSummary` = `{totalRows, toCreate, alreadyImported, skipped, from|null, to|null (UTC, span of importable rows), categories: [{category, eventTypeKey|null, total, toCreate, alreadyImported, skipped}], skippedRows: [{row, category|null, code, reason}]}` (`row` = 1-based data record, header not counted). `NapperMeasurementsSummary` = `{totalRows, toCreate, alreadyImported, skipped, from|null, to|null (yyyy-MM-dd), skippedRows}`. Suggestion = `{token, occurrences, suggestion: "existing"|"create", medicationId|null, medicationName (catalog name, or the token for create), distance|null (0 = same ignoring case/diacritics), similarTokens: [other tokens of the file within typo distance], isMapped}`; listed only for medicine rows that will be created. `unmappedTokens` = names the import would reject with the given mappings (the preview applies mappings when sent, so preview and import of the same body report the same counts).
- `POST /babies/{id}/import/napper` (same body) -> 200 `{eventsCreated, measurementsCreated, createdMedications: [{id, name}], logs, measurements}` (summaries as in the preview; their `toCreate` is what was created). Every medication token of a new medicine row needs a mapping, else 422 `import_unmapped_medications` (ext `tokens`) and nothing is written. Mapping errors: `existing` id not in the baby's catalog, `create` without name, one token mapped twice differently -> 422 `import_invalid_medication_mapping` (ext `token`); create name > 100 chars -> 400. All inserts run in one transaction in chunks of 500 (medications, events, measurements); a concurrent insert of the same ids is 409 `import_conflict` and nothing is saved.
- Skip codes: `unknown_category`, `excluded_category`, `invalid_value`, `missing_value`, `duplicate_row`, `invalid_record` (domain rule, e.g. end before start, notes > 2000, measurement out of range or without values), `medications_ignored`. Invalid rows never abort the file.
- Idempotency: event id = UUID v5 (fixed namespace) of `baby|category|start UTC|end UTC|ordinal`, where `ordinal` numbers rows with the same category/start/end but different content; a row that would create exactly the same event as an earlier row is `duplicate_row`. Measurement id = UUID v5 of `baby|date|values (2 decimals)`; identical rows are duplicates. Medications created by an import get UUID v5 of `baby|normalized name`, and a `create` whose normalized name equals a catalog entry reuses it. Ids that already exist (soft-deleted events included, so deleted imports are not resurrected) count as `alreadyImported`: re-importing creates nothing.
- Mapping (built-in types, `createdBy` = caller, Napper `comment` -> notes except for medicine): BOTTLE -> feeding `{method:"bottle", amount_ml, bottle_feeding_type}` (unknown content kept as a notes line), end = start when empty. NURSING -> feeding `{method:"breast", side: left|right|both from non-zero seconds, breast_left_seconds, breast_right_seconds}`; when Napper stored an instant, end = start + left + right seconds; pauses go to notes. CHANGED_DIAPER -> diaper `{content}` (WET|DIRTY|MIXED, case-insensitive; else `missing_value`), instant. NAP/NIGHT_WAKING -> sleep `{kind: nap|night_waking, mood}` (empty end = `missing_value`); BED_TIME/WOKE_UP -> sleep instants `{kind: bed_time|woke_up}`. `mood` = `babyMoodOnWakeUp`, else `howBabySlept`; the other mood/sleep columns become notes lines ("Mood on sleep: ..", "How baby slept: ..", "How baby woke: ..", "Time to fall asleep: .."). MEDICINE -> medication instant `{medications:[{medicationId, name}]}`; the comment is split on ` e `, ` and `, `&`, `,`, `+`, `/`, line breaks; a row whose tokens are all `ignore` is skipped. Matching normalizes case, diacritics and spaces; typo tolerance: names up to 3 chars exact, up to 7 one edit, longer two (Levenshtein).

## Authorization behavior
Unauthenticated -> 401. Authenticated non-member (or unknown baby) -> 403 (does not reveal baby existence differently). Insufficient role -> 403. Users are provisioned on first authenticated request that needs them.
