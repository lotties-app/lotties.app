using System.Net;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The production external stores (design 47 sections 3.2, 3.3 and 3.6): the sealed descriptor is opened for its own row, the app
/// endpoint (never the migrator one) goes through the egress guard on every new pool, one pool per store and descriptor version, closed on
/// <see cref="IStoreHealth.Forget"/>, on a new descriptor, when idle and past the limit, and disposed only after its contexts. Nothing here
/// opens a connection: the data sources point at public documentation-free addresses that are never dialled.
/// </summary>
public sealed class ExternalDataStoresTests
{
    private const string AppHost = "pooler.example.com";
    private const string MigratorHost = "direct.example.com";
    private const string AppDatabase = "family_db";
    private const string AppUser = "lotties_app";
    private const string AppPassword = "app-secret-71";
    private const string MigratorUser = "lotties_migrator";
    private const string MigratorPassword = "migrator-secret-72";

    private static readonly DateTimeOffset Start = new(2026, 11, 8, 9, 0, 0, TimeSpan.Zero);
    private static readonly IPAddress AppAddress = IPAddress.Parse("8.8.4.4");

    private static readonly StoreDescriptor Descriptor = StoreDescriptor.Create(
        "Example",
        StoreEndpoint.Create(AppHost, 6543, AppDatabase, AppUser, AppPassword),
        StoreMigratorEndpoint.Create(MigratorHost, 5432, MigratorUser, MigratorPassword),
        StoreTlsPolicy.Create(StoreSslMode.VerifyFull, null));

    private readonly FakeRows _rows = new();
    private readonly RecordingCredentials _credentials = new(Descriptor);
    private readonly RecordingGuard _guard = new();
    private readonly ForgettingMigrator _migrator = new();
    private readonly ManualClock _clock = new(Start);
    private readonly CapturingLogger<ExternalDataStores> _logger = new();
    private readonly ExternalDataStoreOptions _options = new();

    [Fact]
    public async Task FindAsync_OpensTheDescriptorForItsOwnRowAndPinsOnlyTheAppEndpoint()
    {
        var store = _rows.Ready();
        using var externals = Externals();

        var found = await externals.FindAsync(store.Id);

        await using var context = found!.CreateContext();
        var settings = new NpgsqlConnectionStringBuilder(context.Database.GetDbConnection().ConnectionString);
        Assert.Equal([new StoreSealContext(store.Id, store.OwnerUserId)], _credentials.Contexts);
        Assert.Equal([$"{AppHost}:6543"], _guard.Pinned);
        Assert.Equal((AppAddress.ToString(), 6543, AppDatabase, AppUser), (settings.Host, settings.Port, settings.Database, settings.Username));
        Assert.Equal((true, PinnedStoreDataSourceFactory.CommandTimeoutSeconds, SslMode.Require), (settings.Pooling, settings.CommandTimeout, settings.SslMode));
        Assert.Equal(DataStoreKey.External(store.Id), found.Key);
    }

    [Fact]
    public async Task CreateContext_IsANewExternalStoreContextCarryingTheStoresFailureInterceptor()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        var found = (await externals.FindAsync(store.Id))!;

        await using var first = found.CreateContext();
        await using var second = found.CreateContext();

        Assert.NotSame(first, second);
        Assert.True(first.IsExternalStore);
        Assert.Equal(ExternalStoreSchema.Schema, first.Model.GetDefaultSchema());
        var interceptors = first.GetService<IDbContextOptions>().FindExtension<CoreOptionsExtension>()!.Interceptors!;
        Assert.Equal(store.Id, Assert.Single(interceptors.OfType<StoreFailureInterceptor>()).StoreId);
        Assert.Equal(2, Assert.Single(externals.LivePools).Leases);
    }

    [Fact]
    public async Task FindAsync_SameStoreAndDescriptor_ReusesThePoolWithoutResolvingAgain()
    {
        var store = _rows.Ready();
        using var externals = Externals();

        await externals.FindAsync(store.Id);
        await externals.FindAsync(store.Id);

        Assert.Single(_guard.Pinned);
        Assert.Single(_credentials.Contexts);
        Assert.Single(externals.LivePools);
    }

    [Fact]
    public async Task FindAsync_TwoStores_GetAPoolEach()
    {
        var first = _rows.Ready();
        var second = _rows.Ready();
        using var externals = Externals();

        await externals.FindAsync(first.Id);
        await externals.FindAsync(second.Id);

        Assert.Equal(2, _guard.Pinned.Count);
        Assert.Equal(new[] { first.Id, second.Id }.Order(), externals.LivePools.Select(pool => pool.StoreId).Order());
        Assert.NotSame(externals.LivePools.First().DataSource, externals.LivePools.Last().DataSource);
    }

    [Fact]
    public async Task FindAsync_DescriptorReplaced_BuildsANewPoolAndRetiresTheOldOne()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await externals.FindAsync(store.Id);
        var old = Assert.Single(externals.LivePools);

        store.ReplaceDescriptor(SealedDescriptor.FromBytes([9, 9, 9]), "Example", Start);
        store.RecordMigrationState(DataStoreState.Ready, null, Start);
        await externals.FindAsync(store.Id);

        Assert.NotSame(old, Assert.Single(externals.LivePools));
        Assert.Same(old, Assert.Single(externals.RetiredPools));
        Assert.Equal(2, _guard.Pinned.Count);
    }

    [Fact]
    public async Task Forget_ClosesThePoolAndTheRebuiltOneRefusesARebindingToAPrivateAddress()
    {
        var store = _rows.Ready();
        var resolver = new FakeHostResolver().Answer(AppAddress.ToString()).Answer("10.0.0.7");
        using var externals = Externals(new StoreEndpointGuard(resolver, Options.Create(new StoreEndpointGuardOptions())));
        await externals.FindAsync(store.Id);

        externals.Forget(store.Id);
        var error = await Assert.ThrowsAsync<StoreUnavailableException>(() => externals.FindAsync(store.Id).AsTask());

        Assert.Equal(2, resolver.Calls);
        Assert.Empty(externals.LivePools);
        Assert.Null(error.InnerException);
        Assert.Contains(_logger.Entries, entry => entry.Message.Contains("endpoint_blocked_address", StringComparison.Ordinal));
        AssertNoSecretIn(error.Message);
        AssertNoSecretInLogs();
    }

    [Fact]
    public async Task StoreHealthForget_ClosesTheStoresPool()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await externals.FindAsync(store.Id);
        var breakers = Breakers();

        new StoreHealth(breakers, _migrator, externals).Forget(store.Id);

        Assert.Empty(externals.LivePools);
        Assert.Single(externals.RetiredPools);
        Assert.Equal([store.Id], _migrator.Forgotten);
    }

    [Fact]
    public async Task Sweep_IdlePool_IsRetiredThenDisposedAfterTheGrace()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await externals.FindAsync(store.Id);
        var pool = Assert.Single(externals.LivePools);

        _clock.Advance(TimeSpan.FromMinutes(_options.IdleMinutes));
        externals.Sweep();
        Assert.Equal((true, false), (pool.IsRetired, pool.IsClosed));
        _clock.Advance(ExternalDataStores.RetiredGrace);
        externals.Sweep();

        Assert.True(pool.IsClosed);
        Assert.Empty(externals.LivePools);
        Assert.Empty(externals.RetiredPools);
    }

    [Fact]
    public async Task Sweep_PoolInUse_IsNotIdle()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await using var context = (await externals.FindAsync(store.Id))!.CreateContext();

        _clock.Advance(TimeSpan.FromMinutes(_options.IdleMinutes) * 2);
        externals.Sweep();

        Assert.Single(externals.LivePools);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Sweep_RetiredPoolStaysOpenUntilItsLastContextIsDisposed(bool disposeAsync)
    {
        var store = _rows.Ready();
        using var externals = Externals();
        var context = (await externals.FindAsync(store.Id))!.CreateContext();
        var pool = Assert.Single(externals.LivePools);
        externals.Forget(store.Id);

        _clock.Advance(ExternalDataStores.RetiredGrace);
        externals.Sweep();
        Assert.Equal((1, false), (pool.Leases, pool.IsClosed));
        await DisposeAsync(context, disposeAsync);
        externals.Sweep();

        Assert.Equal((0, true), (pool.Leases, pool.IsClosed));
        Assert.Empty(externals.RetiredPools);
    }

    [Fact]
    public async Task Sweep_ContextNeverDisposed_ClosesTheRetiredPoolAfterTheLimit()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        var leaked = (await externals.FindAsync(store.Id))!.CreateContext();
        var pool = Assert.Single(externals.LivePools);
        externals.Forget(store.Id);

        _clock.Advance(ExternalDataStores.RetiredLimit);
        externals.Sweep();

        Assert.Equal((1, true), (pool.Leases, pool.IsClosed));
        GC.KeepAlive(leaked);
    }

    [Fact]
    public async Task FindAsync_PastMaxCount_RetiresTheLeastRecentlyUsedPool()
    {
        _options.MaxCount = 2;
        var first = _rows.Ready();
        var second = _rows.Ready();
        var third = _rows.Ready();
        using var externals = Externals();
        await externals.FindAsync(first.Id);
        _clock.Advance(TimeSpan.FromSeconds(1));
        await externals.FindAsync(second.Id);
        _clock.Advance(TimeSpan.FromSeconds(1));
        await externals.FindAsync(first.Id);
        _clock.Advance(TimeSpan.FromSeconds(1));

        await externals.FindAsync(third.Id);

        Assert.Equal(new[] { first.Id, third.Id }.Order(), externals.LivePools.Select(pool => pool.StoreId).Order());
        Assert.Equal(second.Id, Assert.Single(externals.RetiredPools).StoreId);
    }

    [Fact]
    public async Task FindAsync_DisabledStore_IsNotFoundAndItsPoolIsClosed()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await externals.FindAsync(store.Id);

        typeof(DataStore).GetProperty(nameof(DataStore.State))!.SetValue(store, DataStoreState.Disabled);

        Assert.Null(await externals.FindAsync(store.Id));
        Assert.Empty(externals.LivePools);
    }

    [Fact]
    public async Task FindAsync_UnknownStoreOrNoDescriptor_IsNotFoundWithoutOpeningAnything()
    {
        var withoutDescriptor = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), Start);
        _rows.Put(withoutDescriptor);
        using var externals = Externals();

        Assert.Null(await externals.FindAsync(Guid.NewGuid()));
        Assert.Null(await externals.FindAsync(withoutDescriptor.Id));

        Assert.Empty(_credentials.Contexts);
        Assert.Empty(_guard.Pinned);
    }

    [Theory]
    [InlineData(DataStoreState.Pending)]
    [InlineData(DataStoreState.Unreachable)]
    [InlineData(DataStoreState.SchemaAhead)]
    public async Task FindAsync_RowNotReady_IsMigratingAndTheMigratorChecksTheStoreAgain(DataStoreState state)
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await externals.FindAsync(store.Id);
        store.ReplaceDescriptor(SealedDescriptor.FromBytes([1, 2, 3]), "Example", Start);
        store.RecordMigrationState(state, null, Start);

        await Assert.ThrowsAsync<StoreMigratingException>(() => externals.FindAsync(store.Id).AsTask());

        Assert.Equal([store.Id], _migrator.Forgotten);
        Assert.Empty(externals.LivePools);
        Assert.Single(_guard.Pinned);
    }

    [Fact]
    public async Task FindAsync_DescriptorThatDoesNotOpen_IsUnavailableAndLogsOnlyTheKind()
    {
        var store = _rows.Ready();
        _credentials.Failure = StoreCredentialsFailure.AuthenticationFailed;
        using var externals = Externals();

        var error = await Assert.ThrowsAsync<StoreUnavailableException>(() => externals.FindAsync(store.Id).AsTask());

        Assert.Null(error.InnerException);
        Assert.Empty(_guard.Pinned);
        Assert.Contains(_logger.Entries, entry => entry.Message.Contains(nameof(StoreCredentialsFailure.AuthenticationFailed), StringComparison.Ordinal));
        Assert.Empty(externals.LivePools);
    }

    [Fact]
    public async Task FindAsync_ConcurrentFirstUses_BuildOnePool()
    {
        var store = _rows.Ready();
        using var externals = Externals();

        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => externals.FindAsync(store.Id).AsTask()));

        Assert.Single(_guard.Pinned);
        Assert.Single(externals.LivePools);
        Assert.Empty(externals.RetiredPools);
    }

    [Fact]
    public async Task Dispose_ClosesEveryPool()
    {
        var store = _rows.Ready();
        var externals = Externals();
        await externals.FindAsync(store.Id);
        var pool = Assert.Single(externals.LivePools);

        await externals.DisposeAsync();

        Assert.True(pool.IsClosed);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => externals.FindAsync(_rows.Ready().Id).AsTask());
    }

    [Fact]
    public async Task Logs_NeverCarryAHostAUserADatabaseOrAPassword()
    {
        var store = _rows.Ready();
        using var externals = Externals();
        await using (var context = (await externals.FindAsync(store.Id))!.CreateContext())
        {
            Assert.NotNull(context);
        }

        externals.Forget(store.Id);
        _clock.Advance(ExternalDataStores.RetiredGrace);
        externals.Sweep();

        Assert.NotEmpty(_logger.Entries);
        AssertNoSecretInLogs();
    }

    private ExternalDataStores Externals(IStoreEndpointGuard? guard = null) =>
        new(
            _rows,
            _credentials,
            guard ?? _guard,
            new PinnedStoreDataSourceFactory(),
            new StoreFailureInterceptors(Breakers(), NullLogger<StoreFailureInterceptor>.Instance),
            _migrator,
            Options.Create(_options),
            _clock,
            _logger);

    private StoreCircuitBreakers Breakers() =>
        new(Options.Create(new StoreCircuitBreakerOptions()), _clock, NullLogger<StoreCircuitBreakers>.Instance);

    private static async Task DisposeAsync(LottiesDataDbContext context, bool disposeAsync)
    {
        if (disposeAsync)
        {
            await context.DisposeAsync();
            return;
        }

        context.Dispose();
    }

    private static void AssertNoSecretIn(string text)
    {
        foreach (var secret in new[] { AppHost, MigratorHost, AppDatabase, AppUser, AppPassword, MigratorUser, MigratorPassword, AppAddress.ToString(), "10.0.0.7" })
        {
            Assert.DoesNotContain(secret, text, StringComparison.OrdinalIgnoreCase);
        }
    }

    private void AssertNoSecretInLogs()
    {
        foreach (var entry in _logger.Entries)
        {
            AssertNoSecretIn(entry.Message);
            AssertNoSecretIn(string.Join(" ", entry.Values));
            Assert.Null(entry.Exception);
        }
    }

    /// <summary><c>data_stores</c> rows in memory; a ready row has a sealed descriptor of its own (random bytes: the credentials are fake).</summary>
    private sealed class FakeRows : IDataStoreRows
    {
        private readonly Dictionary<Guid, DataStore> _stores = [];

        public DataStore Ready()
        {
            var store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), Start);
            store.ReplaceDescriptor(SealedDescriptor.FromBytes(Guid.NewGuid().ToByteArray()), "Example", Start);
            store.RecordMigrationState(DataStoreState.Ready, "20261107000000_Baseline", Start);
            return Put(store);
        }

        public DataStore Put(DataStore store)
        {
            lock (_stores)
            {
                _stores[store.Id] = store;
            }

            return store;
        }

        public Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default)
        {
            lock (_stores)
            {
                return Task.FromResult(_stores.GetValueOrDefault(storeId));
            }
        }

        public Task RecordAsync(Guid storeId, DataStoreState state, string? schemaVersion, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("The external stores never write the row.");
    }

    private sealed class RecordingCredentials(StoreDescriptor opened) : IStoreCredentials
    {
        private readonly List<StoreSealContext> _contexts = [];

        public StoreCredentialsFailure? Failure { get; set; }

        public IReadOnlyList<StoreSealContext> Contexts
        {
            get
            {
                lock (_contexts)
                {
                    return [.. _contexts];
                }
            }
        }

        public SealedDescriptor Seal(StoreDescriptor descriptor, StoreSealContext context) => throw new NotSupportedException();

        public StoreDescriptor Open(SealedDescriptor sealedDescriptor, StoreSealContext context)
        {
            lock (_contexts)
            {
                _contexts.Add(context);
            }

            return Failure is { } failure ? throw new StoreCredentialsUnreadableException(failure) : opened;
        }

        public SealedDescriptor Rewrap(SealedDescriptor sealedDescriptor, StoreSealContext context) => throw new NotSupportedException();

        public bool IsWrappedWithCurrentKey(SealedDescriptor sealedDescriptor) => true;
    }

    private sealed class RecordingGuard : IStoreEndpointGuard
    {
        private readonly List<string> _pinned = [];

        public IReadOnlyList<string> Pinned
        {
            get
            {
                lock (_pinned)
                {
                    return [.. _pinned];
                }
            }
        }

        public async Task<PinnedEndpoint> PinAsync(string? host, int port, CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            lock (_pinned)
            {
                _pinned.Add($"{host}:{port}");
            }

            return new PinnedEndpoint(AppAddress, StoreHostName.Parse(host), port);
        }

        public Task<PinnedEndpoint> RecheckAsync(PinnedEndpoint previous, CancellationToken cancellationToken = default) =>
            PinAsync(previous.HostName.Value, previous.Port, cancellationToken);
    }

    private sealed class ForgettingMigrator : IStoreMigrator, IStoreMemory
    {
        public List<Guid> Forgotten { get; } = [];

        public Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public void Forget(Guid storeId) => Forgotten.Add(storeId);
    }

    /// <summary>A clock that moves only when told to; timers never fire (the tests sweep themselves).</summary>
    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private long _ticks;

        public override long TimestampFrequency => TimeSpan.TicksPerSecond;

        public override long GetTimestamp() => Interlocked.Read(ref _ticks);

        public override DateTimeOffset GetUtcNow() => start + TimeSpan.FromTicks(Interlocked.Read(ref _ticks));

        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) => new NoTimer();

        private sealed class NoTimer : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => false;

            public void Dispose()
            {
            }

            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }
}
