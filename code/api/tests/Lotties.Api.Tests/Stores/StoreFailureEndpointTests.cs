using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Application.Stores;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// What clients see when a baby's external store fails (docs/design/47-bring-your-own-database.md section 5, task T8; SPEC "Events
/// sync contract"): a retriable <c>503</c> with the class's <c>store_*</c> code and <c>Retry-After</c>, never a 500 and never the
/// driver's text; the circuit breaker answers without touching the store once it is open; a failed write leaves nothing behind and a
/// retry once the store is back writes it once; the voice assistants answer "temporarily unavailable". The stores are the routing
/// tests' SQLite stores with a fault injector that throws what Npgsql throws for a down, slow or full Postgres.
/// </summary>
public sealed class StoreFailureEndpointTests(StoreRoutingHost routing) : IClassFixture<StoreRoutingHost>
{
    /// <summary>The breaker's default (Stores:CircuitBreaker:FailureThreshold).</summary>
    private const int FailureThreshold = 3;

    private const string FakeAddress = "203.0.113.77";
    private const string FakeUser = "lotties_app_secret_user";

    private static readonly DateTimeOffset Now = TestUsers.Now;

    private ApiFactory Factory => routing.Factory;

    private SqliteDataStores Stores => routing.Stores;

    private WebApplicationFactory<Program> Host => routing.Host;

    [Fact]
    public async Task Write_StoreRefusesConnections_Is503PausedOrUnreachableWithRetryAfterAndNoDriverText()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        Stores.FaultsOf(storeId).ConnectionFault = Refused();

        var response = await Host.ClientFor(family.Subject).PutAsJsonAsync($"/api/v1/babies/{family.Baby}/events/{Guid.NewGuid()}", DiaperBody());

        var problem = await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_paused_or_unreachable");
        Assert.Equal(TimeSpan.FromSeconds(30), response.Headers.RetryAfter?.Delta);
        var body = problem.GetRawText();
        Assert.DoesNotContain(FakeAddress, body, StringComparison.Ordinal);
        Assert.DoesNotContain(FakeUser, body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SyncPull_StoreTimesOut_Is503StoreTimeoutWithAShortRetryAfter()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        Stores.FaultsOf(storeId).ConnectionFault = new NpgsqlException($"Exception while connecting to {FakeAddress}", new TimeoutException());

        var response = await Host.ClientFor(family.Subject).GetAsync($"/api/v1/babies/{family.Baby}/events");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_timeout");
        Assert.Equal(TimeSpan.FromSeconds(5), response.Headers.RetryAfter?.Delta);
    }

    [Fact]
    public async Task Requests_AfterTheThresholdOfConnectionFailures_AreAnsweredWithoutTouchingTheStore()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        var faults = Stores.FaultsOf(storeId);
        faults.ConnectionFault = Refused();
        var client = Host.ClientFor(family.Subject);
        for (var attempt = 0; attempt < FailureThreshold; attempt++)
        {
            await (await client.GetAsync($"/api/v1/babies/{family.Baby}/events")).AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_paused_or_unreachable");
        }

        var attemptsBefore = faults.ConnectionAttempts;
        faults.Clear();
        var rejected = await client.PutAsJsonAsync($"/api/v1/babies/{family.Baby}/events/{Guid.NewGuid()}", DiaperBody());

        await rejected.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_paused_or_unreachable");
        Assert.Equal(attemptsBefore, faults.ConnectionAttempts);
        Assert.InRange(rejected.Headers.RetryAfter?.Delta ?? TimeSpan.Zero, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(30));
        Assert.Empty(await IdsInStoreAsync(storeId));
    }

    [Fact]
    public async Task Write_StoreIsFull_FailsWholeAndARetryOnceTheStoreIsBackWritesItOnce()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        var faults = Stores.FaultsOf(storeId);
        faults.WriteFault = new PostgresException($"could not extend file on {FakeAddress}", "ERROR", "ERROR", "53100");
        var client = Host.ClientFor(family.Subject);
        var eventId = Guid.NewGuid();

        var failed = await client.PutAsJsonAsync($"/api/v1/babies/{family.Baby}/events/{eventId}", DiaperBody());

        var problem = await failed.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_quota_full");
        Assert.DoesNotContain(FakeAddress, problem.GetRawText(), StringComparison.Ordinal);
        Assert.Empty(await IdsInStoreAsync(storeId));
        faults.Clear();
        var retried = await client.PutAsJsonAsync($"/api/v1/babies/{family.Baby}/events/{eventId}", DiaperBody());
        var replayed = await client.PutAsJsonAsync($"/api/v1/babies/{family.Baby}/events/{eventId}", DiaperBody());
        Assert.Equal(HttpStatusCode.Created, retried.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);
        Assert.Equal([eventId], await IdsInStoreAsync(storeId));
    }

    [Fact]
    public async Task Write_StoreIsFull_DoesNotOpenTheBreakerSoReadsGoOn()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        Stores.FaultsOf(storeId).WriteFault = new PostgresException("disk full", "ERROR", "ERROR", "53100");
        var client = Host.ClientFor(family.Subject);
        for (var attempt = 0; attempt <= FailureThreshold; attempt++)
        {
            await (await client.PutAsJsonAsync($"/api/v1/babies/{family.Baby}/events/{Guid.NewGuid()}", DiaperBody())).AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_quota_full");
        }

        var read = await client.GetAsync($"/api/v1/babies/{family.Baby}/events");

        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    [Fact]
    public async Task HostedBaby_WhileAnotherBabysStoreIsDown_IsServedAsBefore()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync(babies: 2);
        Stores.FaultsOf(storeId).ConnectionFault = Refused();
        var client = Host.ClientFor(family.Subject);
        for (var attempt = 0; attempt <= FailureThreshold; attempt++)
        {
            await client.GetAsync($"/api/v1/babies/{family.Baby}/events");
        }

        var hosted = await client.PutAsJsonAsync($"/api/v1/babies/{family.Babies[1]}/events/{Guid.NewGuid()}", DiaperBody());

        Assert.Equal(HttpStatusCode.Created, hosted.StatusCode);
    }

    [Fact]
    public async Task AssistantCommands_StoreDown_AnswerTemporarilyUnavailableWithoutDetail()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        Stores.FaultsOf(storeId).ConnectionFault = Refused();
        var invocation = AssistantTestKit.Invocation(babyId: family.Baby);

        var write = await Host.RunAsAsync(family.Subject, assistant => assistant.LogDiaperAsync(invocation, DiaperKind.Wet));
        var read = await Host.RunAsAsync(family.Subject, assistant => assistant.ReadLastFeedAsync(invocation));

        Assert.All(new[] { write, read }, result =>
        {
            Assert.Equal(AssistantResultCode.TemporarilyUnavailable, result.Code);
            Assert.Null(result.Baby);
        });
        Assert.Equal("temporarily_unavailable", AssistantResult.CodeName(AssistantResultCode.TemporarilyUnavailable));
        Assert.Empty(await IdsInStoreAsync(storeId));
    }

    [Fact]
    public async Task AssistantCommands_StoreBreakerOpen_AnswerTemporarilyUnavailable()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        Stores.FaultsOf(storeId).ConnectionFault = new NpgsqlException("boom", new TimeoutException());
        var invocation = AssistantTestKit.Invocation(babyId: family.Baby);
        for (var attempt = 0; attempt < FailureThreshold; attempt++)
        {
            await Host.RunAsAsync(family.Subject, assistant => assistant.ReadSleepStatusAsync(invocation));
        }

        var result = await Host.RunAsAsync(family.Subject, assistant => assistant.ReadSleepStatusAsync(invocation));

        Assert.Equal(AssistantResultCode.TemporarilyUnavailable, result.Code);
    }

    [Fact]
    public async Task Forget_AfterTheStoreWasFixed_LetsTheNextRequestThroughAtOnce()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        var faults = Stores.FaultsOf(storeId);
        faults.ConnectionFault = Refused();
        var client = Host.ClientFor(family.Subject);
        for (var attempt = 0; attempt < FailureThreshold; attempt++)
        {
            await client.GetAsync($"/api/v1/babies/{family.Baby}/events");
        }

        faults.Clear();
        Host.Services.GetRequiredService<IStoreHealth>().Forget(storeId);
        var read = await client.GetAsync($"/api/v1/babies/{family.Baby}/events");

        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    private static NpgsqlException Refused() =>
        new($"Failed to connect to {FakeAddress}:5432 as {FakeUser}", new SocketException((int)SocketError.ConnectionRefused));

    private static object DiaperBody() => new { typeId = BuiltInEventTypes.DiaperId, startedAt = Now, endedAt = Now, payload = new { content = "WET" } };

    private Task<Guid[]> IdsInStoreAsync(Guid storeId) =>
        Stores.QueryAsync(storeId, context => context.EventsIncludingDeleted.Select(item => item.Id).ToArrayAsync());

    /// <summary>An Owner with <paramref name="babies"/> babies; the first is moved onto a new store, the others stay on the built-in one.</summary>
    private async Task<(Family Family, Guid StoreId)> FamilyOnNewStoreAsync(int babies = 1)
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", Now);
        var created = Enumerable.Range(0, babies).Select(index => Baby.Create($"Baby {index}", DateOnly.FromDateTime(Now.UtcDateTime), owner.Id, Now)).ToArray();
        await Factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.AddRange(created);
            return Task.CompletedTask;
        });
        var storeId = Stores.Create();
        await Factory.AssignStoreAsync(created[0].Id, owner.Id, storeId);
        return (new Family(owner.Subject, created.Select(baby => baby.Id).ToArray()), storeId);
    }

    private sealed record Family(string Subject, IReadOnlyList<Guid> Babies)
    {
        public Guid Baby => Babies[0];
    }
}
