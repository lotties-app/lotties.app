using Lotties.Domain.Stores;
using Lotties.Postgres.Tests.Support;
using Npgsql;

namespace Lotties.Postgres.Tests.Stores;

/// <summary>
/// The identity check behind "Update connection details" for a store that holds a baby's records (design 47, follow-up of the
/// replace-credentials work) on a real Postgres: new details are accepted only when both endpoints reach the database whose
/// <c>lotties.store_meta</c> names the store. The check reads only: an empty database it is pointed at is left exactly as it was
/// (no schema, table, row or lock is created there).
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class StoreIdentityPostgresTests(PostgresFixture postgres)
{
    private readonly StoreMigratorHarness _harness = new();

    [PostgresFact]
    public async Task New_credentials_for_the_same_database_name_the_store()
    {
        var store = await postgres.CreateExternalStoreAsync("samedb");
        var storeId = _harness.Register(store);
        await _harness.Migrator().EnsureReadyAsync(storeId);
        var (migrator, app) = await NewLoginsAsync(store);
        _harness.Repoint(storeId, migrator, app);

        var identity = await _harness.Tester().ReadIdentityAsync(_harness.Rows.Find(storeId));

        Assert.Equal(new StoreDatabaseIdentity(storeId, storeId), identity);
        Assert.True(identity.IsOf(storeId));
    }

    [PostgresFact]
    public async Task An_empty_other_database_is_not_the_same_and_is_left_untouched()
    {
        var store = await postgres.CreateExternalStoreAsync("live");
        var storeId = _harness.Register(store);
        await _harness.Migrator().EnsureReadyAsync(storeId);
        var empty = await postgres.CreateExternalStoreAsync("typo");
        var before = await CatalogAsync(empty);
        _harness.Repoint(storeId, empty.MigratorConnectionString, empty.AppConnectionString);

        var identity = await _harness.Tester().ReadIdentityAsync(_harness.Rows.Find(storeId));

        Assert.Equal(StoreDatabaseIdentity.None, identity);
        Assert.False(identity.IsOf(storeId));
        Assert.Equal(before, await CatalogAsync(empty));
        Assert.Equal(0L, await postgres.ScalarAsync<long>("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'lotties'", empty.Admin));
    }

    [PostgresFact]
    public async Task A_database_set_up_for_another_store_is_not_the_same()
    {
        var store = await postgres.CreateExternalStoreAsync("mine");
        var storeId = _harness.Register(store);
        await _harness.Migrator().EnsureReadyAsync(storeId);
        var other = await postgres.CreateExternalStoreAsync("other");
        var otherStoreId = _harness.Register(other);
        await _harness.Migrator().EnsureReadyAsync(otherStoreId);
        var otherBefore = await CatalogAsync(other);
        _harness.Repoint(storeId, other.MigratorConnectionString, other.AppConnectionString);

        var identity = await _harness.Tester().ReadIdentityAsync(_harness.Rows.Find(storeId));

        Assert.Equal(new StoreDatabaseIdentity(otherStoreId, otherStoreId), identity);
        Assert.False(identity.IsOf(storeId));
        Assert.Equal(otherBefore, await CatalogAsync(other));
    }

    [PostgresFact]
    public async Task An_app_endpoint_on_another_database_is_not_the_same()
    {
        var store = await postgres.CreateExternalStoreAsync("split");
        var storeId = _harness.Register(store);
        await _harness.Migrator().EnsureReadyAsync(storeId);
        var empty = await postgres.CreateExternalStoreAsync("splitapp");
        _harness.Repoint(storeId, store.MigratorConnectionString, empty.AppConnectionString);

        var identity = await _harness.Tester().ReadIdentityAsync(_harness.Rows.Find(storeId));

        Assert.Equal(new StoreDatabaseIdentity(storeId, null), identity);
        Assert.False(identity.IsOf(storeId));
    }

    /// <summary>A second pair of logins for the same database (a rotated password or a new user), members of the store's roles.</summary>
    private async Task<(string Migrator, string App)> NewLoginsAsync(ExternalStore store)
    {
        var migrator = $"{store.MigratorRole}2";
        var app = $"{store.AppRole}2";
        var password = Guid.NewGuid().ToString("N");
        await postgres.ExecuteAsync(
            $"CREATE ROLE \"{migrator}\" LOGIN PASSWORD '{password}' IN ROLE \"{store.MigratorRole}\"; "
            + $"CREATE ROLE \"{app}\" LOGIN PASSWORD '{password}' IN ROLE \"{store.AppRole}\"; "
            + $"GRANT CONNECT ON DATABASE \"{store.Database}\" TO \"{migrator}\", \"{app}\";");
        return (WithLogin(store.MigratorConnectionString, migrator, password), WithLogin(store.AppConnectionString, app, password));
    }

    private static string WithLogin(string connectionString, string username, string password) =>
        new NpgsqlConnectionStringBuilder(connectionString) { Username = username, Password = password }.ConnectionString;

    /// <summary>Every schema and relation outside the system catalogs, and the <c>store_meta</c> row when there is one.</summary>
    private async Task<string[]> CatalogAsync(ExternalStore store)
    {
        var rows = new List<string>();
        await using (var command = store.Admin.CreateCommand(
            "SELECT 'schema ' || nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' "
            + "UNION ALL SELECT 'relation ' || n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            + "WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema' ORDER BY 1"))
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                rows.Add(reader.GetString(0));
        }

        if (await postgres.ScalarAsync<bool>("SELECT to_regclass('lotties.store_meta') IS NOT NULL", store.Admin))
            rows.Add("meta " + await postgres.ScalarAsync<string>("SELECT store_id::text || ' ' || epoch::text || ' ' || state || ' ' || updated_at::text FROM lotties.store_meta", store.Admin));
        return [.. rows];
    }
}
