using System.Collections.Concurrent;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The external stores of this process while <c>Stores:Enabled</c> is on (docs/design/47-bring-your-own-database.md sections 3.2, 3.3
/// and 3.6): one pooled <see cref="NpgsqlDataSource"/> per store, on the store's <b>app</b> role (the migrator role is only ever used by
/// the store migrator's own sessions), built from the store's <c>data_stores</c> row: the sealed descriptor is opened for that row (the
/// associated data is the store id and its owner, so a blob copied to another row does not open), the app endpoint goes through the
/// egress guard again (resolved, every address checked, one pinned) and the data source connects to the pinned address with TLS
/// verified against the typed host name (<see cref="PinnedStoreDataSourceFactory"/>). Each request gets a new, unpooled
/// <see cref="Persistence.LottiesDataDbContext"/> in the external store's shape (<see cref="Persistence.ExternalStoreSchema"/>: schema
/// <c>lotties</c>, snake case) that carries the store's <see cref="StoreFailureInterceptor"/>; the data source's fixed connect and command
/// timeouts apply. The schema was brought up to date before, by <see cref="IStoreMigrator"/>, which <see cref="StoreScope"/> calls first.
/// </summary>
/// <remarks>
/// <para>
/// The row is read on every call (one primary-key read of the control database), so a store that another API instance disabled, emptied
/// or gave new credentials is seen at once: a <see cref="DataStoreState.Disabled"/> store or one without a descriptor is not found
/// (<c>store_unavailable</c>), a store whose row is not <see cref="DataStoreState.Ready"/> although this process's migrator trusted it is
/// <c>store_migrating</c> and the migrator checks it again on the next request, and a replaced descriptor (another sealed blob) builds a
/// new pool. A pool is keyed by the store id and the version of its sealed descriptor, never by host.
/// </para>
/// <para>
/// A pool is closed when the store is forgotten (<see cref="IStoreHealth.Forget"/>: its descriptor was replaced or removed), when its
/// descriptor changes, when the row stops serving, when nobody used it for <see cref="ExternalDataStoreOptions.IdleMinutes"/> and, past
/// <see cref="ExternalDataStoreOptions.MaxCount"/> live pools, the least recently used one. Closing first retires it: its idle physical
/// connections are closed at once, new requests get a new pool (built again from the row, so the name is resolved and checked again and a
/// DNS rebinding is refused), and the data source itself is disposed once every context made on it was disposed (at least
/// <see cref="RetiredGrace"/> after retirement, at most <see cref="RetiredLimit"/>), so work in flight is never cut.
/// </para>
/// <para>
/// Nothing of a descriptor is logged or put into an exception: no host, address, database, user, password or connection string; a store
/// that cannot be opened is logged with its id and a coarse reason (an <c>endpoint_*</c> code or the kind of unreadable seal) and answers
/// as a <c>store_*</c> failure (a retriable 503).
/// </para>
/// </remarks>
internal sealed class ExternalDataStores : IExternalDataStores, IStoreMemory, IAsyncDisposable, IDisposable
{
    /// <summary>How often idle and retired pools are looked at.</summary>
    internal static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(1);

    /// <summary>Shortest life of a retired pool: a request that found it just before may still create its context on it.</summary>
    internal static readonly TimeSpan RetiredGrace = TimeSpan.FromMinutes(1);

    /// <summary>Longest a retired pool waits for its contexts to be disposed before it is disposed anyway (a context that leaked).</summary>
    internal static readonly TimeSpan RetiredLimit = TimeSpan.FromMinutes(30);

    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, ExternalStorePool> _live = [];
    private readonly List<ExternalStorePool> _retired = [];
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _openings = new();
    private readonly IDataStoreRows _rows;
    private readonly IStoreCredentials _credentials;
    private readonly IStoreEndpointGuard _guard;
    private readonly PinnedStoreDataSourceFactory _dataSources;
    private readonly StoreFailureInterceptors _interceptors;
    private readonly IStoreMigrator _migrator;
    private readonly ExternalDataStoreOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<ExternalDataStores> _logger;
    private ITimer? _sweeper;
    private bool _disposed;

    public ExternalDataStores(
        IDataStoreRows rows,
        IStoreCredentials credentials,
        IStoreEndpointGuard guard,
        PinnedStoreDataSourceFactory dataSources,
        StoreFailureInterceptors interceptors,
        IStoreMigrator migrator,
        IOptions<ExternalDataStoreOptions> options,
        TimeProvider time,
        ILogger<ExternalDataStores> logger)
    {
        _rows = rows ?? throw new ArgumentNullException(nameof(rows));
        _credentials = credentials ?? throw new ArgumentNullException(nameof(credentials));
        _guard = guard ?? throw new ArgumentNullException(nameof(guard));
        _dataSources = dataSources ?? throw new ArgumentNullException(nameof(dataSources));
        _interceptors = interceptors ?? throw new ArgumentNullException(nameof(interceptors));
        _migrator = migrator ?? throw new ArgumentNullException(nameof(migrator));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));
        _time = time ?? throw new ArgumentNullException(nameof(time));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>The live pools, by store id (tests).</summary>
    internal IReadOnlyCollection<ExternalStorePool> LivePools
    {
        get
        {
            lock (_gate)
            {
                return [.. _live.Values];
            }
        }
    }

    /// <summary>The retired pools not disposed yet (tests).</summary>
    internal IReadOnlyCollection<ExternalStorePool> RetiredPools
    {
        get
        {
            lock (_gate)
            {
                return [.. _retired];
            }
        }
    }

    public async ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default)
    {
        var store = await _rows.FindAsync(storeId, cancellationToken);
        if (store?.SealedDescriptor is not { } sealedDescriptor || store.State == DataStoreState.Disabled)
        {
            Close(storeId, PoolCloseReason.StoreUnusable);
            return null;
        }

        EnsureServing(store);
        var version = DescriptorVersion.Of(sealedDescriptor);
        return Reuse(storeId, version) ?? await OpenAsync(store, sealedDescriptor, version, cancellationToken);
    }

    /// <summary>Closes the store's pool (its descriptor was replaced or removed); the next request builds a new one.</summary>
    public void Forget(Guid storeId) => Close(storeId, PoolCloseReason.Forgotten);

    /// <summary>Retires the idle pools and disposes the retired ones nobody uses any more (the timer's work; tests call it).</summary>
    internal void Sweep()
    {
        IReadOnlyList<ExternalStorePool> idle;
        IReadOnlyList<ExternalStorePool> finished;
        lock (_gate)
        {
            idle = RetireIdleLocked();
            finished = TakeFinishedLocked();
            StopSweeperWhenEmptyLocked();
        }

        Retired(idle, PoolCloseReason.Idle);
        DisposeAll(finished);
    }

    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }

    public void Dispose()
    {
        IReadOnlyList<ExternalStorePool> all;
        lock (_gate)
        {
            _disposed = true;
            _sweeper?.Dispose();
            _sweeper = null;
            all = [.. _live.Values, .. _retired];
            _live.Clear();
            _retired.Clear();
        }

        DisposeAll(all);
    }

    /// <summary>
    /// Only a <see cref="DataStoreState.Ready"/> store serves. Another state here means this process's migrator still trusts an older
    /// check (another instance found the store unreachable, or replaced its descriptor): the migrator forgets it and checks the store again
    /// on the next request.
    /// </summary>
    private void EnsureServing(DataStore store)
    {
        if (DataStoreStateTransitions.Serves(store.State))
        {
            return;
        }

        _logger.LogInformation("Store {StoreId} is {State} although this process found it ready; it is checked again on the next request", store.Id, store.State);
        Close(store.Id, PoolCloseReason.NotServing);
        (_migrator as IStoreMemory)?.Forget(store.Id);
        throw new StoreMigratingException();
    }

    private ExternalDataStore? Reuse(Guid storeId, DescriptorVersion version)
    {
        lock (_gate)
        {
            return _live.TryGetValue(storeId, out var pool) && pool.Version == version ? pool.Use() : null;
        }
    }

    /// <summary>Builds the store's pool, one opening per store at a time (a second request waits and reuses it).</summary>
    private async Task<IDataStore> OpenAsync(DataStore store, byte[] sealedDescriptor, DescriptorVersion version, CancellationToken cancellationToken)
    {
        var opening = _openings.GetOrAdd(store.Id, _ => new SemaphoreSlim(1, 1));
        await opening.WaitAsync(cancellationToken);
        try
        {
            return Reuse(store.Id, version) ?? Add(await CreatePoolAsync(store, sealedDescriptor, version, cancellationToken));
        }
        finally
        {
            opening.Release();
        }
    }

    private async Task<ExternalStorePool> CreatePoolAsync(DataStore store, byte[] sealedDescriptor, DescriptorVersion version, CancellationToken cancellationToken)
    {
        try
        {
            var dataSource = await BuildDataSourceAsync(store, sealedDescriptor, cancellationToken);
            return new ExternalStorePool(store.Id, version, dataSource, _interceptors.For(store.Id), _time);
        }
        catch (StoreEndpointRejectedException rejected)
        {
            throw Refused(store.Id, rejected.Code, StoreFailureClassifier.Classify(rejected) ?? StoreFailureClass.Unavailable);
        }
        catch (StoreCredentialsUnreadableException unreadable)
        {
            throw Refused(store.Id, unreadable.Failure.ToString(), StoreFailureClass.Unavailable);
        }
    }

    /// <summary>
    /// Opens the descriptor for this row, checks and pins the app endpoint (resolving its name now) and builds the pooled data source on
    /// the app role. The plaintext lives only in this call and in the data source.
    /// </summary>
    private async Task<NpgsqlDataSource> BuildDataSourceAsync(DataStore store, byte[] sealedDescriptor, CancellationToken cancellationToken)
    {
        var descriptor = _credentials.Open(SealedDescriptor.FromBytes(sealedDescriptor), new StoreSealContext(store.Id, store.OwnerUserId));
        var endpoint = await _guard.PinAsync(descriptor.App.Host, descriptor.App.Port, cancellationToken);
        var fields = StoreConnectionFields.Create(descriptor.App.Database, descriptor.App.Username, descriptor.App.Password.Reveal());
        var roots = descriptor.Tls.CaCertificatePem is { } pem ? StoreTrustAnchors.FromPem(pem) : null;
        return _dataSources.Create(endpoint, fields, roots);
    }

    private StoreFailureException Refused(Guid storeId, string reason, StoreFailureClass failure)
    {
        _logger.LogWarning("Store {StoreId} cannot be opened: {Reason} ({StoreFailure})", storeId, reason, failure);
        return StoreFailureException.Of(failure);
    }

    /// <summary>Makes <paramref name="pool"/> the store's live pool, retiring the one it replaces and, past the limit, the least recently used.</summary>
    private ExternalDataStore Add(ExternalStorePool pool)
    {
        PoolAddition? addition;
        lock (_gate)
        {
            addition = _disposed ? null : AddLocked(pool);
        }

        if (addition is null)
        {
            pool.Close();
            throw new ObjectDisposedException(nameof(ExternalDataStores));
        }

        _logger.LogInformation("Opened the connection pool of store {StoreId}", pool.StoreId);
        Retired(addition.Replaced, PoolCloseReason.DescriptorReplaced);
        Retired(addition.OverCapacity, PoolCloseReason.Capacity);
        return addition.Store;
    }

    private PoolAddition AddLocked(ExternalStorePool pool)
    {
        var replaced = RetireLocked(pool.StoreId);
        _live[pool.StoreId] = pool;
        var overCapacity = RetireOverCapacityLocked();
        _sweeper ??= _time.CreateTimer(_ => SweepQuietly(), null, SweepInterval, SweepInterval);
        return new PoolAddition(pool.Use(), replaced is null ? [] : [replaced], overCapacity);
    }

    private void Close(Guid storeId, PoolCloseReason reason)
    {
        ExternalStorePool? retired;
        lock (_gate)
        {
            retired = RetireLocked(storeId);
        }

        Retired(retired is null ? [] : [retired], reason);
    }

    private ExternalStorePool? RetireLocked(Guid storeId)
    {
        if (!_live.Remove(storeId, out var pool))
        {
            return null;
        }

        pool.Retire();
        _retired.Add(pool);
        return pool;
    }

    private IReadOnlyList<ExternalStorePool> RetireIdleLocked()
    {
        var idleFor = TimeSpan.FromMinutes(_options.IdleMinutes);
        var idle = _live.Values.Where(pool => pool.IsIdle(idleFor)).Select(pool => pool.StoreId).ToArray();
        return idle.Select(RetireLocked).OfType<ExternalStorePool>().ToArray();
    }

    private IReadOnlyList<ExternalStorePool> RetireOverCapacityLocked()
    {
        var excess = _live.Count - _options.MaxCount;
        var leastRecent = _live.Values.OrderBy(pool => pool.LastUsed).Take(Math.Max(excess, 0)).Select(pool => pool.StoreId).ToArray();
        return leastRecent.Select(RetireLocked).OfType<ExternalStorePool>().ToArray();
    }

    private IReadOnlyList<ExternalStorePool> TakeFinishedLocked()
    {
        var finished = _retired.Where(pool => pool.CanBeDisposed(RetiredGrace, RetiredLimit)).ToArray();
        _retired.RemoveAll(pool => finished.Contains(pool));
        return finished;
    }

    private void StopSweeperWhenEmptyLocked()
    {
        if (_live.Count > 0 || _retired.Count > 0)
        {
            return;
        }

        _sweeper?.Dispose();
        _sweeper = null;
    }

    /// <summary>Closes the idle physical connections of pools just retired (busy ones close when they come back).</summary>
    private void Retired(IReadOnlyList<ExternalStorePool> pools, PoolCloseReason reason)
    {
        foreach (var pool in pools)
        {
            _logger.LogInformation("Closing the connection pool of store {StoreId} ({Reason})", pool.StoreId, reason);
            Quietly(pool, static target => target.DataSource.Clear(), "clear");
        }
    }

    private void DisposeAll(IReadOnlyList<ExternalStorePool> pools)
    {
        foreach (var pool in pools)
        {
            Quietly(pool, static target => target.Close(), "dispose");
        }
    }

    private void Quietly(ExternalStorePool pool, Action<ExternalStorePool> step, string stepName)
    {
        try
        {
            step(pool);
        }
        catch (Exception exception)
        {
            _logger.LogWarning("Could not {Step} the connection pool of store {StoreId} ({ErrorType})", stepName, pool.StoreId, exception.GetType().Name);
        }
    }

    private void SweepQuietly()
    {
        try
        {
            Sweep();
        }
        catch (Exception exception)
        {
            _logger.LogWarning("Sweeping the store connection pools failed ({ErrorType})", exception.GetType().Name);
        }
    }

    /// <summary>A pool just made live: the request's handle, the pool it replaced and the pools retired to stay under the limit.</summary>
    private sealed record PoolAddition(ExternalDataStore Store, IReadOnlyList<ExternalStorePool> Replaced, IReadOnlyList<ExternalStorePool> OverCapacity);
}

/// <summary>Why a store's pool was closed (logged by name).</summary>
internal enum PoolCloseReason
{
    Forgotten,
    DescriptorReplaced,
    StoreUnusable,
    NotServing,
    Idle,
    Capacity,
}
