using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The stores of one DI scope (a request or a job run) and their data contexts, one context per store, created on first use
/// (docs/design/47-bring-your-own-database.md section 3.6). Babies are entered after authorization and stay bound to the store
/// they resolved to for the life of the scope. The data-plane repositories get their context here:
/// <see cref="ContextFor"/> for a call that names the baby (it must have been entered), <see cref="Current"/> for one that names
/// only a record id or saves (the scope must hold exactly one store). There is no default store: without a bound baby every data
/// access throws <see cref="StoreScopeMissingException"/>.
/// </summary>
/// <remarks>
/// A call by record id finds a record only in the scope's store. On the built-in store that is every hosted baby's records, as
/// before; the services already check the record's baby against the one they were called for. An external store holds only
/// the records of the babies that point at it. With <c>Stores:Enabled</c> off no external store is ever opened: a baby whose
/// pointer names one gets <c>store_unavailable</c>, never the built-in store. An external store is opened only through its circuit
/// breaker (task T8): while it is open the request fails at once with the store's last failure class, without touching the network.
/// While <c>Stores:Enabled</c> is on, entering a baby also reads whether a move of its records is running (task T7, one primary-key
/// read of <c>data_store_moves</c>): such a baby's reads go on from its current store, but a save of any of its records through this
/// scope's contexts throws <c>503 store_moving</c>. A move itself never enters the baby: it opens the two stores by name
/// (<see cref="OpenStoreAsync"/>).
/// </remarks>
internal sealed class StoreScope(
    IStoreResolver resolver,
    BuiltInDataStore builtIn,
    IExternalDataStores externals,
    IStoreMigrator migrator,
    StoreCircuitBreakers breakers,
    IDataStoreMoveRepository moves,
    TimeProvider time,
    IOptions<StoreRoutingOptions> options) : IStoreScope, IAsyncDisposable, IDisposable
{
    /// <summary>The property every data-plane record names its baby with.</summary>
    private const string BabyIdProperty = "BabyId";

    private readonly Dictionary<Guid, StoreRoute> _routes = [];
    private readonly Dictionary<DataStoreKey, IDataStore> _stores = [];
    private readonly Dictionary<DataStoreKey, LottiesDataDbContext> _contexts = [];
    private readonly HashSet<Guid> _moving = [];

    /// <summary>The data context of the only store this scope holds (<c>store_scope_missing</c> with none, <c>store_scope_ambiguous</c> with several).</summary>
    public LottiesDataDbContext Current => ContextOf(OnlyStore());

    /// <summary>The built-in store's context when this scope already uses it, else <c>null</c> (then it has nothing to save).</summary>
    public LottiesDataDbContext? CreatedBuiltInContext => _contexts.GetValueOrDefault(DataStoreKey.BuiltIn);

    public async Task EnterAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        if (_routes.ContainsKey(babyId))
        {
            return;
        }

        var route = await resolver.ResolveForBabyAsync(babyId, cancellationToken);
        await OpenAsync(route.Store, cancellationToken);
        await NoteMoveAsync(babyId, cancellationToken);
        _routes[babyId] = route;
    }

    /// <summary>
    /// The data context of <paramref name="store"/>, named by the caller instead of resolved for a baby: only for a move of a baby's
    /// records between two stores (task T7), which reads one store and writes the other in the same scope. The store is opened like any
    /// other (feature flag, circuit breaker, migrator); the scope enters no baby, so the data-plane repositories stay unusable here.
    /// </summary>
    public async Task<LottiesDataDbContext> OpenStoreAsync(DataStoreKey store, CancellationToken cancellationToken = default)
    {
        await OpenAsync(store, cancellationToken);
        return ContextOf(store);
    }

    public StoreRoute RouteOf(Guid babyId) =>
        _routes.TryGetValue(babyId, out var route) ? route : throw new StoreScopeMissingException(babyId);

    /// <summary>The data context of the store bound for <paramref name="babyId"/>.</summary>
    public LottiesDataDbContext ContextFor(Guid babyId) => ContextOf(RouteOf(babyId).Store);

    /// <summary>
    /// Enters every baby of <paramref name="babyIds"/> and requires each to be on the built-in store (<c>store_unavailable</c>
    /// otherwise): for work that reaches the data tables through the control context, which only the built-in database has
    /// (account erasure, until task T10 erases a family's store).
    /// </summary>
    public async Task RequireBuiltInAsync(IEnumerable<Guid> babyIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(babyIds);
        foreach (var babyId in babyIds)
        {
            await EnterBuiltInAsync(babyId, cancellationToken);
        }
    }

    /// <summary>
    /// The built-in context for a transaction shared with the control context: only when the scope holds babies and all of them
    /// are on the built-in store (an external store cannot join a transaction of the Lotties database).
    /// </summary>
    public LottiesDataDbContext BuiltInContextForTransaction()
    {
        if (OnlyStore() != DataStoreKey.BuiltIn)
        {
            throw new InvalidOperationException("A transaction of the Lotties database cannot hold the records of a baby on an external store.");
        }

        return ContextOf(DataStoreKey.BuiltIn);
    }

    /// <summary>Throws when the context of an external store has unsaved changes: they cannot be saved with the control plane.</summary>
    public void EnsureNoExternalChanges()
    {
        if (_contexts.Any(entry => entry.Key.Kind == DataStoreKind.External && entry.Value.ChangeTracker.HasChanges()))
        {
            throw new InvalidOperationException("Changes of a baby on an external store cannot be saved with the control plane in one transaction.");
        }
    }

    /// <summary>Forgets every tracked entity of every data context of the scope.</summary>
    public void ClearTracked()
    {
        foreach (var context in _contexts.Values)
        {
            context.ChangeTracker.Clear();
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var context in OwnedContexts())
        {
            await context.DisposeAsync();
        }

        _contexts.Clear();
    }

    public void Dispose()
    {
        foreach (var context in OwnedContexts())
        {
            context.Dispose();
        }

        _contexts.Clear();
    }

    private async Task EnterBuiltInAsync(Guid babyId, CancellationToken cancellationToken)
    {
        await EnterAsync(babyId, cancellationToken);
        if (RouteOf(babyId).Store != DataStoreKey.BuiltIn)
        {
            throw new StoreUnavailableException();
        }
    }

    private async Task OpenAsync(DataStoreKey key, CancellationToken cancellationToken)
    {
        if (_stores.ContainsKey(key))
        {
            return;
        }

        _stores[key] = key.Id is { } id ? await OpenExternalAsync(id, cancellationToken) : builtIn;
    }

    /// <summary>
    /// An external store, only while the feature is on, when its circuit breaker admits the request (task T8; an open breaker throws
    /// the store's last failure class at once), once the migrator found its schema ready (task T5; it throws the store's
    /// <c>store_*</c> error otherwise) and when the store can be opened; <c>store_unavailable</c> otherwise. A connection failure on
    /// the way counts towards the breaker; a success is reported by the store's connection layer (<see cref="StoreFailureInterceptor"/>).
    /// </summary>
    private async Task<IDataStore> OpenExternalAsync(Guid storeId, CancellationToken cancellationToken)
    {
        if (!options.Value.Enabled)
        {
            throw new StoreUnavailableException();
        }

        breakers.Admit(storeId);
        try
        {
            return await ReadyExternalAsync(storeId, cancellationToken);
        }
        catch (StoreFailureException failure)
        {
            breakers.RecordFailure(storeId, failure.Failure);
            throw;
        }
    }

    private async Task<IDataStore> ReadyExternalAsync(Guid storeId, CancellationToken cancellationToken)
    {
        await migrator.EnsureReadyAsync(storeId, cancellationToken);
        return await externals.FindAsync(storeId, cancellationToken) ?? throw new StoreUnavailableException();
    }

    private DataStoreKey OnlyStore()
    {
        var bound = _routes.Values.Select(route => route.Store).Distinct().Take(2).ToArray();
        return bound.Length switch
        {
            0 => throw new StoreScopeMissingException(null),
            1 => bound[0],
            _ => throw new StoreScopeAmbiguousException(),
        };
    }

    private LottiesDataDbContext ContextOf(DataStoreKey key)
    {
        if (!_contexts.TryGetValue(key, out var context))
        {
            context = _stores[key].CreateContext();
            context.SavingChanges += RefuseWritesOfMovingBabies;
            _contexts[key] = context;
        }

        return context;
    }

    /// <summary>Remembers that a move blocks the baby's writes (only while the feature is on: with it off, no move can exist).</summary>
    private async Task NoteMoveAsync(Guid babyId, CancellationToken cancellationToken)
    {
        if (options.Value.Enabled && await moves.BlocksWritesAsync(babyId, time.GetUtcNow(), cancellationToken))
        {
            _moving.Add(babyId);
        }
    }

    /// <summary>Refuses a save that adds, changes or deletes a record of a baby whose records are being moved (<c>store_moving</c>).</summary>
    private void RefuseWritesOfMovingBabies(object? sender, SavingChangesEventArgs args)
    {
        if (_moving.Count > 0 && sender is DbContext context && context.ChangeTracker.Entries().Any(WritesAMovingBaby))
        {
            throw new StoreMovingException();
        }
    }

    private bool WritesAMovingBaby(EntityEntry entry) =>
        entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
        && entry.Metadata.FindProperty(BabyIdProperty) is not null
        && entry.Property(BabyIdProperty).CurrentValue is Guid babyId
        && _moving.Contains(babyId);

    /// <summary>The contexts this scope created on external stores; the built-in one belongs to the DI scope.</summary>
    private LottiesDataDbContext[] OwnedContexts() =>
        _contexts.Where(entry => entry.Key.Kind == DataStoreKind.External).Select(entry => entry.Value).ToArray();
}
