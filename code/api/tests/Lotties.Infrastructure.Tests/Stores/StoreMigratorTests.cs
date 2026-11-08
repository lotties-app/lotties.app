using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The store migrator's state machine and backoff (docs/design/47-bring-your-own-database.md section 4, task T5) with a fake store
/// session, fake <c>data_stores</c> rows and a clock that moves only when the migrator waits (no real sleep). The real store is
/// covered by the Postgres container tests (Lotties.Postgres.Tests, StoreMigratorPostgresTests).
/// </summary>
public sealed class StoreMigratorTests
{
    private const string Baseline = "20261107000000_DataBaseline";
    private const string Second = "20261201000000_Second";
    private static readonly DateTimeOffset Start = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);

    private readonly ManualClock _clock = new(Start);
    private readonly FakeRows _rows = new();
    private readonly FakeSessions _sessions = new();
    private readonly StoreMigratorOptions _options = new();

    [Fact]
    public async Task EnsureReady_EmptyStore_AppliesTheChainAndRecordsMigratingThenReady()
    {
        var store = _rows.Add();

        await Migrator().EnsureReadyAsync(store.Id);

        var session = _sessions.Last;
        Assert.Equal([DataStoreState.Migrating, DataStoreState.Ready], _rows.Recorded(store.Id));
        Assert.Equal((DataStoreState.Ready, Second), (_rows.Find(store.Id).State, _rows.Find(store.Id).SchemaVersion));
        Assert.Equal(1, session.Migrations);
        Assert.Equal((1, 1), (session.LocksTaken, session.LocksReleased));
        Assert.Equal((store.Id, DataStoreState.Ready, Second), session.MetaWrites[^1]);
        Assert.True(session.Disposed);
    }

    [Fact]
    public async Task EnsureReady_StoreAlreadyUpToDate_AppliesNothingAndRecordsReady()
    {
        var store = _rows.Add();
        _sessions.Applied = [Baseline, Second];

        await Migrator().EnsureReadyAsync(store.Id);

        Assert.Equal(0, _sessions.Last.Migrations);
        Assert.Equal([DataStoreState.Ready], _rows.Recorded(store.Id));
    }

    [Fact]
    public async Task EnsureReady_StoreFoundReadyRecently_DoesNotTouchTheStoreUntilTheRecheck()
    {
        var store = _rows.Add();
        var migrator = Migrator();

        await migrator.EnsureReadyAsync(store.Id);
        await migrator.EnsureReadyAsync(store.Id);
        _clock.Advance(TimeSpan.FromSeconds(_options.ReadyRecheckSeconds));
        _sessions.Applied = [Baseline, Second];
        await migrator.EnsureReadyAsync(store.Id);

        Assert.Equal(2, _sessions.Opened);
        Assert.Equal(1, _sessions.All.Sum(session => session.Migrations));
    }

    [Fact]
    public async Task EnsureReady_LockBusyForAWhile_RetriesWithExponentialBackoffAndMigrates()
    {
        var store = _rows.Add();
        _sessions.LockAnswers = [false, false, false, true];

        await Migrator().EnsureReadyAsync(store.Id);

        Assert.Equal([50d, 100d, 200d], _clock.Delays.Select(delay => delay.TotalMilliseconds));
        Assert.Equal(1, _sessions.Last.Migrations);
    }

    [Fact]
    public async Task EnsureReady_LockHeldLongerThanTheWait_IsStoreMigratingWithoutChangingTheStore()
    {
        var store = _rows.Add();
        _sessions.LockAnswers = [false];
        var migrator = Migrator();

        await Assert.ThrowsAsync<StoreMigratingException>(() => migrator.EnsureReadyAsync(store.Id));

        Assert.Equal(TimeSpan.FromSeconds(_options.LockWaitSeconds), _clock.Elapsed);
        Assert.Equal(TimeSpan.FromMilliseconds(_options.LockRetryMaxMilliseconds), _clock.Delays.Max());
        Assert.Empty(_rows.Recorded(store.Id));
        Assert.Equal((0, 0), (_sessions.Last.Migrations, _sessions.Last.LocksReleased - _sessions.Last.LocksTaken));

        _sessions.LockAnswers = [true];
        await migrator.EnsureReadyAsync(store.Id);
        Assert.Equal(2, _sessions.Opened);
    }

    [Fact]
    public async Task EnsureReady_StoreMigratedByANewerApi_IsSchemaAheadAndNotMigrated()
    {
        var store = _rows.Add();
        _sessions.Applied = [Baseline, Second, "20990101000000_FromTheFuture"];

        await Assert.ThrowsAsync<StoreSchemaAheadException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.SchemaAhead], _rows.Recorded(store.Id));
        Assert.Equal("20990101000000_FromTheFuture", _rows.Find(store.Id).SchemaVersion);
        Assert.Equal(0, _sessions.Last.Migrations);
        Assert.Equal(1, _sessions.Last.LocksReleased);
    }

    [Fact]
    public async Task EnsureReady_AppRoleTooPowerful_IsRefusedBeforeTheLockWithTheFindings()
    {
        var store = _rows.Add();
        _sessions.Audit = StoreRoleAudit.From(false, true, true, false);

        var error = await Assert.ThrowsAsync<StoreRoleTooPowerfulException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([StoreRoleFinding.OwnsObjects, StoreRoleFinding.CreatesInPublic], error.Findings);
        Assert.Equal([DataStoreState.RoleTooPowerful], _rows.Recorded(store.Id));
        Assert.Equal((0, 0), (_sessions.Last.LocksTaken, _sessions.Last.Migrations));
    }

    [Fact]
    public async Task EnsureReady_DatabaseHoldsLottiesControlTables_IsSchemaConflictAndNeverMigrated()
    {
        var store = _rows.Add();
        _sessions.HoldsControlTables = true;

        await Assert.ThrowsAsync<StoreSchemaConflictException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.SchemaConflict], _rows.Recorded(store.Id));
        Assert.Equal((0, 0), (_sessions.Last.LocksTaken, _sessions.Last.Migrations));
    }

    [Fact]
    public async Task EnsureReady_DatabaseSetUpForAnotherStore_IsSchemaConflict()
    {
        var store = _rows.Add();
        _sessions.Applied = [Baseline];
        _sessions.Meta = new StoreMetaSnapshot(Guid.NewGuid(), Guid.NewGuid(), Baseline, nameof(DataStoreState.Ready));

        await Assert.ThrowsAsync<StoreSchemaConflictException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.SchemaConflict], _rows.Recorded(store.Id));
        Assert.Equal(0, _sessions.Last.Migrations);
    }

    [Fact]
    public async Task EnsureReady_MigrationFails_IsMigrationFailedAndTheLockIsReleased()
    {
        var store = _rows.Add();
        _sessions.MigrateFailure = new InvalidOperationException("connection lost");

        await Assert.ThrowsAsync<StoreMigrationFailedException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.Migrating, DataStoreState.MigrationFailed], _rows.Recorded(store.Id));
        Assert.Equal(1, _sessions.Last.LocksReleased);
        Assert.Contains(_sessions.Last.MetaWrites, write => write.State == DataStoreState.MigrationFailed);
    }

    [Fact]
    public async Task EnsureReady_KilledMidway_TheNextRunAfterTheBackoffFinishesTheJob()
    {
        var store = _rows.Add();
        _sessions.MigrateFailure = new IOException("terminated");
        var migrator = Migrator();
        await Assert.ThrowsAsync<StoreMigrationFailedException>(() => migrator.EnsureReadyAsync(store.Id));

        _sessions.MigrateFailure = null;
        _clock.Advance(TimeSpan.FromSeconds(_options.FailureRetryInitialSeconds));
        await migrator.EnsureReadyAsync(store.Id);

        Assert.Equal([DataStoreState.Migrating, DataStoreState.MigrationFailed, DataStoreState.Migrating, DataStoreState.Ready], _rows.Recorded(store.Id));
        Assert.Equal(DataStoreState.Ready, _rows.Find(store.Id).State);
    }

    [Fact]
    public async Task EnsureReady_StoreCannotBeOpenedInTime_IsUnreachableAndStoreTimeout()
    {
        var store = _rows.Add();
        _sessions.OpenFailure = new TimeoutException();

        await Assert.ThrowsAsync<StoreTimeoutException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.Unreachable], _rows.Recorded(store.Id));
    }

    [Fact]
    public async Task EnsureReady_StoreRefusesTheCredentials_IsUnreachableAndCredentialsRejected()
    {
        var store = _rows.Add();
        _sessions.OpenFailure = new Npgsql.PostgresException("password authentication failed for user \"someone\"", "FATAL", "FATAL", "28P01");

        var error = await Assert.ThrowsAsync<StoreCredentialsRejectedException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.Unreachable], _rows.Recorded(store.Id));
        Assert.DoesNotContain("someone", error.Message, StringComparison.Ordinal);
        Assert.Null(error.InnerException);
    }

    [Fact]
    public async Task EnsureReady_EndpointTlsRefused_IsUnreachableAndTlsFailed()
    {
        var store = _rows.Add();
        _sessions.OpenFailure = new StoreEndpointRejectedException(StoreEndpointFailure.TlsFailed);

        await Assert.ThrowsAsync<StoreTlsFailedException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.Unreachable], _rows.Recorded(store.Id));
    }

    [Fact]
    public async Task EnsureReady_TooManyConnections_IsRateLimited()
    {
        var store = _rows.Add();
        _sessions.AuditFailure = new Npgsql.PostgresException("too many connections for role", "FATAL", "FATAL", "53300");

        await Assert.ThrowsAsync<StoreRateLimitedException>(() => Migrator().EnsureReadyAsync(store.Id));
    }

    [Fact]
    public async Task EnsureReady_ConnectionLostWhileChecking_IsUnreachable()
    {
        var store = _rows.Add();
        _sessions.AuditFailure = new IOException("reset");

        await Assert.ThrowsAsync<StoreUnavailableException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal([DataStoreState.Unreachable], _rows.Recorded(store.Id));
    }

    [Fact]
    public async Task EnsureReady_AfterAFailure_BacksOffExponentiallyWithoutTouchingTheStore()
    {
        var store = _rows.Add();
        _sessions.OpenFailure = new TimeoutException();
        var migrator = Migrator();

        await Assert.ThrowsAsync<StoreTimeoutException>(() => migrator.EnsureReadyAsync(store.Id));
        _clock.Advance(TimeSpan.FromSeconds(_options.FailureRetryInitialSeconds) - TimeSpan.FromTicks(1));
        var replayed = await Assert.ThrowsAsync<StoreTimeoutException>(() => migrator.EnsureReadyAsync(store.Id));
        Assert.Equal(1, _sessions.Opened);
        Assert.Equal(TimeSpan.FromTicks(1), replayed.RetryAfter);

        _clock.Advance(TimeSpan.FromTicks(1));
        await Assert.ThrowsAsync<StoreTimeoutException>(() => migrator.EnsureReadyAsync(store.Id));
        Assert.Equal(2, _sessions.Opened);

        _clock.Advance(TimeSpan.FromSeconds(_options.FailureRetryInitialSeconds));
        await Assert.ThrowsAsync<StoreTimeoutException>(() => migrator.EnsureReadyAsync(store.Id));
        Assert.Equal(2, _sessions.Opened);
        _clock.Advance(TimeSpan.FromSeconds(_options.FailureRetryInitialSeconds));
        _sessions.OpenFailure = null;
        await migrator.EnsureReadyAsync(store.Id);
        Assert.Equal(3, _sessions.Opened);
    }

    [Fact]
    public async Task EnsureReady_DuringTheBackoff_ReplaysTheSameErrorWithItsFindings()
    {
        var store = _rows.Add();
        _sessions.Audit = StoreRoleAudit.From(true, false, false, false);
        var migrator = Migrator();
        var first = await Assert.ThrowsAsync<StoreRoleTooPowerfulException>(() => migrator.EnsureReadyAsync(store.Id));

        var second = await Assert.ThrowsAsync<StoreRoleTooPowerfulException>(() => migrator.EnsureReadyAsync(store.Id));

        Assert.NotSame(first, second);
        Assert.Equal(first.Findings, second.Findings);
        Assert.Equal(1, _sessions.Opened);
    }

    [Fact]
    public async Task Forget_DuringTheBackoff_LetsTheNextRunTryTheStore()
    {
        var store = _rows.Add();
        _sessions.OpenFailure = new TimeoutException();
        var migrator = Migrator();
        await Assert.ThrowsAsync<StoreTimeoutException>(() => migrator.EnsureReadyAsync(store.Id));
        _sessions.OpenFailure = null;

        migrator.Forget(store.Id);
        await migrator.EnsureReadyAsync(store.Id);

        Assert.Equal(2, _sessions.Opened);
    }

    [Fact]
    public async Task EnsureReady_DisabledStore_IsUnavailableAndNeverOpened()
    {
        var store = _rows.Add(DataStoreState.Disabled);

        await Assert.ThrowsAsync<StoreUnavailableException>(() => Migrator().EnsureReadyAsync(store.Id));

        Assert.Equal(0, _sessions.Opened);
        Assert.Empty(_rows.Recorded(store.Id));
    }

    [Fact]
    public async Task EnsureReady_UnknownStore_IsUnavailable()
    {
        await Assert.ThrowsAsync<StoreUnavailableException>(() => Migrator().EnsureReadyAsync(Guid.NewGuid()));

        Assert.Equal(0, _sessions.Opened);
    }

    [Fact]
    public async Task EnsureReady_ConcurrentRequestsInOneProcess_OpenTheStoreOnce()
    {
        var store = _rows.Add();
        var release = new TaskCompletionSource();
        _sessions.MigrateGate = release.Task;
        var migrator = Migrator();

        var first = migrator.EnsureReadyAsync(store.Id);
        var second = migrator.EnsureReadyAsync(store.Id);
        release.SetResult();
        await Task.WhenAll(first, second);

        Assert.Equal(1, _sessions.Opened);
        Assert.Equal(1, _sessions.Last.Migrations);
    }

    [Fact]
    public async Task EnsureReady_ControlRowCannotBeWritten_TheStoreOutcomeStillHolds()
    {
        var store = _rows.Add();
        _rows.FailWrites = true;

        await Migrator().EnsureReadyAsync(store.Id);

        Assert.Equal(1, _sessions.Last.Migrations);
        Assert.Equal((store.Id, DataStoreState.Ready, Second), _sessions.Last.MetaWrites[^1]);
    }

    [Fact]
    public async Task DisabledStoreMigrator_RefusesEveryStore()
    {
        await Assert.ThrowsAsync<StoreUnavailableException>(() => new DisabledStoreMigrator().EnsureReadyAsync(Guid.NewGuid()));
    }

    [Fact]
    public void OptionsValidator_DefaultsAreValidAndOutOfRangeValuesFail()
    {
        var validator = new StoreMigratorOptionsValidator();

        Assert.True(validator.Validate(null, new StoreMigratorOptions()).Succeeded);
        Assert.True(validator.Validate(null, new StoreMigratorOptions { LockWaitSeconds = 0 }).Failed);
        Assert.True(validator.Validate(null, new StoreMigratorOptions { LockRetryInitialMilliseconds = 500, LockRetryMaxMilliseconds = 100 }).Failed);
        Assert.True(validator.Validate(null, new StoreMigratorOptions { FailureRetryMaxSeconds = 1 }).Failed);
        Assert.True(validator.Validate(null, new StoreMigratorOptions { ReadyRecheckSeconds = 5 }).Failed);
    }

    [Fact]
    public async Task Forget_StoreFoundReady_TheNextUseChecksTheStoreAgain()
    {
        var store = _rows.Add();
        var migrator = Migrator();
        await migrator.EnsureReadyAsync(store.Id);

        migrator.Forget(store.Id);
        await migrator.EnsureReadyAsync(store.Id);

        Assert.Equal(2, _sessions.Opened);
    }

    [Fact]
    public async Task Forget_StoreBackingOffAfterAFailure_TheNextUseTriesAtOnce()
    {
        var store = _rows.Add();
        var migrator = Migrator();
        _sessions.OpenFailure = new InvalidOperationException("down");
        await Assert.ThrowsAsync<StoreUnavailableException>(() => migrator.EnsureReadyAsync(store.Id));
        _sessions.OpenFailure = null;

        migrator.Forget(store.Id);
        await migrator.EnsureReadyAsync(store.Id);

        Assert.Equal(DataStoreState.Ready, _rows.Find(store.Id).State);
    }

    private StoreMigrator Migrator() =>
        new(_rows, _sessions, Options.Create(_options), _clock, NullLogger<StoreMigrator>.Instance, () => 0d);

    /// <summary>A clock that moves only when told to or when the migrator waits (each wait completes at once and is recorded).</summary>
    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private long _ticks;

        public List<TimeSpan> Delays { get; } = [];

        public TimeSpan Elapsed => TimeSpan.FromTicks(Interlocked.Read(ref _ticks));

        public override long TimestampFrequency => TimeSpan.TicksPerSecond;

        public override long GetTimestamp() => Interlocked.Read(ref _ticks);

        public override DateTimeOffset GetUtcNow() => start + Elapsed;

        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            if (dueTime != Timeout.InfiniteTimeSpan)
            {
                Delays.Add(dueTime);
                Advance(dueTime);
                callback(state);
            }

            return new NoTimer();
        }

        private sealed class NoTimer : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => false;

            public void Dispose()
            {
            }

            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private sealed class FakeRows : IDataStoreRows
    {
        private readonly Dictionary<Guid, DataStore> _stores = [];
        private readonly Dictionary<Guid, List<DataStoreState>> _recorded = [];

        public bool FailWrites { get; set; }

        public DataStore Add(DataStoreState? state = null)
        {
            var store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), Start);
            if (state is { } wanted)
            {
                typeof(DataStore).GetProperty(nameof(DataStore.State))!.SetValue(store, wanted);
            }

            _stores[store.Id] = store;
            _recorded[store.Id] = [];
            return store;
        }

        public DataStore Find(Guid storeId) => _stores[storeId];

        public IReadOnlyList<DataStoreState> Recorded(Guid storeId) => _recorded[storeId];

        public Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_stores.GetValueOrDefault(storeId));

        public Task RecordAsync(Guid storeId, DataStoreState state, string? schemaVersion, CancellationToken cancellationToken = default)
        {
            if (FailWrites)
            {
                throw new InvalidOperationException("control database down");
            }

            _stores[storeId].RecordMigrationState(state, schemaVersion, Start);
            _recorded[storeId].Add(state);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeSessions : IStoreMigrationSessionFactory
    {
        public List<FakeSession> All { get; } = [];

        public FakeSession Last => All[^1];

        public int Opened => All.Count;

        public Exception? OpenFailure { get; set; }

        public Exception? AuditFailure { get; set; }

        public Exception? MigrateFailure { get; set; }

        public Task? MigrateGate { get; set; }

        public StoreRoleAudit Audit { get; set; } = StoreRoleAudit.LeastPrivilege;

        public bool HoldsControlTables { get; set; }

        public bool[] LockAnswers { get; set; } = [true];

        public string[] Applied { get; set; } = [];

        public StoreMetaSnapshot? Meta { get; set; }

        public Task<IStoreMigrationSession> OpenAsync(DataStore store, CancellationToken cancellationToken = default)
        {
            if (OpenFailure is { } failure)
            {
                All.Add(new FakeSession(this));
                return Task.FromException<IStoreMigrationSession>(failure);
            }

            var session = new FakeSession(this);
            All.Add(session);
            return Task.FromResult<IStoreMigrationSession>(session);
        }
    }

    private sealed class FakeSession(FakeSessions settings) : IStoreMigrationSession
    {
        private int _lockCalls;

        public IReadOnlyList<string> KnownMigrations { get; } = [Baseline, Second];

        public int LocksTaken { get; private set; }

        public int LocksReleased { get; private set; }

        public int Migrations { get; private set; }

        public bool Disposed { get; private set; }

        public List<(Guid StoreId, DataStoreState State, string Version)> MetaWrites { get; } = [];

        public Task<StoreRoleAudit> AuditAppRoleAsync(CancellationToken cancellationToken = default) =>
            settings.AuditFailure is { } failure ? Task.FromException<StoreRoleAudit>(failure) : Task.FromResult(settings.Audit);

        public Task<bool> HoldsControlTablesAsync(CancellationToken cancellationToken = default) => Task.FromResult(settings.HoldsControlTables);

        public Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default)
        {
            var answers = settings.LockAnswers;
            var free = answers[Math.Min(_lockCalls++, answers.Length - 1)];
            LocksTaken += free ? 1 : 0;
            return Task.FromResult(free);
        }

        public Task ReleaseLockAsync(CancellationToken cancellationToken = default)
        {
            LocksReleased++;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<string>> GetAppliedMigrationsAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<string>>(settings.Applied);

        public Task<StoreMetaSnapshot?> ReadMetaAsync(CancellationToken cancellationToken = default) => Task.FromResult(settings.Meta);

        public Task<Guid?> ReadAppStoreIdAsync(CancellationToken cancellationToken = default) => Task.FromResult(settings.Meta?.StoreId);

        public async Task MigrateAsync(CancellationToken cancellationToken = default)
        {
            if (settings.MigrateGate is { } gate)
            {
                await gate;
            }

            if (settings.MigrateFailure is { } failure)
            {
                throw failure;
            }

            Migrations++;
            settings.Applied = [.. KnownMigrations];
        }

        public Task WriteMetaAsync(Guid storeId, DataStoreState state, string schemaVersion, CancellationToken cancellationToken = default)
        {
            MetaWrites.Add((storeId, state, schemaVersion));
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }
    }
}
