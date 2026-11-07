using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;

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
/// the records of the babies that point at it.
/// </remarks>
internal sealed class StoreScope(IStoreResolver resolver, BuiltInDataStore builtIn, IExternalDataStores externals) : IStoreScope, IAsyncDisposable, IDisposable
{
    private readonly Dictionary<Guid, StoreRoute> _routes = [];
    private readonly Dictionary<DataStoreKey, IDataStore> _stores = [];
    private readonly Dictionary<DataStoreKey, LottiesDataDbContext> _contexts = [];

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
        _routes[babyId] = route;
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

        _stores[key] = key.Id is { } id
            ? await externals.FindAsync(id, cancellationToken) ?? throw new StoreUnavailableException()
            : builtIn;
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
            _contexts[key] = context;
        }

        return context;
    }

    /// <summary>The contexts this scope created on external stores; the built-in one belongs to the DI scope.</summary>
    private LottiesDataDbContext[] OwnedContexts() =>
        _contexts.Where(entry => entry.Key.Kind == DataStoreKind.External).Select(entry => entry.Value).ToArray();
}
