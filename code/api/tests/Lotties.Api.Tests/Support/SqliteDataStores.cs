using System.Collections.Concurrent;
using System.Data.Common;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// External data stores for the routing tests (docs/design/47-bring-your-own-database.md, task T2): one throw-away SQLite file per
/// store, holding only the data tables of <see cref="LottiesDataDbContext"/> (no table of the control plane, no key to one; the
/// built-in event types seeded). Each store builds its own context options once and a new context per scope (never pooled), like a
/// family's database will. A store that was never <see cref="Create">created</see> here cannot be opened. It is also the store
/// migrator of these stores (task T5): a store created here already has its schema, so it is ready; any other is unavailable.
/// Like every external store (task T8) its contexts carry the store's failure interceptor, when <see cref="FailureInterceptors"/> is
/// set, followed by <see cref="StoreFaults"/> that a test uses to make the store fail as a down Postgres would.
/// </summary>
internal sealed class SqliteDataStores : IExternalDataStores, IStoreMigrator, IDisposable
{
    private readonly ConcurrentDictionary<Guid, Store> _stores = new();

    /// <summary>The failure interceptor of a store (the host's <c>StoreFailureInterceptors.For</c>); none when null.</summary>
    public Func<Guid, IInterceptor>? FailureInterceptors { get; set; }

    /// <summary>The fault injector of a store created here.</summary>
    public StoreFaults FaultsOf(Guid storeId) => _stores[storeId].Faults;

    /// <summary>A new, empty store database; its id is the <c>data_stores</c> id the test seeds.</summary>
    public Guid Create()
    {
        var id = Guid.NewGuid();
        var store = new Store(id, Path.Combine(Path.GetTempPath(), $"lotties-store-{Guid.NewGuid():N}.db"), FailureInterceptors?.Invoke(id));
        using (var context = store.CreateDirectContext())
        {
            context.Database.EnsureCreated();
        }

        _stores[store.Key.Id!.Value] = store;
        return store.Key.Id!.Value;
    }

    public ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<IDataStore?>(_stores.GetValueOrDefault(storeId));

    public Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        _stores.ContainsKey(storeId) ? Task.CompletedTask : Task.FromException(new StoreUnavailableException());

    /// <summary>Reads the store's database directly (not through the API, its breaker or its faults).</summary>
    public async Task<TResult> QueryAsync<TResult>(Guid storeId, Func<LottiesDataDbContext, Task<TResult>> query)
    {
        await using var context = _stores[storeId].CreateDirectContext();
        return await query(context);
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        foreach (var store in _stores.Values)
        {
            File.Delete(store.Path);
        }
    }

    private sealed class Store : IDataStore
    {
        private readonly DbContextOptions<LottiesDataDbContext> _options;
        private readonly DbContextOptions<LottiesDataDbContext> _directOptions;

        public Store(Guid id, string path, IInterceptor? failureInterceptor)
        {
            Key = DataStoreKey.External(id);
            Path = path;
            IInterceptor[] interceptors = failureInterceptor is null ? [Faults, new StoreWriteFaults(Faults)] : [failureInterceptor, Faults, new StoreWriteFaults(Faults)];
            _directOptions = Options(path).Options;
            _options = Options(path).AddInterceptors(interceptors).Options;
        }

        public DataStoreKey Key { get; }

        public StoreFaults Faults { get; } = new();

        public string Path { get; }

        public LottiesDataDbContext CreateContext() => new(_options);

        public LottiesDataDbContext CreateDirectContext() => new(_directOptions);

        private static DbContextOptionsBuilder<LottiesDataDbContext> Options(string path) =>
            new DbContextOptionsBuilder<LottiesDataDbContext>()
                .UseSqlite(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false, DefaultTimeout = 30 }.ToString())
                .UseSnakeCaseNamingConvention()
                .ReplaceService<IModelCustomizer, SqliteModelCustomizer>();
    }
}

/// <summary>
/// Makes a test store fail like a down or full Postgres: a connection attempt throws <see cref="ConnectionFault"/>, an insert throws
/// <see cref="WriteFault"/> (thrown from the connection layer, so EF reports it to the interceptors as the driver's error).
/// <see cref="ConnectionAttempts"/> counts the attempts that reached the store (a request rejected by an open breaker never does).
/// </summary>
internal sealed class StoreFaults : DbConnectionInterceptor
{
    private int _attempts;

    public Exception? ConnectionFault { get; set; }

    public Exception? WriteFault { get; set; }

    public int ConnectionAttempts => Volatile.Read(ref _attempts);

    public void Clear()
    {
        ConnectionFault = null;
        WriteFault = null;
    }

    public override InterceptionResult ConnectionOpening(DbConnection connection, ConnectionEventData eventData, InterceptionResult result)
    {
        Attempt();
        return result;
    }

    public override ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection, ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
    {
        Attempt();
        return ValueTask.FromResult(result);
    }

    private void Attempt()
    {
        Interlocked.Increment(ref _attempts);
        if (ConnectionFault is { } fault)
        {
            throw fault;
        }
    }
}

/// <summary>Throws <see cref="StoreFaults.WriteFault"/> before an insert runs.</summary>
internal sealed class StoreWriteFaults(StoreFaults faults) : DbCommandInterceptor
{
    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        ThrowOnWrite(command);
        return ValueTask.FromResult(result);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        ThrowOnWrite(command);
        return ValueTask.FromResult(result);
    }

    private void ThrowOnWrite(DbCommand command)
    {
        if (faults.WriteFault is { } fault && command.CommandText.Contains("INSERT", StringComparison.Ordinal))
        {
            throw fault;
        }
    }
}
