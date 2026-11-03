# 37. .NET 10 upgrade of the API

Status: **done** (2026-10-24). The whole API solution (`Lotties.Domain`, `.Application`, `.Infrastructure`, `.Api`, the
admin tool `Lotties.CatalogImporter` and the three test projects) moved from `net8.0` to `net10.0` (.NET 10 LTS,
supported until November 2028). .NET 8 support ends 2026-11-10 (PLAN backlog 19, REVIEW #20). Behaviour, API contracts and
the database schema are unchanged; no migration was added.

## 1. What changed

- `TargetFramework` `net10.0` in the eight csproj files (there is no shared TFM in `Directory.Build.props`, which still
  sets nullable, implicit usings, `TreatWarningsAsErrors` and `LangVersion latest`, now C# 14).
- SDK: .NET 10 (built and tested with SDK 10.0.401, runtime 10.0.12 locally; the images get 10.0.13). No `global.json`:
  a `net10.0` project already fails clearly on an older SDK, CI and the Dockerfile name 10.0 explicitly, and a
  `global.json` in `code/api` would not even apply to `dotnet build code/api/Lotties.sln` run from the repository root
  (checked: the SDK is chosen from the current directory).
- `code/api/dotnet-tools.json`: `dotnet-ef` 8.0.32 -> 10.0.13 (matches EF Core; `dotnet tool restore`).
- `code/api/Dockerfile`: `sdk:8.0` -> `sdk:10.0`, `aspnet:8.0` -> `aspnet:10.0` (section 5).
- CI: `actions/setup-dotnet` `dotnet-version: 10.0.x` in `.github/workflows/ci.yml` and `e2e.yml`.

## 2. Packages

Latest stable releases with a `net10.0` (or compatible) build, checked on nuget.org on 2026-10-24.

| Package | Project(s) | Before | After | Notes |
| --- | --- | --- | --- | --- |
| Microsoft.EntityFrameworkCore | Infrastructure | 8.0.11 | 10.0.13 | |
| Microsoft.EntityFrameworkCore.Design | Infrastructure (private) | 8.0.11 | 10.0.13 | design-time only |
| Microsoft.EntityFrameworkCore.Relational | Infrastructure | (transitive 8.0.11) | 10.0.13 | **new direct reference**: Npgsql's provider asks only for >= 10.0.4, so the projects above Infrastructure resolved 10.0.4 while Infrastructure was built against 10.0.13 (MSB3277 conflict warning, an error here) |
| Npgsql.EntityFrameworkCore.PostgreSQL | Infrastructure | 8.0.11 | 10.0.3 | stable, `net10.0` only |
| Npgsql | (transitive) | 8.0.6 | 10.0.3 | |
| EFCore.NamingConventions | Infrastructure | 8.0.3 | 10.0.1 | snake_case names unchanged (identical SQL, section 4) |
| Microsoft.Extensions.DependencyInjection.Abstractions, Logging.Abstractions | Application | 8.0.2 | 10.0.13 | |
| Microsoft.Extensions.Hosting.Abstractions, Http, Options.ConfigurationExtensions | Infrastructure | 8.0.0-8.0.1 | 10.0.13 | |
| Microsoft.AspNetCore.Authentication.JwtBearer | Api | 8.0.11 | 10.0.13 | |
| Microsoft.IdentityModel.* / System.IdentityModel.Tokens.Jwt | (transitive, via JwtBearer) | 7.1.2 | 8.19.2 | JwtBearer's minimum; one version for all IdentityModel packages |
| ModelContextProtocol.AspNetCore | Api | 2.3.0 | 2.3.0 | already the latest; ships a `net10.0` build. On net8 it forced Microsoft.Extensions.*Abstractions 10.0.13 and System.Text.Json 10.0.13 into the app; on net10 these are the framework's own versions |
| Lib.Net.Http.WebPush | Infrastructure | 3.3.1 | 3.3.1 | latest; its `net6.0` build runs on net10 (only dependency `Lib.Net.Http.EncryptedContentEncoding` 2.1.1, no BouncyCastle) |
| Microsoft.EntityFrameworkCore.Sqlite | Api.Tests | 8.0.11 | 10.0.13 | |
| Microsoft.AspNetCore.Mvc.Testing | Api.Tests | 8.0.11 | 10.0.13 | |
| Microsoft.NET.Test.Sdk | 3 test projects | 17.8.0 | 18.11.0 | |
| xunit.runner.visualstudio | 3 test projects | 2.5.3 | 3.1.5 | 4.x targets xunit v3 projects; 3.1.5 is the latest that runs xunit v2 |
| coverlet.collector | 3 test projects | 6.0.0 | 10.1.0 | |
| xunit | 3 test projects | 2.5.3 | **2.5.3 (kept)** | 2.9.3 adds `Assert` overloads (spans, `IReadOnlySet`) that make 19 existing assertions ambiguous or nullability errors under C# 14. Not forced by .NET 10; a separate test-only chore |

The credits files (`CREDITS.md`, `THIRD_PARTY_NOTICES.md`, `code/web/src/credits/*.generated.json`) still list the old
versions: they are regenerated in the main clone (docs/PROCESS.md "Credits after a dependency change"); until then the web
test `src/credits/thirdParty.test.ts` fails on the new direct `Microsoft.EntityFrameworkCore.Relational` reference.

## 3. Breaking changes handled

1. **Forwarded headers (ASP.NET Core 10, ASPDEPR005).** `Microsoft.AspNetCore.HttpOverrides.IPNetwork` and
   `ForwardedHeadersOptions.KnownNetworks` are obsolete. `ForwardedHeadersSettings` now builds `System.Net.IPNetwork`
   values for `KnownIPNetworks`. The new type refuses bits after the prefix (`10.42.0.1/16`), which the old parser
   accepted as `10.42.0.0/16`; even the obsolete property converts to the new type now and would throw. The settings keep
   the old reading (the host bits are cleared), so a `FORWARDED_HEADERS_TRUSTED_NETWORKS` value that started the API
   before still does; a test pins it.
2. **EF Core 10 and the model snapshot of a complex property.** EF Core 10 supports optional complex properties and reads
   one without `IsRequired()` as optional; EF Core 8 never wrote it (complex properties were always required). With the
   EF Core 8 snapshot, `PushSubscription.Keys` (`p256dh`, `auth`) looked nullable, so `dotnet ef migrations
   has-pending-model-changes` reported changes, and, worse, since EF Core 9 `Database.Migrate()` (`DB_AUTO_MIGRATE`) and
   `dotnet ef database update` **throw** on pending model changes: the deploy would have failed. The design-time tools
   fix this up for 8.x/9.x snapshots (`SnapshotModelProcessor`), the runtime check does not. A throw-away
   `migrations add` produced an **empty** migration (no operation, only the history row), which proves there is no schema
   change. Fix: the snapshot (`LottiesDbContextModelSnapshot.cs`, not a migration) now has the exact text EF Core 10 writes:
   `b1.IsRequired()` on the complex property, the `ComplexProperty(typeof(...), ...)` overload and `ProductVersion`
   `10.0.13`. No migration or Designer file was touched. `MigrationTests` reads the Designers of migrations generated before
   the upgrade as EF's tools do (complex properties of 8.x/9.x models required), and a new test
   (`Migrations_HaveNoPendingModelChangesForTheRuntimeCheck`) asserts `Database.HasPendingModelChanges()` is false, the
   check `Migrate()` makes (it failed before the snapshot fix).
3. **SQL parameter names (EF Core 10).** `@__babyId_0` is now `@babyId`; `EventChangesQueryTests` match the new names.
   The SQL is otherwise the same.
4. **Exception diagnostics (ASP.NET Core 10).** The exception handler middleware no longer records an exception that an
   `IExceptionHandler` answered (the "unhandled exception" error log, the `Microsoft.AspNetCore.Diagnostics.HandledException`
   event, the `error.type` metric tag). `AddApiProblemDetails` sets `SuppressDiagnosticsCallback = _ => false`, so every
   `DomainException` answered by `DomainExceptionHandler` is still recorded as with .NET 8 (`ExceptionDiagnosticsTests`).
   Dropping that line adopts the new default (fewer error logs for 4xx answers); that is a product decision, not part of
   the upgrade.
5. **`traceId` in problem bodies (ASP.NET Core 9).** The default problem details writer adds a `traceId` member to every
   `application/problem+json` body. `AddApiProblemDetails` removes it (`CustomizeProblemDetails` runs after it is added),
   so bodies are what they were (a board test compares two 403 bodies byte for byte, so that no one can tell an existing
   item from a missing one). Left as is: ASP.NET Core 10 also knows a `type` link and `title` for more status codes, so the
   API's 410 (expired invite) and 413 (body, import and backup size limits) problems now also carry `type` and `title` ("Gone",
   "Content Too Large"); additive, and the web app reads only `code` and the extensions.
6. **GSS encryption (Npgsql 10).** Npgsql 10 tries GSSAPI session encryption first by default; in the API image (no
   Kerberos library) that attempt writes `Cannot load library libgssapi_krb5.so.2` to stderr. `DatabaseOptions` sets
   `GSS Encryption Mode=Disable`, the behaviour of Npgsql 8 (which had no GSS encryption); a test pins it.
7. **`X509Certificate2(byte[])` obsolete (.NET 9, SYSLIB0057)** in the Alexa test certificates: `X509CertificateLoader`.
8. **Test host provider swap (EF Core 9).** `AddDbContext` now also registers its options callback as an
   `IDbContextOptionsConfiguration<TContext>`, and all of them run; the SQLite test host (`ApiFactory`) removed only the
   options, so the context got both Npgsql and SQLite ("Only a single database provider can be registered") and almost
   every API test failed. `ApiFactory` removes those registrations too. Test-only.
9. **MCP test clients (slower host start, section 6).** The MCP SDK client gives `server/discover` 5 s by default; a fresh
   test host's first request could take longer in the parallel suite, the cancelled probe came back as a 499 and failed
   a random MCP protocol test. `McpApiHost` and `BoardMcpHost` connect with `DiscoverProbeTimeout` off (the connect is
   still bounded by the SDK's 60 s `InitializationTimeout`). Test-only.

Checked, nothing to change:

- EF Core 9: migrations in one transaction (reverted in EF Core 10: one transaction per migration, as in EF Core 8);
  `MigrationsUserTransactionWarning` (the startup migrator opens its connection and takes the advisory lock, but starts no
  transaction); the EF migration lock (Npgsql: `LOCK TABLE "__EFMigrationsHistory" IN ACCESS EXCLUSIVE MODE` in the
  migration transaction) works with the migrator role, which owns the table, and inside our advisory lock.
- EF Core 10 parameterized collections ("multiple parameters" by default) and Npgsql 10 array `Contains`: on PostgreSQL a
  list or array `Contains` still becomes one array parameter, `WHERE e.id = ANY (@ids)` (EF Core 8: `= ANY (@__ids_0)`),
  checked with `ToQueryString` on the Npgsql model, also for the C# 14 span binding of `array.Contains`. The model has
  no PostgreSQL array column, so Npgsql 10's `@>` to `ANY` change for array columns does not apply.
- EF Core 10 complex type column names (uniquified, full path for nested types): `Keys` sets its column names
  explicitly, no nesting. JSON columns, value converters and `xmin` row versions: same model, same SQL.
- Npgsql 9 enum mapping (no PostgreSQL enums are mapped), Guid v7 key generation (every Guid key is
  `ValueGeneratedNever`, ids come from the domain or the client), Npgsql 10 `date`/`time` in non-generic reads (the only
  raw ADO read is the advisory lock's boolean), `cidr` (unused), root CA handling (no `Root Certificate` configured),
  `PostgresException.BatchCommand` (unused).
- Npgsql 9 `Connection Lifetime` default 3600 s (was unlimited): pooled connections are recycled hourly; kept.
- Microsoft.Data.Sqlite 10 date/time reads (tests only): the SQLite test model stores timestamps as UTC ticks
  (`SqliteModelCustomizer`).
- System.Text.Json 10 (property name conflict checks, unchanged defaults), .NET 9 nullable `JsonDocument` (none in DTOs),
  .NET 10 configuration nulls (no `null` in `appsettings.json`), `BackgroundService` running all of `ExecuteAsync` on the
  thread pool (`PushSchedulerService` only logs and starts its timer; startup migrations run before the host starts),
  HttpClientFactory's `SocketsHttpHandler` default and header redaction in its logs (address lookup and Alexa already set
  their own handler), JWT bearer with IdentityModel 8 (the three JWT schemes and the board key scheme are covered by the
  API tests with real token validation), `AuthenticationHandler` constructor (already without `ISystemClock`), the MCP SDK
  registration (same 2.3.0 API).
- C# 14 (`LangVersion latest`): the `field` keyword (no accessor uses an identifier called `field`) and first-class spans.
  Note that the release images were compiled with C# 12 (`sdk:8.0`) while local builds with SDK 10 already used C# 14.

## 4. SQL equality proof

`dotnet ef migrations script --idempotent --project src/Lotties.Infrastructure` (dummy `DB_*`, no database), once at the
base commit `7c07b6b` (net8.0, `dotnet-ef` 8.0.32) and once after the upgrade (`dotnet-ef` 10.0.13):

| | Lines | SHA-256 (raw) |
| --- | --- | --- |
| EF Core 8.0.11 | 2250 | `3c7aa4a9f7ff4665ba511dfbfcdfa2848e17acb697aaf1898425d4501bb7dcd5` |
| EF Core 10.0.13 | 2215 | `a9dee85b2d8cea070991c77e6a0b4620489ea64c1169d0fc77f5f3fdae2ca4c2` |

The raw diff has 105 changed lines: 35 blank lines (EF Core 8 wrote one more after each migration's
`START TRANSACTION;`) and the `product_version` of the 35 `__EFMigrationsHistory` inserts (`'8.0.11'` -> `'10.0.13'`, 35
old and 35 new lines). Without blank lines and with the
product version masked, both scripts have the SHA-256 `3fe0c3cf5fef8fbdffa50f1d5596d3734a940236a2988f0cd3d2987b017ce150`:
the DDL, the seeds and the data rewrites are identical. `dotnet ef migrations has-pending-model-changes`: "No changes have
been made to the model since the last migration." (before the snapshot fix: "Changes have been made").

## 5. Container image

`mcr.microsoft.com/dotnet/aspnet:10.0` (10.0.13 today) is Ubuntu 24.04 "noble"; `aspnet:8.0` was Debian 12. Its
runtime-deps layer installs `ca-certificates`, `libicu74`, `libssl3t64`, `tzdata` and `tzdata-legacy` and creates the user
`app` (UID 1654) and sets `ASPNETCORE_HTTP_PORTS=8080`. So: IANA time zones work (`NotificationTimeZone` validates and
applies the user's zone for reminders and quiet hours, the voice and MCP assistants use it too, all through
`TimeZoneInfo` with ids like `America/Sao_Paulo`), globalization is not
invariant, the HEALTHCHECK's `bash`, `head` and `grep` exist, the chart's `runAsUser: 1654` matches, and
`ASPNETCORE_URLS=http://+:8080` from the Dockerfile still wins over `ASPNETCORE_HTTP_PORTS` (same port). The Dockerfile
keeps its restore layer, `--no-self-contained` publish (no ReadyToRun, no trimming), the build args `APP_VERSION`,
`APP_COMMIT`, `APP_BUILD_TIME` and `USER app`. No `DOTNET_*` variable is set anywhere in the deploy kit. The image was not
built by the upgrade worker (agents do not run Podman); `deploy.sh` builds it with Podman in WSL.

## 6. Verification done

- `dotnet build code/api/Lotties.sln`: 0 warnings, 0 errors (warnings are errors); restore has no NU1xxx warning (the
  .NET 10 SDK also audits transitive packages and reports pruned direct references).
- `dotnet test code/api/Lotties.sln`: Domain 2475, Infrastructure 313 (311 + 2 new), Api 2840 (2836 + 4 new), all
  passing; base commit on net8.0: 2475 / 311 / 2836. The API tests take about twice as long (3.5 -> 7.5 minutes on the
  dev machine): steady-state requests are as fast as before (the median duration of the tests under 0.5 s is unchanged),
  but each test host's start and first requests are 25-40 % slower on ASP.NET Core 10 (measured warm: start 1.05 -> 1.3 s,
  first two requests 0.27 -> 0.38 s; EF Core 10 builds the model faster, about 0.22 s instead of 0.65 s), which adds up
  over a few hundred hosts started in parallel. Under that load two kinds of timing failures showed up in some full
  runs and pass alone: the MCP SDK client's 5 s `server/discover` probe (fixed in the test hosts, see the commit) and
  tests with tight wall-clock tolerances such as `AssistantServiceTests.LogSleepEnd_PausedSleep_FoldsTheOpenPause`
  (+-5 s) and `NapperImportEndpointTests...Returns400Quickly` (< 10 s).
- `dotnet ef migrations has-pending-model-changes` and the script comparison (section 4); a throw-away `migrations add`
  gave an empty migration and was deleted.
- `dotnet publish src/Lotties.Api -c Release --no-self-contained` (0 warnings) and the published build started in
  Development with dummy `DB_*` on 127.0.0.1:18431: `/health` 200 `{"status":"ok"}`, `/api/v1/version` 200, `/api/v1/me`
  401, no error or warning in the log, then stopped.
- `Lotties.CatalogImporter`: its tests are in Infrastructure.Tests (passing); `--help` runs, `verify-curated` with an
  empty cache directory exits 3 ("Missing file(s)", nothing downloaded). No dry run (it would download from ANVISA).
- `node code/web/scripts/generate-credits.mjs --check`: stale, as expected (section 2).

Not verifiable here: the image build and run (Podman in WSL is the owner's), PostgreSQL itself (the tests use SQLite;
`jsonb`, `xmin`, the migration lock and GSS/SSL negotiation are only checked through the model, the generated SQL and
the connection string), Keycloak tokens from the real realm, push sends to real browser push services.

## 7. Risks

- **Migrations from the owner's machine** need .NET 10 (`dotnet tool restore` installs `dotnet-ef` 10.0.13).
- **`DB_AUTO_MIGRATE` / `database update`** now refuse a model with pending changes and take a table lock; both are
  covered by section 3.2 and the migrator role's ownership.
- **Rare log differences**: Npgsql 10 metric and span names follow the OpenTelemetry conventions (no dashboard uses
  them); HttpClientFactory logs redact header values.
- **C# 14 in release builds** (section 3, last item).
- **Slower test suite** (section 6): about twice the wall time for the API tests; tests with tight wall-clock
  tolerances can fail under load and pass when re-run alone. In production this should only mean a few hundred
  milliseconds more at pod start (one host); not measured on the cluster.

## 8. Rollback

`helm --kube-context "$KUBE_CONTEXT" -n lotties-app-production rollback lotties-api [REVISION]` (deploy/homelab/README.md
"Roll back"): the .NET 8 image stays in the registry under its `src-<hash>` tag. The schema is the same, so nothing to do in
the database. Rolling the code back in git is a revert of the upgrade commits; the snapshot change goes with it.

## 9. Post-deploy checks (for the orchestrator)

1. `kubectl ... -n lotties-app-production logs deploy/lotties-api`: no startup error, no
   `Cannot load library libgssapi_krb5.so.2`, no `PendingModelChangesWarning`; with `DB_AUTO_MIGRATE=true`, the migrator's
   lines show no pending migration and no lock timeout.
2. `/health` through a port-forward (`curl localhost:18080/health` -> 200) and the pod's readiness.
3. `GET https://lotties.app/api/v1/version`: the new release, commit and build time.
4. `GET /api/v1/me` without a token -> 401, with a real sign-in -> 200 (JwtBearer with IdentityModel 8).
5. Migration history unchanged: `SELECT migration_id, product_version FROM "__EFMigrationsHistory" ORDER BY 1;` gives
   the same 35 rows as before the deploy, ending in `20261024142612_ProjectBoard` (the upgrade adds none). From the
   owner's machine with the migrator role, `dotnet tool restore` then `dotnet ef database update` reports nothing to
   apply instead of a pending-model-changes error, which exercises the runtime check of section 3.2.
6. Time zones: `GET /api/v1/push/settings` returns the stored IANA zone, and saving Settings > Notifications again (a
   `PUT /api/v1/push/settings` with the same `timeZone`, e.g. `America/Sao_Paulo`) succeeds; without tzdata in the image
   the zone would be rejected as unknown (400 on `timeZone`). Reminders then arrive at the expected local times.
7. Push send path: Settings > Notifications > send a test notification (VAPID, `aes128gcm` through Lib.Net.Http.WebPush);
   the scheduler log "Push scheduler started" once per pod.
8. Account deletion preview: `GET /api/v1/me/deletion-preview` (Settings > Delete account shows it) answers 200, without
   confirming the deletion.
9. Board: `GET /api/v1/board/me` with a board key (`X-Board-Key: lbk_...` or `Authorization: Bearer lbk_...`) -> 200
   with the key's permissions; with a wrong key -> 401 `invalid_board_key`. If the board MCP is on, `tools/list` on
   `POST /api/v1/board/mcp` with a key.
10. Behind Traefik: the rate limiter still sees client addresses (forwarded headers), e.g. no single shared limit.
