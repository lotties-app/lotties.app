using System.Net;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Users;
using static Lotties.Api.Tests.Assistants.AlexaRequests;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The two adapters end to end for a baby whose records are in a family's own database that this server cannot reach (here: any
/// external store while <c>Stores:Enabled</c> is off, the default; docs/design/47-bring-your-own-database.md section 2.2, task T11).
/// Alexa speaks the existing "temporarily unavailable" sentence in the request's language and the MCP tool answers the
/// <c>temporarily_unavailable</c> refusal; neither carries the baby's name (even with <c>sayBabyName</c> on), the medicine's name, the
/// baby's id or anything about the store, and nothing is written. No spoken command or tool is added for this.
/// </summary>
public sealed class StoreAssistantAdapterTests
{
    private const string BabyName = "Aurorinha";

    private const string EnglishUnavailable = "Lotties is temporarily unavailable. Please try again in a few minutes.";

    [Theory]
    [InlineData("LastFeedIntent", "en-US")]
    [InlineData("DiaperIntent", "en-US")]
    [InlineData("MedicationIntent", "en-US")]
    [InlineData("MedicationReminderIntent", "pt-BR")]
    [InlineData("LastFeedIntent", "pt-BR")]
    public async Task Alexa_BabyOnAStoreThatCannotBeReached_SpeaksTemporarilyUnavailableWithoutNames(string intent, string locale)
    {
        using var host = new AlexaApiHost();
        var baby = await SeedBabyOnUnreachableStoreAsync(host.Factory);
        object? slots = intent switch
        {
            "DiaperIntent" => new { diaperKind = ResolvedSlot("diaperKind", "wet", "WET") },
            "MedicationIntent" => new { medicationName = Slot("medicationName", "Zyrtecish") },
            _ => null,
        };

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent(intent, host.TokenFor(baby.OwnerSubject), locale, slots), SignedHeaders));
        var speech = AlexaApiHost.Speech(json);

        Assert.Equal(AlexaLanguages.For(locale).Say(new AssistantResult { Code = AssistantResultCode.TemporarilyUnavailable, AsOf = DateTimeOffset.UtcNow }), speech);
        if (locale == "en-US")
        {
            Assert.Equal(EnglishUnavailable, speech);
        }

        Assert.DoesNotContain(BabyName, speech, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Zyrtecish", speech, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await host.Factory.EventsAsync(baby.BabyId));
    }

    [Theory]
    [InlineData("get_last_feed", "{}")]
    [InlineData("log_diaper", """{"kind":"wet"}""")]
    public async Task Mcp_BabyOnAStoreThatCannotBeReached_RefusesTemporarilyUnavailableWithoutNames(string tool, string arguments)
    {
        using var host = new McpApiHost();
        var baby = await SeedBabyOnUnreachableStoreAsync(host.Factory);

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite), McpMessages.Call(tool, arguments));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("temporarily_unavailable", body, StringComparison.Ordinal);
        Assert.DoesNotContain(BabyName, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(baby.BabyId.ToString(), body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("store_", body, StringComparison.Ordinal);
        Assert.Empty(await host.Factory.EventsAsync(baby.BabyId));
    }

    /// <summary>A baby whose pointer names an external store (a <c>data_stores</c> row the server cannot open), with the Owner's opt-in to hear the baby's and medicines' names.</summary>
    private static async Task<UnreachableBaby> SeedBabyOnUnreachableStoreAsync(ApiFactory factory)
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", TestUsers.Now);
        var baby = Baby.Create(BabyName, DateOnly.FromDateTime(TestUsers.Now.UtcDateTime.AddMonths(-2)), owner.Id, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.Add(baby);
            context.UserAssistantSettings.Add(UserAssistantSettings.Create(owner.Id, null, TestUsers.Now, sayBabyName: true, sayMedicineNames: true));
            return Task.CompletedTask;
        });
        await factory.AssignStoreAsync(baby.Id, owner.Id, Guid.NewGuid());
        return new UnreachableBaby(owner.Subject, baby.Id);
    }

    private sealed record UnreachableBaby(string OwnerSubject, Guid BabyId);
}
