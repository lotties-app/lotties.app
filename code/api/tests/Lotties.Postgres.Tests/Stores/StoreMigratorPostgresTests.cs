using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Migration;
using Lotties.Postgres.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Lotties.Postgres.Tests.Stores;

/// <summary>
/// The store migrator and the data migration chain on a real Postgres (design 47 section 4 and the "Postgres container test" of
/// section 12, task T5). Each test gets its own external store database with the BYO role set from the fixture: a migrator role that
/// owns schema <c>lotties</c> and an app role with DML only.
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class StoreMigratorPostgresTests(PostgresFixture postgres)
{
    private const string InsufficientPrivilege = "42501";

    private readonly StoreMigratorHarness _harness = new();

    [PostgresFact]
    public async Task Baseline_on_a_new_store_creates_the_data_tables_in_lotties_with_the_built_in_event_types()
    {
        var store = await postgres.CreateExternalStoreAsync("baseline");
        var storeId = _harness.Register(store);

        await _harness.Migrator().EnsureReadyAsync(storeId);

        Assert.Equal(DataTablesAndMeta, await TablesAsync(store, "lotties"));
        Assert.Empty(await TablesAsync(store, "public"));
        Assert.Equal((long)BuiltInEventTypes.All.Count, await postgres.ScalarAsync<long>("SELECT count(*) FROM lotties.event_types WHERE baby_id IS NULL", store.Admin));
        Assert.Equal(KnownMigrations, await HistoryAsync(store));
        var meta = await MetaAsync(store);
        Assert.Equal((storeId, nameof(DataStoreState.Ready), KnownMigrations[^1]), (meta.StoreId, meta.State, meta.SchemaVersion));
        Assert.Equal([DataStoreState.Migrating, DataStoreState.Ready], _harness.Rows.Recorded(storeId));
        Assert.Equal((DataStoreState.Ready, KnownMigrations[^1]), (_harness.Rows.Find(storeId).State, _harness.Rows.Find(storeId).SchemaVersion));
    }

    [PostgresFact]
    public async Task Second_run_on_a_ready_store_changes_nothing()
    {
        var store = await postgres.CreateExternalStoreAsync("noop");
        var storeId = _harness.Register(store);
        await _harness.Migrator().EnsureReadyAsync(storeId);
        var before = await MetaAsync(store);
        var log = new CommandLog();

        await _harness.Migrator(interceptors: log).EnsureReadyAsync(storeId);

        Assert.Equal(KnownMigrations, await HistoryAsync(store));
        Assert.Equal(before.Epoch, (await MetaAsync(store)).Epoch);
        Assert.Equal((long)BuiltInEventTypes.All.Count, await postgres.ScalarAsync<long>("SELECT count(*) FROM lotties.event_types", store.Admin));
        Assert.DoesNotContain(log.Commands, text => text.Contains("CREATE ", StringComparison.Ordinal) || text.Contains("ALTER ", StringComparison.Ordinal) || text.Contains("INSERT INTO lotties.event_types", StringComparison.Ordinal));
        Assert.Equal([DataStoreState.Migrating, DataStoreState.Ready, DataStoreState.Ready], _harness.Rows.Recorded(storeId));
    }

    [PostgresFact]
    public async Task Concurrent_migrators_apply_the_chain_once()
    {
        var store = await postgres.CreateExternalStoreAsync("concurrent");
        var storeId = _harness.Register(store);

        await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => _harness.Migrator().EnsureReadyAsync(storeId)));

        Assert.Equal(KnownMigrations, await HistoryAsync(store));
        Assert.Equal((long)BuiltInEventTypes.All.Count, await postgres.ScalarAsync<long>("SELECT count(*) FROM lotties.event_types", store.Admin));
        Assert.Equal(DataStoreState.Ready, _harness.Rows.Find(storeId).State);
    }

    [PostgresFact]
    public async Task A_held_lock_makes_a_short_waiter_answer_store_migrating_and_a_long_waiter_wait()
    {
        var store = await postgres.CreateExternalStoreAsync("locked");
        var storeId = _harness.Register(store);
        await using var holder = await store.Admin.OpenConnectionAsync();
        await ExecuteAsync(holder, $"SELECT pg_advisory_lock({NpgsqlStoreMigrationSession.LockKey})");

        await Assert.ThrowsAsync<StoreMigratingException>(() => _harness.Migrator(lockWaitSeconds: 1).EnsureReadyAsync(storeId));
        Assert.Empty(await TablesAsync(store, "lotties"));
        Assert.Empty(_harness.Rows.Recorded(storeId));

        var waiting = _harness.Migrator(lockWaitSeconds: 30).EnsureReadyAsync(storeId);
        await Task.Delay(TimeSpan.FromMilliseconds(500));
        Assert.False(waiting.IsCompleted);
        await ExecuteAsync(holder, $"SELECT pg_advisory_unlock({NpgsqlStoreMigrationSession.LockKey})");
        await waiting;

        Assert.Equal(KnownMigrations, await HistoryAsync(store));
        Assert.Equal(DataStoreState.Ready, _harness.Rows.Find(storeId).State);
    }

    [PostgresFact]
    public async Task A_store_migrated_by_a_newer_api_is_refused_as_schema_ahead()
    {
        var store = await postgres.CreateExternalStoreAsync("ahead");
        var storeId = _harness.Register(store);
        await _harness.Migrator().EnsureReadyAsync(storeId);
        await postgres.ExecuteAsync("INSERT INTO lotties.__ef_data_migrations VALUES ('20991231000000_FromTheFuture', '99.0.0')", store.Admin);

        await Assert.ThrowsAsync<StoreSchemaAheadException>(() => _harness.Migrator().EnsureReadyAsync(storeId));

        Assert.Equal(DataStoreState.SchemaAhead, _harness.Rows.Find(storeId).State);
        Assert.Equal("20991231000000_FromTheFuture", _harness.Rows.Find(storeId).SchemaVersion);
        Assert.Equal([.. KnownMigrations, "20991231000000_FromTheFuture"], await HistoryAsync(store));
    }

    [PostgresFact]
    public async Task A_connection_killed_mid_migration_rolls_back_and_the_next_run_finishes()
    {
        var store = await postgres.CreateExternalStoreAsync("killed");
        var storeId = _harness.Register(store);
        var killer = new KillConnectionBefore("CREATE INDEX", postgres.DataSource);

        await Assert.ThrowsAsync<StoreMigrationFailedException>(() => _harness.Migrator(interceptors: killer).EnsureReadyAsync(storeId));

        Assert.True(killer.Killed);
        Assert.Empty((await TablesAsync(store, "lotties")).Except(["__ef_data_migrations"]));
        Assert.Empty(await HistoryAsync(store));
        Assert.Equal(DataStoreState.MigrationFailed, _harness.Rows.Find(storeId).State);

        await _harness.Migrator().EnsureReadyAsync(storeId);

        Assert.Equal(DataTablesAndMeta, await TablesAsync(store, "lotties"));
        Assert.Equal(KnownMigrations, await HistoryAsync(store));
        Assert.Equal([DataStoreState.Migrating, DataStoreState.MigrationFailed, DataStoreState.Migrating, DataStoreState.Ready], _harness.Rows.Recorded(storeId));
    }

    [PostgresFact]
    public async Task An_app_role_that_may_create_in_public_is_too_powerful_and_nothing_is_created()
    {
        var store = await postgres.CreateExternalStoreAsync("public");
        await postgres.ExecuteAsync($"GRANT CREATE ON SCHEMA public TO \"{store.AppRole}\"", store.Admin);
        var storeId = _harness.Register(store);

        var error = await Assert.ThrowsAsync<StoreRoleTooPowerfulException>(() => _harness.Migrator().EnsureReadyAsync(storeId));

        Assert.Equal([StoreRoleFinding.CreatesInPublic], error.Findings);
        Assert.Empty(await TablesAsync(store, "lotties"));
        Assert.Equal(DataStoreState.RoleTooPowerful, _harness.Rows.Find(storeId).State);
    }

    [PostgresFact]
    public async Task The_migrator_credentials_used_as_the_app_role_are_too_powerful()
    {
        var store = await postgres.CreateExternalStoreAsync("samerole");
        var storeId = _harness.Register(store, appConnectionString: store.MigratorConnectionString);

        var error = await Assert.ThrowsAsync<StoreRoleTooPowerfulException>(() => _harness.Migrator().EnsureReadyAsync(storeId));

        Assert.Contains(StoreRoleFinding.OwnsObjects, error.Findings);
        Assert.Contains(StoreRoleFinding.CreatesInStoreSchema, error.Findings);
    }

    [PostgresFact]
    public async Task A_superuser_app_role_is_too_powerful()
    {
        var store = await postgres.CreateExternalStoreAsync("super");
        await postgres.ExecuteAsync($"ALTER ROLE \"{store.AppRole}\" SUPERUSER");
        var storeId = _harness.Register(store);

        var error = await Assert.ThrowsAsync<StoreRoleTooPowerfulException>(() => _harness.Migrator().EnsureReadyAsync(storeId));

        Assert.Contains(StoreRoleFinding.SuperuserLike, error.Findings);
    }

    [PostgresFact]
    public async Task After_the_baseline_the_app_role_uses_the_data_tables_and_cannot_touch_public_or_the_schema()
    {
        var store = await postgres.CreateExternalStoreAsync("approle");
        await _harness.Migrator().EnsureReadyAsync(_harness.Register(store));
        await postgres.ExecuteAsync("CREATE TABLE public.operator_only (id int)", store.Admin);

        Assert.Equal((long)BuiltInEventTypes.All.Count, await postgres.ScalarAsync<long>("SELECT count(*) FROM lotties.event_types", store.App));
        Assert.Equal(0L, await postgres.ScalarAsync<long>("SELECT count(*) FROM events", store.App));
        await AssertDeniedAsync(() => postgres.ExecuteAsync("CREATE TABLE public.intruder (id int)", store.App));
        await AssertDeniedAsync(() => postgres.ScalarAsync<int>("SELECT id FROM public.operator_only", store.App));
        await AssertDeniedAsync(() => postgres.ExecuteAsync("CREATE TABLE lotties.intruder (id int)", store.App));
        await AssertDeniedAsync(() => postgres.ExecuteAsync("DROP TABLE lotties.events", store.App));
        await AssertDeniedAsync(() => postgres.ExecuteAsync("ALTER TABLE lotties.events ADD COLUMN extra int", store.App));
    }

    [PostgresFact]
    public async Task A_database_set_up_for_another_store_is_a_schema_conflict()
    {
        var store = await postgres.CreateExternalStoreAsync("shared");
        await _harness.Migrator().EnsureReadyAsync(_harness.Register(store));
        var otherStoreId = _harness.Register(store);

        await Assert.ThrowsAsync<StoreSchemaConflictException>(() => _harness.Migrator().EnsureReadyAsync(otherStoreId));

        Assert.Equal(DataStoreState.SchemaConflict, _harness.Rows.Find(otherStoreId).State);
    }

    [PostgresFact]
    public async Task The_data_chain_is_never_applied_to_a_Lotties_control_database()
    {
        var store = await postgres.CreateExternalStoreAsync("control");
        await ApplyControlChainAsync(store);
        var storeId = _harness.Register(store);

        await Assert.ThrowsAsync<StoreSchemaConflictException>(() => _harness.Migrator().EnsureReadyAsync(storeId));
        Assert.Equal(DataStoreState.SchemaConflict, _harness.Rows.Find(storeId).State);

        await using var connection = await store.Migrator.OpenConnectionAsync();
        await using var direct = new LottiesDataDbContext(ExternalStoreSchema.Options(connection));
        var refused = await Assert.ThrowsAnyAsync<Exception>(() => direct.Database.MigrateAsync());

        Assert.Equal("lotties_data_chain_on_control_database", PostgresErrorIn(refused)?.MessageText);
        Assert.Empty((await TablesAsync(store, "lotties")).Except(["__ef_data_migrations"]));
        Assert.Empty(await HistoryAsync(store));
    }

    private static readonly string[] DataTablesAndMeta =
    [
        "__ef_data_migrations", "appointments", "baby_notes", "care_providers", "event_types", "events", "formulas", "measurements",
        "medications", "note_reads", "prescription_proposals", "prescriptions", "store_meta", "vaccinations",
    ];

    private static string[] KnownMigrations
    {
        get
        {
            using var context = new LottiesDataDbContextFactory().CreateDbContext([]);
            return context.Database.GetMigrations().ToArray();
        }
    }

    private async Task ApplyControlChainAsync(ExternalStore store)
    {
        var connectionString = new NpgsqlConnectionStringBuilder(postgres.ConnectionString) { Database = store.Database }.ConnectionString;
        var options = new DbContextOptionsBuilder<LottiesDbContext>().UseLottiesDatabase(connectionString).Options;
        await using var control = new LottiesDbContext((DbContextOptions<LottiesDbContext>)options);
        await control.Database.MigrateAsync();
    }

    private async Task<string[]> TablesAsync(ExternalStore store, string schema)
    {
        await using var command = store.Admin.CreateCommand($"SELECT tablename::text FROM pg_tables WHERE schemaname = '{schema}' ORDER BY tablename COLLATE \"C\"");
        await using var reader = await command.ExecuteReaderAsync();
        var tables = new List<string>();
        while (await reader.ReadAsync())
            tables.Add(reader.GetString(0));
        return [.. tables];
    }

    private async Task<string[]> HistoryAsync(ExternalStore store)
    {
        if (!await postgres.ScalarAsync<bool>("SELECT to_regclass('lotties.__ef_data_migrations') IS NOT NULL", store.Admin))
            return [];
        await using var command = store.Admin.CreateCommand("SELECT \"MigrationId\" FROM lotties.__ef_data_migrations ORDER BY \"MigrationId\" COLLATE \"C\"");
        await using var reader = await command.ExecuteReaderAsync();
        var ids = new List<string>();
        while (await reader.ReadAsync())
            ids.Add(reader.GetString(0));
        return [.. ids];
    }

    private static async Task<(Guid StoreId, Guid Epoch, string State, string SchemaVersion)> MetaAsync(ExternalStore store)
    {
        await using var command = store.Admin.CreateCommand("SELECT store_id, epoch, state, schema_version FROM lotties.store_meta");
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return (reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3));
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteScalarAsync();
    }

    private static PostgresException? PostgresErrorIn(Exception? error) =>
        error switch
        {
            null => null,
            PostgresException postgres => postgres,
            _ => PostgresErrorIn(error.InnerException),
        };

    private static async Task AssertDeniedAsync(Func<Task> action)
    {
        var error = await Assert.ThrowsAsync<PostgresException>(action);
        Assert.Equal(InsufficientPrivilege, error.SqlState);
    }
}
