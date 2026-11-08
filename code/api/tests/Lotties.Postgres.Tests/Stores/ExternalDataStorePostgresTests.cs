using System.Net;
using System.Security.Cryptography;
using Lotties.Application;
using Lotties.Application.Events;
using Lotties.Application.Stores;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Lotties.Infrastructure;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Lotties.Infrastructure.Stores.Migration;
using Lotties.Postgres.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Postgres.Tests.Stores;

/// <summary>
/// The production external store end to end on real Postgres (design 47 sections 2, 3 and 12): a Lotties database built by the control
/// chain, a family's database set up with the BYO role set behind a TLS front door (<see cref="TlsPostgresProxy"/>, certificate from the
/// family's own CA), a descriptor sealed for its <c>data_stores</c> row, and the API's own services (<c>AddInfrastructure</c>,
/// <c>AddApplication</c>, <c>AddStoreCredentials</c>, <c>AddStoreMigrator</c> with <c>Stores:Enabled</c>). The only test seams are the DNS
/// answer for the typed host (loopback) and the egress guard's <c>AllowLoopbackForTests</c>, set in code because no configuration can set
/// it. A baby entered through <see cref="IStoreScope"/> is migrated, opened on the app role and written and read through the normal event
/// service: the row is in the family's database and not in Lotties'; two babies on two stores never see each other's records; a stopped
/// store opens the circuit breaker.
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class ExternalDataStorePostgresTests(PostgresFixture postgres)
{
    [PostgresFact]
    public async Task Event_written_through_the_event_service_lands_in_the_family_database_and_not_in_lotties()
    {
        await using var world = await WorldAsync("byowrite");
        var store = await postgres.CreateExternalStoreAsync("byowrite");
        var family = await world.AddFamilyAsync(store);

        var eventId = await world.WriteDiaperAsync(family);
        var read = await world.ReadAsync(family, family.BabyId, eventId);

        Assert.Equal((eventId, family.BabyId, BuiltInEventTypes.DiaperId), (read.Id, read.BabyId, read.TypeId));
        Assert.Equal(1L, await postgres.ScalarAsync<long>($"SELECT count(*) FROM lotties.events WHERE id = '{eventId}' AND baby_id = '{family.BabyId}'", store.Admin));
        Assert.Equal(0L, await postgres.ScalarAsync<long>($"SELECT count(*) FROM public.events WHERE id = '{eventId}' OR baby_id = '{family.BabyId}'", world.Control));
        Assert.Equal("Ready", await postgres.ScalarAsync<string>($"SELECT state FROM data_stores WHERE id = '{family.StoreId}'", world.Control));
        Assert.Equal(new[] { store.AppRole }, await RuntimeRolesAsync(store));
        Assert.True(world.Proxy.Accepted > 0);

        world.Services.GetRequiredService<IStoreHealth>().Forget(family.StoreId);
        var again = await world.ReadAsync(family, family.BabyId, eventId);

        Assert.Equal(eventId, again.Id);
    }

    [PostgresFact]
    public async Task Two_babies_on_two_stores_never_read_each_others_records()
    {
        await using var world = await WorldAsync("byocross");
        var firstStore = await postgres.CreateExternalStoreAsync("byocross1");
        var secondStore = await postgres.CreateExternalStoreAsync("byocross2");
        var first = await world.AddFamilyAsync(firstStore);
        var second = await world.AddFamilyAsync(secondStore, alsoParent: first.OwnerId);
        var firstEvent = await world.WriteDiaperAsync(first);
        var secondEvent = await world.WriteDiaperAsync(second);

        await using var scope = world.Scope(first.OwnerId);
        var stores = scope.ServiceProvider.GetRequiredService<IStoreScope>();
        await stores.EnterAsync(first.BabyId);
        await stores.EnterAsync(second.BabyId);
        var events = scope.ServiceProvider.GetRequiredService<IEventService>();

        Assert.Equal(firstEvent, (await events.GetAsync(first.BabyId, firstEvent)).Id);
        Assert.Equal(secondEvent, (await events.GetAsync(second.BabyId, secondEvent)).Id);
        await Assert.ThrowsAsync<EventNotFoundException>(() => events.GetAsync(first.BabyId, secondEvent));
        await Assert.ThrowsAsync<EventNotFoundException>(() => events.GetAsync(second.BabyId, firstEvent));
        Assert.Equal(new[] { firstEvent }, await EventIdsAsync(firstStore));
        Assert.Equal(new[] { secondEvent }, await EventIdsAsync(secondStore));
        Assert.Equal(0L, await postgres.ScalarAsync<long>($"SELECT count(*) FROM public.events WHERE id IN ('{firstEvent}', '{secondEvent}')", world.Control));
    }

    [PostgresFact]
    public async Task Stopped_store_opens_the_circuit_breaker_and_requests_then_fail_before_the_network()
    {
        await using var world = await WorldAsync("byostop");
        var store = await postgres.CreateExternalStoreAsync("byostop");
        var family = await world.AddFamilyAsync(store);
        var eventId = await world.WriteDiaperAsync(family);
        var breakers = world.Services.GetRequiredService<StoreCircuitBreakers>();

        world.Proxy.Stop();
        var failures = new List<StoreFailureException>();
        for (var attempt = 0; attempt < 10 && breakers.PhaseOf(family.StoreId) != StoreCircuitPhase.Open; attempt++)
        {
            failures.Add(await Assert.ThrowsAnyAsync<StoreFailureException>(() => world.ReadAsync(family, family.BabyId, eventId)));
        }

        Assert.Equal(StoreCircuitPhase.Open, breakers.PhaseOf(family.StoreId));
        Assert.All(failures, failure => Assert.Null(failure.InnerException));
        Assert.All(failures, failure => Assert.Contains(failure.Failure, new[] { StoreFailureClass.Unavailable, StoreFailureClass.PausedOrUnreachable }));
        await using var scope = world.Scope(family.OwnerId);
        var rejected = await Assert.ThrowsAnyAsync<StoreFailureException>(() => scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(family.BabyId));
        Assert.NotNull(rejected.RetryAfter);
    }

    private async Task<IReadOnlyList<string>> RuntimeRolesAsync(ExternalStore store)
    {
        var sql = $"SELECT coalesce(string_agg(DISTINCT usename::text, ',' ORDER BY usename::text), '') FROM pg_stat_activity WHERE datname = '{store.Database}' AND application_name = '{PinnedStoreDataSourceFactory.ApplicationName}'";
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        var roles = await postgres.ScalarAsync<string>(sql) ?? string.Empty;
        while (roles != store.AppRole && DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(100));
            roles = await postgres.ScalarAsync<string>(sql) ?? string.Empty;
        }

        return roles.Split(',', StringSplitOptions.RemoveEmptyEntries);
    }

    private async Task<IReadOnlyList<Guid>> EventIdsAsync(ExternalStore store)
    {
        await using var command = store.Admin.CreateCommand("SELECT id FROM lotties.events ORDER BY id");
        await using var reader = await command.ExecuteReaderAsync();
        var ids = new List<Guid>();
        while (await reader.ReadAsync())
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    private async Task<StoreWorld> WorldAsync(string prefix)
    {
        var database = PostgresFixture.UniqueName(prefix);
        var control = await postgres.CreateDatabaseAsync(database);
        var server = new NpgsqlConnectionStringBuilder(postgres.ConnectionString);
        var proxy = new TlsPostgresProxy(server.Host!, server.Port);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stores:Enabled"] = "true",
            ["Stores:CurrentKeyId"] = "e2e",
            ["Stores:KeyEncryptionKeys:e2e"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            ["Stores:Migrator:LockWaitSeconds"] = "30",
        }).Build();
        var services = new ServiceCollection()
            .AddInfrastructure(new DatabaseOptions(server.Host!, server.Port, database, server.Username!, server.Password!))
            .AddDataStoreRouting(configuration)
            .AddApplication()
            .AddStoreCredentials(configuration)
            .AddStoreMigrator(configuration);
        services.AddScoped<ActingUser>();
        services.AddScoped<ICurrentUser, ActingCurrentUser>();
        services.Replace(ServiceDescriptor.Singleton<IStoreEndpointGuard>(LoopbackGuard(proxy.Port)));
        var provider = services.BuildServiceProvider();
        await using (var scope = provider.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<LottiesDbContext>().Database.MigrateAsync();
        }

        return new StoreWorld(provider, proxy, control);
    }

    /// <summary>The production egress guard with its two test seams: the typed name resolves to loopback, and loopback is allowed.</summary>
    private static StoreEndpointGuard LoopbackGuard(int port) =>
        new(new LoopbackResolver(), Options.Create(new StoreEndpointGuardOptions { AllowLoopbackForTests = true, ExtraAllowedPorts = [port] }));

    private sealed record Family(Guid OwnerId, Guid BabyId, Guid StoreId);

    private sealed class StoreWorld(ServiceProvider provider, TlsPostgresProxy proxy, NpgsqlDataSource control) : IAsyncDisposable
    {
        private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow.AddMinutes(-30);

        public IServiceProvider Services => provider;

        public TlsPostgresProxy Proxy => proxy;

        /// <summary>Superuser data source on the Lotties (control) database.</summary>
        public NpgsqlDataSource Control => control;

        public async ValueTask DisposeAsync()
        {
            await provider.DisposeAsync();
            await proxy.DisposeAsync();
        }

        /// <summary>A DI scope acting as <paramref name="userId"/> (the request's signed-in account).</summary>
        public AsyncServiceScope Scope(Guid userId)
        {
            var scope = provider.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<ActingUser>().UserId = userId;
            return scope;
        }

        /// <summary>
        /// An owner and a baby whose records live in <paramref name="store"/>: a <c>data_stores</c> row with a descriptor sealed for it
        /// (app and migrator role behind the front door, the front door's CA) and the baby's pointer to it. <paramref name="alsoParent"/>
        /// joins the baby as a Parent.
        /// </summary>
        public async Task<Family> AddFamilyAsync(ExternalStore store, Guid? alsoParent = null)
        {
            await using var scope = provider.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
            var owner = User.Create(User.UnknownIssuer, $"byo|{Guid.NewGuid():N}", "Owner", Now);
            var baby = Baby.Create("Lia", DateOnly.FromDateTime(Now.UtcDateTime.AddMonths(-3)), owner.Id, Now);
            if (alsoParent is { } parent)
            {
                baby.AddMember(parent, BabyRole.Parent, Now);
            }

            var storeId = Guid.NewGuid();
            var row = DataStore.Create(storeId, owner.Id, Now);
            var sealedDescriptor = scope.ServiceProvider.GetRequiredService<IStoreCredentials>().Seal(Descriptor(store), new StoreSealContext(storeId, owner.Id));
            row.ReplaceDescriptor(sealedDescriptor, "Test provider", Now);
            context.Users.Add(owner);
            context.Babies.Add(baby);
            context.DataStores.Add(row);
            await context.SaveChangesAsync();
            var assignment = await context.BabyStoreAssignments.SingleAsync(candidate => candidate.BabyId == baby.Id);
            assignment.MoveTo(DataStoreKey.External(storeId));
            await context.SaveChangesAsync();
            return new Family(owner.Id, baby.Id, storeId);
        }

        /// <summary>A finished wet diaper, written as the owner through the event service after entering the baby.</summary>
        public async Task<Guid> WriteDiaperAsync(Family family)
        {
            await using var scope = Scope(family.OwnerId);
            await scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(family.BabyId);
            var eventId = Guid.NewGuid();
            var request = new UpsertEventRequest
            {
                TypeId = BuiltInEventTypes.DiaperId,
                StartedAt = Now,
                EndedAt = Now,
                Payload = EventPayload.From("""{"content":"WET"}"""),
            };
            await scope.ServiceProvider.GetRequiredService<IEventService>().UpsertAsync(family.BabyId, eventId, request);
            return eventId;
        }

        public async Task<EventResponse> ReadAsync(Family family, Guid babyId, Guid eventId)
        {
            await using var scope = Scope(family.OwnerId);
            await scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(babyId);
            return await scope.ServiceProvider.GetRequiredService<IEventService>().GetAsync(babyId, eventId);
        }

        private StoreDescriptor Descriptor(ExternalStore store)
        {
            var app = new NpgsqlConnectionStringBuilder(store.AppConnectionString);
            var migrator = new NpgsqlConnectionStringBuilder(store.MigratorConnectionString);
            return StoreDescriptor.Create(
                "Test provider",
                StoreEndpoint.Create(TlsPostgresProxy.HostName, proxy.Port, store.Database, app.Username, app.Password),
                StoreMigratorEndpoint.Create(TlsPostgresProxy.HostName, proxy.Port, migrator.Username, migrator.Password),
                StoreTlsPolicy.Create(StoreSslMode.VerifyFull, proxy.CaPem));
        }
    }

    /// <summary>The signed-in account of one scope.</summary>
    private sealed class ActingUser
    {
        public Guid UserId { get; set; }
    }

    private sealed class ActingCurrentUser(ActingUser acting, LottiesDbContext control) : ICurrentUser
    {
        public bool IsAuthenticated => true;

        public Task<User> GetUserAsync(CancellationToken cancellationToken = default) =>
            control.Users.SingleAsync(user => user.Id == acting.UserId, cancellationToken);
    }

    /// <summary>DNS for the tests: the front door's name is on loopback; any other name is unknown.</summary>
    private sealed class LoopbackResolver : IHostResolver
    {
        public Task<IReadOnlyList<IPAddress>> ResolveAsync(string hostName, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<IPAddress>>(hostName == TlsPostgresProxy.HostName ? [IPAddress.Loopback] : []);
    }
}
