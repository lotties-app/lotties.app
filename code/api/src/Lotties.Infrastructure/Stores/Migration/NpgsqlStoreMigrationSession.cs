using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// A migrator run on one store, on one open connection of the store's migrator role with a <see cref="LottiesDataDbContext"/> in the
/// external store's shape (<see cref="ExternalStoreSchema"/>): the data chain, its history table <c>lotties.__ef_data_migrations</c>
/// and <c>lotties.store_meta</c>. The lock is <c>pg_try_advisory_lock(<see cref="LockKey"/>)</c> on that connection; advisory locks
/// belong to one database, so the fixed key serializes the runs on this store only. The connection is unpooled, so closing it
/// releases the lock even when the explicit unlock fails (a killed run included).
/// </summary>
internal sealed class NpgsqlStoreMigrationSession : IStoreMigrationSession
{
    /// <summary>Advisory lock key of a store's data migration ("LOTTIESD" in ASCII); the control database uses another one.</summary>
    internal const long LockKey = 0x4C4F545449455344;

    private const string ControlTablesSql = """
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace n
            WHERE (SELECT count(DISTINCT c.relname) FROM pg_catalog.pg_class c
                   WHERE c.relnamespace = n.oid AND c.relname IN ('__EFMigrationsHistory', 'babies', 'baby_members')) = 3)
        """;

    /// <summary>
    /// The app role's rights, as the app role itself sees them: superuser-like attributes, ownership (directly or through a role it
    /// belongs to) of schema <c>lotties</c> or anything in it, and <c>CREATE</c> on <c>public</c> or <c>lotties</c>. Catalog only.
    /// </summary>
    private const string AppRoleAuditSql = """
        SELECT
            (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user),
            EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                    WHERE n.nspname = 'lotties'
                      AND (pg_catalog.pg_has_role(current_user, n.nspowner, 'USAGE')
                           OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                                      WHERE c.relnamespace = n.oid AND pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')))),
            EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                    WHERE n.nspname = 'public' AND pg_catalog.has_schema_privilege(n.oid, 'CREATE')),
            EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                    WHERE n.nspname = 'lotties' AND pg_catalog.has_schema_privilege(n.oid, 'CREATE'))
        """;

    private const string ReadMetaSql = """
        SELECT store_id, epoch, schema_version, state FROM lotties.store_meta WHERE id = 1
        """;

    private const string HasMetaTableSql = $"SELECT to_regclass('{ExternalStoreSchema.Schema}.{ExternalStoreSchema.MetaTable}') IS NOT NULL";

    private const string ReadStoreIdSql = $"SELECT store_id FROM {ExternalStoreSchema.Schema}.{ExternalStoreSchema.MetaTable} WHERE id = 1";

    private const string WriteMetaSql = """
        INSERT INTO lotties.store_meta (id, store_id, epoch, schema_version, state, updated_at)
        VALUES (1, @store_id, @epoch, @schema_version, @state, now())
        ON CONFLICT (id) DO UPDATE SET schema_version = EXCLUDED.schema_version, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
        """;

    private readonly StoreMigrationConnections _connections;
    private readonly NpgsqlConnection _connection;
    private readonly LottiesDataDbContext _context;

    private NpgsqlStoreMigrationSession(StoreMigrationConnections connections, NpgsqlConnection connection, DbContextOptions<LottiesDataDbContext> options)
    {
        _connections = connections;
        _connection = connection;
        _context = new LottiesDataDbContext(options);
        KnownMigrations = _context.Database.GetMigrations().ToArray();
    }

    public IReadOnlyList<string> KnownMigrations { get; }

    /// <summary>
    /// Opens the migrator connection on <paramref name="connections"/> (which the session then owns). <paramref name="interceptors"/>
    /// is a test seam (a test kills the connection in the middle of a migration); production passes none.
    /// </summary>
    public static async Task<NpgsqlStoreMigrationSession> OpenAsync(
        StoreMigrationConnections connections,
        IReadOnlyList<IInterceptor> interceptors,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(connections);
        var connection = await OpenConnectionAsync(connections, cancellationToken);
        var options = new DbContextOptionsBuilder<LottiesDataDbContext>(ExternalStoreSchema.Options(connection)).AddInterceptors(interceptors).Options;
        return new NpgsqlStoreMigrationSession(connections, connection, options);
    }

    public async Task<StoreRoleAudit> AuditAppRoleAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await PinnedStoreDataSourceFactory.OpenAsync(_connections.App, cancellationToken);
        await using var command = new NpgsqlCommand(AppRoleAuditSql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return StoreRoleAudit.From(reader.GetBoolean(0), reader.GetBoolean(1), reader.GetBoolean(2), reader.GetBoolean(3));
    }

    public async Task<bool> HoldsControlTablesAsync(CancellationToken cancellationToken = default) =>
        await ScalarAsync(ControlTablesSql, cancellationToken) is true;

    public async Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default) =>
        await ScalarAsync($"SELECT pg_try_advisory_lock({LockKey})", cancellationToken) is true;

    public async Task ReleaseLockAsync(CancellationToken cancellationToken = default) =>
        await ScalarAsync($"SELECT pg_advisory_unlock({LockKey})", cancellationToken);

    public async Task<IReadOnlyList<string>> GetAppliedMigrationsAsync(CancellationToken cancellationToken = default) =>
        (await _context.Database.GetAppliedMigrationsAsync(cancellationToken)).ToArray();

    public async Task<StoreMetaSnapshot?> ReadMetaAsync(CancellationToken cancellationToken = default)
    {
        if (!await HasMetaTableAsync(cancellationToken))
        {
            return null;
        }

        await using var command = new NpgsqlCommand(ReadMetaSql, _connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new StoreMetaSnapshot(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3))
            : null;
    }

    public async Task<Guid?> ReadAppStoreIdAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await PinnedStoreDataSourceFactory.OpenAsync(_connections.App, cancellationToken);
        if (await ScalarAsync(HasMetaTableSql, connection, cancellationToken) is not true)
        {
            return null;
        }

        return await ScalarAsync(ReadStoreIdSql, connection, cancellationToken) is Guid storeId ? storeId : null;
    }

    public Task MigrateAsync(CancellationToken cancellationToken = default) => _context.Database.MigrateAsync(cancellationToken);

    public async Task WriteMetaAsync(Guid storeId, DataStoreState state, string schemaVersion, CancellationToken cancellationToken = default)
    {
        if (!await HasMetaTableAsync(cancellationToken))
        {
            return;
        }

        await using var command = new NpgsqlCommand(WriteMetaSql, _connection);
        command.Parameters.AddWithValue("store_id", storeId);
        command.Parameters.AddWithValue("epoch", Guid.NewGuid());
        command.Parameters.AddWithValue("schema_version", schemaVersion);
        command.Parameters.AddWithValue("state", state.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        await _context.DisposeAsync();
        await _connection.DisposeAsync();
        await _connections.DisposeAsync();
    }

    private static async Task<NpgsqlConnection> OpenConnectionAsync(StoreMigrationConnections connections, CancellationToken cancellationToken)
    {
        try
        {
            return await PinnedStoreDataSourceFactory.OpenAsync(connections.Migrator, cancellationToken);
        }
        catch
        {
            await connections.DisposeAsync();
            throw;
        }
    }

    private async Task<bool> HasMetaTableAsync(CancellationToken cancellationToken) =>
        await ScalarAsync(HasMetaTableSql, cancellationToken) is true;

    private Task<object?> ScalarAsync(string sql, CancellationToken cancellationToken) => ScalarAsync(sql, _connection, cancellationToken);

    private static async Task<object?> ScalarAsync(string sql, NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return await command.ExecuteScalarAsync(cancellationToken);
    }
}

/// <summary>Opens <see cref="NpgsqlStoreMigrationSession"/>s on the connections <see cref="IStoreConnectionSource"/> gives for a store.</summary>
internal sealed class NpgsqlStoreMigrationSessionFactory(IStoreConnectionSource connections, IReadOnlyList<IInterceptor>? interceptors = null)
    : IStoreMigrationSessionFactory
{
    private readonly IReadOnlyList<IInterceptor> _interceptors = interceptors ?? [];

    public async Task<IStoreMigrationSession> OpenAsync(DataStore store, CancellationToken cancellationToken = default) =>
        await NpgsqlStoreMigrationSession.OpenAsync(await connections.OpenAsync(store, cancellationToken), _interceptors, cancellationToken);
}
