# 36. Project board (owner + AI assistant)

Status: **API built** (data model, REST API, authorization, API keys, tests; migration `ProjectBoard`). **Web page
built** (section 10, 2026-10-24). **Not built**: the MCP tools (section 9), for a later worker. Off by default
(`Board:Enabled`).

## 1. Goals and non-goals

Goals:

- One place where the owner and the AI assistant (Claude, through the REST API now and an MCP endpoint later) track
  the project: tasks, gaps, decisions, open questions, risks, notes and memories, organised by topic, with who is
  expected to act next (the owner, the assistant, both, someone external).
- Readable by humans (a web page) and consultable by tools (REST now, MCP later) with the same data and the same rules.
- An immutable history per item (who changed what, when), comments, a decisions log, a summary ("waiting on the
  owner", "waiting on the assistant"), an export for backups and offline reading.
- Idempotent bulk import (by `externalKey`) so the existing Markdown lists (docs/agents/PLAN.md, docs/agents/REVIEW.md,
  docs/PRIVACY-OWNER-CHECKLIST.md, the open questions of the design docs) can be seeded and re-imported without
  duplicates.

Non-goals:

- **No baby data, ever.** The board is internal project management. No table references a baby, a family, an event or
  any record of the app's users; no route is baby-scoped; nothing of the board is ever shown in the parents' shell, the
  doctor's dashboard, the sync, the per-baby export, the voice assistants or the baby MCP tools. Writing a baby's data
  into an item is a misuse the docs forbid (an item about a bug says "a feed with two pauses", never a real baby's log).
- No PII beyond the Keycloak-backed user id (the `users` row, which holds the OIDC `sub`) and the display name of the
  author of each change. No emails, no IP addresses (not even for API keys: only `last_used_at` and a counter).
- No third party: the board lives in the same PostgreSQL database and calls nothing outside the API.
- Not a general issue tracker for the public (GitHub issues stay the public channel), no notifications, no
  assignment to people other than the four sides, no attachments (links only), no hard delete.

## 2. Data model (EF Core code-first, migration `ProjectBoard`)

All tables snake_case, timestamps `timestamptz` (UTC, microseconds), soft delete by `deleted_at`.

### `board_topics`

| Column | Type | Rules |
| --- | --- | --- |
| `key` (PK) | varchar(40) | lower-case slug `^[a-z][a-z0-9-]{1,39}$`, never changes |
| `name` | varchar(80) | required |
| `description` | varchar(500) | optional |
| `sort_order` | int | display order |
| `archived` | bool | archived topics keep their items; new items cannot be created in them |
| `created_at`, `updated_at` | timestamptz | |

Seeded by the migration (EF `HasData`, idempotent: applied once, never duplicated; there is no delete route, so they
cannot be removed, only renamed or archived by an admin): `product`, `doctor-access`, `assistants-alexa-mcp`,
`privacy-legal`, `mobile-stores`, `infrastructure-deploy`, `data-catalog`, `predictions-ml`, `design-ux`,
`process-meta` (sort orders 10, 20, ... 100). An admin adds more with `PUT /board/topics/{key}`.

### `board_items`

| Column | Type | Rules |
| --- | --- | --- |
| `id` (PK) | uuid | client-generated (idempotent create) or server-generated |
| `type` | varchar(16) | `task`, `gap`, `decision`, `question`, `risk`, `note`, `memory` |
| `topic_key` | varchar(40) FK `board_topics` | an existing topic |
| `title` | varchar(200) | required, trimmed, no NUL |
| `body` | text (<= 20000) | Markdown, optional |
| `status` | varchar(16) | `open`, `in_progress`, `blocked`, `waiting`, `done`, `dropped` (default `open`) |
| `side` | varchar(16) | who acts next: `owner`, `assistant`, `both`, `external` (default `both`) |
| `priority` | varchar(16) | `low`, `normal`, `high`, `urgent` (default `normal`) |
| `labels` | varchar(411) | up to 10 labels of 1-40 characters (`[a-z0-9._:/-]`, stored lower-case), kept as `,a,b,` so a label filter is a portable `LIKE`-free substring test (`instr`/`strpos`); the API speaks arrays |
| `due_date` | date | optional |
| `links` | jsonb | up to 10 `{label (<= 100), url (<= 2000, absolute http/https only)}` |
| `pinned` | bool | only for `note` and `memory` |
| `decided_at`, `decision_summary` (<= 1000), `rationale` (<= 4000) | | only for `decision` (400 otherwise); a summary without a time gets `decided_at` = now |
| `source` | varchar(200) | where it came from, e.g. `docs/design/34 O3`, `conversation 2026-10-24` |
| `external_key` | varchar(120) | optional, unique among items (partial unique index), e.g. `privacy-owner-checklist:C3` |
| `imported_version` | int | the `version` right after the last bulk write; equal to `version` means "untouched since the import" |
| `created_by_user_id` | uuid FK `users`, null | the human author (null for a key, or after the author deleted her account) |
| `created_by_key_id` | uuid FK `board_api_keys`, null | the key that created it |
| `created_by_name` | varchar(100) | display name snapshot ("Former member" after account deletion) |
| `created_at`, `updated_at`, `closed_at`, `deleted_at` | timestamptz | `closed_at` set when the status becomes `done` or `dropped`, cleared when reopened |
| `version` | int | optimistic concurrency token, +1 on every change (the ETag) |

Indexes: `(topic_key, updated_at)`, `(updated_at)`, unique `(external_key) WHERE external_key IS NOT NULL`.

Why an application-managed `version` instead of `xmin`: the version is exposed as the item's ETag (`If-Match`), so it
must be a value the client can hold and that the SQLite test host changes too (the SQLite host never changes `xmin`,
docs: `SqliteModelCustomizer`). EF checks it on every update (`IsConcurrencyToken`), so two concurrent PATCHes of the
same version cannot both win.

### `board_item_events` (immutable history)

| Column | Type | Rules |
| --- | --- | --- |
| `id` (PK) | uuid | |
| `item_id` | uuid FK `board_items` | |
| `at` | timestamptz | |
| `kind` | varchar(16) | `created`, `updated`, `status_changed`, `commented`, `decided`, `deleted`, `restored` |
| `actor_kind` | varchar(16) | `user` or `api_key` |
| `actor_user_id` | uuid FK `users`, null | |
| `actor_key_id` | uuid FK `board_api_keys`, null | |
| `actor_name` | varchar(100) | snapshot ("Former member" after account deletion) |
| `changes` | jsonb | `[{field, from, to}]`; text values longer than 200 characters are cut to 200 and end in `…` (bodies are never copied whole) |
| `comment` | varchar(4000) | only for `commented` |

One event per write request: `status_changed` when the status changed, else `decided` when a decision summary was set,
else `updated`. Rows are never edited, except the actor fields by account deletion (section 8).

### `board_api_keys`

| Column | Type | Rules |
| --- | --- | --- |
| `id` (PK) | uuid | |
| `name` | varchar(80) | e.g. "Claude Code on the dev machine" |
| `prefix` | varchar(12) | the first 12 characters of the secret (`lbk_` + 8), shown in lists and logs-free |
| `key_hash` | varchar(64) | lower-case hex SHA-256 of the full secret (UTF-8) |
| `scope` | varchar(16) | `read` or `write` (write implies read) |
| `allowed_topics` | varchar(411), null | `,a,b,`, at most 10 existing topics (null = every topic) |
| `created_by_user_id` | uuid FK `users`, null | the admin who created it (null after her account deletion) |
| `created_by_name` | varchar(100) | snapshot |
| `created_at`, `expires_at` (null = no expiry), `last_used_at`, `revoked_at` | timestamptz | |
| `use_count` | bigint | minutes in which the key was used (written at most once per minute per key) |

Index: `(prefix)`. Keys are never deleted (revocation is the soft delete), so the history keeps naming them.

## 3. REST contract (`/api/v1/board`)

Every route answers **a plain 404 (no `code`) while `Board:Enabled` is false** (the default), before authentication,
so a disabled board looks like no route. JSON is camelCase; codes are snake_case strings; instants ISO 8601 UTC; dates
`yyyy-MM-dd`. Errors are RFC 7807 problems with `code` (as the rest of the API).

| Route | Policy | Answer |
| --- | --- | --- |
| `GET /board/me` | BoardRead | `{kind: user|api_key, name, roles[], scope (keys), keyId (keys), canRead, canWrite, canAdmin, allowedTopics|null}` |
| `GET /board/topics?includeArchived=` | BoardRead | `[{key, name, description, sortOrder, archived}]` (a key limited to topics sees only those) |
| `PUT /board/topics/{key}` | BoardAdmin | body `{name, description?, sortOrder?, archived?}`; 201 created / 200 |
| `GET /board/items` | BoardRead | `{items: [itemSummary], nextCursor|null}`; filters below |
| `GET /board/items/{id}` | BoardRead | `item` + `history[]` (oldest first); `ETag: "<version>"`; a deleted item is 404 except for an admin |
| `POST /board/items` | BoardWrite | body `itemCreate`; 201 + `Location` + `ETag`; an `id` or `externalKey` that exists returns the stored item unchanged (200, a retry) |
| `PATCH /board/items/{id}` | BoardWrite | merge patch (absent = unchanged, `null` clears an optional field); `If-Match: "<version>"` or body `version` (optional; stale = 412); 200 + `ETag` |
| `POST /board/items/{id}/comments` | BoardWrite | `{comment}` (1-4000); 201 + the history event |
| `DELETE /board/items/{id}` | BoardWrite | soft delete; 204 (again: 204, no new event) |
| `POST /board/items/{id}/restore` | BoardAdmin | 200 + item (not deleted: unchanged) |
| `POST /board/items/bulk` | BoardWrite | `{items: [itemCreate]}` (1-100); 200 `{results: [{index, id, externalKey, outcome}]}` |
| `GET /board/summary?top=` | BoardRead | section 3.3 |
| `GET /board/export` | BoardRead | `{format: "lotties-board", version: 1, exportedAt, topics, items (with history)}`; deleted items only for an admin; never keys |
| `GET /board/keys` | BoardAdmin | `[{id, name, prefix, scope, allowedTopics, createdBy, createdAt, expiresAt, lastUsedAt, useCount, revokedAt, active}]` |
| `POST /board/keys` | BoardAdmin | `{name, scope, allowedTopics?, expiresAt?}`; 201 `{key, secret}`: the secret is returned **once** |
| `DELETE /board/keys/{id}` | BoardAdmin | revoke; 204 (again: 204) |

### 3.1 Item shapes

`itemCreate`: `{id?, type, topic, title, body?, status?, side?, priority?, labels?, dueDate?, links?, pinned?,
decisionSummary?, rationale?, decidedAt?, source?, externalKey?}`. Unknown properties are 400 (a typo never silently
drops a field). `PATCH` accepts the same fields except `id` and `externalKey`, plus `version`.

`item`: `{id, type, topic, title, body, status, side, priority, labels[], dueDate, links[{label, url}], pinned,
decision: {summary, rationale, decidedAt}|null, source, externalKey, createdBy: {kind, name, keyId?}, createdAt,
updatedAt, closedAt, deletedAt, version}`. `itemSummary` is `item` without `body`, with `excerpt` (the body's first 200
characters). User ids are never returned.

History event: `{id, at, kind, actor: {kind, name, keyId?}, changes: [{field, from, to}], comment}`.

### 3.2 List filters, sort, pagination

`topic`, `type`, `status`, `side`, `priority` (each repeatable or comma-separated: any of), `label` (repeatable: any
of), `pinned` (bool), `open` (bool: status not `done`/`dropped`), `q` (case-insensitive substring of title or body),
`updatedSince` (instant, `updated_at >=`), `includeDeleted` (admin only, else 403 `board_admin_required`), `sort`
(`updated` newest first, the default; `created` newest first; `priority` urgent first then due date then newest;
`due` earliest due first, items without a due date last; `decided` newest decision first), `limit` (1-200, default 50),
`cursor`.

`cursor` is opaque (base64url, bound to the sort; another sort is 400 `invalid_cursor`). It is an offset today: with a
board of hundreds of items a moved item can appear twice or be skipped across pages; tools that sync use
`updatedSince` instead. Search is portable (`lower(title)` / `lower(body)` contains, the same on PostgreSQL and SQLite)
and unindexed: a sequential scan of a table of a few thousand rows; a `tsvector` + GIN index is the upgrade path if the
board grows.

### 3.3 Summary

`{generatedAt, totals: {open, waitingOnOwner, waitingOnAssistant, blocked, overdue}, counts: [{topic, side, status,
count}], waitingOnOwner: [itemSummary], waitingOnAssistant: [itemSummary], recentDecisions: [itemSummary],
recentlyUpdated: [itemSummary]}`. Deleted items never count. "Open" = status not `done`/`dropped`; waiting on the owner
= open with side `owner` or `both`; on the assistant = open with side `assistant` or `both`; ordered by priority
(urgent first), due date (earliest first, none last), then newest update. `overdue` = open with a due date before
today (UTC). `top` (1-50, default 10) bounds each list. Recent decisions are `decision` items by `decidedAt` (newest
first, undecided ones excluded).

### 3.4 Bulk import

The body is exactly `{"items": [...]}`. Validates every entry first (any invalid entry: 400 `validation_failed` whose
`field` names it, e.g. `items[3].title`; an `externalKey` or `id` given twice is invalid too; nothing is saved), checks
every topic, then writes all in one `SaveChanges`. Per entry:

- no `externalKey`: created (an `id` that exists: `unchanged`);
- `externalKey` not seen: `created`;
- seen, item deleted: `deleted` (never resurrected by an import);
- seen, untouched since the last import (`version == imported_version`): `updated` when the values differ, else
  `unchanged`;
- seen, edited since by anyone (a PATCH, a comment, a status change): `kept` (the board's version wins).

### 3.5 Error codes

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` (`field`; `items[i].<field>` in a bulk body; `If-Match` for a malformed header) | any invalid value, unknown property, more than 100 bulk entries |
| 400 | `invalid_cursor` | a cursor that does not parse or belongs to another sort |
| 401 | (none) / `invalid_board_key` | no credentials / a board key that is unknown, revoked or expired |
| 403 | (none) | no board role (users) or a write with a read key; the same plain 403 on every route, so it says nothing about items |
| 403 | `board_admin_required` | `includeDeleted` without the admin role |
| 403 | `board_topic_not_allowed` | a key limited to topics writes elsewhere |
| 404 | (no `code`) | the board is disabled |
| 404 | `board_item_not_found`, `board_api_key_not_found` | unknown id (a deleted item for a non-admin; an item outside a key's topics) |
| 409 | `board_item_deleted` | PATCH or comment of a deleted item |
| 409 | `concurrent_modification` | two writes raced (retry) |
| 412 | `board_version_mismatch` (`currentVersion`) | `If-Match`/`version` is not the stored version |
| 413 | `request_body_too_large` | body over `RequestLimits:BoardMaxRequestBodyBytes` (256 KiB) or, for bulk, `BoardBulkMaxRequestBodyBytes` (4 MiB) |
| 422 | `board_unknown_topic`, `board_topic_archived` | create or move into a topic that does not exist / is archived |
| 429 | `rate_limited` | over `RequestLimits:BoardPermitsPerMinute` (120) per user or per key, or the global 300 |

## 4. Authorization

Board routes accept **either** a Keycloak user token (with a board realm role) **or** a board API key. No baby
membership is involved anywhere.

### 4.1 Humans: Keycloak realm roles

Keycloak puts realm roles in the access token as `realm_access: {"roles": [...]}`. The API's JWT scheme keeps raw claim
names (`MapInboundClaims = false`), so a claims transformation (`Api/Board/BoardRoleClaims`) reads that claim and, for
exactly these three names, adds role claims (`ClaimTypes.Role`) and the board permission claims:

| Realm role | Permissions |
| --- | --- |
| `lotties-board-reader` | read |
| `lotties-board-writer` | read, write |
| `lotties-board-admin` | read, write, admin (manage API keys and topics, restore, see deleted items) |

Any other realm role is ignored (it is never turned into a role claim). Policies: `BoardRead`, `BoardWrite`,
`BoardAdmin` (permission claims `read`/`write`/`admin`). A signed-in user without a board role gets a plain 403 on
every board route, before any lookup, so the answer is the same whether an item exists or not. Admin never hard
deletes: deletion is soft for everyone.

### 4.2 Machines: board API keys

- Format: `lbk_` + 43 base64url characters (32 bytes from the OS CSPRNG, no padding): 47 characters, fixed prefix so
  secret scanners can detect it (`lbk_[A-Za-z0-9_-]{43}`).
- Sent as `Authorization: Bearer lbk_...` or `X-Board-Key: lbk_...`. A second authentication scheme (`BoardKey`) runs
  only on board routes (the board guard, after the normal authentication): it hashes the presented secret (SHA-256),
  finds the candidates by prefix and compares the hashes in constant time (`CryptographicOperations.FixedTimeEquals`),
  refuses revoked and expired keys (401 `invalid_board_key`), and writes `last_used_at`/`use_count` at most once per
  minute per key (a conditional `UPDATE`). When a key is presented it is the request's identity, even next to a user
  token. The API's JWT schemes skip `lbk_` bearer values (they never reach token validation or its logs).
- Scopes map to the same policies: `read` -> BoardRead; `write` -> BoardRead + BoardWrite. A key never has admin, so a
  key can never create, list or revoke keys, restore items or see deleted ones. `allowedTopics` (optional) limits reads
  (lists, summary, export filter them; an item elsewhere is 404) and writes (403 `board_topic_not_allowed`).
- Created and revoked **only** by BoardAdmin users. The full secret is in the creation answer only; the database holds
  its SHA-256 (and the 12-character prefix); lists show prefix, name, scope, topics, expiry, last use and count.
- Rate limit per key (the partition is `board-key:<id>`, never shared with a user) and per user.

### 4.3 Other protections

- Body caps (section 3.5), the global per-user limit, and the board limit.
- Logging: route-level outcome only (`Board item {ItemId} {Action}`, key id on key events, result code, correlation id
  from the problem details); never a secret, a hash, a prefix, a title or a body. The API's `Microsoft.AspNetCore`
  logs stay at Warning (no request lines).
- CORS: unchanged (the app origin only, as for every route; no board-specific policy).
- `Board:Enabled` defaults to false: nothing is exposed until the owner enables it.

## 5. Audit and history

Every write adds one `board_item_events` row in the same `SaveChanges` as the item, with the actor (user or key, and
the display name at that time) and the field changes. The history is returned with `GET /board/items/{id}` and in the
export. API key creation and revocation are visible in the key list (`createdAt`, `createdBy`, `revokedAt`).

## 6. Retention

Items, history and keys are kept until the owner decides otherwise: soft-deleted items stay (an admin can restore
them), revoked keys stay (so the history still names them). There is no purge job. Account deletion anonymizes the
actor fields (section 8). Owner decision pending (privacy audit G4 covers retention in general).

## 7. Backups

The board lives in the same PostgreSQL database and is in the same `pg_dump` backups (docs/DEPLOY.md "Applying
migrations": back up before a migration deploy). `GET /board/export` is a readable JSON copy for consultation or an
extra backup; it holds no key material.

## 8. Account deletion

`DELETE /me` (`EfAccountDataEraser`) clears the deleting user's links on board rows and replaces the name snapshots:
`board_items.created_by_user_id`, `board_item_events.actor_user_id`, `board_api_keys.created_by_user_id` become null and
the matching `*_name` becomes "Former member". Items, history and keys stay (they are the project's, not the user's).
`AccountErasureTests.Rules` lists the three columns as `Clear`, and its fixture writes a board row of each kind for the
deleting user.

## 9. MCP tools (for the later worker)

A board MCP endpoint is a separate adapter (its own route, e.g. `/api/v1/board/mcp`, authenticated by the same
`BoardKey` scheme or by Keycloak tokens with the board roles; never the baby MCP server's scopes or tools). Tools call
the same application service (`IBoardService`), so rules and history are identical:

| Tool | Args | Result |
| --- | --- | --- |
| `board_whoami` | none | `GET /board/me` |
| `board_summary` | `top?` | section 3.3 |
| `board_list_topics` | `includeArchived?` | topics |
| `board_list_items` | the filters of 3.2 (`topic`, `type`, `status`, `side`, `priority`, `label`, `pinned`, `open`, `q`, `updatedSince`, `sort`, `limit`, `cursor`) | `{items: [itemSummary], nextCursor}` |
| `board_get_item` | `id` | `item` + `history` |
| `board_create_item` | `itemCreate` | `item` |
| `board_update_item` | `id`, `version?`, patch fields | `item` (`board_version_mismatch` carries `currentVersion`) |
| `board_set_status` | `id`, `status`, `comment?` | `item` (a PATCH and, with `comment`, a comment) |
| `board_comment` | `id`, `comment` | history event |
| `board_record_decision` | `topic`, `title`, `decisionSummary`, `rationale?`, `source?`, `id?` | `item` (type `decision`, status `done`) |
| `board_remember` | `topic`, `title`, `body`, `pinned?`, `source?` | `item` (type `memory`) |
| `board_bulk_upsert` | `items` (<= 100, with `externalKey`) | bulk results |

Read tools need the read permission, the others write; results are the REST JSON as `structuredContent` plus a short
text. No tool deletes, restores or touches keys.

## 10. Web page (built 2026-10-24)

Route `/hub/board` and `/hub/board/<item id>` (the drawer), outside the parents' shell, signed-in; i18n in
`locales/<lang>/board.json`. The information architecture as first planned:

- **Topic view** (default): topics as sections or columns, each with its open items grouped by status; counts from the
  summary.
- **Side filter**: owner / assistant / both / external, plus "waiting on me" shortcuts from the summary lists.
- **Decisions log**: `type=decision`, newest `decidedAt` first, summary and rationale visible.
- **Gaps view**: `type=gap` and `risk`, by priority.
- **Notes and memories**: `type=note|memory`, pinned first.
- **Search**: `q` plus filters (type, status, side, priority, label, topic), cursor paging.
- **Quick add**: title + topic + type (+ side, priority), the rest in the drawer.
- **Item drawer**: all fields editable (PATCH with `If-Match`; on 412 reload and show the newer version), comments,
  the history timeline, soft delete; restore and deleted items for admins.
- **Admin**: topics (add, rename, archive) and API keys (create with the secret shown once and a copy button, list,
  revoke).

### 10.1 Page layout (as built)

Code in `code/web/src/board/` (docs/agents/filemap.md lists every file).

- **Access**: `GET /board/me` (`useBoardAccess`), asked once per session and account, in memory only, never with the
  401 login redirect. 404 (disabled), 403 (no board role) or a body that is not a `me` mean no access. The Hub entry
  Hub > App > Project board (`board`, after Settings) appears only when the answer grants read; the Hub renders at once
  and never waits for it. Hidden in the native app (not even asked) and for a Doctor with no family of her own; the
  doctor shell (`/doctor`) has no entry. The page itself: offline it shows "Needs a connection" (nothing of the board is
  stored on the device: no Dexie table, TanStack Query cache in memory only); no access shows a plain "not available"
  message; in the native app it redirects to `/hub`.
- **Frame**: its own frame outside `AppShell` (no baby header, no dock, no event quick add: nothing of a baby is near
  it), "Back to Hub", the h1, content up to 1200 px wide. Lazy chunk `board/BoardPage`.
- **Top to bottom**: admins' "API keys and topics" button; the **summary strip** (`GET /board/summary` totals: Waiting
  on you = side owner or both, Waiting on the assistant = assistant or both, Blocked, Overdue; each a toggle button
  that applies its filter, pressed while applied, pressed again clears); the **search** (`q`, 300 ms debounce, in the
  URL); **quick add** (writers): one line, Enter, in the view's type (task, gap in Gaps, decision in Decisions, note
  in Notes) and side (owner in Mine, assistant in Claude, else the single filtered side or both), into the topic
  chosen beside it (the filtered topic, else the last used, else the first open one), client id (idempotent);
  "More fields" opens the full form; the **views** segmented control (Topics, Mine, Claude, Decisions, Gaps, Notes
  and memories); the **filter row** (Filters button with the count, Hide done and dropped on by default (Topics,
  Mine, Claude, Gaps), Show deleted for admins, Clear filters; the collapsible panel: type (when the view lists
  several), status, side (not in Mine/Claude), priority, topic, labels, order).
- **URL**: `view`, `q`, `type`, `status`, `side`, `priority`, `label`, `topic` (comma lists), `closed=show`,
  `deleted=1`, `sort`, `panel=keys|topics`; unknown values are ignored. View queries: Topics `open&sort=updated`;
  Mine `side=owner`, Claude `side=assistant`, both `sort=priority`; Decisions `type=decision&sort=decided` (done
  included); Gaps `type=gap&sort=priority`; Notes `type=note,memory&sort=updated` (done included).
- **Lists**: pages of 50 with "Load more" (cursor); a stale request is aborted when its list is no longer shown;
  skeletons while loading. Topics: an accordion per topic (h2), its counts by status from the summary (done and
  dropped left out while hidden), its loaded items (expanded when it has some). Rows: type icon (type read aloud),
  title, status chip, side chip, high/urgent flag, due date (overdue in the error tone, with the word), updated
  (relative), pinned, deleted. Decisions: a log by decision date (h2), summary, rationale behind a toggle
  (`aria-expanded`), the topic chip filters the board to it. Gaps: by topic (h2) then priority (h3). Notes and
  memories: cards, pinned first (within the loaded pages), label chips, a Markdown preview of the excerpt.
- **Drawer** (`/hub/board/<id>`, keeps the query): beside the list from `md` (sticky panel, focus moves to its title,
  Escape and Close go back and focus the row), a full-screen dialog on phones. Title (h2), fields, decision, links
  (http(s) only, new tab), the Markdown body, the history (who, when, field changes with codes translated, comments),
  a comment box. Writers: Status menu (one tap, PATCH with `If-Match`), Edit (the same form; only changed fields are
  sent; moving away from a decision clears its fields, from a note/memory its pin), Delete. A 412 shows "Someone
  changed this item. Reload to see the latest version; your changes were not saved." with Reload (refetch, edits
  dropped, no diff). Delete is soft: admins get an Undo snackbar (restore); writers without admin confirm first
  (they cannot restore: see 10.2). Admins see deleted items (Show deleted) and Restore in the drawer.
- **Markdown**: no renderer existed in the bundle, so `markdown.ts` parses a safe subset (headings, paragraphs,
  lists, quotes, rules, fenced and inline code, bold, italic, http(s) links and bare http(s) addresses) into a tree
  that `MarkdownView` renders as React elements: no `dangerouslySetInnerHTML`, raw HTML stays text, images become
  their alt text, other link schemes become text; searches are bounded (no quadratic input).
- **Admin settings** (`?panel=keys|topics`, dialog, full screen on phones, tabs): API keys (create: name, Read or Read
  and write, optional expiry (end of that day UTC), optional topics; the answer goes straight into a dialog that shows
  the full secret once with Copy and "You will not see it again", closed only by "Done, I stored it", which drops it
  from memory (never in a query or mutation cache); list: name, `lbk_xxxxxxxx…`, scope, state (active, revoked,
  expired), topics, expiry, last use and minutes used, creator; revoke with a confirmation; "How to use a key": the
  curl line with `$LOTTIES_BOARD_KEY` and the Claude Code line `claude mcp add --transport http lotties-board
  https://<host>/api/v1/board/mcp --header "Authorization: Bearer <key>"` labelled "when enabled", host from
  `VITE_API_BASE_URL` (the page's origin when empty), pointing to docs/KEYCLOAK-BOARD.md). Topics: rename, describe,
  reorder, archive, add (key slug checked), never delete.
- **Keyboard** (desktop, never while typing or in a dialog): `j`/`k` move between rows, `/` search, `c` quick add,
  `e` edits the open item. **A11y**: one h1, h2 per section, list semantics, polite live region for saves, comments,
  deletions and status changes, 44 px targets, axe clean in light, dark and night, en and pt-BR. Rows wrap at 320-430
  px. Reduced motion: the theme rule (no own animation).
- **Preview and screenshots**: `/dev/board?state=admin|writer|reader|empty|none` (in-memory API, synthetic items);
  `tests/e2e/design-review/board-preview.review.ts` at 390 and 1280 px.

### 10.2 Deviations and missing API pieces

- Route `/hub/board` instead of `/board`, inside the Hub's family of routes but outside `AppShell` (the 480 px column
  of the shell cannot hold list and drawer side by side, and the shell's baby header and event quick add must not be
  near the board).
- "Due soon" is shown as **Overdue** (`totals.overdue`): the summary has no due-soon count and the list API has no
  due-date filter, so the Overdue shortcut sorts open items by due date (earliest first) instead of filtering.
  Missing API piece: a `dueBefore` list filter and a due-soon total.
- Undo of a delete needs `POST /restore`, which is admin only: writers confirm before deleting instead. Missing API
  piece (optional): restore by the deleting writer within a short grace window.
- Gaps view lists `type=gap` only (the brief); risks stay in Topics with a type filter.
- Notes "pinned first" orders the loaded pages only (the list API has no pinned-first sort).

## 11. Seed plan

- Topics: the migration seeds the ten topics (section 2).
- Items: imported with `POST /board/items/bulk` (an admin's token or a write key), never by a migration (no project
  content in the schema). Sources and `externalKey` scheme: `plan:<task id>` (docs/agents/PLAN.md open tasks),
  `review:<finding id>` (docs/agents/REVIEW.md), `privacy-owner-checklist:<item>` (docs/PRIVACY-OWNER-CHECKLIST.md),
  `design-<nn>:<question id>` (open questions such as docs/design/34 O3), `deferred:<feature>` (deferred features),
  `audit-33:<gap>` (docs/design/33 G1-G13). Re-running the import updates only untouched items (section 3.4).
- The import script is a later task (it reads the Markdown and posts JSON); the REST example in docs/KEYCLOAK-BOARD.md
  shows the call.

## 12. Configuration

| Key (env) | Default | Purpose |
| --- | --- | --- |
| `Board__Enabled` | `false` | `true` serves the board routes |
| `RequestLimits__BoardPermitsPerMinute` | `120` | board requests per user or key per minute |
| `RequestLimits__BoardMaxRequestBodyBytes` | `262144` | largest board request body |
| `RequestLimits__BoardBulkMaxRequestBodyBytes` | `4194304` | largest bulk import body |

Owner setup (realm roles, the token mapper, keys): docs/KEYCLOAK-BOARD.md.

## 13. Implementation notes (for the next workers)

- Code: Domain `Lotties.Domain/Board`, Application `Lotties.Application/Board` (`IBoardService`, `IBoardApiKeyService`,
  `IBoardCaller`), Infrastructure `BoardConfigurations.cs`, `EfBoardRepository.cs`, `EfBoardApiKeyRepository.cs`, Api
  `Lotties.Api/Board` (routes, claims transformation, `BoardKey` scheme, guard, policies). docs/agents/filemap.md lists
  every file.
- The MCP worker calls `IBoardService` / `BoardItemInput` (create and patch bodies are JSON elements read strictly, so a
  tool's arguments can be passed through) and gets the caller from `IBoardCaller`; a new route needs a row in
  `EndpointRoleMatrixTests` (board section) and the guard metadata (`BoardEndpointMetadata`) to be 404 while disabled.
- The web worker: `GET /board/me` decides whether to show the page (200) or not (403/404); every list is
  `itemSummary` (no body); PATCH with `If-Match` and handle 412 (`currentVersion`); key creation shows `secret` once.
- Tests: `BoardTestKit` (users with realm roles through the test header `X-Test-Realm-Roles`, keys seeded in the
  database); the test host turns the board on (`ApiFactory`).
