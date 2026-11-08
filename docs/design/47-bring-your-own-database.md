# 47. Bring your own database: a family's baby data in its own Postgres, reached only through the Lotties API (design only, 2026-11-07)

**Status: design only. Nothing is built, migrated or deployed.** No feature code in this change. Not legal advice.

Owner request: a user keeps the Lotties app but syncs with **their own database** (Supabase or another cheap host). All
traffic still goes through the Lotties API, so insights, predictions, vaccine status and doctor summaries stay in the API.
The API stores the connection string in a form that is not readable, runs the queries against the user's database and
returns the results. Suggest the cheapest hosts to users.

**Owner clarification (2026-11-07): this is an option, not a replacement.** Lotties-hosted storage stays the default for
everyone. A user may choose their own database for a baby and may move back at any time. Nobody who never opts in sees any
change, and the feature flag is off by default. The owner has decided to build it, staged (section 14).

Related: [40 family tenant](#0-how-this-relates-to-earlier-notes) (design on branch `claude/design-family-tenant-bdb1b5`, not
on `main`), [24 backup file](24-export-import.md), [33 privacy audit](33-privacy-audit.md),
[38 consent](38-consent-and-terms.md), [16 doctor access](16-doctor-access.md), [39 self-hosting](39-self-hosting-page.md),
[43 funding](43-funding-options.md), `docs/DEPLOY.md` ("Database roles", "Applying migrations").

## 0. How this relates to earlier notes

- **Design 40 (family tenant, branch only)** routes a request to a *second whole database* chosen by a token role, from a
  static config. It keeps users, consents, members and babies in that database (every table in the tenant). BYO is a
  different shape: **the control data stays in the Lotties database and only the baby's records move**, to a database
  Lotties does not run, chosen by the user at run time. They share one piece: a per-request resolver that binds a scope to
  one `NpgsqlDataSource` (40 section 2.4: `AddDbContext` not `AddDbContextPool`, one pool per data source, fail closed, no
  ambient tenant in jobs). If 40 is built first, BYO reuses that resolver; if not, BYO builds it. BYO does **not** reuse
  40's "the whole schema in the other database", because accounts, roles, invites and doctor access must be readable
  without the user's database being up.
- **Design 24 (backup file)** is the transport for moving data in and out (section 8).
- **Encryption levels (nickname, field encryption, E2EE)** are in the owner's memory notes only; no document in `docs/`
  records them. Section 11 states what BYO does and does not give against the operator. The owner is undecided on
  encryption, and BYO must not be sold as the answer to it.

## 1. Decisions in one table

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| D0 | Opt-in | **Opt-in, per baby, reversible; hosted is the default; the flag is off by default** | The hosted path must stay the one everyone uses; BYO is an extra store, never a migration of the user base |
| D1 | Unit of routing | **Per baby**, the store is *owned by an account* (the Owner of the baby) and the baby points at it | A baby is shared by several accounts (members), so a per-account store cannot serve shared babies; a baby-level pointer lets one Owner keep babies in different places |
| D2 | What moves | Records **about the baby's care** (events, custom event types, medications, prescriptions, formulas, appointments, care providers, vaccinations, measurements, notes, proposals, note reads) | Content is where the health data is |
| D3 | What stays in Lotties | Accounts, consents, memberships and roles, invites, doctor access and its log, push subscriptions and notification preferences, settings, the board, the public catalog, and (MVP) the `babies` row | The app must authenticate, authorize and show the list when the store is down |
| D4 | Connection input | **Structured fields**, not a free connection string; the API builds the string | Blocks connection-string option injection |
| D5 | Credential at rest | Envelope encryption, AES-256-GCM, key from a Secret (KMS later). Said plainly: **not readable by DB admins and backups, readable by the API and therefore by the operator** | The API must connect without the user |
| D6 | Role in the user's DB | User creates two roles owning one schema `lotties` only (app, migrator) with our copyable SQL | A leaked string reaches only the Lotties schema |
| D7 | Network | Public Postgres hosts only, TLS verified, port allowlist, resolved IPs pinned and checked, plus a Kubernetes egress policy | The home-lab API can reach the owner's other databases |
| D8 | Schema | Same generic `Event` + JSONB model; a separate EF "data" context with its own migrations, applied by the API per store, lazily, under a lock | No per-user SQL |
| D9 | Background and voice | Alexa/MCP work through the same resolver. **Push reminders for BYO babies are off in the MVP** | Reminders poll every store every tick |
| D10 | Unlock | Server-held key only in the MVP. A per-session user passphrase is deferred | It would disable Alexa, MCP and every job |
| D11 | MVP | One store per account, Owner only, no members, no doctors, no reminders, in-API move in and out through the backup file | Smallest thing that proves the router and the guard |

## 2. Architecture

### 2.1 The two planes

```
client (Dexie outbox) ──> Lotties API ──> control DB (Lotties-run Postgres)
                              │              accounts, members, roles, consents, invites,
                              │              doctor access, push, settings, data_stores, babies.store_id
                              │
                              └─ resolve(babyId) ──> data store
                                     ├─ built-in: the same Lotties DB, data tables (every baby today)
                                     └─ external: user's Postgres, schema `lotties` (BYO)
```

One abstraction, `IDataStore` (a scoped service holding the `NpgsqlDataSource` of the resolved store), has two
implementations; the built-in one is the Lotties database, so **every baby goes through the same code path** and the
non-BYO path is not a special case that rots. A request does: authenticate, read membership/role/scope from the control
DB, **then** resolve the baby's store, then run data queries. Visibility rules that join members to data (private note
visibility, Doctor scopes) are evaluated in the application: read the allowed author ids and scopes from the control DB,
pass them as parameters to the data query. This replaces SQL joins across the two planes (they cannot cross databases).

Routing key: `babies.store_id` (nullable, null = built-in) -> `data_stores` row (owner user id, provider label, state,
sealed descriptor, `schema_version`, `epoch`, timestamps). The resolver takes a **baby id that the authorization step
already checked**, never a client-supplied store id. The `LottiesDbContext` is split in two:

- `LottiesControlDbContext`: the control tables above.
- `LottiesDataDbContext`: the data tables, **with no foreign keys to control tables** (`baby_id`, `created_by` are plain
  uuids). Integrity (this baby exists, this author is a member) is checked by the services before the write, and erasure is
  already explicit in `EfAccountDataEraser`. The built-in database keeps its existing foreign keys (the data model just does
  not declare them), so no destructive migration is needed on `main`'s database. `medications.product_id` becomes a logical
  reference to the public catalog; the API joins medicine names itself. *Unverified: how many foreign keys cross the
  line today and whether any query relies on a database-side join; this is the first task of the plan (T0).*

Doc 40 chose "the database is the isolation, not a predicate", with no tenant column and a scoped context that throws if no
scope is set. Keep both rules: `IDataStore` throws without a resolved store, there is no default, no "unavailable ->
built-in" fallback (a BYO baby whose store is down gets `503 store_unavailable`; it never silently writes to Lotties).

### 2.2 Who sees what when the data is in the owner's database

| Actor | How | Note |
| --- | --- | --- |
| Owner (MVP) | Through the API, as today | The only supported actor in the MVP |
| Parent, Caregiver, Viewer (stage 2) | Through the API; they never get credentials | The store belongs to the Owner's account. If the Owner removes the store, members lose the data (they must be told at invite time and in the leave/removal dialog). Each member's core consent already covers Lotties processing; stage 2 adds a line to the invite screen naming the store provider |
| Doctor (stage 3) | The doctor's read goes to the *family's* store through the router, with the scope checks in the control DB (`BabyScope:*`, design 16/19) | A patient list fans out to N stores (N free databases woken for one page) and is slow; cache a per-patient summary only in process memory. The doctor's notes and consultation measurements are written into the family's store (the family's record); if the store is removed the notes go with it, and the doctor's profile stays |
| Invites | Control DB, unchanged | Accepting an invite never exposes the store descriptor |
| Alexa / MCP | Same command layer (`Application/Assistants`), the router resolves by the linked account's baby | Needs the server-held key: with a store down the answer is the existing "temporarily unavailable" spoken text, never a guess. Answers still follow every no-names/no-free-text rule of design 32 |
| Anonymous aggregate / community insights (34, 39) | **BYO babies are excluded** (the job reads only built-in stores) | Pooling data the user chose to keep elsewhere would defeat the choice; revisit only with a separate explicit consent |
| Push reminders | MVP: **not available** for a BYO baby. Stage 3 option: compute "next due" per baby on demand with a long tick (e.g. 5 min) and a per-store circuit breaker | A tick over all stores wakes every free database, burns connections of free tiers and makes a down store a recurring error. A stored "next feed at 14:00" in the control DB is derived health data in Lotties' hands: if ever done, it must be disclosed |
| Background jobs (housekeeping, demo cleanup, push) | Run per store in their own DI scope with the store set explicitly; **no ambient store outside a request** (rule from 40 section 3) | A job that does not name a store fails |
| Account deletion | Section 9 | |
| Backup export/import | Reads/writes through the resolver (section 8) | |

### 2.3 Sync contract per store

The contract in SPEC "Events sync contract" is unchanged: client GUIDs, idempotent upserts, soft deletes, server
`updatedAt` as the delta cursor, conflicts by client `updatedAt` vs stored `ClientUpdatedAt`, never compare the client
clock with server `updatedAt`.

- `updatedAt` is assigned by the **API** (as today), not by the user's database, so a store with a skewed clock does not
  matter. The cursor is monotonic **per store**.
- A store can go *backwards* (the user restores an old backup of their database, or swaps databases): a client cursor then
  runs ahead of the data and silently misses rows. So each store carries an **`epoch`** (random, stored in the control row
  and in `lotties.store_meta` in the user's schema). Sync responses include it; a client that holds a different epoch
  discards its cursor and does a full pull (design 40 section 6.3 does the same for a database move). *Unverified: how the
  current web sync handles a changed cursor basis; it must be read before T2.*
- The outbox is untouched: a write that gets `503 store_unavailable` stays queued like any offline write (section 6).
- There are no transactions across the two planes. A write validates in the control plane (role, membership), then writes
  one store in one transaction. The control plane writes nothing derived from the payload.
- Offline-first Dexie: the client is unchanged apart from handling the new error codes and the epoch field.

## 3. Security

This is the main risk. The threat is **the Lotties API becoming a tool that connects to attacker-chosen hosts with
attacker-chosen credentials**, from a pod inside the owner's home network.

### 3.1 Threats

| Threat | Handled by |
| --- | --- |
| SSRF / internal scanning: user "connects" to `10.x`, `192.168.x`, the owner's other databases, `localhost`, link-local, the cloud metadata address | Section 3.2 (application guard) **and** a Kubernetes egress policy (defence in depth: the application guard is one bug away from failing) |
| DNS rebinding: name resolves to a public IP at check time and a private one at connect time | Resolve once, check **every** returned address, connect to the pinned address; re-check on every new pool |
| Credential stuffing / port scan through "Test connection" | Section 3.4 |
| Connection-string injection (`Options=`, `Passfile`, `SslKey`, extra hosts, `Application Name` with newlines, `Include Error Detail`) | Structured input; the string is built by us from an allowlist |
| Request for baby A reaches store B | Section 3.6 |
| Leaked database credential from our Secret/backup/log | Envelope encryption, never logged, least-privilege role |
| Malicious or compromised user database returns hostile data | Treat results as untrusted: same validators as any input; JSONB payloads are never executed; size and row caps per query |
| Operator reads the user's data | **Not prevented** (section 3.5, 11) |

### 3.2 The egress guard (`IStoreEndpointGuard`)

Applied when the descriptor is created, on test, and on **every new physical connection** (not only once).

1. **Input**: `host` (DNS name or literal IP), `port`, `database`, `username`, `password`, `sslMode`. Lengths limited, no
   control characters, no `;` `=` `\0`. No other connection option can be set by the user. The API adds fixed options:
   `Timeout`/`Command Timeout`, `Maximum Pool Size`, `Pooling`, `Application Name=lotties`, no GSS, no passfile, no
   client certificates, no `Options`.
2. **Port allowlist**: 5432 and 6543 (pooler ports). Other ports only by owner-curated provider presets.
3. **Resolve ourselves** (system resolver, timeout 3 s, IPv4 and IPv6), then require **every** address to be *globally
   routable*. Reject: loopback, `0.0.0.0/8`, RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT `100.64/10` (common in
   home labs and tailnets), link-local `169.254/16` (metadata `169.254.169.254`), `fe80::/10`, ULA `fc00::/7`,
   multicast, reserved ranges, documentation ranges, and IPv4-mapped/compatible/NAT64 forms whose embedded IPv4 is
   non-public (`::ffff:10.0.0.1`). Reject numeric-looking hosts in decimal/octal/hex forms (`2130706433`, `0x7f.1`):
   a literal IP must parse as a canonical dotted/colon form. Reject the owner-configured deny list (the lab's public IP,
   the cluster pod/service CIDRs, the Postgres host the control DB uses).
4. **Pin**: connect to the validated IP, not to the name. TLS must still be verified against the *original host name*:
   `SslMode=VerifyFull`-equivalent through a certificate validation callback that checks the name and chain, with
   `Host` set to the pinned address. *Verified in a spike ([47a](47a-byo-database-spikes.md) (b)): `SslMode=Require` + `UseSslClientAuthenticationOptionsCallback` with `TargetHost` = the typed name and our own chain/name validation works; `VerifyFull` cannot be combined with a custom callback.*
5. **TLS required**, no `Disable`/`Allow`/`Prefer`/`Require` without verification: only a verified chain. Providers that use
   a private CA (some poolers) need the user to paste the CA certificate (PEM, size-limited, parsed, stored in the
   descriptor); never "trust anything".
6. **Timeouts and caps**: connect 5 s, command 15 s, statement and idle-in-transaction timeouts set on the role by our
   setup SQL, `Maximum Pool Size` 5 per store, a global ceiling on live pools with LRU eviction (the API evicts idle store
   pools after e.g. 10 minutes, which also lets paused free databases sleep), result row and byte caps.
7. **Egress policy (infrastructure, not code)**: a `NetworkPolicy` (or the lab firewall) for the API pod that denies
   the private ranges (RFC1918, CGNAT, link-local, the pod/service CIDRs) except the explicit allow of the control
   Postgres, Keycloak, and in-cluster services the API already needs; allows 443/5432/6543 to the public internet. *Unverified:
   the enforcement available on the owner's k3s (k3s ships a NetworkPolicy controller by default, but this was not checked
   on the cluster) and whether the API's current allowed paths can be enumerated. `deploy/homelab` and `docs/DEPLOY.md`
   get the manifest; the owner applies it.* Better still, if the lab allows it: run store connections from a separate small
   pod ("data gateway") that has *no* route to private ranges at all and holds the key; the API pod talks to it. That is a
   second service to run, so it is a decision (D-B), not the MVP.

### 3.3 Credential handling

- `data_stores.sealed_descriptor`: AES-256-GCM with a fresh random data key per descriptor; the data key is wrapped by a key
  from a Kubernetes Secret (`BYO_KEK_<id>`), with a key id stored next to it so keys can rotate (re-wrap, no re-ask of
  users). Associated data = store id + owner id + format version, so a sealed blob copied to another row fails to open.
  Later the wrapping key can come from a KMS or Vault transit if the lab runs one; the code takes an `IKeyWrapper`.
- Only non-secret display fields stay readable: provider label, state, last-ok time, the *last four characters of the host*
  (to tell two stores apart). Host, user, database, password, CA are sealed.
- **What "not readable" really means**: the descriptor cannot be read by someone with only a database dump, a backup or a
  `SELECT` on the control DB. It *can* be read by anyone who can run the API with its Secret (the operator, a compromised
  pod, a developer with `kubectl get secret`). The UI and policy must say this (section 10).
- Never logged: the descriptor, host, user, password, connection string, and the **exception text of a failed connect**
  (Npgsql errors can echo the host and user). Log a store id, a coarse error class and a duration. HttpClient-style
  category rule from address lookup applies: the logger category for the connection layer is configured to `None` for
  messages carrying the string, and a test fails if the string appears in captured logs.
- Decryption happens in a narrow `IStoreCredentials` service, the plaintext lives only in the `NpgsqlDataSource` it builds
  (and the migrator, section 5). No endpoint ever returns it, not even to the Owner: the UI shows the provider label, the
  user name's last characters and "Replace credentials".
- **Rotation and revoke**: `PUT` a new password replaces the sealed blob and rebuilds the pool; `DELETE` removes the
  descriptor, disposes the pool, and (if asked) wipes our rows (section 9). An API-side kill switch per store state
  (`Disabled`) stops all use without deleting. The user can also revoke from their side by changing the role password; the
  store then goes `Unreachable` with an `auth_failed` class and the app asks for the new credentials.
- **Least privilege** (the main answer to "a leaked string"): our setup SQL (`docs/sql/byo-setup.sql`, generated per provider
  in the UI with the user's chosen passwords) creates `lotties_migrator` (owns schema `lotties`, can `CREATE` there) and
  `lotties_app` (DML on that schema only), `REVOKE ALL ON SCHEMA public`, no `CREATEROLE`, `CREATEDB`, `SUPERUSER`,
  `BYPASSRLS`, `statement_timeout`, `idle_in_transaction_session_timeout`, `CONNECTION LIMIT`. Never the provider's admin
  user (`postgres`). The guard cannot prove this from outside; the test-connection step **checks** it (the role is not a
  superuser, cannot create roles, cannot read other schemas' tables it should not own) and warns, but a user can ignore the
  warning. Both roles' secrets are stored (the migrator one is opened only inside the migration path).
- **User-supplied unlock** (per session passphrase, the descriptor sealed with a key derived from it, kept in API memory
  for the session): hides the string from a stolen Secret and from the operator *while nobody is signed in*, but the
  operator still sees it in memory during use, and every feature that runs without the user (Alexa, MCP, any job)
  stops working. It adds a failure mode (restart of the API loses all unlocks) for a small gain. **Deferred**; not
  recommended for the MVP.

### 3.4 The test-connection endpoint

It is a port scanner and a credential-testing oracle if left open.

- Signed in, current core consent, Owner of the baby, **and** BYO optional consent given (section 10).
- Rate limit per user: e.g. 5 per hour, 20 per day; per remote address: 20 per hour; global: a small constant per minute.
  Each test counts, successes included. A new host name counts double. (`UserRateLimits` and the address limiter exist.)
- Same guard as a real connection; responses are coarse: `ok`, `host_not_allowed`, `unreachable`, `tls_failed`,
  `auth_failed`, `role_too_powerful`, `schema_conflict`, `version_unsupported`. No banner, no timing difference exposed, no
  distinction between "closed port" and "filtered", no resolved address in the answer or log. A failure reason never includes
  server text.
- Total work bounded: one resolve, one connect, a fixed list of checks, 10 s overall.
- Blocked in the demo (`DemoBlockedRoutes`).

### 3.5 What the operator can do (stated)

The operator holds the key and the API code, so they can read every BYO baby's data through the API or by decrypting the
string. Controls that reduce *accidents*, not intent: the descriptor is sealed at rest; reads are logged by route and
store id only; no human-facing admin endpoint returns data from a store. "Hide data from the operator" needs a design the
API does not read (section 11), and BYO is not one.

### 3.6 Tenant isolation inside the API

- `IDataStore` is **scoped**, built from the resolver after authorization; `AddDbContext` (never `AddDbContextPool`), as in
  40 section 2.4.
- The resolver input is a `BabyId` that has just passed `BabyPolicies`; a service never receives a `StoreId` from the client.
- A data-plane query always carries `baby_id`; every repository method takes the baby id. A **cross-store test**: two
  stores, two babies, every baby route and every assistant command hit with baby A's token and baby B's id and the reverse
  (`EndpointRoleMatrixTests` drives the route list; a new test iterates the same list).
- A `NpgsqlDataSource` per store id, cached in a singleton keyed by `(storeId, descriptorVersion)`; replacing credentials
  creates a new key and disposes the old one after in-flight work ends. The cache is never keyed by host.
- Migration and wipe code take an explicit store; none reads "the current" store.

## 4. Schema management

- The data context has **its own migration chain**, history table `lotties.__ef_data_migrations`, schema `lotties`
  (never `public`, so the provider's REST/auto-API on `public` does not expose it; *unverified for each provider, the setup
  guide checks that the schema is not in the provider's exposed-schemas list*). The control chain stays as today.
  For the built-in store the data chain is applied to the Lotties database the way migrations are applied now
  (`dotnet ef` default, or `DB_AUTO_MIGRATE`); data tables there stay in `public`, so the built-in path is a mapping
  difference (schema name per store kind) rather than a data move. Whether that is feasible without a rename migration
  is a T0 question; the fallback is the data model using `public` everywhere and the user's schema being called
  `public`-compatible via `search_path` set on the role (the user's DB, their schema `lotties`, `search_path = lotties`).
- **The model stays generic**: typed `Event` + JSONB payload; never a table per event kind; no per-user SQL; the only
  per-user text we run is the setup SQL the user runs themselves and the EF-generated migrations.
- **Who migrates**: the API, with the migrator credential, **lazily on first use of a store by a new API version** and on
  "connect" (the move-in flow). Not at API startup for all stores (a down store must not block a release, and N
  external databases must not slow the start). Under a session-level advisory lock on a **session-mode** connection (a
  transaction pooler breaks session advisory locks and prepared statements; the setup guide tells users to use the direct
  or session-mode endpoint for the migrator and gives the pooler endpoint for the app role if they like).
  *Unverified per provider: which endpoint is IPv4-reachable from the home lab on a free tier. Supabase documents a direct
  connection that is IPv6 by default and poolers on 5432/6543; I could not confirm the free-tier IPv4 position, and the
  lab's IPv6 reachability is unknown. T0-c tests this on throwaway accounts.*
- **Version compatibility**: migrations stay additive (current convention). The control row holds `schema_version` and the
  store has `lotties.store_meta (schema_version, epoch)`. States: `Pending` (first connect), `Migrating`, `Ready`,
  `MigrationFailed`, `SchemaAhead` (rolled-back code vs newer schema: 503, never serve a schema the code does not know),
  `Unreachable`, `Disabled`. Only `Ready` serves. A request to a `Pending/Migrating` store waits up to a few seconds,
  then 503 `store_migrating`. `MigrationFailed`/`Unreachable` retry with exponential backoff and jitter, plus a "Try again"
  button; a paused database stays `Unreachable` until woken.
- **The user changes the database** (new host): a new descriptor goes through the full test; if it points at a database that
  already has the `lotties` schema with a *different* `epoch` for this baby, ask "use the data already there (restore) or
  replace it?" Never merge silently. Dropping or editing our tables by hand is the user's risk; the schema check at
  connect fails closed (`schema_conflict`).
- A migration error leaves the store unchanged in the common case (EF runs each migration in a transaction on Postgres,
  except statements that cannot); we never run `DROP`/`TRUNCATE` on tables we did not create.
- Tests: the existing SQLite host cannot prove Postgres behaviour. See section 12 (T-tests).

## 5. Availability and failure modes

| Situation | API | App | Data |
| --- | --- | --- | --- |
| Store down / network error / TLS failure | Circuit breaker per store (open after 3 failures, half-open probe every 30 s); `503 store_unavailable` with a coarse class; writes are not accepted | Banner "your database is not reachable" with the class, link to the provider, last good sync time; reading shows the Dexie copy | Outbox keeps writes; delta pull resumes by cursor |
| **Free project paused** (inactivity) | Connect fails as `Unreachable`; first request after the user wakes the project reconnects | Message names the likely cause ("paused for inactivity on some free plans"), tells the user to open the provider and resume, "Try again" | Same |
| Slow store (latency spikes, cold start) | Timeouts above; aggregations time-boxed; stale cache allowed to answer reads with a "from N min ago" flag | Skeleton + stale value | |
| Over quota / read-only (storage cap) | Write fails with `store_full` (classified from the Postgres error), reads continue | "Your database is full" with "export" and "clean up" help | Outbox keeps the writes |
| Wrong credentials (rotated by user) | `auth_failed`, state `Unreachable` | Ask for new credentials (Owner); others see "the owner must reconnect" | |
| Schema ahead/conflict | `SchemaAhead` / `schema_conflict` | Update message / contact | |
| Latency from the lab to the region | The cost is per round trip; an aggregation must use **one query per window** (events of the last N days), then compute in the API with the existing Domain functions | | |

- **Read-your-writes**: one store, the same connection pool and a single primary; reads after a write see it. Read replicas
  or pooler-fronted replicas are not supported (the setup guide says to give the primary endpoint).
- **Caching of aggregations**: in-process only, keyed `(storeId, babyId, max(updatedAt) of the window)`, short TTL, dropped
  on write. **Never** a persistent cache of health values in the Lotties database (that defeats the point); this is a rule,
  the same family as design 41's "memory cache only".
- **Outbox and Dexie**: unchanged. The sync engine must treat `503 store_*` as retriable (not as a rejection that drops the
  change). *Unverified: today's handling of 5xx in the outbox; read before T9.*
- **Free-tier connection limits** matter: with five pooled connections per store and N API replicas the user's limit
  (which on small plans is small; Supabase lists pooler/direct client limits by compute size, Neon has pooled and unpooled
  limits by compute) can be reached by one user's single phone. Defaults: pool max 3 per store per replica, idle
  eviction, and the setup guide recommends the provider's pooler endpoint for the app role.
- **Backups of the user's database** are the user's: some free tiers have none or short retention (section 7). Lotties
  offers the existing **export** (design 24) as the portable backup and may remind the user (a monthly "download a backup"
  banner, optional). Lotties does not keep a copy of BYO data; promising a backup would defeat the choice.

## 6. Moving data in and out (reuse design 24)

**Into the user's database (one-time):**

1. The user finishes setup and test (state `Ready`, empty store). The baby enters state `MovingIn`: writes are queued
   (clients get `409 baby_moving`, which the outbox retries; short, minutes).
2. `IBackupExportService.WriteAsync` streams the baby from the *built-in* store; `BackupApplier` writes into the *target*
   store through the same application services (all validators, the sync contract) in transactions by section. Ids are kept
   (this is the same baby: the "merge into its own baby" path of 24 section 4.3, no re-derived ids). The existing counts +
   SHA-256 checksum of the file are verified against the target by re-reading the target through the export path.
3. The baby's `store_id` flips to the new store and the `epoch` changes (clients fully re-pull; the outbox flushes to the new
   store).
4. **Old rows in the Lotties database are not deleted automatically.** They stay, read-only and unreferenced, for a window
   the owner sets (default 7 days, "undo"), then a job erases them. Until they are erased, the privacy gain is not real, and
   the UI says so with the date. A failed copy leaves the baby on the built-in store (the pointer flips last).

**Back to Lotties-hosted:** the reverse (export from the user store, import into built-in, flip, optional wipe of the user's
schema on request). The user can always take the file and leave: that path never depends on the store being up, except to
read it.

**Backup file (design 24):** the `lotties-backup` file never contains the descriptor or any credential. The file is the
portable format; it stays per baby. A `BackupApplier` that targets a store needs the resolver's target explicitly (no
ambient store).

## 7. Cheap hosts: what to suggest (searched 2026-11-07, not verified against vendor pages)

Prices and limits change often and were read mostly from secondary pages by an automated search; the owner (or the first
implementer) must open each vendor page before the UI names a number. The product must **not** promise prices: the setup
guide says "free tiers exist at the time of writing, with limits, check the provider page", never a figure.

| Provider | Free-tier facts seen (source) | What matters for Lotties |
| --- | --- | --- |
| Supabase | Pricing page via search: free projects **paused after about 1 week of inactivity**, 2 active free projects, **500 MB** database, other limits (egress, MAU) listed differently by third parties. [supabase.com/docs/pricing](https://supabase.com/docs/pricing), [jetadmin summary](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/amp/) | Pausing is the main risk: a baby tracker used daily keeps the project active, but a quiet month does not. Direct connection vs pooler and **IPv6**: not confirmed. Do not use the `public` schema (its auto API). Region choice (a Brazil region exists as far as known, unverified) |
| Neon | Official FAQ (as seen via search, updated 2026-10-01): free plan 100 CU-hours/project/month, **1 GB storage per project**, scale-to-zero (idle suspend; third parties say about 5 min), no overage billing. [neon.com/faqs/free-plan-limits-and-quotas](https://neon.com/faqs/free-plan-limits-and-quotas) | Scale to zero means the **first request after idle is slow** (cold start) and every Alexa call may pay it; a project over the storage cap rejects writes. Pooled vs direct endpoint matters for migrations |
| Aiven | Secondary page claims a free plan with about 5 GB ([swyftstack](https://swyftstack.com/blog/free-postgresql-hosting)); not verified | Check terms (idle shutdown, region list) before listing |
| Prisma Postgres | Secondary page: 2 GB, 200k operations per month ([prisma.io](https://www.prisma.io/postgres/free-postgresql-hosting)) | An operations cap fits a tracker poorly (every sync is operations); not recommended until measured |
| Railway, Render | Conflicting secondary claims (a free credit; a trial). Not verified | Do not list |
| A VPS / the user's own server / another cheap managed Postgres | Not researched | Works with any provider that meets the guard (public IP, verified TLS, a role we can create) |

**Limits that matter, in order:** (1) **idle pausing / scale to zero** (availability, section 5), (2) **connection limits**
(one phone must not exhaust a small plan), (3) **storage cap** (a back-of-envelope: an event row with indexes and a small
JSONB payload is likely well under 1 KB; at ~30 events a day a baby writes roughly 11k events a year, i.e. a few MB a year;
500 MB is not the constraint for a long time. *Estimate, not measured; measure with the real schema in T0.*), (4) **region**
(latency from the lab per query, and LGPD art. 33 international transfer when the region is outside Brazil), (5)
**backups** (free tiers often have none or short retention; I did not confirm any provider's free backup policy), (6) **IPv4
vs IPv6 reachability from the home lab**, (7) **provider terms** about health data and the account owner (a free account
can be closed).

**Recommendation:** document two worked guides first, Supabase and Neon (the setup SQL is provider-neutral Postgres, the
guide differs only in clicks and the right endpoint), call them *examples*, and keep the product provider-neutral. Do not
build provider-specific code (no Supabase API keys, no management-API integration: an API key to the user's cloud account
would be a far worse secret than a role limited to one schema).

## 8. Product

Everything in this section applies only to a person who opens "Use your own database". Nothing in the hosted flows
(sign-up, baby creation, invites, sync, export, deletion) changes for anyone else, and the entry sits behind the flag.

### 8.1 Onboarding ("Use your own database", Settings > Privacy and data)

1. **What this is, in plain words**: your records are stored in a database you control; Lotties still reads and writes it
   to run the app; Lotties can read it while the service runs; you can leave at any time. A required line: "this is not
   end-to-end encryption" (section 10).
2. **Pick a provider** (two guides + "other Postgres"): costs may apply; limits that matter (section 7), region.
3. **Copy this SQL** (role + schema, with generated passwords the user can regenerate, copyable per provider). Link to
   the provider's SQL editor. The SQL is generated in the browser (like `/self-host` generate.ts: nothing typed is sent
   until the user presses Connect; a test asserts no network call).
4. **Paste the connection details** (host, port, database, the two users and passwords). Press **Test**. Show the coarse
   results with a fix for each ("use the pooler endpoint", "role too powerful").
5. **Choose data to move** (existing data -> "move my history", default; or start empty).
6. Consent step (BYO consent, section 10), then **Move**. Progress with counts, then "You can undo until <date>".
7. Settings afterwards: status (Ready / Unreachable...), last sync, **Replace credentials**, **Move back to Lotties**,
   **Download a backup now**, **Disconnect (keep my data in my database)**, **Disconnect and delete my data there**.

### 8.2 What other people see

MVP: nothing changes for others because there are none. Stage 2: the invite screen and the member list show that the baby's
records are kept in a database the Owner chose; leaving the baby does not delete anything in it (it never did); if the
Owner disconnects or deletes the store, members see a banner. A Doctor sees only what her scopes allow, as today; she is
never given a credential.

### 8.3 Effort pricing (honest)

- Operator cost: the home-lab Postgres load drops only for BYO babies; the bill is electricity and internet (design 43), so
  **no meaningful saving** until the dataset is large. The real value is trust and a storage ceiling that is not ours.
- Support cost rises sharply: every failure is "my provider" (pausing, IPv6, pooler, quota, rotated password, region).
  Expect most support to be setup. Budget for good error classes and guides, not for a promise of help with each provider.
- Engineering cost is large (section 12) because the model must split in two. Without design 40, that split is the bulk.

### 8.4 What to cut

No provider API integration. No sharing, doctors, reminders or aggregate participation in the MVP. No per-session unlock.
No auto-wake of paused databases. No Lotties-managed backups of BYO data. No more than one store per account. No custom
CA input in the MVP unless a target provider needs it (decided in T0).

## 9. Account deletion and the user's database

- The user's database is theirs. Deleting the account **deletes the descriptor** (sealed blob, key id, pool) in all cases
  (`EfAccountDataEraser`, a rule in `AccountErasureTests.Rules` for `data_stores` and `babies.store_id`; the test is
  model-driven and fails until the rule exists).
- The delete dialog gets a choice, **default on**: "also delete my data in my database". Lotties then, before removing
  the descriptor, wipes *its* rows: for each baby the Owner owns and that no other member keeps, it deletes the baby's rows
  in schema `lotties` (the same eraser logic as the built-in store, run against that store through the migrator role),
  then drops nothing else. If the store is unreachable the dialog says so and gives the SQL the user can run
  (`DROP SCHEMA lotties CASCADE;` and drop the two roles), and Lotties **does not delete the descriptor until the user
  chooses to proceed anyway**, because after that Lotties can no longer reach it. A shared baby (other members) is kept
  and handed to the policy that already applies for kept babies (the row stays under the anonymised author); the BYO
  store of a baby with other members follows the Owner's choice at the time of the leave (a rule to settle in stage 2).
- The eraser's data-plane half has its own fixture test: a store with a row in every data table of a baby, erased, empty.

## 10. Legal and privacy

- **New data flow**: all baby records are written to and read from a database provider **chosen by the user**
  (Supabase, Neon, ...), in the region the user picked, and the connection credentials are held (sealed) by Lotties. Updates:
  the policy text in both languages (`legal/privacy.{en,pt-BR}.ts`), `legal/dataFlows.ts` (new entry: recipient "database
  provider chosen by you", data: baby records, trigger: you connect a database, country: provider's region), the audit
  (`33-privacy-audit.md`: a new section and a row in section 3, with the sealed-credential fact and the operator's access),
  and the policy version/date.
- **Consent**: a new *optional* consent kind `byo_database` recorded when the person finishes setup, in the style of the push,
  Alexa and MCP records (`PUT /me/consents/optional/...`), wording that names the provider, the region and the plain facts of
  this design. Because the privacy policy changes meaning (a new flow), a new entry in
  `code/web/src/legal/consentVersions.json` **and** `Lotties.Domain.Consents.ConsentVersions` with the new `textDigest`
  (design 38; tests fail otherwise). Whether it is *minor* or *material* is a lawyer question; recommend **minor**, since
  nobody is affected unless they opt in. The core consent text is not changed by BYO.
- **Controller / operator angle**: the baby's health data is sensitive data of a child (LGPD arts. 11 and 14). The parent
  who chooses the provider chooses a processor for their own records; Lotties still decides the purposes and means of the
  processing it runs (it reads and writes the rows) and remains a controller for that processing as far as we can tell.
  The user does **not** become the sole controller, and the provider does not stop being a third party. This needs the
  lawyer (open in `PRIVACY-LAWYER-BRIEF.md`; add a question). International transfer (art. 33) applies when the region is
  abroad.
- **What Lotties must NOT say or imply** (tests of the landing, the privacy page and the setup screen): "we cannot read
  your data", "only you can read your data", "zero-knowledge", "end-to-end encrypted", "your data never touches our
  servers" (it passes through the API and can be cached in memory), "we do not store your data" (the baby row, members,
  settings stay), "your credentials are safe from us". What it **can** say: "stored in a database you control", "the
  connection string is encrypted at rest and never shown again", "Lotties' servers read and write it to run the app",
  "you can disconnect and take your data any time", "the database provider's terms and region apply".
- **Voice and MCP**: unchanged rules (32); the BYO consent does not widen what is spoken.
- **Provider as a third party** also receives IP addresses of Lotties' servers; users' phones never connect to it.

## 11. Alternatives considered

| Alternative | Verdict | Reason |
| --- | --- | --- |
| Client-side sync straight to the user's database (the app talks to Supabase/Postgres, the API sees nothing) | **Rejected** | Defeats the goal (aggregations, Alexa, MCP, doctor summaries are in the API); puts database credentials or JWT-RLS design in every client; no schema control; each platform differs |
| User self-hosts the whole stack (design 39, `/self-host`) | **Kept as the maximal option, not the answer** | Full control, but needs a server, a domain and OIDC; BYO is for people who want the app but their own storage |
| Lotties-hosted database per tenant (design 40 generalized) | **Deferred / separate** | Moves cost and operations to the owner for every user; fine for the owner's own family (40), not for an open product |
| Field-level or end-to-end encryption (operator-blind) | **Deferred, owner undecided** | The only option that actually hides data from the operator; but the server then cannot aggregate, predict, speak (Alexa), or serve doctors, which is exactly what this request wants to keep. A hybrid (the API holds a per-family key in memory only while a signed-in session exists) is the middle path and is a separate design |
| Per-session passphrase unlock | **Deferred** | Section 3.3 |
| One store per account, all babies | **Chosen as MVP constraint** | Simpler UI; the data model (per baby pointer) does not prevent per-baby later |
| Per-account store, shared babies' data in the owner's | **Rejected** | A member's data would depend on someone else's account in ways the model cannot explain |
| Provider API integration (create the project for the user) | **Rejected** | A far more powerful secret than a role limited to one schema |

## 12. Implementation plan

**Status (2026-11-07): T1 is built** (branch `feat/byo-t1-model-split`, not deployed). The control context kept its name
`LottiesDbContext` (renaming it would rewrite every migration's `[DbContext]` attribute and the snapshot) and still maps the
data tables with their physical keys (`BuiltInDatabaseLinks`), so it keeps owning every migration until T5; the data context
`LottiesDataDbContext` maps the 12 data tables without keys to control tables and runs on the control context's connection.
Cross-plane writes found: the member change that cancels a doctor's proposals and the backup restore (both share one transaction
through `BuiltInUnitOfWork`). Two cross-plane places stay on `LottiesDbContext`, valid for the built-in database only: the
reminder candidates query (one statement with `EXISTS` on data tables; T11) and account erasure (both planes in one
transaction; T10). Hosted responses and SQL are pinned by golden tests. `dotnet ef` now needs `--context LottiesDbContext`.

**Status (2026-11-07): T2 is built** (branch `feat/byo-t2-store-resolver`, stacked on T1, not deployed; migration
`20261107124403_DataStores`, additive, not applied anywhere). Every data-plane repository gets its context from the scoped
`StoreScope` (`IStoreScope`): a baby is entered after authorization and stays bound to the store `IStoreResolver` found for it;
a call that names a baby that was not entered throws `store_scope_missing`, a call by record id needs exactly one store in the
scope (`store_scope_ambiguous` otherwise), and a store that cannot be opened is `503 store_unavailable` (every external store
today: `IExternalDataStores` has none in production), never the built-in store. The `/babies/{babyId}` routes enter the
route's baby in an endpoint filter; everything else enters its babies itself: the push planning pass (per baby, a failure skips
that baby), the demo start, the assistants (`AssistantSubjects`, Alexa and MCP), the doctor's patient list, the rest estimate,
a backup restore, and the account eraser (which, until T10, requires every baby it touches to be on the built-in store; the demo
cleanup runs through it). The built-in store is the T1 data context on the control connection (`AddDbContext`, never pooled);
an external store builds its own options. Control table `data_stores` (owner account, state, sealed descriptor bytes, empty)
and the routing columns `babies.data_store_id` (null = built-in, `RESTRICT`) and `babies.store_epoch` (per-baby counter,
default 0) are mapped beside `Baby` by table splitting (`BabyStoreAssignment`), so the baby's own queries are unchanged; EF
cannot bulk-delete a shared table, so the eraser deletes baby rows through the change tracker, and `store_epoch` is nullable in
the schema (an optional table-splitting dependent) with the check constraint `ck_babies_store_epoch_present` keeping it non-null
(EF reads the row only where the epoch is not null). The resolver always reads the pointer (one query per baby per request,
the only change in the golden SQL file; the golden responses are unchanged). `Stores:Enabled` (section `Stores`, the same flag
as T3, bound separately by `StoreRoutingOptions`) is off by default and then only means that no external store is opened: a
baby that points at one gets `store_unavailable` on every way in (routes, assistants, jobs, erasure), never the built-in
database. The epoch reaches clients in the additive header `X-Sync-Epoch` (SPEC "Events sync contract"). The cross-plane unit
of work refuses an external store (T7 moves data through the backup file instead).

**Status (2026-11-07): T5 is built** (branch `feat/byo-t5-store-migrator`, stacked on T2, not deployed; control migration
`DataStoreSchemaVersion` adds `data_stores.schema_version`, additive, empty table). A **separate data migration chain**
(`Persistence/DataMigrations`, `--context LottiesDataDbContext`, history `lotties.__ef_data_migrations`) is generated from the
data context in its external-store shape (`ExternalStoreSchema`: default schema `lotties` plus `lotties.store_meta`, a model of
its own in EF's cache). Its baseline creates the 12 data tables and `store_meta` with no key to a control table and seeds the
built-in event types from the current model. It never runs on the Lotties database, which keeps its own chain and its tables
in `public` (section 4's first bullet is therefore not followed: no rename, no second chain on the built-in database): the
design-time factory points at a `.invalid` host, the baseline's first statement raises on a database that holds the control
tables, and the migrator refuses one too (`SchemaConflict`). `IStoreMigrator` (one per process) migrates a store lazily when
`StoreScope` opens it, after the flag check and before handing it out: migrator endpoint (pinned, unpooled), app role audit
(`RoleTooPowerful`), control/other-store check (`SchemaConflict`, new state; `store_meta.store_id` must be this store),
advisory lock with exponential backoff then `store_migrating`, `SchemaAhead` when the history holds an unknown migration,
`Migrating` then `Ready` or `MigrationFailed`, `Unreachable` for connection failures; states are mirrored in `store_meta` and
`data_stores`, a ready store is trusted for 5 minutes, a failed one backs off (5 s doubling to 5 min). With `Stores:Enabled` off
(the default) a migrator that refuses every store is registered and never reached. Postgres container tests
(`Lotties.Postgres.Tests/Stores`) cover baseline, second run, concurrency, a held lock, schema-ahead, a killed connection, the
too-powerful role, the app role's limits and the control-database refusal; `docs/DEPLOY.md` "Applying migrations to user
stores" is the operator's view.

**Status (2026-11-07): T8 is built** (branch `feat/byo-t8-store-failures`, stacked on T5, not deployed; no migration). Failures of an
external store are classified by type and SQLSTATE only (`StoreFailureClassifier`, `StoreSqlStates`; never the driver's message, host,
user or address) into `store_unavailable`, `store_timeout`, `store_credentials_rejected`, `store_paused_or_unreachable`, `store_quota_full`
(53100, and 25006: the providers' read-only over-quota mode), `store_rate_limited` (53300), `store_tls_failed`, plus the T5 codes
(`store_schema_ahead`, `store_schema_conflict` also for a missing table or column, `store_role_too_powerful`, `store_migrating`,
`store_migration_failed`); every one is a `StoreFailureException` and one rule (`Api/Errors/StoreFailureResponses`) answers it as a
retriable `503` with `Retry-After` (SPEC "Events sync contract"). The design's `store_full` and `auth_failed` names of section 5 became
`store_quota_full` and `store_credentials_rejected`. A per-store circuit breaker (`StoreCircuit`, pure, with `StoreCircuitBreakers` per
process; `Stores:CircuitBreaker`: 3 connection failures, 30 s window doubling to 5 min with 20 % jitter, one probe per 15 s lease)
gates `StoreScope.OpenExternalAsync` (an open breaker throws the opening class at once, without the migrator or the network) and every
new physical connection (`StoreFailureInterceptor.ConnectionOpening`); only unreachable/timeout/credentials/too-many-connections/TLS
failures count, a full store keeps serving reads. Every external store's contexts must carry `StoreFailureInterceptors.For(storeId)`
(contract on `IExternalDataStores`; production still has no external store, so the future implementation must add it): it reports
successes and failures to the breaker and replaces a classified driver error with the class's exception (no inner exception), so a
failed save is the usual rolled-back EF transaction wrapped in `DbUpdateException`, which `DomainExceptionHandler` unwraps; errors
without a class (unique violations) pass through unchanged. `ExternalStoreSchema` turns off EF's connection and error log events
for external stores (they name the server and carry the driver text). The migrator classifies its connection failures the same way
(still state `Unreachable`) and replays its backoff with `Retry-After`. Command timeouts are the data source's (15 s app, 120 s
migrator; the contexts set none). The assistants' command layer answers any store failure with `temporarily_unavailable`
(`AssistantResultCode.TemporarilyUnavailable`, Alexa en/pt-BR, MCP refusal); no voice command changed. `IStoreHealth.Forget(storeId)`
drops the breaker, ready flag and backoff of a store: the endpoints that replace or delete a descriptor (T6) must call it. **In-process caches
(audit)**: nothing read from a store outlives its request. What the process keeps per store is the migrator's 5-minute ready flag and
failure backoff (`StoreMigrator`, by store id) and the breaker (by store id: counters and the last class); a baby that moves gets a new
store id, so neither applies to its new store, and a replaced descriptor is forgotten through `IStoreHealth`. Other process-wide state,
none of it baby data or keyed by baby: `AnswerCache` (address lookup answers, by typed text, design 23), `AlexaCertificateChains`
(Amazon signing certificates by URL), `AssistantRateLimiter` (per-user counters), `PushMetrics` (counters), `NotificationTickRunner`
(next housekeeping time), the embedded vaccine schedule and age norms, EF's model cache (models only, external keyed apart). There is
no prediction or aggregation cache in the API (predictions are computed per request). Not covered: a connection lost while the rows of
an already started query stream in surfaces as the driver's exception (a 500), because EF has no interceptor for row reads; a real
"disk full" is not simulated in the container tests (it needs a size-limited volume under the data directory); its SQLSTATE is in the
classification table and the providers' read-only over-quota mode is simulated instead. Container tests (CI only):
`Lotties.Postgres.Tests/Stores/StoreFailurePostgresTests.cs` (paused database: timeout, breaker, recovery; stopped and restarted
database; killed backend; role connection limit; wrong password; command and statement timeouts; read-only database).

**Status (2026-11-08): T6 is built** (branch `feat/byo-t6-store-endpoints`, not deployed; control migration `DataStoreManagement`
adds `data_stores.provider_label`, `last_checked_at`, `last_check_result`, additive, empty table). The Owner's routes
`GET|PUT|DELETE /babies/{id}/data-store`, `POST .../test`, `.../move-in`, `.../move-out` (501 until T7) answer a bare 404 while
`Stores:Enabled` is off (before any 401) and, after authorization, to an Owner whose account is not on `Stores:Allowlist` (account
ids or OIDC subjects; e-mail is not matched because the API never reads that claim). One store per account in the MVP, without a
unique index on the owner (so per-baby stores stay possible in stage 3): the first store's id is derived from the owner
(`DataStore.FirstStoreIdOf`, UUID v5), so two simultaneous first saves meet on the primary key and the second replaces the first's
descriptor. A baby's store is the one its pointer names (it must be the caller's, else 403 `store_not_owned`), else the caller's own.
`PUT`, the test and the move-in need the optional consent `byo_database` (section 3.4; the onboarding order of section 8.1 puts the
consent after the test, so the web must ask for it before "Test", task T9). The test reuses the migrator's session (unseal, pin
both endpoints, app role audit, control/other-store/schema-ahead checks) without migrating, writing or locking, within 10 s, and
records only the coarse code on the row (the state stays the migrator's). Its outcomes: `ok`, an egress guard code (`endpoint_*`), or
a T8 failure class. A store that is down for now (unavailable, timeout, paused or unreachable, too many connections, migrating)
answers like every store failure, 503 with `Retry-After` (`StoreFailureResponses`); an answer about the setup (credentials rejected,
TLS failed, role too powerful with its findings, schema conflict or ahead, quota full, migration failed) is a 200 with the code, as
section 3.4 lists them as the test's results. Saving or removing a descriptor calls T8's `IStoreHealth.Forget`. A password may now
hold any character but a control character (T3 and T4 alike; the string is built by `NpgsqlConnectionStringBuilder`). Per-account
limits: 10 saves or moves and 5 tests per hour.

Tiers: heavy / careful / medium / light. Every task ships tests with it. Each lists the CLAUDE.md conventions it touches.
Order matters; T0 first, because it can kill or reshape the rest.

**Neutrality rule for people who never opt in:** every task keeps the hosted path behaviorally identical. T1 and T2 are
refactors with the built-in store as the only store: the whole existing suite must pass unchanged, API responses and
sync payloads must be byte-identical for a hosted baby (add golden-response tests on the sync routes and a SQL-shape test
that the hosted queries still hit the same tables), the `epoch` field is additive and ignored by old clients, and no new
dependency, migration or table touches a hosted user's rows until the flag is on for that account (the `data_stores` table is
empty and the control migration is additive). The flag defaults to off in `appsettings` and in the home-lab kit.

| Task | Tier | Depends | What | Tests | Conventions touched |
| --- | --- | --- | --- | --- | --- |
| **T0** Spikes (throwaway, no merge): (a) FK and join inventory of the data tables, (b) Npgsql IP-pinned connect + name-verified TLS, (c) Supabase and Neon free accounts: IPv4 reach from the lab, pooler ports, session lock, schema exposure, pause, connection limits, row size measure | careful | none | Written findings in `docs/design/` as an addendum | The spikes' own scripts, not merged | none |
| **T1** Split the model into control and data contexts (data tables without declared FKs; same database for now; no behavior change) | heavy | T0 | Services read the data through the data context; visibility joins move to parameters | The whole existing suite green; ModelTests table lists for both contexts | Persistence/EF (code-first only), `AccountErasureTests.Rules`, `EfAccountDataEraser`, backup (`BackupExportService`/`Applier` use the data context) |
| **T2** `IDataStore` + `IStoreResolver` + built-in store; `data_stores` table (empty); fail-closed scope; sync `epoch` | heavy | T1 (and design 40's resolver if built) | The router with a single built-in store first | Two-store leak tests on SQLite for routing; **Postgres container test** of the router (below) | `EndpointRoleMatrixTests` (no new route yet), sync contract in SPEC (epoch), Dexie client (reads epoch) |
| **T3** Sealed descriptor: `IKeyWrapper`, envelope format, rotation, `IStoreCredentials` | careful | T2 | Library + Secret in `deploy/homelab` | Known-answer + tamper + wrong-AAD tests; "string never in logs" capture test | `.env`/Secrets rules (never read or print `.env`); `AccountErasureTests.Rules` for `data_stores` |
| **T4** `IStoreEndpointGuard` (parse, allowlist, resolve, range checks, pinning) + egress NetworkPolicy manifest | careful | T0 | Pure code with an injected resolver | Table of vectors: loopback, RFC1918, CGNAT, link-local/metadata, ULA, `::ffff:10.0.0.1`, NAT64, decimal/hex/octal hosts, `0.0.0.0`, mixed A records (one private), rebinding with a fake resolver that changes answer, port allowlist, injection characters; a "no network" handler (`NoNetworkHandler` style) | Address lookup's "third parties only on button press" pattern; DemoBlockedRoutes |
| **T5** Store migrator: lazy per-store migrate, advisory lock, state machine, backoff, `lotties.store_meta` | careful | T2, T3 | Data migration chain and history table | **Postgres container test** (below) incl. second run no-op, locked, killed mid-way, schema-ahead | `docs/DEPLOY.md` "Applying migrations" (new subsection), `Persistence/Migrations` rules |
| **T6** Endpoints: `GET/PUT/DELETE /babies/{id}/data-store`, `POST .../test`, `POST .../move-in`, `POST .../move-out`, rate limits, optional consent route `byo_database` | medium | T3, T4, T5 | Owner only | Rows in `EndpointRoleMatrixTests` (Owner; every other role 403; Doctor scope decision), consent-gate coverage (`ConsentGateCoverageTests`), `DemoBlockedRoutes` keys, rate-limit tests | Endpoint role matrix, consent gate, demo blocked routes |
| **T7** Move in/out via the backup file to a target store | heavy | T2, T5, T6 | Streaming copy, count + checksum verify, pointer flip last, undo window job | Container test of a full move both ways; interrupted copy leaves the baby on the source | Backup file (`BackupFile`, `BackupExportService`, `BackupApplier` + tests in `Lotties.Api.Tests/Backups`); never export credentials |
| **T8** Failure behavior: circuit breaker, error classes, `store_*` codes, in-memory cache rules | careful | T2, T5 | Error taxonomy in the API contract | Container test with a killed/paused database; timeout tests | SPEC sync contract (503 retriable) |
| **T9** Web: Settings flow, SQL generator (client-side only), provider guides, status banners, outbox handling of `store_*`, epoch re-pull | medium | T6, T8 | `code/web/src/byoDatabase/`, i18n en + pt-BR under `locales/<lang>/byoDatabase.json` | Component tests incl. "no fetch before Connect", axe; web sync test for epoch change | i18n rule, `docs/design/` showcase media (new Settings screen: `SCREENS`, `demo-video.review.ts`, `landing.*.json`, `SHOWCASE_SCREENS`, README, regenerate) |
| **T10** Account deletion half: wipe-in-store with consent, unreachable path | careful | T7 | Eraser data-plane step | Fixture test: store with a row in every data table | `AccountErasureTests`, `EfAccountDataEraser` |
| **T11** Assistants and jobs through the resolver; BYO babies excluded from aggregate and reminders | careful | T2, T8 | Alexa/MCP resolve per baby; schedulers filter on `store_id` | Command-layer tests with a down store ("temporarily unavailable"); aggregate job never reads external stores | Voice assistants rules (design 32), `docs/VOICE-COMMANDS.md` unchanged |
| **T12** Privacy and legal: policy en + pt-BR, `dataFlows.ts`, audit 33 section, version/date, consent entry in both `ConsentVersions` places with `textDigest`, lawyer brief question, "must not say" test | medium | T6 | Texts only; wording after the owner decisions | `consentVersions` tests, policy tests, a test that forbidden phrases are absent | Privacy policy, consent gate, `PRIVACY-LAWYER-BRIEF.md` |
| **T13** Docs: `docs/DEPLOY.md` (Secret, NetworkPolicy, key rotation, "applying migrations" for stores), `docs/sql/byo-setup.sql`, provider guides, `docs/agents/filemap.md`, `PLAN.md` | light | all | | | docs location rule |

**Postgres container test for the router.** API tests run on SQLite today, so routing and migration behaviour on Postgres
(search_path/schemas, jsonb, advisory locks, roles and grants, `xmin`) are unproven. Add a small test project
(Testcontainers for .NET, `postgres:17`, one container per test class, a second database/role set to play the "external"
store) that runs only where a container runtime exists (CI; the dev machine has none, so tests are tagged and skipped
locally, and the docs say so). It covers: guard is bypassed only in tests by an explicit `AllowLoopbackForTests` option
that does not exist in production configuration; two stores, two babies, no cross-read; the setup SQL creates roles that
cannot touch `public`; migration under concurrency; schema-ahead; killed connection mid-migration; role too powerful is
detected. *Which CI runner and image tag to use was not checked.*

**Staged rollout**

1. **MVP (stages T0-T9 minus members)**: one Postgres connection per account, Owner only, no members/doctors/reminders,
   read/write through the API, move in and out, behind a feature flag off by default and a per-account allowlist
   (owner and a few testers), consent step, honest wording.
2. **Stage 2**: members (Parent/Caregiver/Viewer) and invite wording, the "leave baby" rules, monthly backup reminder, a
   second provider guide.
3. **Stage 3**: doctors, optional low-frequency reminders, per-baby stores for one account, maybe a data-gateway pod.
4. **Not planned**: per-session unlock, provider API integration, hybrid encryption (needs its own design).

## 13. Risks that remain (stated, not solved)

- The operator can read BYO data (section 3.5). Marketing must not suggest otherwise.
- The model split (T1) is a deep change; a mistake there affects every user, not just BYO. It lands first with no behavior
  change and is the main reason to consider not building this.
- Free tiers change terms; a provider can pause, throttle, close an account or change a price, and Lotties cannot fix that.
- Support cost grows faster than the benefit for most users, who want a baby tracker, not a database.
- The egress guard is only as good as its tests and the cluster policy; a bug here exposes the owner's home network.
- Unverified in this document (to settle in T0 or by the owner): Npgsql IP-pinned TLS validation; provider IPv4/pooler/pause
  behavior and every price or limit in section 7; k3s NetworkPolicy enforcement on the owner's cluster; the FK/join
  inventory; current sync handling of cursor changes and 5xx; the legal role split; that design 40 is not merged and its
  resolver may differ.

## 14. Decisions the owner must make

1. **Build it: yes, staged (owner decided 2026-11-07).** T0 spikes first (done for the FK inventory and the TLS recipe,
   see 47a; the real-provider run needs the owner's accounts), then T1 onward in order. The model split costs a lot and the
   privacy gain is partial (the operator still reads), so it stays opt-in and behavior-neutral for everyone else.
2. **Honest wording.** Accept "stored in a database you control; Lotties reads and writes it", never "we cannot read it".
   Recommend yes.
3. **Where the key lives.** Kubernetes Secret now; a separate data-gateway pod later. Recommend Secret, MVP.
4. **Unlock.** Server-held key only (keeps Alexa, MCP, reminders possible later). Recommend yes, per-session unlock deferred.
5. **Scope of the MVP.** Owner only, one store per account, no members/doctors/reminders. Recommend yes.
6. **After moving, delete our copy?** Default undo window of 7 days then erase. Recommend yes; the privacy gain depends on it.
7. **Providers to document first.** Supabase and Neon as examples, provider-neutral product, no provider API. Recommend yes,
   after you open their pages (section 7 is unverified).
8. **Relation to design 40.** Merge/shared resolver first, or build BYO's resolver and let 40 reuse it. Recommend: decide
   40's fate first; if 40 is built, its resolver is the base of T2.

## 15. Files this design names (all new or changed only when built)

Changed in this PR: this file and `docs/agents/filemap.md`. Planned: `code/api/src/Lotties.Infrastructure/Persistence/`
(control and data contexts, data migration chain), `.../Stores/` (`IDataStore`, resolver, guard, sealed descriptor,
migrator), `code/api/src/Lotties.Application/Stores/`, `code/api/src/Lotties.Api/Endpoints/DataStoreEndpoints.cs`,
`code/web/src/byoDatabase/`, `docs/sql/byo-setup.sql`, `docs/DEPLOY.md`, the legal files in section 10.
