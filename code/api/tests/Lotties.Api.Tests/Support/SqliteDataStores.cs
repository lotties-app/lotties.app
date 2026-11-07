using System.Collections.Concurrent;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// External data stores for the routing tests (docs/design/47-bring-your-own-database.md, task T2): one throw-away SQLite file per
/// store, holding only the data tables of <see cref="LottiesDataDbContext"/> (no table of the control plane, no key to one; the
/// built-in event types seeded). Each store builds its own context options once and a new context per scope (never pooled), like a
/// family's database will. A store that was never <see cref="Create">created</see> here cannot be opened.
/// </summary>
internal sealed class SqliteDataStores : IExternalDataStores, IDisposable
{
    private readonly ConcurrentDictionary<Guid, Store> _stores = new();

    /// <summary>A new, empty store database; its id is the <c>data_stores</c> id the test seeds.</summary>
    public Guid Create()
    {
        var store = new Store(Guid.NewGuid(), Path.Combine(Path.GetTempPath(), $"lotties-store-{Guid.NewGuid():N}.db"));
        using (var context = store.CreateContext())
        {
            context.Database.EnsureCreated();
        }

        _stores[store.Key.Id!.Value] = store;
        return store.Key.Id!.Value;
    }

    public ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<IDataStore?>(_stores.GetValueOrDefault(storeId));

    /// <summary>Reads the store's database directly (not through the API).</summary>
    public async Task<TResult> QueryAsync<TResult>(Guid storeId, Func<LottiesDataDbContext, Task<TResult>> query)
    {
        await using var context = _stores[storeId].CreateContext();
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

        public Store(Guid id, string path)
        {
            Key = DataStoreKey.External(id);
            Path = path;
            _options = new DbContextOptionsBuilder<LottiesDataDbContext>()
                .UseSqlite(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false, DefaultTimeout = 30 }.ToString())
                .UseSnakeCaseNamingConvention()
                .ReplaceService<IModelCustomizer, SqliteModelCustomizer>()
                .Options;
        }

        public DataStoreKey Key { get; }

        public string Path { get; }

        public LottiesDataDbContext CreateContext() => new(_options);
    }
}
