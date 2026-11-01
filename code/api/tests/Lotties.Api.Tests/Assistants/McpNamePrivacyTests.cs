using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using static Lotties.Api.Tests.Assistants.McpProtocolTests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>The MCP server through the SDK client: no baby name in the text or the structured JSON unless the user turned on <c>sayBabyName</c>.</summary>
public sealed class McpNamePrivacyTests(McpApiHost host) : IClassFixture<McpApiHost>
{
    private ApiFactory Factory => host.Factory;

    [Fact]
    public async Task EveryTool_ByDefault_ReturnsNoBabyName_InTextOrStructuredJson()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var seen = await CallEveryToolAsync(client);

        Assert.True(seen.Count >= 20);
        Assert.All(seen, pair => Assert.DoesNotContain("Lia", pair.Value, StringComparison.Ordinal));
        Assert.DoesNotContain(seen, pair => pair.Value.Contains("\"name\"", StringComparison.Ordinal));
        var babies = Structured(await client.CallToolAsync("list_babies", Args())).GetProperty("babies")[0];
        Assert.False(babies.TryGetProperty("name", out _));
        Assert.Equal(baby.BabyId, babies.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task EveryTool_WithSayBabyName_NamesTheBabyAgain()
    {
        var baby = await Factory.SeedBabyAsync();
        var put = await Factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync("/api/v1/me/assistant-settings", new { sayBabyName = true });
        put.EnsureSuccessStatusCode();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var logged = await client.CallToolAsync("log_sleep_start", Args());
        var babies = await client.CallToolAsync("list_babies", Args());

        Assert.Equal("Lia", Structured(logged).GetProperty("baby").GetProperty("name").GetString());
        Assert.Contains("Lia", Text(logged), StringComparison.Ordinal);
        Assert.Equal("Lia", Structured(babies).GetProperty("babies")[0].GetProperty("name").GetString());
    }

    private static async Task<Dictionary<string, string>> CallEveryToolAsync(McpClient client)
    {
        var seen = new Dictionary<string, string>();
        foreach (var tool in new[] { "log_sleep_start", "log_sleep_start", "get_sleep_status", "log_sleep_end", "log_sleep_end", "log_bottle", "log_nursing", "log_diaper", "list_babies", "get_baby_profile", "get_last_feed", "get_diapers_today", "get_next_appointment", "get_due_vaccines", "get_day_summary", "get_week_summary", "get_next_nap_window", "get_next_feed", "get_next_diaper", "get_diapers_average", "get_bottle_average", "get_sleep_today", "get_bottle_today", "get_feeds_today", "get_last_diaper", "get_cry_reasons", "request_delete_last_entry" })
        {
            var arguments = tool switch
            {
                "log_bottle" => Args(("amountMl", 120)),
                "log_nursing" => Args(("side", "left")),
                "log_diaper" => Args(("kind", "wet")),
                _ => Args(),
            };
            var result = await client.CallToolAsync(tool, arguments);
            seen[$"{tool}#{seen.Count}"] = string.Join("\n", result.Content.OfType<TextContentBlock>().Select(block => block.Text)) + Structured(result).GetRawText();
        }

        return seen;
    }
}
