using Npgsql;
using Testcontainers.PostgreSql;

namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// One postgres:17 container per test collection, with helpers to run SQL, open data sources and create a second
/// database with its own role set (<see cref="CreateExternalStoreAsync"/>). Starts nothing where no container runtime
/// is reachable: the tests are skipped there by <see cref="PostgresFactAttribute"/>. A suite that needs a container of its own with
/// another setup derives from it (<see cref="Configure"/>, e.g. <see cref="StoppablePostgresFixture"/>).
/// </summary>
public class PostgresFixture : IAsyncLifetime
{
    public const string Image = "postgres:17";

    private readonly List<IAsyncDisposable> _owned = [];
    private PostgreSqlContainer? _container;
    private NpgsqlDataSource? _dataSource;

    /// <summary>Superuser connection string to the container's default database.</summary>
    public string ConnectionString => Container.GetConnectionString();

    /// <summary>Superuser data source on the container's default database.</summary>
    public NpgsqlDataSource DataSource => _dataSource ?? throw NotStarted();

    /// <summary>The running container.</summary>
    protected PostgreSqlContainer Container => _container ?? throw NotStarted();

    /// <summary>Extra container setup of a derived fixture.</summary>
    protected virtual PostgreSqlBuilder Configure(PostgreSqlBuilder builder) => builder;

    public async Task InitializeAsync()
    {
        if (!ContainerRuntime.IsAvailable)
            return;
        _container = Configure(new PostgreSqlBuilder(Image)).Build();
        await _container.StartAsync();
        _dataSource = NpgsqlDataSource.Create(_container.GetConnectionString());
    }

    public async Task DisposeAsync()
    {
        for (var i = _owned.Count - 1; i >= 0; i--)
            await _owned[i].DisposeAsync();
        if (_dataSource is not null)
            await _dataSource.DisposeAsync();
        if (_container is not null)
            await _container.DisposeAsync();
    }

    /// <summary>A unique lower-case identifier for a database, role or schema (safe to inline in DDL).</summary>
    public static string UniqueName(string prefix) => $"{prefix}_{Guid.NewGuid():N}"[..Math.Min(prefix.Length + 13, 40)];

    /// <summary>A data source on <paramref name="database"/>, optionally as another role; disposed with the fixture.</summary>
    public NpgsqlDataSource OpenDataSource(string? database = null, string? username = null, string? password = null)
    {
        var builder = new NpgsqlConnectionStringBuilder(ConnectionString);
        if (database is not null)
            builder.Database = database;
        if (username is not null)
        {
            builder.Username = username;
            builder.Password = password;
        }
        var dataSource = NpgsqlDataSource.Create(builder.ConnectionString);
        _owned.Add(dataSource);
        return dataSource;
    }

    public async Task ExecuteAsync(string sql, NpgsqlDataSource? on = null, CancellationToken ct = default)
    {
        await using var command = (on ?? DataSource).CreateCommand(sql);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<T?> ScalarAsync<T>(string sql, NpgsqlDataSource? on = null, CancellationToken ct = default)
    {
        await using var command = (on ?? DataSource).CreateCommand(sql);
        var value = await command.ExecuteScalarAsync(ct);
        return value is null or DBNull ? default : (T)value;
    }

    /// <summary>Creates an empty database and returns a superuser data source on it (disposed with the fixture).</summary>
    public async Task<NpgsqlDataSource> CreateDatabaseAsync(string? name = null, CancellationToken ct = default)
    {
        var database = name ?? UniqueName("db");
        await ExecuteAsync($"CREATE DATABASE \"{database}\"", ct: ct);
        return OpenDataSource(database);
    }

    /// <summary>
    /// A second database with the BYO role set: <c>{name}_migrator</c> owns schema <c>lotties</c>,
    /// <c>{name}_app</c> may only use it (DML on tables the migrator creates), neither can create anything in
    /// <c>public</c>, neither is superuser or may create roles or databases.
    /// </summary>
    public async Task<ExternalStore> CreateExternalStoreAsync(string prefix = "store", CancellationToken ct = default)
    {
        var name = UniqueName(prefix);
        var migrator = $"{name}_migrator";
        var app = $"{name}_app";
        var migratorPassword = Guid.NewGuid().ToString("N");
        var appPassword = Guid.NewGuid().ToString("N");

        await ExecuteAsync(
            $"CREATE ROLE \"{migrator}\" LOGIN PASSWORD '{migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; "
            + $"CREATE ROLE \"{app}\" LOGIN PASSWORD '{appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;",
            ct: ct);
        var admin = await CreateDatabaseAsync(name, ct);
        await ExecuteAsync(
            $"REVOKE ALL ON DATABASE \"{name}\" FROM PUBLIC; "
            + $"GRANT CONNECT ON DATABASE \"{name}\" TO \"{migrator}\", \"{app}\"; "
            + "REVOKE ALL ON SCHEMA public FROM PUBLIC; "
            + $"CREATE SCHEMA {ExternalStore.Schema} AUTHORIZATION \"{migrator}\"; "
            + $"GRANT USAGE ON SCHEMA {ExternalStore.Schema} TO \"{app}\"; "
            + $"ALTER DEFAULT PRIVILEGES FOR ROLE \"{migrator}\" IN SCHEMA {ExternalStore.Schema} "
            + $"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO \"{app}\"; "
            + $"ALTER ROLE \"{migrator}\" IN DATABASE \"{name}\" SET search_path = {ExternalStore.Schema}; "
            + $"ALTER ROLE \"{app}\" IN DATABASE \"{name}\" SET search_path = {ExternalStore.Schema};",
            admin,
            ct);

        var store = new ExternalStore(
            name,
            migrator,
            app,
            Builder(name).ConnectionString,
            Builder(name, migrator, migratorPassword).ConnectionString,
            Builder(name, app, appPassword).ConnectionString);
        _owned.Add(store);
        return store;
    }

    private NpgsqlConnectionStringBuilder Builder(string database, string? username = null, string? password = null)
    {
        var builder = new NpgsqlConnectionStringBuilder(ConnectionString) { Database = database };
        if (username is null)
            return builder;
        builder.Username = username;
        builder.Password = password;
        return builder;
    }

    private static InvalidOperationException NotStarted() =>
        new("The Postgres container is not running: use [PostgresFact] so the test is skipped without a container runtime.");
}
