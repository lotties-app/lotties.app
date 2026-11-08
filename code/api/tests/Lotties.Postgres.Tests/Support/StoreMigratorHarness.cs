using System.Collections.Concurrent;
using System.Data.Common;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// The store migrator (design 47 task T5) wired for the container: <c>data_stores</c> rows kept in memory (the control plane is not
/// what these tests prove) and a connection source that hands out the fixture's role connection strings instead of a sealed
/// descriptor pinned through the egress guard (the container is on loopback and has no TLS; the guard and the TLS rule have their
/// own tests). Everything else is the production code: sessions, lock, history table, <c>store_meta</c>, role audit.
/// </summary>
internal sealed class StoreMigratorHarness
{
    private readonly ConcurrentDictionary<Guid, (string Migrator, string App)> _endpoints = new();

    public InMemoryDataStoreRows Rows { get; } = new();

    /// <summary>A new <c>data_stores</c> row for <paramref name="store"/>'s database, migrator and app roles.</summary>
    public Guid Register(ExternalStore store, string? appConnectionString = null) =>
        Register(store.MigratorConnectionString, appConnectionString ?? store.AppConnectionString);

    public Guid Register(string migratorConnectionString, string appConnectionString)
    {
        var row = Rows.Add();
        _endpoints[row.Id] = (migratorConnectionString, appConnectionString);
        return row.Id;
    }

    /// <summary>
    /// Points the row <paramref name="storeId"/> at other endpoints, as new connection details typed for the same store would (the
    /// owner's replace): the row keeps its id, so <c>store_meta</c> written for it still names it.
    /// </summary>
    public void Repoint(Guid storeId, string migratorConnectionString, string appConnectionString) =>
        _endpoints[storeId] = (migratorConnectionString, appConnectionString);

    /// <summary>The owner's connection test and identity check (task T6) on the same sessions as the migrator.</summary>
    public StoreConnectionTester Tester() =>
        new(new NpgsqlStoreMigrationSessionFactory(new FixtureConnectionSource(_endpoints)), NullLogger<StoreConnectionTester>.Instance);

    /// <summary>A migrator as one API process would hold it (its own ready cache, failure backoff and in-process gate).</summary>
    public StoreMigrator Migrator(int lockWaitSeconds = 30, params IInterceptor[] interceptors) =>
        new(
            Rows,
            new NpgsqlStoreMigrationSessionFactory(new FixtureConnectionSource(_endpoints), interceptors),
            Options.Create(new StoreMigratorOptions { LockWaitSeconds = lockWaitSeconds }),
            TimeProvider.System,
            NullLogger<StoreMigrator>.Instance,
            () => 0.5);

    private sealed class FixtureConnectionSource(ConcurrentDictionary<Guid, (string Migrator, string App)> endpoints) : IStoreConnectionSource
    {
        public Task<StoreMigrationConnections> OpenAsync(DataStore store, CancellationToken cancellationToken = default)
        {
            var (migrator, app) = endpoints[store.Id];
            return Task.FromResult(new StoreMigrationConnections(Unpooled(migrator), Unpooled(app)));
        }

        private static NpgsqlDataSource Unpooled(string connectionString) =>
            NpgsqlDataSource.Create(new NpgsqlConnectionStringBuilder(connectionString) { Pooling = false }.ConnectionString);
    }
}

/// <summary><c>data_stores</c> rows in memory, through the same domain method as the EF rows, with every state recorded.</summary>
internal sealed class InMemoryDataStoreRows : IDataStoreRows
{
    private readonly ConcurrentDictionary<Guid, DataStore> _stores = new();
    private readonly ConcurrentDictionary<Guid, ConcurrentQueue<DataStoreState>> _recorded = new();

    public DataStore Add()
    {
        var store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UtcNow);
        _stores[store.Id] = store;
        _recorded[store.Id] = new ConcurrentQueue<DataStoreState>();
        return store;
    }

    public DataStore Find(Guid storeId) => _stores[storeId];

    public IReadOnlyList<DataStoreState> Recorded(Guid storeId) => [.. _recorded[storeId]];

    public Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_stores.GetValueOrDefault(storeId));

    public Task RecordAsync(Guid storeId, DataStoreState state, string? schemaVersion, CancellationToken cancellationToken = default)
    {
        lock (_stores[storeId])
        {
            _stores[storeId].RecordMigrationState(state, schemaVersion, DateTimeOffset.UtcNow);
        }

        _recorded[storeId].Enqueue(state);
        return Task.CompletedTask;
    }
}

/// <summary>Records every command text the migrator's context sends.</summary>
internal sealed class CommandLog : DbCommandInterceptor
{
    public ConcurrentQueue<string> Commands { get; } = new();

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Commands.Enqueue(command.CommandText);
        return ValueTask.FromResult(result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        Commands.Enqueue(command.CommandText);
        return ValueTask.FromResult(result);
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
    {
        Commands.Enqueue(command.CommandText);
        return ValueTask.FromResult(result);
    }
}

/// <summary>
/// Kills the migrator's own backend (as the provider's admin would, or a crash would) right before the first command whose text
/// contains <paramref name="trigger"/>, so that command runs on a dead connection in the middle of a migration.
/// </summary>
internal sealed class KillConnectionBefore(string trigger, NpgsqlDataSource admin) : DbCommandInterceptor
{
    private int _killed;

    public bool Killed => _killed == 1;

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await KillIfTriggeredAsync(command);
        return result;
    }

    public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        KillIfTriggeredAsync(command).GetAwaiter().GetResult();
        return result;
    }

    private async Task KillIfTriggeredAsync(DbCommand command)
    {
        if (!command.CommandText.Contains(trigger, StringComparison.Ordinal) || Interlocked.Exchange(ref _killed, 1) == 1)
            return;
        var pid = ((NpgsqlConnection)command.Connection!).ProcessID;
        await using var kill = admin.CreateCommand($"SELECT pg_terminate_backend({pid}, 10000)");
        await kill.ExecuteScalarAsync();
    }
}
