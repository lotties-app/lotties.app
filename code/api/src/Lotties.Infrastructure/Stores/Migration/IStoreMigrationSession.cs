using Lotties.Domain.Stores;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// One migrator run on one external store (task T5): a connection of the store's migrator role, which holds the migration lock and
/// applies the data chain, plus the app role's credentials for the privilege audit. Every call works on the store only; nothing
/// here touches the Lotties database.
/// </summary>
internal interface IStoreMigrationSession : IAsyncDisposable
{
    /// <summary>The data migrations this API ships, in order.</summary>
    IReadOnlyList<string> KnownMigrations { get; }

    /// <summary>What the app role may do beyond reading and writing the data tables (connects as the app role).</summary>
    Task<StoreRoleAudit> AuditAppRoleAsync(CancellationToken cancellationToken = default);

    /// <summary>Whether the database holds the control tables of a Lotties database (then it is never migrated).</summary>
    Task<bool> HoldsControlTablesAsync(CancellationToken cancellationToken = default);

    /// <summary>Takes the store's migration lock if it is free (a session-level advisory lock); false when someone holds it.</summary>
    Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default);

    Task ReleaseLockAsync(CancellationToken cancellationToken = default);

    /// <summary>The data migrations recorded in the store's history table (empty before the first run).</summary>
    Task<IReadOnlyList<string>> GetAppliedMigrationsAsync(CancellationToken cancellationToken = default);

    /// <summary>The store's own row, or <c>null</c> when the store has none yet.</summary>
    Task<StoreMetaSnapshot?> ReadMetaAsync(CancellationToken cancellationToken = default);

    /// <summary>Applies every pending data migration (each in its own transaction: a failed step leaves the store as it was).</summary>
    Task MigrateAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes the store's own row: <paramref name="state"/> and <paramref name="schemaVersion"/>; the store id and a new epoch on
    /// the first write only. Does nothing while the store has no <c>store_meta</c> table (before the baseline).
    /// </summary>
    Task WriteMetaAsync(Guid storeId, DataStoreState state, string schemaVersion, CancellationToken cancellationToken = default);
}

/// <summary>Opens <see cref="IStoreMigrationSession"/>s for a store row (unseals its descriptor, pins its endpoints).</summary>
internal interface IStoreMigrationSessionFactory
{
    Task<IStoreMigrationSession> OpenAsync(DataStore store, CancellationToken cancellationToken = default);
}

/// <summary>What <c>lotties.store_meta</c> says about the store.</summary>
internal sealed record StoreMetaSnapshot(Guid StoreId, Guid Epoch, string SchemaVersion, string State);
