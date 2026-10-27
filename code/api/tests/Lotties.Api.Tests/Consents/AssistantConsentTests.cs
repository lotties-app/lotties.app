using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Consents;
using ModelContextProtocol.Protocol;
using static Lotties.Api.Tests.Assistants.AlexaRequests;

namespace Lotties.Api.Tests.Consents;

/// <summary>
/// The adapters do not read the gate (they are not API routes): the command layer answers a person without a current core consent with
/// <c>consent_required</c>, which Alexa speaks ("open the Lotties app to accept the terms", en and pt-BR) and MCP returns as a tool
/// error (docs/design/38-consent-and-terms.md section 2, decision 4). Nothing is read or written meanwhile.
/// </summary>
public sealed class AssistantConsentTests
{
    private static readonly string Current = ConsentVersions.Current.Version;

    [Theory]
    [InlineData("en-US", "Before Lotties can use your baby's information, please open the Lotties app and accept the terms of use. Then try again.")]
    [InlineData("pt-BR", "Antes de o Lotties usar as informações do bebê, abra o app Lotties e aceite os termos de uso. Depois tente de novo.")]
    public async Task Alexa_WithoutConsent_SaysToOpenTheApp_LogsNothing_AndWorksAfterAccepting(string locale, string spoken)
    {
        using var host = new AlexaApiHost();
        host.Factory.GrantConsentToNewUsers = false;
        var baby = await host.Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);

        var refused = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStartIntent", token, locale), SignedHeaders));
        var read = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("LastFeedIntent", token, locale), SignedHeaders));

        Assert.Equal(spoken, AlexaApiHost.Speech(refused));
        Assert.Equal(spoken, AlexaApiHost.Speech(read));
        Assert.Empty(await host.Factory.EventsAsync(baby.BabyId));

        await host.Factory.CreateClientFor(baby.OwnerSubject, issuer: AlexaApiHost.Issuer).PutAsJsonAsync("/api/v1/me/consents/core", new { version = Current, capacity = "guardian" }).Ok();
        var accepted = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("SleepStartIntent", token, locale), SignedHeaders));

        Assert.NotEqual(spoken, AlexaApiHost.Speech(accepted));
        Assert.Single(await host.Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Mcp_WithoutConsent_ReturnsAConsentRequiredToolError_ForReadsAndWrites()
    {
        using var host = new McpApiHost();
        host.Factory.GrantConsentToNewUsers = false;
        var baby = await host.Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var list = await client.CallToolAsync("list_babies", new Dictionary<string, object?>());
        var write = await client.CallToolAsync("log_diaper", new Dictionary<string, object?> { ["kind"] = "wet" });

        foreach (var result in new[] { list, write })
        {
            Assert.True(result.IsError);
            Assert.Equal("consent_required", result.StructuredContent!.Value.GetProperty("code").GetString());
            Assert.Contains("open the Lotties app", ((TextContentBlock)result.Content[0]).Text, StringComparison.Ordinal);
        }

        Assert.Empty(await host.Factory.EventsAsync(baby.BabyId));
        await host.Factory.CreateClientFor(baby.OwnerSubject, issuer: McpApiHost.Issuer).PutAsJsonAsync("/api/v1/me/consents/core", new { version = Current, capacity = "guardian" }).Ok();
        var after = await client.CallToolAsync("list_babies", new Dictionary<string, object?>());
        Assert.NotEqual(true, after.IsError);
    }

    [Fact]
    public async Task CommandLayer_WithoutConsent_AnswersConsentRequiredToEveryCommandKind()
    {
        using var factory = new ApiFactory { GrantConsentToNewUsers = false };
        var baby = await factory.SeedBabyAsync();

        var read = await factory.RunAsAsync(baby.OwnerSubject, service => service.ReadLastFeedAsync(AssistantTestKit.Invocation()));
        var write = await factory.RunAsAsync(baby.OwnerSubject, service => service.LogDiaperAsync(AssistantTestKit.Invocation(), Lotties.Domain.Assistants.DiaperKind.Wet));
        var babies = await factory.RunAsAsync(baby.OwnerSubject, service => service.ListBabiesAsync(AssistantTestKit.Invocation()));

        Assert.All(new[] { read, write, babies }, result => Assert.Equal(AssistantResultCode.ConsentRequired, result.Code));
        Assert.Equal("consent_required", AssistantResult.CodeName(AssistantResultCode.ConsentRequired));
        Assert.Empty(babies.Babies);
        Assert.Null(read.Baby);
    }
}
