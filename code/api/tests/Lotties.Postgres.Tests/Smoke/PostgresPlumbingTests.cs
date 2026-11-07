using System.Text.Json;
using Lotties.Postgres.Tests.Support;
using Npgsql;
using NpgsqlTypes;

namespace Lotties.Postgres.Tests.Smoke;

/// <summary>
/// Proves the container plumbing and doubles as the template for the store router and migrator suites (design 47
/// section 12): a class in <see cref="PostgresCollection"/>, the Postgres trait, <see cref="PostgresFactAttribute"/>
/// facts, and the fixture's helpers.
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class PostgresPlumbingTests(PostgresFixture postgres)
{
    private const string InsufficientPrivilege = "42501";

    [PostgresFact]
    public async Task Container_answers_a_query_on_postgres_17()
    {
        Assert.Equal(1, await postgres.ScalarAsync<int>("SELECT 1"));
        var major = await postgres.ScalarAsync<string>("SHOW server_version_num");
        Assert.StartsWith("17", major);
    }

    [PostgresFact]
    public async Task Advisory_lock_is_held_by_one_session_until_released()
    {
        const long key = 4_747_001;
        await using var first = await postgres.DataSource.OpenConnectionAsync();
        await using var second = await postgres.DataSource.OpenConnectionAsync();

        Assert.True(await TryLockAsync(first, key));
        Assert.False(await TryLockAsync(second, key));

        await using (var unlock = new NpgsqlCommand($"SELECT pg_advisory_unlock({key})", first))
            Assert.True((bool)(await unlock.ExecuteScalarAsync())!);

        Assert.True(await TryLockAsync(second, key));
        await first.CloseAsync();
        await using var third = await postgres.DataSource.OpenConnectionAsync();
        Assert.False(await TryLockAsync(third, key));
    }

    [PostgresFact]
    public async Task Advisory_lock_is_released_when_the_holding_session_ends()
    {
        const long key = 4_747_002;
        // Unpooled: the killed connection must never return to the shared pool other tests use.
        var unpooled = new NpgsqlConnectionStringBuilder(postgres.ConnectionString) { Pooling = false };
        await using var holderSource = NpgsqlDataSource.Create(unpooled.ConnectionString);
        var holder = await holderSource.OpenConnectionAsync();
        Assert.True(await TryLockAsync(holder, key));

        var pid = holder.ProcessID;
        Assert.True(await postgres.ScalarAsync<bool>($"SELECT pg_terminate_backend({pid}, 10000)"));
        await holder.DisposeAsync();

        await using var other = await postgres.DataSource.OpenConnectionAsync();
        Assert.True(await TryLockAsync(other, key));
    }

    [PostgresFact]
    public async Task External_store_roles_are_least_privilege_and_cannot_touch_public()
    {
        var store = await postgres.CreateExternalStoreAsync();
        await postgres.ExecuteAsync("CREATE TABLE public.operator_only (id int); INSERT INTO public.operator_only VALUES (1);", store.Admin);

        foreach (var role in new[] { store.MigratorRole, store.AppRole })
        {
            var attributes = await postgres.ScalarAsync<bool>(
                $"SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = '{role}'");
            Assert.False(attributes, $"{role} has a superuser-like attribute");
        }

        foreach (var restricted in new[] { store.Migrator, store.App })
        {
            await AssertDeniedAsync(() => postgres.ExecuteAsync("CREATE TABLE public.intruder (id int)", restricted));
            await AssertDeniedAsync(() => postgres.ScalarAsync<int>("SELECT id FROM public.operator_only", restricted));
        }

        await postgres.ExecuteAsync("CREATE TABLE events (id uuid PRIMARY KEY, kind text NOT NULL)", store.Migrator);
        Assert.Equal(
            ExternalStore.Schema,
            await postgres.ScalarAsync<string>("SELECT table_schema::text FROM information_schema.tables WHERE table_name = 'events'", store.Admin));

        await postgres.ExecuteAsync($"INSERT INTO events VALUES ('{Guid.NewGuid()}', 'sleep')", store.App);
        Assert.Equal(1L, await postgres.ScalarAsync<long>("SELECT count(*) FROM events", store.App));
        await AssertDeniedAsync(() => postgres.ExecuteAsync("CREATE TABLE app_made (id int)", store.App));
        await AssertDeniedAsync(() => postgres.ExecuteAsync("DROP TABLE events", store.App));
    }

    [PostgresFact]
    public async Task Two_external_stores_cannot_reach_each_other()
    {
        var first = await postgres.CreateExternalStoreAsync("first");
        var second = await postgres.CreateExternalStoreAsync("second");

        Assert.Equal(1, await postgres.ScalarAsync<int>("SELECT 1", first.App));

        var crossed = new NpgsqlConnectionStringBuilder(first.AppConnectionString) { Database = second.Database };
        await using var crossConnect = NpgsqlDataSource.Create(crossed.ConnectionString);
        await AssertDeniedAsync(() => postgres.ScalarAsync<int>("SELECT 1", crossConnect));
    }

    [PostgresFact]
    public async Task Jsonb_payload_round_trips_and_is_queryable()
    {
        var database = await postgres.CreateDatabaseAsync();
        await postgres.ExecuteAsync("CREATE TABLE events (id uuid PRIMARY KEY, payload jsonb NOT NULL)", database);

        var id = Guid.NewGuid();
        const string payload = """{"kind":"bottle","amount_ml":120,"notes":null,"tags":["night","formula"]}""";
        await using (var insert = database.CreateCommand("INSERT INTO events (id, payload) VALUES ($1, $2)"))
        {
            insert.Parameters.Add(new NpgsqlParameter { Value = id });
            insert.Parameters.Add(new NpgsqlParameter { Value = payload, NpgsqlDbType = NpgsqlDbType.Jsonb });
            await insert.ExecuteNonQueryAsync();
        }

        var stored = await postgres.ScalarAsync<string>($"SELECT payload::text FROM events WHERE id = '{id}'", database);
        using var expected = JsonDocument.Parse(payload);
        using var actual = JsonDocument.Parse(stored!);
        Assert.True(JsonElement.DeepEquals(expected.RootElement, actual.RootElement), stored);

        Assert.Equal(120, await postgres.ScalarAsync<int>($"SELECT (payload->>'amount_ml')::int FROM events WHERE id = '{id}'", database));
        Assert.Equal(1L, await postgres.ScalarAsync<long>("""SELECT count(*) FROM events WHERE payload @> '{"tags":["night"]}'""", database));
    }

    private static async Task<bool> TryLockAsync(NpgsqlConnection connection, long key)
    {
        await using var command = new NpgsqlCommand($"SELECT pg_try_advisory_lock({key})", connection);
        return (bool)(await command.ExecuteScalarAsync())!;
    }

    private static async Task AssertDeniedAsync(Func<Task> action)
    {
        var error = await Assert.ThrowsAsync<PostgresException>(action);
        Assert.Equal(InsufficientPrivilege, error.SqlState);
    }
}
