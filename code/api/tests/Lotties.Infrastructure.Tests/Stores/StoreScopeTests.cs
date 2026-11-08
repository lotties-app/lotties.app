using Lotties.Application.Stores;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The fail-closed scope of docs/design/47-bring-your-own-database.md section 3.6, with a fake resolver and fake external stores (no
/// connection is ever opened): a data context only for an entered baby, never the built-in store for a baby of another store, no
/// external store at all while <c>Stores:Enabled</c> is off, and an external store only after the store migrator (task T5) found it
/// ready. The flag is on unless a test turns it off before the first entry.
/// </summary>
public sealed class StoreScopeTests : IDisposable
{
    private static readonly DatabaseOptions Options = new("localhost", 5432, "model_tests", "user", "password");
    private static readonly Guid StoreX = Guid.Parse("5a000000-0000-4000-8000-000000000001");
    private static readonly Guid StoreY = Guid.Parse("5a000000-0000-4000-8000-000000000002");
    private static readonly Guid StoreGone = Guid.Parse("5a000000-0000-4000-8000-0000000000ff");
    private static readonly Guid HostedBaby = Guid.Parse("b0000000-0000-4000-8000-000000000001");
    private static readonly Guid BabyInX = Guid.Parse("b0000000-0000-4000-8000-000000000002");
    private static readonly Guid BabyInY = Guid.Parse("b0000000-0000-4000-8000-000000000003");
    private static readonly Guid BabyInGone = Guid.Parse("b0000000-0000-4000-8000-000000000004");

    private readonly FakeResolver _resolver = new(new Dictionary<Guid, StoreRoute>
    {
        [HostedBaby] = StoreRoute.BuiltInDefault,
        [BabyInX] = new(DataStoreKey.External(StoreX), 1),
        [BabyInY] = new(DataStoreKey.External(StoreY), 2),
        [BabyInGone] = new(DataStoreKey.External(StoreGone), 1),
    });

    private readonly FakeStores _externals = new(StoreX, StoreY);
    private readonly StoreRoutingOptions _routing = new() { Enabled = true };
    private readonly FakeMigrator _migrator = new();
    private readonly ServiceProvider _provider;
    private readonly IServiceScope _scope;

    public StoreScopeTests()
    {
        var services = new ServiceCollection().AddInfrastructure(Options);
        services.AddScoped<IStoreResolver>(_ => _resolver);
        services.AddSingleton<IExternalDataStores>(_externals);
        services.AddSingleton<IStoreMigrator>(_migrator);
        services.AddSingleton(Microsoft.Extensions.Options.Options.Create(_routing));
        _provider = services.BuildServiceProvider();
        _scope = _provider.CreateScope();
    }

    private StoreScope Stores => _scope.ServiceProvider.GetRequiredService<StoreScope>();

    public void Dispose()
    {
        _scope.Dispose();
        _provider.Dispose();
    }

    [Fact]
    public void DataAccess_NothingEntered_ThrowsStoreScopeMissing()
    {
        Assert.Equal("store_scope_missing", Assert.Throws<StoreScopeMissingException>(() => Stores.Current).Code);
        Assert.Equal(HostedBaby, Assert.Throws<StoreScopeMissingException>(() => Stores.ContextFor(HostedBaby)).BabyId);
        Assert.Throws<StoreScopeMissingException>(() => Stores.RouteOf(HostedBaby));
    }

    [Fact]
    public async Task ContextFor_AnotherBabyThanTheOneEntered_ThrowsStoreScopeMissing()
    {
        await Stores.EnterAsync(BabyInX);

        var error = Assert.Throws<StoreScopeMissingException>(() => Stores.ContextFor(HostedBaby));

        Assert.Equal(HostedBaby, error.BabyId);
    }

    [Fact]
    public async Task EnterAsync_HostedBaby_UsesTheScopesOwnBuiltInContext()
    {
        await Stores.EnterAsync(HostedBaby);

        Assert.Same(_scope.ServiceProvider.GetRequiredService<LottiesDataDbContext>(), Stores.ContextFor(HostedBaby));
        Assert.Same(Stores.ContextFor(HostedBaby), Stores.Current);
        Assert.Equal(StoreRoute.BuiltInDefault, Stores.RouteOf(HostedBaby));
    }

    [Fact]
    public async Task EnterAsync_BabyOfAnExternalStore_UsesThatStoreNeverTheBuiltInOne()
    {
        await Stores.EnterAsync(BabyInX);

        var context = Stores.ContextFor(BabyInX);

        Assert.Same(_externals.ContextsOf(StoreX).Single(), context);
        Assert.NotSame(_scope.ServiceProvider.GetRequiredService<LottiesDataDbContext>(), context);
        Assert.Equal(new StoreRoute(DataStoreKey.External(StoreX), 1), Stores.RouteOf(BabyInX));
    }

    [Fact]
    public async Task EnterAsync_StoreThatCannotBeOpened_ThrowsStoreUnavailableAndBindsNothing()
    {
        var error = await Assert.ThrowsAsync<StoreUnavailableException>(() => Stores.EnterAsync(BabyInGone));

        Assert.Equal("store_unavailable", error.Code);
        Assert.Throws<StoreScopeMissingException>(() => Stores.ContextFor(BabyInGone));
        Assert.Throws<StoreScopeMissingException>(() => Stores.Current);
    }

    [Fact]
    public async Task EnterAsync_BabyOfAnExternalStore_AsksTheMigratorOncePerStoreBeforeHandingItOut()
    {
        await Stores.EnterAsync(BabyInX);
        await Stores.EnterAsync(BabyInX);
        _ = Stores.ContextFor(BabyInX);

        Assert.Equal([StoreX], _migrator.Asked);
        Assert.Single(_externals.ContextsOf(StoreX));
    }

    [Fact]
    public async Task EnterAsync_HostedBaby_NeverAsksTheMigrator()
    {
        await Stores.EnterAsync(HostedBaby);

        Assert.Empty(_migrator.Asked);
    }

    [Fact]
    public async Task EnterAsync_StoreTheMigratorRefuses_ThrowsItsErrorAndBindsNothing()
    {
        _migrator.Failure = new StoreSchemaAheadException();

        await Assert.ThrowsAsync<StoreSchemaAheadException>(() => Stores.EnterAsync(BabyInX));

        Assert.Empty(_externals.ContextsOf(StoreX));
        Assert.Throws<StoreScopeMissingException>(() => Stores.ContextFor(BabyInX));
    }

    [Fact]
    public async Task EnterAsync_FlagOff_NeverAsksTheMigrator()
    {
        _routing.Enabled = false;

        await Assert.ThrowsAsync<StoreUnavailableException>(() => Stores.EnterAsync(BabyInX));

        Assert.Empty(_migrator.Asked);
    }

    [Fact]
    public async Task EnterAsync_FlagOff_BabyOfAnExternalStoreIsUnavailableAndNeverServedFromTheBuiltInStore()
    {
        _routing.Enabled = false;

        await Assert.ThrowsAsync<StoreUnavailableException>(() => Stores.EnterAsync(BabyInX));

        Assert.Empty(_externals.ContextsOf(StoreX));
        Assert.Throws<StoreScopeMissingException>(() => Stores.ContextFor(BabyInX));
        Assert.Throws<StoreScopeMissingException>(() => Stores.Current);
    }

    [Fact]
    public async Task EnterAsync_FlagOff_HostedBabyIsOnTheBuiltInStore()
    {
        _routing.Enabled = false;

        await Stores.EnterAsync(HostedBaby);

        Assert.Same(_scope.ServiceProvider.GetRequiredService<LottiesDataDbContext>(), Stores.ContextFor(HostedBaby));
        Assert.Equal(1, _resolver.Calls(HostedBaby));
    }

    [Fact]
    public async Task EnterAsync_SameBabyTwice_ResolvesOnceAndKeepsItsStore()
    {
        await Stores.EnterAsync(BabyInX);
        var first = Stores.ContextFor(BabyInX);

        await Stores.EnterAsync(BabyInX);

        Assert.Equal(1, _resolver.Calls(BabyInX));
        Assert.Same(first, Stores.ContextFor(BabyInX));
        Assert.Single(_externals.ContextsOf(StoreX));
    }

    [Fact]
    public async Task Current_BabiesOfTwoStores_ThrowsAmbiguousWhileEachBabyKeepsItsOwnStore()
    {
        await Stores.EnterAsync(BabyInX);
        await Stores.EnterAsync(BabyInY);

        var error = Assert.Throws<StoreScopeAmbiguousException>(() => Stores.Current);

        Assert.Equal("store_scope_ambiguous", error.Code);
        var (inX, inY) = (Stores.ContextFor(BabyInX), Stores.ContextFor(BabyInY));
        Assert.Same(_externals.ContextsOf(StoreX).Single(), inX);
        Assert.Same(_externals.ContextsOf(StoreY).Single(), inY);
    }

    [Fact]
    public async Task RequireBuiltInAsync_BabyOfAnExternalStore_ThrowsStoreUnavailable()
    {
        await Stores.RequireBuiltInAsync([HostedBaby]);

        await Assert.ThrowsAsync<StoreUnavailableException>(() => Stores.RequireBuiltInAsync([HostedBaby, BabyInX]));
    }

    [Fact]
    public async Task BuiltInContextForTransaction_OnlyWhenEveryBabyIsOnTheBuiltInStore()
    {
        Assert.Throws<StoreScopeMissingException>(() => Stores.BuiltInContextForTransaction());
        await Stores.EnterAsync(HostedBaby);
        Assert.Same(Stores.ContextFor(HostedBaby), Stores.BuiltInContextForTransaction());

        await Stores.EnterAsync(BabyInX);

        Assert.Throws<StoreScopeAmbiguousException>(() => Stores.BuiltInContextForTransaction());
    }

    [Fact]
    public async Task BuiltInContextForTransaction_OnlyAnExternalBaby_Throws()
    {
        await Stores.EnterAsync(BabyInX);

        Assert.Throws<InvalidOperationException>(() => Stores.BuiltInContextForTransaction());
    }

    [Fact]
    public async Task EnsureNoExternalChanges_PendingChangeOfAnExternalStore_Throws()
    {
        await Stores.EnterAsync(HostedBaby);
        await Stores.EnterAsync(BabyInX);
        Stores.EnsureNoExternalChanges();

        Stores.ContextFor(BabyInX).Events.Add(Event.Create(Guid.NewGuid(), BabyInX, BuiltInEventTypes.DiaperId, Guid.NewGuid(), DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch, EventPayload.From("""{"content":"WET"}"""), null, DateTimeOffset.UnixEpoch));

        Assert.Throws<InvalidOperationException>(() => Stores.EnsureNoExternalChanges());
        Assert.Null(Stores.CreatedBuiltInContext);
    }

    [Fact]
    public async Task Dispose_DisposesTheExternalContextsOnly()
    {
        await Stores.EnterAsync(HostedBaby);
        await Stores.EnterAsync(BabyInX);
        var builtIn = Stores.ContextFor(HostedBaby);
        var external = Stores.ContextFor(BabyInX);

        await Stores.DisposeAsync();

        Assert.Throws<ObjectDisposedException>(() => external.Model);
        Assert.NotNull(builtIn.Model);
    }

    private sealed class FakeResolver(IReadOnlyDictionary<Guid, StoreRoute> routes) : IStoreResolver
    {
        private readonly Dictionary<Guid, int> _calls = [];

        public int Calls(Guid babyId) => _calls.GetValueOrDefault(babyId);

        public Task<StoreRoute> ResolveForBabyAsync(Guid babyId, CancellationToken cancellationToken = default)
        {
            _calls[babyId] = Calls(babyId) + 1;
            return Task.FromResult(routes[babyId]);
        }
    }

    private sealed class FakeMigrator : IStoreMigrator
    {
        public List<Guid> Asked { get; } = [];

        public Exception? Failure { get; set; }

        public Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default)
        {
            Asked.Add(storeId);
            return Failure is { } failure ? Task.FromException(failure) : Task.CompletedTask;
        }
    }

    /// <summary>External stores that hand out contexts on a placeholder connection (never opened) and remember them.</summary>
    private sealed class FakeStores(params Guid[] storeIds) : IExternalDataStores
    {
        private readonly Dictionary<Guid, FakeStore> _stores = storeIds.ToDictionary(id => id, id => new FakeStore(DataStoreKey.External(id)));

        public IReadOnlyList<LottiesDataDbContext> ContextsOf(Guid storeId) => _stores[storeId].Created;

        public ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult<IDataStore?>(_stores.GetValueOrDefault(storeId));
    }

    private sealed class FakeStore(DataStoreKey key) : IDataStore
    {
        private readonly List<LottiesDataDbContext> _created = [];

        public DataStoreKey Key => key;

        public IReadOnlyList<LottiesDataDbContext> Created => _created;

        public LottiesDataDbContext CreateContext()
        {
            var context = ModelTestContext.CreateData();
            _created.Add(context);
            return context;
        }
    }
}
