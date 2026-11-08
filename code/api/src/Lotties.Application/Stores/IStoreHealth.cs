namespace Lotties.Application.Stores;

/// <summary>
/// What this process remembers about an external store between requests (docs/design/47-bring-your-own-database.md section 5,
/// task T8): its circuit breaker and the migrator's "ready" flag (trusted for 5 minutes) and failure backoff. Nothing read from a
/// store is kept in process beyond a request. Forget a store whenever its descriptor is replaced or removed, so the next request
/// tries the new connection at once instead of replaying the old store's failure or trusting its schema check.
/// </summary>
public interface IStoreHealth
{
    /// <summary>Drops the breaker, the ready flag and the failure backoff of store <paramref name="storeId"/> (a <c>data_stores</c> id).</summary>
    void Forget(Guid storeId);
}
