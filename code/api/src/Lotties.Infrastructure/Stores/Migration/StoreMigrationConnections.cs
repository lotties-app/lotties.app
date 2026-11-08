using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Npgsql;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// The two unpooled data sources of one migrator run: the migrator role (direct endpoint, DDL, the lock) and the app role (only
/// for the privilege audit). Disposed after the run, which closes every connection and so releases any lock left behind.
/// </summary>
internal sealed record StoreMigrationConnections(NpgsqlDataSource Migrator, NpgsqlDataSource App) : IAsyncDisposable
{
    public async ValueTask DisposeAsync()
    {
        await App.DisposeAsync();
        await Migrator.DisposeAsync();
    }
}

/// <summary>Where a migrator run connects to: the store's endpoints, opened from its sealed descriptor.</summary>
internal interface IStoreConnectionSource
{
    /// <summary>The run's data sources; <c>store_unavailable</c> when the store has no descriptor or it cannot be opened.</summary>
    Task<StoreMigrationConnections> OpenAsync(DataStore store, CancellationToken cancellationToken = default);
}

/// <summary>
/// Opens a store's descriptor (task T3) and pins both of its endpoints through the egress guard (task T4): the migrator connects to
/// its own host and port (the direct endpoint: a transaction pooler breaks session advisory locks, docs/design/47a-byo-database-spikes.md
/// consequence 1) and to the app endpoint's database, with the same TLS rule. The plaintext descriptor lives only inside this call
/// and the data sources it builds; nothing of it is logged.
/// </summary>
internal sealed class SealedStoreConnectionSource(
    IStoreCredentials credentials,
    IStoreEndpointGuard guard,
    PinnedStoreDataSourceFactory dataSources) : IStoreConnectionSource
{
    public async Task<StoreMigrationConnections> OpenAsync(DataStore store, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        var descriptor = Open(store);
        var roots = descriptor.Tls.CaCertificatePem is { } pem ? StoreTrustAnchors.FromPem(pem) : null;
        var migratorEndpoint = await guard.PinAsync(descriptor.Migrator.Host, descriptor.Migrator.Port, cancellationToken);
        var appEndpoint = await guard.PinAsync(descriptor.App.Host, descriptor.App.Port, cancellationToken);
        var migratorFields = StoreConnectionFields.Create(descriptor.App.Database, descriptor.Migrator.Username, descriptor.Migrator.Password.Reveal());
        var appFields = StoreConnectionFields.Create(descriptor.App.Database, descriptor.App.Username, descriptor.App.Password.Reveal());
        return new StoreMigrationConnections(
            dataSources.CreateForMigration(migratorEndpoint, migratorFields, roots),
            dataSources.CreateForMigration(appEndpoint, appFields, roots));
    }

    private StoreDescriptor Open(DataStore store) =>
        store.SealedDescriptor is { } sealedBytes
            ? credentials.Open(SealedDescriptor.FromBytes(sealedBytes), new StoreSealContext(store.Id, store.OwnerUserId))
            : throw new StoreUnavailableException();
}
