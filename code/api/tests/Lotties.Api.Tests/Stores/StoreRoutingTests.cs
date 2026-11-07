using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Stores;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Support;
using Lotties.Application.Stores;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Stores;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The API with <c>Stores:Enabled</c> on and two kinds of external store (SQLite files holding only the data tables), next to the
/// built-in store of the test database (docs/design/47-bring-your-own-database.md section 3.6, task T2). One host per class.
/// </summary>
public sealed class StoreRoutingHost : IDisposable
{
    public StoreRoutingHost()
    {
        Host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Stores:Enabled", "true");
            builder.ConfigureTestServices(services => services.AddSingleton<IExternalDataStores>(Stores));
        });
    }

    public ApiFactory Factory { get; } = new();

    internal SqliteDataStores Stores { get; } = new();

    public WebApplicationFactory<Program> Host { get; }

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
        Stores.Dispose();
    }
}

/// <summary>
/// Routing leaks and the fail-closed rule: a baby on store X is read and written only there, never through store Y or the built-in
/// store; a data access without the baby bound throws; a store that cannot be opened is <c>503 store_unavailable</c>, never a fallback
/// to the built-in store; the entry points outside a baby route (the voice assistants, account erasure) bind the baby themselves.
/// </summary>
public sealed class StoreRoutingTests(StoreRoutingHost routing) : IClassFixture<StoreRoutingHost>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;

    private ApiFactory Factory => routing.Factory;

    private SqliteDataStores Stores => routing.Stores;

    private WebApplicationFactory<Program> Host => routing.Host;

    [Fact]
    public async Task Events_EachBabyIsReadAndWrittenOnlyInItsOwnStore()
    {
        var family = await SeedFamilyAsync(3);
        var (inX, inY, hosted) = (family.Babies[0], family.Babies[1], family.Babies[2]);
        var storeX = await AssignNewStoreAsync(family, inX);
        var storeY = await AssignNewStoreAsync(family, inY);
        var client = Host.ClientFor(family.Subject);

        var eventInX = await PutDiaperAsync(client, inX);
        var eventInY = await PutDiaperAsync(client, inY);
        var eventHosted = await PutDiaperAsync(client, hosted);

        Assert.Equal([eventInX], await IdsInStoreAsync(storeX));
        Assert.Equal([eventInY], await IdsInStoreAsync(storeY));
        Assert.Equal([eventHosted], await BuiltInIdsAsync(family.Babies));
        Assert.Equal([eventInX], await ListedIdsAsync(client, inX));
        Assert.Equal([eventInY], await ListedIdsAsync(client, inY));
        Assert.Equal([eventHosted], await ListedIdsAsync(client, hosted));
    }

    [Fact]
    public async Task GetEvent_IdOfABabyOnAnotherStore_IsNotFound()
    {
        var family = await SeedFamilyAsync(2);
        await AssignNewStoreAsync(family, family.Babies[0]);
        var storeY = await AssignNewStoreAsync(family, family.Babies[1]);
        var client = Host.ClientFor(family.Subject);
        var eventInX = await PutDiaperAsync(client, family.Babies[0]);

        var response = await client.GetAsync($"/api/v1/babies/{family.Babies[1]}/events/{eventInX}");

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "event_not_found");
        Assert.Empty(await IdsInStoreAsync(storeY));
    }

    [Fact]
    public async Task SyncEpoch_IsTheBabysStoreEpochOnItsRoutes()
    {
        var family = await SeedFamilyAsync(2);
        await AssignNewStoreAsync(family, family.Babies[0]);
        var client = Host.ClientFor(family.Subject);

        var moved = await client.GetAsync($"/api/v1/babies/{family.Babies[0]}/events");
        var hosted = await client.GetAsync($"/api/v1/babies/{family.Babies[1]}/events");
        var flagOff = await Factory.CreateClientFor(family.Subject).GetAsync($"/api/v1/babies/{family.Babies[1]}/events");

        Assert.Equal("1", Assert.Single(moved.EnsureSuccessStatusCode().Headers.GetValues(StoreScopeEndpointFilter.SyncEpochHeader)));
        Assert.Equal("0", Assert.Single(hosted.EnsureSuccessStatusCode().Headers.GetValues(StoreScopeEndpointFilter.SyncEpochHeader)));
        Assert.Equal("0", Assert.Single(flagOff.EnsureSuccessStatusCode().Headers.GetValues(StoreScopeEndpointFilter.SyncEpochHeader)));
    }

    [Fact]
    public async Task Requests_BabyOnAStoreThatCannotBeOpened_Are503AndNeverReachTheBuiltInStore()
    {
        var family = await SeedFamilyAsync(1);
        var baby = family.Babies[0];
        await AssignAsync(family, baby, Guid.NewGuid());
        var client = Host.ClientFor(family.Subject);

        var write = await client.PutAsJsonAsync($"/api/v1/babies/{baby}/events/{Guid.NewGuid()}", DiaperBody());
        var read = await client.GetAsync($"/api/v1/babies/{baby}/events");

        await write.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        await read.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.Empty(await BuiltInIdsAsync([baby]));
    }

    [Fact]
    public async Task Repositories_WithoutTheBabyBound_FailClosed()
    {
        var family = await SeedFamilyAsync(2);
        var (inX, hosted) = (family.Babies[0], family.Babies[1]);
        await AssignNewStoreAsync(family, inX);
        var eventInX = await PutDiaperAsync(Host.ClientFor(family.Subject), inX);
        await using var scope = Host.Services.CreateAsyncScope();
        var events = scope.ServiceProvider.GetRequiredService<IEventRepository>();
        var stores = scope.ServiceProvider.GetRequiredService<IStoreScope>();

        await Assert.ThrowsAsync<StoreScopeMissingException>(() => events.ListChangesAsync(inX, null, 10));
        await Assert.ThrowsAsync<StoreScopeMissingException>(() => events.FindAsync(eventInX));
        await stores.EnterAsync(inX);
        var otherBaby = await Assert.ThrowsAsync<StoreScopeMissingException>(() => events.ListChangesAsync(hosted, null, 10));
        var found = await events.FindAsync(eventInX);
        await stores.EnterAsync(hosted);

        Assert.Equal(hosted, otherBaby.BabyId);
        Assert.Equal(inX, found?.BabyId);
        await Assert.ThrowsAsync<StoreScopeAmbiguousException>(() => events.FindAsync(eventInX));
        Assert.Equal([eventInX], (await events.ListChangesAsync(inX, null, 10)).Select(item => item.Id));
        Assert.Empty(await events.ListChangesAsync(hosted, null, 10));
    }

    [Fact]
    public async Task AssistantCommand_BabyOnAnExternalStore_WritesIntoThatStore()
    {
        var family = await SeedFamilyAsync(2);
        var storeX = await AssignNewStoreAsync(family, family.Babies[0]);

        await Host.RunAsAsync(family.Subject, assistant => assistant.LogDiaperAsync(AssistantTestKit.Invocation(babyId: family.Babies[0]), DiaperKind.Wet));

        Assert.Single(await IdsInStoreAsync(storeX));
        Assert.Empty(await BuiltInIdsAsync(family.Babies));
    }

    [Fact]
    public async Task DeleteAccount_OwnerOfABabyOnAnExternalStore_FailsClosedAndErasesNothing()
    {
        var family = await SeedFamilyAsync(1);
        var storeX = await AssignNewStoreAsync(family, family.Babies[0]);
        await PutDiaperAsync(Host.ClientFor(family.Subject), family.Babies[0]);

        var response = await Host.ClientFor(family.Subject).DeleteAsync("/api/v1/me");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.True(await Factory.QueryAsync(context => context.Babies.AnyAsync(baby => baby.Id == family.Babies[0])));
        Assert.True(await Factory.QueryAsync(context => context.DataStores.AnyAsync(store => store.Id == storeX)));
        Assert.Null(await Factory.QueryAsync(context => context.Users.Where(user => user.Id == family.OwnerId).Select(user => user.DeletedAt).SingleAsync()));
        Assert.Single(await IdsInStoreAsync(storeX));
    }

    private static object DiaperBody() => new { typeId = BuiltInEventTypes.DiaperId, startedAt = Now, endedAt = Now, payload = new { content = "WET" } };

    private static async Task<Guid> PutDiaperAsync(HttpClient client, Guid babyId)
    {
        var id = Guid.NewGuid();
        var response = await client.PutAsJsonAsync($"/api/v1/babies/{babyId}/events/{id}", DiaperBody());
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return id;
    }

    private static async Task<Guid[]> ListedIdsAsync(HttpClient client, Guid babyId)
    {
        var listed = await (await client.GetAsync($"/api/v1/babies/{babyId}/events")).ReadAsync<JsonElement>();
        return listed.EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
    }

    private Task<Guid[]> IdsInStoreAsync(Guid storeId) =>
        Stores.QueryAsync(storeId, context => context.EventsIncludingDeleted.Select(item => item.Id).ToArrayAsync());

    private Task<Guid[]> BuiltInIdsAsync(IReadOnlyCollection<Guid> babyIds) =>
        Factory.QueryAsync(context => context.Events.IgnoreQueryFilters().Where(item => babyIds.Contains(item.BabyId)).Select(item => item.Id).ToArrayAsync());

    /// <summary>An Owner with <paramref name="count"/> babies, all on the built-in store.</summary>
    private async Task<Family> SeedFamilyAsync(int count)
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", Now);
        var babies = Enumerable.Range(0, count).Select(index => Baby.Create($"Baby {index}", DateOnly.FromDateTime(Now.UtcDateTime), owner.Id, Now)).ToArray();
        await Factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.AddRange(babies);
            return Task.CompletedTask;
        });
        return new Family(owner.Id, owner.Subject, babies.Select(baby => baby.Id).ToArray());
    }

    /// <summary>A new store database owned by the family's Owner, with <paramref name="babyId"/> moved onto it.</summary>
    private async Task<Guid> AssignNewStoreAsync(Family family, Guid babyId)
    {
        var storeId = Stores.Create();
        await AssignAsync(family, babyId, storeId);
        return storeId;
    }

    private Task AssignAsync(Family family, Guid babyId, Guid storeId) => Factory.AssignStoreAsync(babyId, family.OwnerId, storeId);

    private sealed record Family(Guid OwnerId, string Subject, IReadOnlyList<Guid> Babies);
}
