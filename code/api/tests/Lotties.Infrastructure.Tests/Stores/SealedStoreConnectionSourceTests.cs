using System.Net;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Npgsql;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// Where a store migrator run connects (task T5): the migrator role to its own pinned endpoint (the direct one), the app role to the
/// app endpoint, both unpooled, both on the app endpoint's database. No connection is opened here.
/// </summary>
public sealed class SealedStoreConnectionSourceTests
{
    private static readonly IPAddress MigratorAddress = IPAddress.Parse("203.0.113.10");
    private static readonly IPAddress AppAddress = IPAddress.Parse("203.0.113.20");

    private static readonly StoreDescriptor Descriptor = StoreDescriptor.Create(
        "Example",
        StoreEndpoint.Create("pooler.example.com", 6543, "family_db", "lotties_app", "app-secret"),
        StoreMigratorEndpoint.Create("direct.example.com", 5432, "lotties_migrator", "migrator-secret"),
        StoreTlsPolicy.Create(StoreSslMode.VerifyFull, null));

    [Fact]
    public async Task OpenAsync_PinsEachEndpointAndUsesTheRightRoleOnTheAppDatabaseUnpooled()
    {
        var guard = new FakeGuard();
        var source = new SealedStoreConnectionSource(new FakeCredentials(Descriptor), guard, new PinnedStoreDataSourceFactory());

        await using var connections = await source.OpenAsync(StoreWithDescriptor());

        var migrator = new NpgsqlConnectionStringBuilder(connections.Migrator.ConnectionString);
        var app = new NpgsqlConnectionStringBuilder(connections.App.ConnectionString);
        Assert.Equal(["direct.example.com:5432", "pooler.example.com:6543"], guard.Pinned);
        Assert.Equal((MigratorAddress.ToString(), 5432, "family_db", "lotties_migrator", false), (migrator.Host, migrator.Port, migrator.Database, migrator.Username, migrator.Pooling));
        Assert.Equal((AppAddress.ToString(), 6543, "family_db", "lotties_app", false), (app.Host, app.Port, app.Database, app.Username, app.Pooling));
        Assert.Equal(PinnedStoreDataSourceFactory.MigrationCommandTimeoutSeconds, migrator.CommandTimeout);
        Assert.Equal(SslMode.Require, migrator.SslMode);
    }

    [Fact]
    public async Task OpenAsync_StoreWithoutDescriptor_IsUnavailableAndPinsNothing()
    {
        var guard = new FakeGuard();
        var source = new SealedStoreConnectionSource(new FakeCredentials(Descriptor), guard, new PinnedStoreDataSourceFactory());

        await Assert.ThrowsAsync<StoreUnavailableException>(() => source.OpenAsync(DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UtcNow)));

        Assert.Empty(guard.Pinned);
    }

    private static DataStore StoreWithDescriptor()
    {
        var store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), DateTimeOffset.UtcNow);
        typeof(DataStore).GetProperty(nameof(DataStore.SealedDescriptor))!.SetValue(store, new byte[] { 1, 2, 3 });
        return store;
    }

    private sealed class FakeCredentials(StoreDescriptor descriptor) : IStoreCredentials
    {
        public SealedDescriptor Seal(StoreDescriptor descriptor, StoreSealContext context) => throw new NotSupportedException();

        public StoreDescriptor Open(SealedDescriptor sealedDescriptor, StoreSealContext context) => descriptor;

        public SealedDescriptor Rewrap(SealedDescriptor sealedDescriptor, StoreSealContext context) => throw new NotSupportedException();

        public bool IsWrappedWithCurrentKey(SealedDescriptor sealedDescriptor) => true;
    }

    private sealed class FakeGuard : IStoreEndpointGuard
    {
        public List<string> Pinned { get; } = [];

        public Task<PinnedEndpoint> PinAsync(string? host, int port, CancellationToken cancellationToken = default)
        {
            Pinned.Add($"{host}:{port}");
            var address = host!.StartsWith("direct", StringComparison.Ordinal) ? MigratorAddress : AppAddress;
            return Task.FromResult(new PinnedEndpoint(address, StoreHostName.Parse(host), port));
        }

        public Task<PinnedEndpoint> RecheckAsync(PinnedEndpoint previous, CancellationToken cancellationToken = default) => Task.FromResult(previous);
    }
}
