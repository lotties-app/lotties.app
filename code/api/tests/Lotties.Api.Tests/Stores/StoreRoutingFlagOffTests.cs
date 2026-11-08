using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.Stores;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The API with <c>Stores:Enabled</c> off (the default) and a store the host could open if it were allowed to: a baby whose pointer
/// names an external store is never served from the built-in database (docs/design/47-bring-your-own-database.md section 3.6).
/// </summary>
public sealed class StoreRoutingFlagOffHost : IDisposable
{
    public StoreRoutingFlagOffHost()
    {
        Host = Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<IExternalDataStores>(Stores)));
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
/// The pointer is read whatever the flag says; with the flag off no external store is opened, so every way in answers
/// <c>store_unavailable</c> for such a baby: a read and a write of its route, the voice assistants, account deletion, the doctor's
/// patient list, the rest estimate and a backup restore into it. Nothing reaches the built-in database or the store. The push
/// scheduler's case is in <see cref="StoreRoutingSchedulerTests"/>.
/// </summary>
public sealed class StoreRoutingFlagOffTests(StoreRoutingFlagOffHost routing) : IClassFixture<StoreRoutingFlagOffHost>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;

    private ApiFactory Factory => routing.Factory;

    private SqliteDataStores Stores => routing.Stores;

    private WebApplicationFactory<Program> Host => routing.Host;

    [Fact]
    public async Task BabyRoutes_ReadAndWriteOfABabyOnAnExternalStore_Are503AndTouchNoDatabase()
    {
        var (baby, _, storeId) = await SeedExternalBabyAsync();
        var client = Host.ClientFor(baby.OwnerSubject);
        var eventId = Guid.NewGuid();

        var write = await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/events/{eventId}", new { typeId = BuiltInEventTypes.DiaperId, startedAt = Now, endedAt = Now, payload = new { content = "WET" } });
        var read = await client.GetAsync($"/api/v1/babies/{baby.BabyId}/events");

        await write.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        await read.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.False(await Factory.QueryAsync(context => context.Events.IgnoreQueryFilters().AnyAsync(item => item.BabyId == baby.BabyId)));
        Assert.Empty(await Stores.QueryAsync(storeId, context => context.EventsIncludingDeleted.Select(item => item.Id).ToArrayAsync()));
    }

    [Fact]
    public async Task BabyRoutes_HostedBaby_IsServedFromTheBuiltInStore()
    {
        var baby = await Factory.SeedBabyAsync();

        var response = await Host.ClientFor(baby.OwnerSubject).GetAsync($"/api/v1/babies/{baby.BabyId}/events");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task AssistantCommand_BabyOnAnExternalStore_IsTemporarilyUnavailableAndWritesNothing()
    {
        var (baby, _, storeId) = await SeedExternalBabyAsync();

        var result = await Host.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(AssistantTestKit.Invocation(babyId: baby.BabyId), DiaperKind.Wet));

        Assert.Equal(AssistantResultCode.TemporarilyUnavailable, result.Code);

        Assert.False(await Factory.QueryAsync(context => context.Events.IgnoreQueryFilters().AnyAsync(item => item.BabyId == baby.BabyId)));
        Assert.Empty(await Stores.QueryAsync(storeId, context => context.EventsIncludingDeleted.Select(item => item.Id).ToArrayAsync()));
    }

    [Fact]
    public async Task DeleteAccount_OwnerOfABabyOnAnExternalStore_Is503AndErasesNothing()
    {
        var (baby, ownerId, storeId) = await SeedExternalBabyAsync();

        var response = await Host.ClientFor(baby.OwnerSubject).DeleteAsync("/api/v1/me");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.True(await Factory.QueryAsync(context => context.Babies.AnyAsync(item => item.Id == baby.BabyId)));
        Assert.True(await Factory.QueryAsync(context => context.DataStores.AnyAsync(store => store.Id == storeId)));
        Assert.Null(await Factory.QueryAsync(context => context.Users.Where(user => user.Id == ownerId).Select(user => user.DeletedAt).SingleAsync()));
    }

    [Fact]
    public async Task DoctorPatients_PatientOnAnExternalStore_Is503()
    {
        var (baby, _, _) = await SeedExternalBabyAsync(BabyRole.Doctor);

        var response = await Host.ClientFor(baby.SubjectOf(BabyRole.Doctor)).GetAsync("/api/v1/doctor/patients");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
    }

    [Fact]
    public async Task RestEstimate_BabyOnAnExternalStore_Is503()
    {
        var (baby, _, _) = await SeedExternalBabyAsync();
        var client = Host.ClientFor(baby.OwnerSubject);
        var settings = await client.PutAsJsonAsync("/api/v1/me/rest-settings", new
        {
            enabled = true,
            timeZone = "UTC",
            workWindows = new[] { new { days = new[] { 1, 2 }, start = "08:00", end = "17:00" } },
            nightStart = "19:00",
            nightEnd = "07:00",
            fallAsleepMinutes = 20,
            wakeLeadMinutes = 20,
        });
        settings.EnsureSuccessStatusCode();

        var response = await client.GetAsync("/api/v1/me/rest");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
    }

    [Fact]
    public async Task BackupRestore_IntoARestoredBabyNowOnAnExternalStore_Is503AndImportsNothing()
    {
        var source = await Factory.SeedBabyAsync();
        var owner = Host.ClientFor(source.OwnerSubject);
        await owner.PutAsJsonAsync($"/api/v1/babies/{source.BabyId}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.DiaperId, startedAt = Now, endedAt = Now, payload = new { content = "WET" } }).Ok();
        var file = await owner.ExportTextAsync(source.BabyId);
        var restoredId = (await (await owner.Restore(file).Ok()).ReadAsync<JsonElement>()).GetProperty("babyId").GetGuid();
        var restoredEvents = await Factory.QueryAsync(context => context.Events.IgnoreQueryFilters().CountAsync(item => item.BabyId == restoredId));
        await Factory.AssignStoreAsync(restoredId, await Factory.UserIdAsync(source.OwnerSubject), Stores.Create());

        var again = await owner.Restore(file);

        await again.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.Equal(restoredEvents, await Factory.QueryAsync(context => context.Events.IgnoreQueryFilters().CountAsync(item => item.BabyId == restoredId)));
    }

    /// <summary>A baby (with <paramref name="memberRoles"/>) whose pointer names a store this host could open.</summary>
    private async Task<(SeededBaby Baby, Guid OwnerId, Guid StoreId)> SeedExternalBabyAsync(params BabyRole[] memberRoles)
    {
        var baby = await Factory.SeedBabyAsync(memberRoles);
        var ownerId = await Factory.UserIdAsync(baby.OwnerSubject);
        var storeId = Stores.Create();
        await Factory.AssignStoreAsync(baby.BabyId, ownerId, storeId);
        return (baby, ownerId, storeId);
    }
}
