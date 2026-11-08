using System.Collections.Concurrent;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// The store migrator (docs/design/47-bring-your-own-database.md section 4, task T5), one per process. For a store it has not seen
/// ready lately it: reads the <c>data_stores</c> row (a <see cref="DataStoreState.Disabled"/> store is never touched), opens the
/// store's migrator and app endpoints, refuses an app role that can do more than DML (<see cref="DataStoreState.RoleTooPowerful"/>)
/// and a database that holds a Lotties control database or another store's schema (<see cref="DataStoreState.SchemaConflict"/>),
/// takes the store's advisory lock (retrying with exponential backoff, then <c>store_migrating</c>), refuses a store migrated by a
/// newer API (<see cref="DataStoreState.SchemaAhead"/>), applies the pending data migrations (<see cref="DataStoreState.Migrating"/>,
/// then <see cref="DataStoreState.Ready"/> or <see cref="DataStoreState.MigrationFailed"/>) and records the state in
/// <c>lotties.store_meta</c> and in <c>data_stores</c>. A store found ready is trusted for
/// <see cref="StoreMigratorOptions.ReadyRecheckSeconds"/>; after a failure the store is left alone for a backoff that doubles per
/// failure, and requests in between get the same error at once (with the time left as <c>Retry-After</c>). A second run on a ready
/// store applies nothing. A connection failure is classified (task T8, <see cref="StoreFailureClassifier"/>: timeout, refused
/// credentials, paused or unreachable, too many connections, TLS) and recorded as <see cref="DataStoreState.Unreachable"/>.
/// Logs carry the store id, the state and the error's type only: never a host, a user or the database's own text.
/// </summary>
internal sealed class StoreMigrator : IStoreMigrator, IStoreMemory
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _runs = new();
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _readyUntil = new();
    private readonly ConcurrentDictionary<Guid, StoreFailure> _failures = new();
    private readonly IDataStoreRows _rows;
    private readonly IStoreMigrationSessionFactory _sessions;
    private readonly StoreMigratorOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<StoreMigrator> _logger;
    private readonly Func<double> _random;

    public StoreMigrator(
        IDataStoreRows rows,
        IStoreMigrationSessionFactory sessions,
        IOptions<StoreMigratorOptions> options,
        TimeProvider time,
        ILogger<StoreMigrator> logger)
        : this(rows, sessions, options, time, logger, Random.Shared.NextDouble)
    {
    }

    /// <summary>Test seam: <paramref name="random"/> draws the jitter (a value in [0, 1)).</summary>
    internal StoreMigrator(
        IDataStoreRows rows,
        IStoreMigrationSessionFactory sessions,
        IOptions<StoreMigratorOptions> options,
        TimeProvider time,
        ILogger<StoreMigrator> logger,
        Func<double> random)
    {
        _rows = rows ?? throw new ArgumentNullException(nameof(rows));
        _sessions = sessions ?? throw new ArgumentNullException(nameof(sessions));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));
        _time = time ?? throw new ArgumentNullException(nameof(time));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _random = random ?? throw new ArgumentNullException(nameof(random));
    }

    private TimeSpan LockWait => TimeSpan.FromSeconds(_options.LockWaitSeconds);

    public async Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default)
    {
        if (IsKnownReady(storeId))
        {
            return;
        }

        ThrowIfBackingOff(storeId);
        var run = _runs.GetOrAdd(storeId, _ => new SemaphoreSlim(1, 1));
        if (!await run.WaitAsync(LockWait, cancellationToken))
        {
            throw new StoreMigratingException();
        }

        try
        {
            await RunOnceAsync(storeId, cancellationToken);
        }
        finally
        {
            run.Release();
        }
    }

    private async Task RunOnceAsync(Guid storeId, CancellationToken cancellationToken)
    {
        if (IsKnownReady(storeId))
        {
            return;
        }

        ThrowIfBackingOff(storeId);
        try
        {
            await MigrateStoreAsync(storeId, cancellationToken);
        }
        catch (DomainException failure) when (failure is not StoreMigratingException)
        {
            RememberFailure(storeId, failure);
            throw;
        }

        _failures.TryRemove(storeId, out _);
        _readyUntil[storeId] = _time.GetUtcNow() + TimeSpan.FromSeconds(_options.ReadyRecheckSeconds);
    }

    private async Task MigrateStoreAsync(Guid storeId, CancellationToken cancellationToken)
    {
        var store = await _rows.FindAsync(storeId, cancellationToken) ?? throw new StoreUnavailableException();
        EnsureNotDisabled(store);
        await using var session = await OpenSessionAsync(store, cancellationToken);
        await TalkToStoreAsync(store, () => CheckStoreAsync(session, store, cancellationToken));
        await TalkToStoreAsync(store, () => AcquireLockAsync(session, cancellationToken));
        try
        {
            await MigrateUnderLockAsync(session, store, cancellationToken);
        }
        finally
        {
            await ReleaseLockQuietlyAsync(session, store);
        }
    }

    private static void EnsureNotDisabled(DataStore store)
    {
        if (store.State == DataStoreState.Disabled)
        {
            throw new StoreUnavailableException();
        }
    }

    private async Task<IStoreMigrationSession> OpenSessionAsync(DataStore store, CancellationToken cancellationToken)
    {
        try
        {
            return await _sessions.OpenAsync(store, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw await UnreachableAsync(store, exception);
        }
    }

    /// <summary>A step that only reads the store: a lost connection or a refused endpoint makes the store unreachable.</summary>
    private async Task TalkToStoreAsync(DataStore store, Func<Task> step)
    {
        try
        {
            await step();
        }
        catch (Exception exception) when (exception is not (DomainException or OperationCanceledException))
        {
            throw await UnreachableAsync(store, exception);
        }
    }

    private async Task CheckStoreAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken)
    {
        var audit = await session.AuditAppRoleAsync(cancellationToken);
        if (audit.IsTooPowerful)
        {
            await RecordAsync(store, DataStoreState.RoleTooPowerful, null);
            throw new StoreRoleTooPowerfulException(audit.Findings);
        }

        if (await session.HoldsControlTablesAsync(cancellationToken))
        {
            await RecordAsync(store, DataStoreState.SchemaConflict, null);
            throw new StoreSchemaConflictException();
        }
    }

    private async Task AcquireLockAsync(IStoreMigrationSession session, CancellationToken cancellationToken)
    {
        var started = _time.GetTimestamp();
        for (var attempt = 1; !await session.TryAcquireLockAsync(cancellationToken); attempt++)
        {
            await WaitBeforeLockRetryAsync(started, attempt, cancellationToken);
        }
    }

    private Task WaitBeforeLockRetryAsync(long started, int attempt, CancellationToken cancellationToken)
    {
        var remaining = LockWait - _time.GetElapsedTime(started);
        if (remaining <= TimeSpan.Zero)
        {
            throw new StoreMigratingException();
        }

        var delay = _options.LockBackoff.DelayFor(attempt, _random());
        return Task.Delay(delay < remaining ? delay : remaining, _time, cancellationToken);
    }

    private async Task MigrateUnderLockAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken)
    {
        var status = await TalkToStoreAsync(store, async () =>
            StoreSchemaStatus.Compare(await session.GetAppliedMigrationsAsync(cancellationToken), session.KnownMigrations));
        await EnsureNotAheadAsync(session, store, status, cancellationToken);
        await EnsureSameStoreAsync(session, store, cancellationToken);
        await ApplyPendingAsync(session, store, status, cancellationToken);
        await RecordReadyAsync(session, store, cancellationToken);
    }

    private async Task<T> TalkToStoreAsync<T>(DataStore store, Func<Task<T>> step)
    {
        try
        {
            return await step();
        }
        catch (Exception exception) when (exception is not (DomainException or OperationCanceledException))
        {
            throw await UnreachableAsync(store, exception);
        }
    }

    private async Task EnsureNotAheadAsync(IStoreMigrationSession session, DataStore store, StoreSchemaStatus status, CancellationToken cancellationToken)
    {
        if (status.Position != StoreSchemaPosition.Ahead)
        {
            return;
        }

        _logger.LogWarning("Store {StoreId} holds {Count} data migrations this API does not know; refused", store.Id, status.Unknown.Count);
        await RecordAsync(store, DataStoreState.SchemaAhead, status.LatestApplied);
        throw new StoreSchemaAheadException();
    }

    private async Task EnsureSameStoreAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken)
    {
        var meta = await TalkToStoreAsync(store, () => session.ReadMetaAsync(cancellationToken));
        if (meta is null || meta.StoreId == store.Id)
        {
            return;
        }

        _logger.LogWarning("Store {StoreId} points at a database set up for another store; refused", store.Id);
        await RecordAsync(store, DataStoreState.SchemaConflict, null);
        throw new StoreSchemaConflictException();
    }

    private async Task ApplyPendingAsync(IStoreMigrationSession session, DataStore store, StoreSchemaStatus status, CancellationToken cancellationToken)
    {
        if (status.Position != StoreSchemaPosition.Behind)
        {
            return;
        }

        _logger.LogInformation("Applying {Count} data migrations to store {StoreId}: {Migrations}", status.Pending.Count, store.Id, string.Join(", ", status.Pending));
        await RecordAsync(store, DataStoreState.Migrating, null);
        await WriteMetaQuietlyAsync(session, store, DataStoreState.Migrating, status.LatestApplied);
        var started = _time.GetTimestamp();
        try
        {
            await session.MigrateAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw await MigrationFailedAsync(session, store, status, exception);
        }

        _logger.LogInformation("Applied {Count} data migrations to store {StoreId} in {ElapsedMilliseconds} ms", status.Pending.Count, store.Id, (long)_time.GetElapsedTime(started).TotalMilliseconds);
    }

    private async Task<DomainException> MigrationFailedAsync(IStoreMigrationSession session, DataStore store, StoreSchemaStatus status, Exception exception)
    {
        _logger.LogWarning("Data migration of store {StoreId} failed ({ErrorType}); the failed step rolled back", store.Id, exception.GetType().Name);
        await WriteMetaQuietlyAsync(session, store, DataStoreState.MigrationFailed, status.LatestApplied);
        await RecordAsync(store, DataStoreState.MigrationFailed, null);
        return new StoreMigrationFailedException();
    }

    private async Task RecordReadyAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken)
    {
        var version = session.KnownMigrations[^1];
        await TalkToStoreAsync(store, async () =>
        {
            await session.WriteMetaAsync(store.Id, DataStoreState.Ready, version, cancellationToken);
            return true;
        });
        await RecordAsync(store, DataStoreState.Ready, version);
    }

    private async Task<DomainException> UnreachableAsync(DataStore store, Exception exception)
    {
        var failure = StoreFailureClassifier.Classify(exception) ?? StoreFailureClass.Unavailable;
        _logger.LogWarning("Store {StoreId} could not be reached by the migrator: {StoreFailure} ({ErrorType})", store.Id, failure, exception.GetType().Name);
        await RecordAsync(store, DataStoreState.Unreachable, null);
        return StoreFailureException.Of(failure);
    }

    /// <summary>Mirrors a state into <c>data_stores</c>; a failure there is logged and never hides the store's own outcome.</summary>
    private async Task RecordAsync(DataStore store, DataStoreState state, string? schemaVersion)
    {
        try
        {
            await _rows.RecordAsync(store.Id, state, schemaVersion, CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogWarning("Could not record state {State} of store {StoreId} ({ErrorType})", state, store.Id, exception.GetType().Name);
        }
    }

    private async Task WriteMetaQuietlyAsync(IStoreMigrationSession session, DataStore store, DataStoreState state, string? schemaVersion)
    {
        try
        {
            await session.WriteMetaAsync(store.Id, state, schemaVersion ?? string.Empty, CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogWarning("Could not write state {State} into store {StoreId} ({ErrorType})", state, store.Id, exception.GetType().Name);
        }
    }

    private async Task ReleaseLockQuietlyAsync(IStoreMigrationSession session, DataStore store)
    {
        try
        {
            await session.ReleaseLockAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogWarning("Could not release the migration lock of store {StoreId} ({ErrorType}); closing the session releases it", store.Id, exception.GetType().Name);
        }
    }

    private bool IsKnownReady(Guid storeId) =>
        _readyUntil.TryGetValue(storeId, out var until) && _time.GetUtcNow() < until;

    private void ThrowIfBackingOff(Guid storeId)
    {
        var now = _time.GetUtcNow();
        if (_failures.TryGetValue(storeId, out var failure) && now < failure.RetryAt)
        {
            throw failure.Replay(failure.RetryAt - now);
        }
    }

    /// <summary>Forgets the store's ready flag and failure backoff (its descriptor was replaced or removed).</summary>
    public void Forget(Guid storeId)
    {
        _readyUntil.TryRemove(storeId, out _);
        _failures.TryRemove(storeId, out _);
    }

    private void RememberFailure(Guid storeId, DomainException error)
    {
        _readyUntil.TryRemove(storeId, out _);
        var attempts = _failures.TryGetValue(storeId, out var previous) ? previous.Attempts + 1 : 1;
        var retryAt = _time.GetUtcNow() + _options.FailureBackoff.DelayFor(attempts, _random());
        _failures[storeId] = new StoreFailure(attempts, retryAt, error);
    }

    /// <summary>The last failure of a store and when this process may try it again.</summary>
    private sealed record StoreFailure(int Attempts, DateTimeOffset RetryAt, DomainException Error)
    {
        /// <summary>
        /// A new exception like <see cref="Error"/> (one exception object is never thrown by two requests), telling when the store
        /// is tried again.
        /// </summary>
        public DomainException Replay(TimeSpan retryAfter) => Error switch
        {
            StoreRoleTooPowerfulException tooPowerful => new StoreRoleTooPowerfulException(tooPowerful.Findings, retryAfter),
            StoreFailureException failure => StoreFailureException.Of(failure.Failure, retryAfter),
            _ => new StoreUnavailableException(retryAfter),
        };
    }
}

/// <summary>The migrator while <c>Stores:Enabled</c> is off: no external store is ever migrated or opened.</summary>
internal sealed class DisabledStoreMigrator : IStoreMigrator
{
    public Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        Task.FromException(new StoreUnavailableException());
}
