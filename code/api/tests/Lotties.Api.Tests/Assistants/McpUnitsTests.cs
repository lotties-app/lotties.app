using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using static Lotties.Api.Tests.Assistants.McpProtocolTests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The MCP <c>log_bottle</c> tool with <c>amount</c> and <c>unit</c>, and the text part following the unit setting while the
/// structured values stay canonical metric (docs/design/37-measurement-units.md section 6).
/// </summary>
public sealed class McpUnitsTests(McpApiHost host) : IClassFixture<McpApiHost>
{
    private ApiFactory Factory => host.Factory;

    private async Task<(SeededBaby Baby, McpClient Client)> StartAsync(string? system)
    {
        var baby = await Factory.SeedBabyAsync();
        if (system is not null)
        {
            (await Factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync("/api/v1/me/unit-settings", new { system })).EnsureSuccessStatusCode();
        }

        return (baby, await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite)));
    }

    [Fact]
    public async Task LogBottle_AmountInOunces_IsStoredInMlAndStructuredStaysMetric()
    {
        var (baby, client) = await StartAsync("us");
        await using var session = client;

        var logged = await client.CallToolAsync("log_bottle", Args(("amount", 4.5), ("unit", "oz")));

        Assert.NotEqual(true, logged.IsError);
        Assert.Equal(("bottle_logged", 133), (Code(logged), Structured(logged).GetProperty("amountMl").GetInt32()));
        Assert.False(Structured(logged).TryGetProperty("units", out _));
        Assert.Contains("4.5 fl oz bottle", Text(logged), StringComparison.Ordinal);
        var stored = Assert.Single(await Factory.EventsAsync(baby.BabyId));
        Assert.Equal(133, JsonDocument.Parse(stored.Payload.Value).RootElement.GetProperty("amount_ml").GetInt32());
    }

    [Theory]
    [InlineData("us")]
    [InlineData("metric")]
    [InlineData("auto")]
    public async Task LogBottle_AmountMl_IsAlwaysMlWhateverTheSetting_AndTheTextFollowsTheSetting(string system)
    {
        var (_, client) = await StartAsync(system);
        await using var session = client;

        var withAmountMl = await client.CallToolAsync("log_bottle", Args(("amountMl", 120)));
        var withAmountAndMl = await client.CallToolAsync("log_bottle", Args(("amount", 90), ("unit", "ml")));
        var withAmountOnly = await client.CallToolAsync("log_bottle", Args(("amount", 60)));

        Assert.Equal([120, 90, 60], new[] { withAmountMl, withAmountAndMl, withAmountOnly }.Select(result => Structured(result).GetProperty("amountMl").GetInt32()));
        var expected = system == "us" ? "4.1 fl oz" : "120 ml";
        Assert.Contains(expected, Text(withAmountMl), StringComparison.Ordinal);
    }

    [Fact]
    public async Task GetBottleAverage_TextFollowsTheSetting_StructuredStaysMl()
    {
        var (baby, client) = await StartAsync("us");
        await using var session = client;
        foreach (var ml in new[] { 100, 110, 120 })
        {
            await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, Lotties.Domain.EventTypes.BuiltInEventTypes.FeedingId, DateTimeOffset.UtcNow.AddHours(-ml / 10), null, $$"""{"method":"bottle","amount_ml":{{ml}}}""");
        }

        var average = await client.CallToolAsync("get_bottle_average", Args());

        Assert.Equal(("bottle_average", 110), (Code(average), Structured(average).GetProperty("amountMl").GetInt32()));
        Assert.Contains("3.7 fl oz", Text(average), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"amountMl":120,"amount":4}""", "amountMl")]
    [InlineData("""{}""", "amountMl")]
    [InlineData("""{"unit":"oz"}""", "amountMl")]
    [InlineData("""{"amountMl":120,"unit":"oz"}""", "unit")]
    [InlineData("""{"amount":4,"unit":"cups"}""", "unit")]
    [InlineData("""{"amount":0}""", "amount")]
    [InlineData("""{"amount":-1,"unit":"oz"}""", "amount")]
    [InlineData("""{"amount":"4","unit":"oz"}""", "amount")]
    public async Task LogBottle_ArgumentCombinations_AreCheckedStrictly(string arguments, string field)
    {
        var (baby, client) = await StartAsync("us");
        await using var session = client;

        var result = await client.CallToolAsync(new CallToolRequestParams { Name = "log_bottle", Arguments = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(arguments) });

        Assert.True(result.IsError);
        Assert.Equal(("invalid_arguments", field), (Code(result), Structured(result).GetProperty("field").GetString()));
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Theory]
    [InlineData(17, "oz")]
    [InlineData(501, "ml")]
    public async Task LogBottle_OutOfRangeAfterConversion_IsInvalidAmount(double amount, string unit)
    {
        var (baby, client) = await StartAsync("us");
        await using var session = client;

        var result = await client.CallToolAsync("log_bottle", Args(("amount", amount), ("unit", unit)));

        Assert.True(result.IsError);
        Assert.Equal("invalid_amount", Code(result));
        Assert.Contains("500 ml", Text(result), StringComparison.Ordinal);
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task LogBottle_Schema_OffersAmountMlAmountAndUnit()
    {
        var (_, client) = await StartAsync(null);
        await using var session = client;

        var tool = (await client.ListToolsAsync()).Single(candidate => candidate.Name == "log_bottle").ProtocolTool;

        var properties = tool.InputSchema.GetProperty("properties");
        Assert.Equal("integer", properties.GetProperty("amountMl").GetProperty("type").GetString());
        Assert.Equal("number", properties.GetProperty("amount").GetProperty("type").GetString());
        Assert.Equal(["ml", "oz"], properties.GetProperty("unit").GetProperty("enum").EnumerateArray().Select(value => value.GetString()));
        Assert.False(tool.InputSchema.TryGetProperty("required", out var required) && required.EnumerateArray().Any(name => name.GetString() == "amountMl"));
    }
}
