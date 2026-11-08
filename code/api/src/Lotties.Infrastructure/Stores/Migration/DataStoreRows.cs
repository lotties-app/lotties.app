using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>The control rows the store migrator reads and writes (<c>data_stores</c>).</summary>
internal interface IDataStoreRows
{
    /// <summary>The store's row as it is now, untracked; <c>null</c> when there is none.</summary>
    Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Mirrors what the migrator found into <c>data_stores.state</c> and <c>schema_version</c> (a null version keeps the stored
    /// one); nothing when the row is gone. Throws <c>store_state_transition</c> for a move the domain does not allow.
    /// </summary>
    Task RecordAsync(Guid storeId, DataStoreState state, string? schemaVersion, CancellationToken cancellationToken = default);
}

/// <summary>
/// <see cref="IDataStoreRows"/> on the Lotties database, each call in a DI scope of its own: the migrator runs inside a request,
/// and its writes must never ride on the request's control context (its change tracker or its transaction).
/// </summary>
internal sealed class EfDataStoreRows(IServiceScopeFactory scopes, TimeProvider time) : IDataStoreRows
{
    public async Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var control = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        return await control.DataStores.AsNoTracking().SingleOrDefaultAsync(store => store.Id == storeId, cancellationToken);
    }

    public async Task RecordAsync(Guid storeId, DataStoreState state, string? schemaVersion, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var control = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        var store = await control.DataStores.SingleOrDefaultAsync(row => row.Id == storeId, cancellationToken);
        store?.RecordMigrationState(state, schemaVersion, time.GetUtcNow());
        await control.SaveChangesAsync(cancellationToken);
    }
}
