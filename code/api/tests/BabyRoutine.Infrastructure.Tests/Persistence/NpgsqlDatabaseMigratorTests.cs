using BabyRoutine.Infrastructure.Persistence.AutoMigration;
using Microsoft.Extensions.Logging.Abstractions;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

public sealed class NpgsqlDatabaseMigratorTests
{
    private static readonly DatabaseMigrationSettings FastLock = new(true, TimeSpan.FromMilliseconds(200), TimeSpan.FromMilliseconds(5));

    [Fact]
    public async Task MigrateAsync_PendingMigrations_LocksReadsMigratesReleasesThenCloses()
    {
        var session = new FakeMigrationSession { Pending = ["20260101000000_InitialCreate"] };

        await Migrator(session).MigrateAsync();

        Assert.Equal(new[] { "open", "try-lock:True", "pending", "migrate", "release", "dispose" }, session.Calls);
    }

    [Fact]
    public async Task MigrateAsync_NothingPending_DoesNotMigrateAndReleases()
    {
        var session = new FakeMigrationSession();

        await Migrator(session).MigrateAsync();

        Assert.Equal(new[] { "open", "try-lock:True", "pending", "release", "dispose" }, session.Calls);
    }

    [Fact]
    public async Task MigrateAsync_LockBusyThenFree_RetriesBeforeMigrating()
    {
        var session = new FakeMigrationSession { BusyAttempts = 2, Pending = ["20260101000000_InitialCreate"] };

        await Migrator(session).MigrateAsync();

        Assert.Equal(new[] { "open", "try-lock:False", "try-lock:False", "try-lock:True", "pending", "migrate", "release", "dispose" }, session.Calls);
    }

    [Fact]
    public async Task MigrateAsync_LockNeverFree_TimesOutWithoutMigrating()
    {
        var session = new FakeMigrationSession { BusyAttempts = int.MaxValue, Pending = ["20260101000000_InitialCreate"] };

        await Assert.ThrowsAsync<TimeoutException>(() => Migrator(session).MigrateAsync());

        Assert.DoesNotContain("pending", session.Calls);
        Assert.DoesNotContain("migrate", session.Calls);
        Assert.DoesNotContain("release", session.Calls);
        Assert.Equal("dispose", session.Calls[^1]);
    }

    [Fact]
    public async Task MigrateAsync_MigrationFails_ReleasesLockAndRethrows()
    {
        var session = new FakeMigrationSession { Pending = ["20260101000000_InitialCreate"], MigrateFailure = new InvalidOperationException("ddl failed") };

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => Migrator(session).MigrateAsync());

        Assert.Equal("ddl failed", exception.Message);
        Assert.Equal(new[] { "open", "try-lock:True", "pending", "migrate", "release", "dispose" }, session.Calls);
    }

    [Fact]
    public async Task MigrateAsync_ReleaseFails_KeepsMigrationFailure()
    {
        var session = new FakeMigrationSession
        {
            Pending = ["20260101000000_InitialCreate"],
            MigrateFailure = new InvalidOperationException("ddl failed"),
            ReleaseFailure = new IOException("connection lost"),
        };

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => Migrator(session).MigrateAsync());

        Assert.Equal("ddl failed", exception.Message);
        Assert.Equal("dispose", session.Calls[^1]);
    }

    [Fact]
    public async Task MigrateAsync_ReleaseFailsAfterSuccess_Completes()
    {
        var session = new FakeMigrationSession { ReleaseFailure = new IOException("connection lost") };

        await Migrator(session).MigrateAsync();

        Assert.Equal("dispose", session.Calls[^1]);
    }

    [Fact]
    public async Task MigrateAsync_Cancelled_StopsWaitingForTheLock()
    {
        var session = new FakeMigrationSession { BusyAttempts = int.MaxValue };
        var migrator = new NpgsqlDatabaseMigrator(new FakeSessionFactory(session), FastLock with { LockTimeout = TimeSpan.FromMinutes(5) }, TimeProvider.System, NullLogger<NpgsqlDatabaseMigrator>.Instance);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => migrator.MigrateAsync(cancellation.Token));

        Assert.DoesNotContain("migrate", session.Calls);
    }

    private static NpgsqlDatabaseMigrator Migrator(FakeMigrationSession session) =>
        new(new FakeSessionFactory(session), FastLock, TimeProvider.System, NullLogger<NpgsqlDatabaseMigrator>.Instance);

    private sealed class FakeSessionFactory(FakeMigrationSession session) : IMigrationSessionFactory
    {
        public string Target => "'babyroutine' on localhost:5432";

        public Task<IMigrationSession> OpenAsync(CancellationToken cancellationToken = default)
        {
            session.Calls.Add("open");
            return Task.FromResult<IMigrationSession>(session);
        }
    }

    private sealed class FakeMigrationSession : IMigrationSession
    {
        public List<string> Calls { get; } = [];

        public int BusyAttempts { get; init; }

        public IReadOnlyList<string> Pending { get; init; } = [];

        public Exception? MigrateFailure { get; init; }

        public Exception? ReleaseFailure { get; init; }

        private int _attempts;

        public Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default)
        {
            var acquired = _attempts++ >= BusyAttempts;
            Calls.Add($"try-lock:{acquired}");
            return Task.FromResult(acquired);
        }

        public Task ReleaseLockAsync(CancellationToken cancellationToken = default)
        {
            Calls.Add("release");
            return ReleaseFailure is null ? Task.CompletedTask : Task.FromException(ReleaseFailure);
        }

        public Task<IReadOnlyList<string>> GetPendingMigrationsAsync(CancellationToken cancellationToken = default)
        {
            Calls.Add("pending");
            return Task.FromResult(Pending);
        }

        public Task MigrateAsync(CancellationToken cancellationToken = default)
        {
            Calls.Add("migrate");
            return MigrateFailure is null ? Task.CompletedTask : Task.FromException(MigrateFailure);
        }

        public ValueTask DisposeAsync()
        {
            Calls.Add("dispose");
            return ValueTask.CompletedTask;
        }
    }
}
