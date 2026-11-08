using Lotties.Application.Stores;

namespace Lotties.Infrastructure.Stores.Failures;

/// <summary>Something this process remembers per external store between requests (never data read from the store).</summary>
internal interface IStoreMemory
{
    void Forget(Guid storeId);
}

/// <summary>
/// Forgets a store in the circuit breakers, in the migrator (when it is the real one, which remembers ready stores) and in the external
/// stores (when they are the real ones, which keep a connection pool per store: it is closed, and the next request builds a new one from
/// the row, resolving and checking the host again).
/// </summary>
internal sealed class StoreHealth(StoreCircuitBreakers breakers, IStoreMigrator migrator, IExternalDataStores externals) : IStoreHealth
{
    public void Forget(Guid storeId)
    {
        breakers.Forget(storeId);
        (migrator as IStoreMemory)?.Forget(storeId);
        (externals as IStoreMemory)?.Forget(storeId);
    }
}
