using Lotties.Application.Stores;

namespace Lotties.Infrastructure.Stores.Failures;

/// <summary>Something this process remembers per external store between requests (never data read from the store).</summary>
internal interface IStoreMemory
{
    void Forget(Guid storeId);
}

/// <summary>Forgets a store in the circuit breakers and in the migrator (when it is the real one, which remembers ready stores).</summary>
internal sealed class StoreHealth(StoreCircuitBreakers breakers, IStoreMigrator migrator) : IStoreHealth
{
    public void Forget(Guid storeId)
    {
        breakers.Forget(storeId);
        (migrator as IStoreMemory)?.Forget(storeId);
    }
}
