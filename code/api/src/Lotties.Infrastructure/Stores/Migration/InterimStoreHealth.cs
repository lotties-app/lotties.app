using Lotties.Application.Stores;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// Interim <see cref="IStoreHealth"/> until task T8 (PR #59, <c>Stores/Failures/StoreHealth</c>, which also drops the circuit
/// breaker) is merged: forgets the migrator's ready flag and failure backoff. Registered with <c>TryAdd</c> after the routing, so
/// T8's registration wins once it exists; delete this class then.
/// </summary>
internal sealed class InterimStoreHealth(IStoreMigrator migrator) : IStoreHealth
{
    public void Forget(Guid storeId) => (migrator as StoreMigrator)?.Forget(storeId);
}
