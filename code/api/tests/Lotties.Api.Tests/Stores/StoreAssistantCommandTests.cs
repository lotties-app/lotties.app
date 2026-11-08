using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The voice assistants' command layer for a baby whose records are in the Owner's own database (docs/design/47-bring-your-own-database.md
/// D9 and section 2.2, task T11; design 32). The command resolves the baby's store through the same resolver as every route: reads come
/// from that store and the allowed writes (an event, a dose of a registered medicine as said) go into it, never into the Lotties
/// database. With the store down every data command answers the language-neutral <c>temporarily_unavailable</c> result, which carries no
/// baby, no store and no reason, writes nothing, and renders (Alexa en/pt-BR, MCP) without the baby's or the medicine's name even when
/// the user turned on saying them. Listing the family needs only the control plane and still answers.
/// </summary>
public sealed class StoreAssistantCommandTests(StoreRoutingHost routing) : IClassFixture<StoreRoutingHost>
{
    private const string BabyName = "Aurorinha";
    private const string MedicineName = "Zyrtecish";
    private const string FakeAddress = "203.0.113.91";

    private static readonly DateTimeOffset Now = TestUsers.Now;

    private ApiFactory Factory => routing.Factory;

    private SqliteDataStores Stores => routing.Stores;

    private WebApplicationFactory<Program> Host => routing.Host;

    [Fact]
    public async Task Commands_BabyOnItsOwnStore_ReadAndWriteThroughThatStoreOnly()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        await SeedMedicineAsync(family);
        var invocation = AssistantTestKit.Invocation(babyId: family.BabyId, fallbackZone: "America/Sao_Paulo");

        var bottle = await Host.RunAsAsync(family.Subject, assistant => assistant.LogBottleAsync(invocation, 90, BottleKind.Formula));
        var lastFeed = await Host.RunAsAsync(family.Subject, assistant => assistant.ReadLastFeedAsync(invocation));
        var dose = await Host.RunAsAsync(family.Subject, assistant => assistant.LogMedicationAsync(invocation, MedicineName.ToLowerInvariant()));
        var reminder = await Host.RunAsAsync(family.Subject, assistant => assistant.ReadMedicationReminderAsync(invocation));

        Assert.Equal(AssistantResultCode.LastFeed, lastFeed.Code);
        Assert.Equal(AssistantResultCode.MedicationLogged, dose.Code);
        Assert.Equal(AssistantResultCode.MedicationReminder, reminder.Code);
        Assert.NotEqual(AssistantResultCode.TemporarilyUnavailable, bottle.Code);
        var inStore = await Stores.QueryAsync(storeId, context => context.EventsIncludingDeleted.Select(item => item.TypeId).ToArrayAsync());
        Assert.Contains(BuiltInEventTypes.MedicationId, inStore);
        Assert.Equal(2, inStore.Length);
        Assert.False(await Factory.QueryAsync(context => context.Events.IgnoreQueryFilters().AnyAsync(item => item.BabyId == family.BabyId)));
    }

    [Fact]
    public async Task Commands_StoreDown_AnswerTemporarilyUnavailableWithNoBabyStoreOrMedicineAndWriteNothing()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync(sayNames: true);
        await SeedMedicineAsync(family);
        Stores.FaultsOf(storeId).ConnectionFault = new NpgsqlException($"Failed to connect to {FakeAddress}:5432", new SocketException((int)SocketError.ConnectionRefused));
        var invocation = AssistantTestKit.Invocation(babyId: family.BabyId, fallbackZone: "America/Sao_Paulo");

        var results = new[]
        {
            await Host.RunAsAsync(family.Subject, assistant => assistant.LogMedicationAsync(invocation, MedicineName)),
            await Host.RunAsAsync(family.Subject, assistant => assistant.ReadMedicationReminderAsync(invocation)),
            await Host.RunAsAsync(family.Subject, assistant => assistant.LogDiaperAsync(invocation, DiaperKind.Wet)),
            await Host.RunAsAsync(family.Subject, assistant => assistant.ReadLastFeedAsync(invocation)),
            await Host.RunAsAsync(family.Subject, assistant => assistant.ReadDaySummaryAsync(invocation, null)),
        };

        foreach (var result in results)
        {
            Assert.Equal(AssistantResultCode.TemporarilyUnavailable, result.Code);
            Assert.Null(result.Baby);
            foreach (var text in new[] { AlexaLanguages.For("en-US").Say(result), AlexaLanguages.For("pt-BR").Say(result), McpResultText.Of(result), JsonSerializer.Serialize(result) })
            {
                Assert.DoesNotContain(BabyName, text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain(MedicineName, text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain(FakeAddress, text, StringComparison.Ordinal);
                Assert.DoesNotContain(storeId.ToString(), text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain(family.BabyId.ToString(), text, StringComparison.OrdinalIgnoreCase);
            }
        }

        Stores.FaultsOf(storeId).Clear();
        Assert.Empty(await Stores.QueryAsync(storeId, context => context.EventsIncludingDeleted.Select(item => item.Id).ToArrayAsync()));
    }

    [Fact]
    public async Task ListBabies_StoreDown_StillAnswersFromTheControlPlane()
    {
        var (family, storeId) = await FamilyOnNewStoreAsync();
        Stores.FaultsOf(storeId).ConnectionFault = new NpgsqlException("down", new SocketException((int)SocketError.ConnectionRefused));
        var attempts = Stores.FaultsOf(storeId).ConnectionAttempts;

        var result = await Host.RunAsAsync(family.Subject, assistant => assistant.ListBabiesAsync(AssistantTestKit.Invocation()));

        Assert.NotEqual(AssistantResultCode.TemporarilyUnavailable, result.Code);
        Assert.Equal(attempts, Stores.FaultsOf(storeId).ConnectionAttempts);
    }

    /// <summary>A registered medicine with a scheduled prescription, written through the baby's routes (so into its own store).</summary>
    private async Task SeedMedicineAsync(Family family)
    {
        var client = Host.ClientFor(family.Subject);
        var medicationId = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/api/v1/babies/{family.BabyId}/medications/{medicationId}", new { name = MedicineName, isUsual = true })).EnsureSuccessStatusCode();
        var put = await client.PutAsJsonAsync($"/api/v1/babies/{family.BabyId}/prescriptions/{Guid.NewGuid()}", new { medicationId, kind = "scheduled", dose = new { amount = 2.5, unit = "drops" }, everyMinutes = 240, startDate = DateTime.UtcNow.AddDays(-3).ToString("yyyy-MM-dd") });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
    }

    /// <summary>An Owner and her baby, moved onto a new store; with <paramref name="sayNames"/> she turned on saying the baby's and the medicines' names.</summary>
    private async Task<(Family Family, Guid StoreId)> FamilyOnNewStoreAsync(bool sayNames = false)
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", Now);
        var baby = Baby.Create(BabyName, DateOnly.FromDateTime(Now.UtcDateTime.AddMonths(-3)), owner.Id, Now);
        await Factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.Add(baby);
            if (sayNames)
            {
                context.UserAssistantSettings.Add(UserAssistantSettings.Create(owner.Id, null, Now, sayBabyName: true, sayMedicineNames: true));
            }

            return Task.CompletedTask;
        });
        var storeId = Stores.Create();
        await Factory.AssignStoreAsync(baby.Id, owner.Id, storeId);
        return (new Family(owner.Subject, baby.Id), storeId);
    }

    private sealed record Family(string Subject, Guid BabyId);
}
