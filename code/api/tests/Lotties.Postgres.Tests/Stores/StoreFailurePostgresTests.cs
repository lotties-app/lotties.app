using System.Diagnostics;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Failures;
using Lotties.Postgres.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Postgres.Tests.Stores;

/// <summary>
/// Failure behaviour of an external store on a real Postgres (design 47 section 5, task T8): the data context of a store carries the
/// production <see cref="StoreFailureInterceptor"/> and circuit breakers, the migrator is the production one. A paused database times
/// out, opens the breaker (then answered without touching the network) and recovers; a stopped one is paused or unreachable and
/// recovers when started; a killed backend, too many connections, refused credentials, command and statement timeouts and a read-only
/// (over quota) database each get their class; a failed save leaves nothing. A real "disk full" (<c>53100</c>) is not simulated here
/// (it needs a size-limited volume under the data directory); the classification test covers its SQLSTATE, and the provider's over-quota
/// read-only mode is simulated instead.
/// </summary>
[Collection(StoppablePostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class StoreFailurePostgresTests(StoppablePostgresFixture postgres)
{
    private const int ConnectTimeoutSeconds = 2;

    private static readonly DateTimeOffset Start = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);

    private readonly StoreMigratorHarness _harness = new();
    private readonly FakeClock _clock = new(Start);
    private readonly StoreCircuitBreakerOptions _breakerOptions = new() { FailureThreshold = 2, OpenSeconds = 30 };

    [PostgresFact]
    public async Task Paused_database_times_out_opens_the_breaker_and_recovers_when_resumed()
    {
        var (store, storeId) = await ReadyStoreAsync("paused");
        var breakers = Breakers();
        await using var data = Unpooled(store.AppConnectionString);
        Assert.Equal(0, await CountEventsAsync(data, breakers, storeId));

        await postgres.PauseAsync();
        try
        {
            await Assert.ThrowsAsync<StoreTimeoutException>(() => CountEventsAsync(data, breakers, storeId));
            await Assert.ThrowsAsync<StoreTimeoutException>(() => CountEventsAsync(data, breakers, storeId));
            Assert.Equal(StoreCircuitPhase.Open, breakers.PhaseOf(storeId));
            var clock = Stopwatch.StartNew();
            var rejected = await Assert.ThrowsAsync<StoreTimeoutException>(() => CountEventsAsync(data, breakers, storeId));
            Assert.True(clock.Elapsed < TimeSpan.FromSeconds(ConnectTimeoutSeconds) / 2, $"an open breaker answered after {clock.Elapsed}");
            Assert.Equal(TimeSpan.FromSeconds(30), rejected.RetryAfter);
            await Assert.ThrowsAsync<StoreTimeoutException>(() => _harness.Migrator().EnsureReadyAsync(storeId));
            Assert.Equal(DataStoreState.Unreachable, _harness.Rows.Find(storeId).State);
        }
        finally
        {
            await postgres.UnpauseAsync();
        }

        _clock.Advance(TimeSpan.FromSeconds(_breakerOptions.OpenSeconds));
        breakers.Admit(storeId);
        Assert.Equal(0, await CountEventsAsync(data, breakers, storeId));
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(storeId));
        await _harness.Migrator().EnsureReadyAsync(storeId);
        Assert.Equal(DataStoreState.Ready, _harness.Rows.Find(storeId).State);
    }

    [PostgresFact]
    public async Task Stopped_database_is_paused_or_unreachable_and_recovers_when_started()
    {
        var (store, storeId) = await ReadyStoreAsync("stopped");
        var breakers = Breakers();
        await using var data = Unpooled(store.AppConnectionString);

        await postgres.StopAsync();
        try
        {
            await Assert.ThrowsAsync<StorePausedOrUnreachableException>(() => CountEventsAsync(data, breakers, storeId));
            await Assert.ThrowsAsync<StorePausedOrUnreachableException>(() => _harness.Migrator().EnsureReadyAsync(storeId));
        }
        finally
        {
            await postgres.StartAsync();
        }

        Assert.Equal(0, await CountEventsAsync(data, breakers, storeId));
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(storeId));
        await _harness.Migrator().EnsureReadyAsync(storeId);
    }

    [PostgresFact]
    public async Task Killed_backend_is_store_unavailable_and_the_next_connection_works()
    {
        var (store, storeId) = await ReadyStoreAsync("killed");
        var breakers = Breakers();
        await using var data = NpgsqlDataSource.Create(WithTimeouts(store.AppConnectionString, pooling: true));
        await using (var context = Context(data, breakers, storeId))
        {
            await context.Database.OpenConnectionAsync();
            var pid = ((NpgsqlConnection)context.Database.GetDbConnection()).ProcessID;
            await postgres.ExecuteAsync($"SELECT pg_terminate_backend({pid}, 10000)");

            var error = await Assert.ThrowsAnyAsync<Exception>(() => context.Events.CountAsync());

            var failure = Assert.IsType<StoreUnavailableException>(StoreFailureException.FindIn(error));
            Assert.Null(failure.InnerException);
        }

        Assert.Equal(0, await CountEventsAsync(data, breakers, storeId));
    }

    [PostgresFact]
    public async Task Too_many_connections_for_the_role_is_store_rate_limited()
    {
        var (store, storeId) = await ReadyStoreAsync("crowded");
        await postgres.ExecuteAsync($"ALTER ROLE \"{store.AppRole}\" CONNECTION LIMIT 1");
        await using var holder = NpgsqlDataSource.Create(WithTimeouts(store.AppConnectionString, pooling: false));
        await using var held = await holder.OpenConnectionAsync();
        await using var data = Unpooled(store.AppConnectionString);

        await Assert.ThrowsAsync<StoreRateLimitedException>(() => CountEventsAsync(data, Breakers(), storeId));
    }

    [PostgresFact]
    public async Task Wrong_password_is_store_credentials_rejected_without_the_user_name()
    {
        var (store, storeId) = await ReadyStoreAsync("password");
        var wrong = new NpgsqlConnectionStringBuilder(store.AppConnectionString) { Password = "not-the-password" }.ConnectionString;
        await using var data = Unpooled(wrong);

        var error = await Assert.ThrowsAsync<StoreCredentialsRejectedException>(() => CountEventsAsync(data, Breakers(), storeId));

        Assert.DoesNotContain(store.AppRole, error.Message, StringComparison.Ordinal);
    }

    [PostgresFact]
    public async Task Command_and_statement_timeouts_are_store_timeout()
    {
        var (store, storeId) = await ReadyStoreAsync("slow");
        var breakers = Breakers();
        await using var shortCommands = NpgsqlDataSource.Create(new NpgsqlConnectionStringBuilder(WithTimeouts(store.AppConnectionString, pooling: false)) { CommandTimeout = 1 }.ConnectionString);
        await using (var context = Context(shortCommands, breakers, storeId))
        {
            var error = await Assert.ThrowsAnyAsync<Exception>(() => context.Database.ExecuteSqlRawAsync("SELECT pg_sleep(3)"));
            Assert.IsType<StoreTimeoutException>(StoreFailureException.FindIn(error));
        }

        await postgres.ExecuteAsync($"ALTER ROLE \"{store.AppRole}\" IN DATABASE \"{store.Database}\" SET statement_timeout = '300ms'");
        await using var data = Unpooled(store.AppConnectionString);
        await using (var context = Context(data, breakers, storeId))
        {
            var error = await Assert.ThrowsAnyAsync<Exception>(() => context.Database.ExecuteSqlRawAsync("SELECT pg_sleep(2)"));
            Assert.IsType<StoreTimeoutException>(StoreFailureException.FindIn(error));
        }
    }

    [PostgresFact]
    public async Task Read_only_database_over_quota_fails_the_whole_save_then_saves_once_writable_again()
    {
        var (store, storeId) = await ReadyStoreAsync("quota");
        var breakers = Breakers();
        var babyId = Guid.NewGuid();
        await postgres.ExecuteAsync($"ALTER DATABASE \"{store.Database}\" SET default_transaction_read_only = on");
        await using var data = Unpooled(store.AppConnectionString);
        var events = new[] { Diaper(babyId), Diaper(babyId) };

        await using (var context = Context(data, breakers, storeId))
        {
            context.Events.AddRange(events);
            var error = await Assert.ThrowsAnyAsync<Exception>(() => context.SaveChangesAsync());
            Assert.IsType<StoreQuotaFullException>(StoreFailureException.FindIn(error));
        }

        Assert.Equal(0L, await postgres.ScalarAsync<long>("SELECT count(*) FROM lotties.events", store.Admin));
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(storeId));
        await postgres.ExecuteAsync($"ALTER DATABASE \"{store.Database}\" RESET default_transaction_read_only");
        await using (var context = Context(data, breakers, storeId))
        {
            context.Events.AddRange(events.Select(saved => Diaper(babyId, saved.Id)));
            await context.SaveChangesAsync();
        }

        Assert.Equal(2L, await postgres.ScalarAsync<long>("SELECT count(*) FROM lotties.events", store.Admin));
    }

    /// <summary>A new external store migrated to the current data chain by the production migrator.</summary>
    private async Task<(ExternalStore Store, Guid StoreId)> ReadyStoreAsync(string prefix)
    {
        var store = await postgres.CreateExternalStoreAsync(prefix);
        var storeId = _harness.Register(WithTimeouts(store.MigratorConnectionString, pooling: false), WithTimeouts(store.AppConnectionString, pooling: false));
        await _harness.Migrator().EnsureReadyAsync(storeId);
        return (store, storeId);
    }

    private StoreCircuitBreakers Breakers() =>
        new(Options.Create(_breakerOptions), _clock, NullLogger<StoreCircuitBreakers>.Instance, () => 0);

    private static NpgsqlDataSource Unpooled(string connectionString) =>
        NpgsqlDataSource.Create(WithTimeouts(connectionString, pooling: false));

    private static string WithTimeouts(string connectionString, bool pooling) =>
        new NpgsqlConnectionStringBuilder(connectionString) { Timeout = ConnectTimeoutSeconds, CommandTimeout = 15, Pooling = pooling }.ConnectionString;

    /// <summary>A data context on the store as an external store's would be: the external schema and the store's failure interceptor.</summary>
    private static LottiesDataDbContext Context(NpgsqlDataSource data, StoreCircuitBreakers breakers, Guid storeId) =>
        new(new DbContextOptionsBuilder<LottiesDataDbContext>(ExternalStoreSchema.Options(data.CreateConnection()))
            .AddInterceptors(new StoreFailureInterceptors(breakers, NullLogger<StoreFailureInterceptor>.Instance).For(storeId))
            .Options);

    private static async Task<int> CountEventsAsync(NpgsqlDataSource data, StoreCircuitBreakers breakers, Guid storeId)
    {
        await using var context = Context(data, breakers, storeId);
        return await context.Events.CountAsync();
    }

    private static Event Diaper(Guid babyId, Guid? id = null) =>
        Event.Create(id ?? Guid.NewGuid(), babyId, BuiltInEventTypes.DiaperId, Guid.NewGuid(), Start, Start, EventPayload.From("""{"content":"WET"}"""), null, Start);

    private sealed class FakeClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }
}
