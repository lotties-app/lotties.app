namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The external stores this process can open, by <c>data_stores</c> id (docs/design/47-bring-your-own-database.md). Opening one
/// means reading its row, unsealing the descriptor (task T3) and checking the endpoint (task T4); the schema is brought up to date
/// before, by <c>IStoreMigrator</c> (task T5, called by <see cref="StoreScope"/>). While <c>Stores:Enabled</c> is on production
/// registers <see cref="ExternalDataStores"/> (a pool per store on the store's app role); with the flag off (the default) it keeps
/// <see cref="NoExternalDataStores"/>, so a baby on an external store gets <c>store_unavailable</c>. Tests register stores of their own
/// (two SQLite databases) to prove the routing.
/// </summary>
/// <remarks>
/// Contract of every implementation (task T8): each data context an external <see cref="IDataStore"/> creates carries the store's
/// <see cref="Failures.StoreFailureInterceptor"/> (<c>StoreFailureInterceptors.For(storeId)</c>, added with <c>AddInterceptors</c>),
/// so its connection failures feed the store's circuit breaker and reach clients as a retriable <c>503 store_*</c>, never as the
/// driver's error; and the Npgsql data source keeps the fixed connect and command timeouts of
/// <see cref="PinnedStoreDataSourceFactory"/> (the context sets no command timeout of its own).
/// </remarks>
public interface IExternalDataStores
{
    /// <summary>
    /// The store, or <c>null</c> when it cannot be used (unknown, disabled, no descriptor). A store that cannot be opened now throws its
    /// <c>store_*</c> failure.
    /// </summary>
    ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default);
}

/// <summary>No external store can be opened (<c>Stores:Enabled</c> off): the routing fails closed for any baby that points at one.</summary>
internal sealed class NoExternalDataStores : IExternalDataStores
{
    public ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) => ValueTask.FromResult<IDataStore?>(null);
}
