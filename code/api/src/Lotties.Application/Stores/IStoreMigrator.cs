namespace Lotties.Application.Stores;

/// <summary>
/// Brings an external data store's schema up to this API's data migrations before it is used
/// (docs/design/47-bring-your-own-database.md section 4, task T5): lazily, on the first use of the store by this API version,
/// never at startup and never for the built-in store (the Lotties database keeps its own migration chain). The data routing asks
/// it before it hands out an external store; it returns only when the store is ready to serve and otherwise throws one of the
/// <c>store_*</c> domain errors (<c>store_unavailable</c>, <c>store_migrating</c>, <c>store_schema_ahead</c>,
/// <c>store_role_too_powerful</c>, <c>store_schema_conflict</c>, <c>store_migration_failed</c>), all retriable for a client.
/// </summary>
public interface IStoreMigrator
{
    /// <summary>Returns when the store <paramref name="storeId"/> (a <c>data_stores</c> id, never from a client) is ready.</summary>
    Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default);
}
