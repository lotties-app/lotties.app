# 47a. Bring your own database: spike results (T0, 2026-11-07)

Companion to [47](47-bring-your-own-database.md). Spikes (a) and (b) were run; (c) was done from vendor documentation only,
because creating provider accounts is something the owner must do. Nothing here is merged as code; the spike program for (b)
was throwaway (about 70 lines, Npgsql 10.0.0, a fake TLS endpoint that answers the Postgres `SSLRequest` with `S` and then
does a TLS handshake). Not legal advice.

## (a) Foreign keys and joins that cross the control/data line

Source: `code/api/src/Lotties.Infrastructure/Persistence/Configurations/*` and `Repositories/*`, `main` at 82025bc.

**Foreign keys leaving the data tables** (to be dropped from the *data model*; the built-in database keeps them):

| Data table | Points at (control) |
| --- | --- |
| `events`, `event_types`, `medications`, `prescriptions`, `formulas`, `appointments`, `care_providers`, `vaccinations`, `measurements`, `baby_notes`, `prescription_proposals`, `note_reads` | `babies.id` (`baby_id`) |
| the same, plus `baby_notes.author_user_id`, `prescription_proposals.author_user_id` / `decided_by`, `note_reads.user_id` | `users.id` (`created_by`, ...) |
| `medications.product_id` | `products.id` (public catalog, `ON DELETE SET NULL`) |

**Foreign keys inside the data plane (stay):** `events.type_id` -> `event_types`, `note_reads.note_id` -> `baby_notes` (cascade).

**Control-plane keys to data:** none. `babies`, `baby_members`, `invites`, push, consents, settings and the board never point at a
data table. `user_assistant_settings.default_baby_id` points at `babies` (control to control).

**Cross-plane queries found** (repositories are per aggregate and `Lotties.Application` never touches the DbContext):

1. `EfBabyNotificationPreferencesRepository.CandidatesQuery`: joins `baby_notification_preferences` and `baby_members`
   (control) with `EXISTS` subqueries on `appointments`, `prescription_proposals`, `baby_notes` (data). It is the reminder
   scheduler's candidate query. It cannot stay one SQL statement for a BYO baby: it becomes two steps (control candidates,
   then a data check per store). This confirms "no reminders for BYO babies in the MVP" (47 section 2.2).
2. `EfAccountDataEraser`: joins `baby_members` and `babies` (control). It erases rows of both planes; the data-plane half
   must run against the baby's store (47 section 9).
3. `EfPredictionHistoryRepository`: joins `events` with `event_types` (both data). No change.
4. Visibility of private notes and Doctor scopes is not a database join today (no `BabyMembers` reference in the notes,
   proposals or doctor repositories); the rule is applied in code. So the "pass allowed author ids as parameters" design in
   47 section 2.1 needs no query rewrite there. *Not read line by line: confirm during T1.*

**Built-in event types are rows** (`event_types` with `baby_id` null, inserted and updated by migrations: `InitialCreate`,
`ConditionalFieldsAndBreastPump`, `NasalSuction`, `BellyMassage`, `FussyEvent`, `MoreEventTypes`, ...). Events point at them, so
**every store needs these rows**. The data migration chain therefore starts from a baseline that already contains the current
built-in set (generated from the model, not replayed from the historical seeds), and future seeds are data-chain migrations
applied to every store. A store that is behind on seeds rejects events of a newer type (existing behavior, same rule as
`docs/DEPLOY.md` "Migrations that seed built-in event types").

**Unresolved:** whether any service saves rows of both planes in one `SaveChanges` (an implicit transaction that would stop
being atomic). Look at services that write an event and also touch membership or the baby row (baby creation, import, account
erasure). Not searched.

**Verdict:** the split is smaller than feared: about 13 data tables, 3 outgoing key groups, 1 cross-plane query that matters.
The cost is mostly the baseline migration chain and the resolver plumbing, not rewriting queries.

## (b) Pinned-IP connect with TLS verified against the real host name (Npgsql)

Question (47 section 3.2 step 4): can the API connect to a validated IP address and still verify the server certificate
against the host name the user typed, so that DNS rebinding after the check cannot redirect the connection?

Result: **yes, with a specific recipe.** Observed with Npgsql 10.0.0 against a fake TLS endpoint on 127.0.0.1 whose
certificate is for `db.example.test`:

| Case | Setup | Observed |
| --- | --- | --- |
| 1 | `Host=<ip>`, `SslMode=VerifyFull`, defaults | rejected (the name is the IP, not the certificate's) |
| 2 | `Host=<ip>`, `SslMode=Require`, `UseSslClientAuthenticationOptionsCallback`: `TargetHost = "db.example.test"` and our own `RemoteCertificateValidationCallback` | TLS handshake **succeeds**; the server sees SNI `db.example.test`; Postgres startup bytes arrive (the later error is the fake server closing) |
| 3 | same as 2 but `TargetHost = "evil.example.test"` | callback receives `RemoteCertificateNameMismatch`, connection **rejected**; server SNI shows `evil.example.test` |
| 4 | obsolete `UseUserCertificateValidationCallback` only, no `TargetHost` | name mismatch (the IP), rejected |

Rules that follow for the guard:

- Npgsql **refuses `SslMode=VerifyFull` together with a custom validation callback** (`ArgumentException`: "perform whatever
  validation you require in that callback"). So use `SslMode=Require` **and** do the validation ourselves: no chain errors
  (the system trust store, or a user-pasted CA as a custom root) and no `RemoteCertificateNameMismatch` with `TargetHost` set
  to the typed name. A callback that returns `true` without these checks silently removes verification; a test must fail it
  (a server with a wrong-name certificate and one with an untrusted chain must both be refused).
- `UseUserCertificateValidationCallback` is marked obsolete in this version; use `UseSslClientAuthenticationOptionsCallback`.
- `TargetHost` also sets the SNI name, which providers that route by SNI need (Neon is documented to; *not tested*).
- **Not** tested: a real provider, a real chain, an IPv6 literal, a pooler (poolers present their own certificates, sometimes
  from a private CA). In the spike the self-signed case showed `RemoteCertificateChainErrors` alongside the name result, so
  the real-chain behavior must be checked with a real provider.
- Npgsql resolves a DNS name itself, so the guard always passes an IP in `Host` and keeps the typed name only in
  `TargetHost`. Re-resolve and re-validate whenever a pool is rebuilt (idle eviction already forces this).

## (c) Providers, from vendor documentation (no accounts created)

Read through web search of vendor pages on 2026-11-07; to be confirmed by someone with throwaway accounts.

**Supabase** ([connect](https://supabase.com/docs/guides/database/connecting-to-postgres),
[pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits),
[IPv4 add-on](https://supabase.com/docs/guides/platform/ipv4-address),
[pausing](https://supabase.com/docs/guides/platform/free-project-pausing)):

- The direct connection (5432) is **IPv6** unless the paid IPv4 add-on is bought. The shared pooler (Supavisor) is **IPv4**,
  in session mode (5432; session features and prepared statements work) and transaction mode (6543; no prepared statements
  on the shared pooler). **A home lab without IPv6 must therefore use the shared pooler in session mode.** Whether the lab
  has IPv6 egress is unknown (owner).
- The migrator needs session mode (advisory lock, DDL). Simplest rule: session mode for both roles. Free-plan pool and client
  limits: not retrieved.
- Free projects pause after about a week of low activity; restore windows are quoted differently (90 days in an older
  changelog, up to a year in the current docs). **Free plans have no downloadable database backups.** Our export file is
  therefore the user's only portable backup.
- Pooler user names are suffixed with the project reference (`role.<ref>`): the form must accept it and the guard must not
  mangle it. *Not verified with a custom role.*
- Not found: whether custom schemas are exposed by the Data API by default. The setup guide must tell users to check the
  exposed schemas and keep `lotties` out of them.

**Neon** ([connection pooling](https://neon.com/docs/connect/connection-pooling)):

- The pooler (PgBouncer, transaction mode, host name with `-pooler`) does **not support session-level advisory locks**,
  `SET`, `LISTEN` or SQL-level `PREPARE`; protocol-level prepared statements work. Neon recommends the **direct** endpoint for
  migrations. So the migrator must use the direct endpoint while the app role may use the pooler. The descriptor needs two
  endpoints (app, migrator), or a pooled-host check with the rule "the migrator never goes through a pooler".
- Direct max connections scale with compute size (104 at 0.25 CU quoted); the free-plan figure was not retrieved. Scale to zero
  and the 1 GB cap are in 47 section 7. IPv4 reachability of the direct endpoint: not retrieved.

**Neon, measured (2026-11-07, owner's free project in `sa-east-1`, PostgreSQL 18.6, throwaway program, one run):**

| Check | Direct endpoint | Pooler endpoint (`-pooler`) |
| --- | --- | --- |
| DNS | 3 IPv4 + 3 IPv6, all globally routable | same |
| Pinned IPv4 + `SslMode=Require` + `TargetHost` = typed name + system trust store, no policy errors | **works** | **works** |
| Certificate | `*.c-2.sa-east-1.aws.neon.tech`, Let's Encrypt (public CA) | same |
| First connect / second connect | 194 ms / 38 ms (project was awake) | 49 ms / 24 ms |
| `max_connections` | 901 | 901 |
| Create schema, create table, insert 1000 events with a small jsonb payload | ok; table plus primary key is 262144 bytes (256 KiB) | ok |
| **Session advisory lock held by A, probed from B** | **B got `false`: the lock holds** | **B got `true`: the lock did not persist** |
| Protocol-level prepared statement | works | works |

What this settles:

- The pinned-IP recipe from (b) works against a real provider with a public CA, over the pooler as well. The `TargetHost`
  override also satisfied Neon's SNI routing (it connected, so the proxy found the endpoint by name).
- **Advisory locks do not work through the Neon pooler**, as the docs said. This is now observed, not read. The migrator must
  connect to the direct endpoint. The migration runner must also **fail closed** if the lock probe says the lock did not
  persist (take the lock, probe from a second connection, abort if the second also gets it), because a pooled host name is not
  the only way to land on a pooler.
- A custom schema and plain DDL work with the default owner role. We did not test a restricted role (the setup SQL in 47
  section 8 still needs a run with a role that lacks `CREATE` on `public`).
- Size: 1000 events fit in 256 KiB including the primary key, so about 250 bytes per event as a rough upper figure for tiny
  payloads (small tables are padded to pages, so the real per-row cost is lower; a baby logs a few thousand events a year). A
  500 MB to 1 GB cap is therefore years of data. One run, small payloads, **not** a capacity guarantee.
- `pg_stat_ssl` reported `ssl = false` for the backend even though our TLS handshake to the proxy was verified. Neon's proxy
  terminates TLS and talks to the compute node itself, so **"the connection is encrypted" is true up to the provider's proxy,
  not necessarily end to end inside the provider**. We cannot see past the proxy, and the policy text must not claim more
  than "encrypted in transit to the provider".
- IPv6 also resolved, and IPv4 was available, so Neon works from a lab without IPv6 (this lab's own IPv6 is still unknown).

Second run, after an idle period the owner did not time (Neon suspends a free compute after about 5 minutes without connections; we did not confirm it had suspended): the first connect to the direct endpoint took **748 ms** against 194 ms and 38 ms warm, and the pooled connect right after took 62 ms because the first call had already woken the compute. Results otherwise identical (same lock behavior, same TLS result). So a wake-up costs well under a second on this region and plan, in one sample. That is small next to our timeouts, but the guard's connect timeout must stay at several seconds (not 1 to 2) so a cold compute is not reported as `Unreachable`.

**Supabase, measured (2026-11-07, owner's free project, PostgreSQL 17.11, one run from the owner's PC).** The two pooler URIs were pasted into each other's prompts, so the program's labels are swapped; the table is by **port**, and the advisory-lock results agree with the ports.

| Check | Direct (`db.<ref>`, 5432) | Session pooler (5432) | Transaction pooler (6543) |
| --- | --- | --- | --- |
| DNS | **one AAAA record, no IPv4** | 3 IPv4 | 3 IPv4 |
| Connect | **failed from the owner's PC** ("Failed to connect" to the IPv6 address: no IPv6 route there) | works | works |
| TLS with the system trust store and the typed name | not reached | **fails**: `RemoteCertificateChainErrors`, name matched | same |
| Certificate | not seen | `*.pooler.supabase.com`, issued by **"Supabase Intermediate 2021 CA"** (a private CA) | same |
| Connected with verification off (diagnostic only) | not reached | yes, 131 ms then 47 ms | yes, 70 ms then 48 ms |
| Session advisory lock held by A, probed from B | not reached | **held** (B got `false`) | **not held** (B got `true`) |
| Prepared statement | not reached | works | works (one sample; the docs said it would not) |
| `max_connections` | not reached | **60** | **60** |
| Schema, table, 1000 events | not reached | ok, 256 KiB | ok, 256 KiB |

What this settles:

- **Supabase's TLS cannot be verified with the system trust store.** The chain ends in a private Supabase CA, so the strict recipe fails closed (correctly). Supabase therefore needs the **user-supplied CA as the only root** path that 47 section 3.2 already allows: the user downloads Supabase's CA certificate from the dashboard and pastes it into the form, we validate the chain against that root only (and the typed name), and the test-connection error must say "certificate not trusted, add the provider's CA" instead of a generic handshake error. The name check passed here (no name mismatch). Verification **with** the downloaded CA is the next run (below); until then it is untested.
- **The direct connection is IPv6 only and the owner's PC cannot reach it.** The lab's IPv6 egress is still unknown, so for Supabase the form must default to the **session pooler** (5432), which has IPv4. Transaction mode (6543) does not hold advisory locks and must be refused for the migrator, exactly like Neon's pooler.
- **Pool caps must be tiny.** `max_connections` was 60 on this plan (the pooler layer has its own limits, not retrieved). With many stores and a shared API, the per-store pool cap is a few connections (2 to 5), with idle eviction, and the API must never hold a connection per baby per request.
- The pooler user is `postgres.<ref>`: the form and the guard handled the dotted name unchanged.
- As with Neon, `pg_stat_ssl` shows no SSL on the backend: the pooler ends TLS. Same wording limit for the policy ("encrypted in transit to the provider").
- Latency from the owner's PC: 47 to 131 ms to the pooler, 38 to 194 ms to Neon. Not a design constraint.
- Not tested on Supabase: exposed schemas in the Data API (a dashboard check), a restricted role, free-plan pausing (a week of inactivity, cannot be tested quickly), the downloaded CA.

Not measured: a restricted role, behavior near the free
plan limits, and **Supabase** (no account yet).

## Consequences for 47 (apply when the owner decides)

1. The descriptor carries **separate app and migrator host/port**.
2. The recipe in (b) replaces the "unverified" remark in 47 section 3.2 step 4 (done in this change).
3. T0 is done for (a) and (b), and for (c) on Neon (two runs, one with a cold start sample) and on Supabase (one run, TLS only with verification off). (c) still needs a run with Supabase's downloaded CA, a restricted
   role run and the lab's IPv6 answer.
3a. The migration runner proves the advisory lock really holds (probe from a second connection) and refuses otherwise.
3b. The privacy text says "encrypted in transit to the provider" and nothing about the inside of the provider.
4. New data-chain task: a baseline migration with the built-in event types (47 section 4, plan T5).
5. Supabase free pausing plus "no backups" makes the monthly "download a backup" reminder a requirement, not an option.

## Still open after the spikes

- Real-provider run, remaining (owner action): Neon is done once (above); still to do on Neon: a timed-idle cold start and a
  restricted role. Supabase: a throwaway project, the setup SQL with a custom role, the pooler user suffix, exposed-schema
  behavior. Both from the lab itself, through the guard.
- IPv6 egress from the home lab.
- NetworkPolicy enforcement on the k3s cluster.
- The one-`SaveChanges`-across-planes question in (a).
