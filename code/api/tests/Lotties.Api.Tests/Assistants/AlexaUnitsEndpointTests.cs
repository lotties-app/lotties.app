using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using static Lotties.Api.Tests.Assistants.AlexaRequests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The Alexa bottle intent with decimals and the <c>volumeUnit</c> slot, and the unit system of the spoken answer
/// (docs/design/37-measurement-units.md section 6): the stored setting wins, <c>auto</c> follows the request locale.
/// </summary>
public sealed class AlexaUnitsEndpointTests(AlexaApiHost host) : IClassFixture<AlexaApiHost>
{
    private ApiFactory Factory => host.Factory;

    private async Task<SeededBaby> BabyAsync(string? system)
    {
        var baby = await Factory.SeedBabyAsync();
        if (system is not null)
        {
            (await Factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync("/api/v1/me/unit-settings", new { system })).EnsureSuccessStatusCode();
        }

        return baby;
    }

    private async Task<string> SayAsync(SeededBaby baby, string locale, object slots)
    {
        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("BottleIntent", host.TokenFor(baby.OwnerSubject), locale, slots), SignedHeaders));
        return AlexaApiHost.Speech(json);
    }

    private async Task<int> StoredMlAsync(SeededBaby baby)
    {
        var stored = Assert.Single(await Factory.EventsAsync(baby.BabyId));
        return JsonDocument.Parse(stored.Payload.Value).RootElement.GetProperty("amount_ml").GetInt32();
    }

    [Fact]
    public async Task Bottle_ResolvedOunces_IsStoredAsMlAndConfirmedInTheUsersMetricSystem()
    {
        var baby = await BabyAsync("metric");

        var speech = await SayAsync(baby, "en-US", new { amount = Slot("amount", "4"), volumeUnit = ResolvedSlot("volumeUnit", "ounces", "OZ") });

        Assert.StartsWith("Logged a 118 ml bottle", speech, StringComparison.Ordinal);
        Assert.Equal(118, await StoredMlAsync(baby));
    }

    [Fact]
    public async Task Bottle_ResolvedMilliliters_IsConfirmedInOuncesForAUsPerson()
    {
        var baby = await BabyAsync("us");

        var speech = await SayAsync(baby, "en-US", new { amount = Slot("amount", "120"), volumeUnit = ResolvedSlot("volumeUnit", "ml", "ML") });

        Assert.StartsWith("Logged a 4.1 ounce bottle", speech, StringComparison.Ordinal);
        Assert.Equal(120, await StoredMlAsync(baby));
    }

    [Fact]
    public async Task Bottle_DecimalAmountInOunces_IsRoundedToWholeMl()
    {
        var baby = await BabyAsync("us");

        var speech = await SayAsync(baby, "pt-BR", new { amount = Slot("amount", "4.5"), volumeUnit = Slot("volumeUnit", "onças") });

        Assert.StartsWith("Registrei uma mamadeira de 4,5 onças", speech, StringComparison.Ordinal);
        Assert.Equal(133, await StoredMlAsync(baby));
    }

    [Theory]
    [InlineData(null, "en-US", 4, 118, "Logged a 4 ounce bottle")]
    [InlineData(null, "pt-BR", 120, 120, "Registrei uma mamadeira de 120 ml")]
    [InlineData("metric", "en-US", 120, 120, "Logged a 120 ml bottle")]
    [InlineData("us", "pt-BR", 4, 118, "Registrei uma mamadeira de 4 onças")]
    [InlineData("auto", "en-US", 4, 118, "Logged a 4 ounce bottle")]
    public async Task Bottle_NoUnitSaid_IsReadInTheResolvedSystem(string? system, string locale, double amount, int expectedMl, string expectedStart)
    {
        var baby = await BabyAsync(system);

        var speech = await SayAsync(baby, locale, new { amount = Slot("amount", amount.ToString(System.Globalization.CultureInfo.InvariantCulture)) });

        Assert.StartsWith(expectedStart, speech, StringComparison.Ordinal);
        Assert.Equal(expectedMl, await StoredMlAsync(baby));
    }

    [Fact]
    public async Task Bottle_OunceOverTheLimit_AsksAgainInOunces_AndWritesNothing()
    {
        var baby = await BabyAsync("us");

        var speech = await SayAsync(baby, "en-US", new { amount = Slot("amount", "20"), volumeUnit = Slot("volumeUnit", "oz") });

        Assert.Equal("Please say an amount up to 16.9 ounces, for example: log a 4 ounce bottle.", speech);
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Bottle_SpokenUnitWithoutResolution_IsMatchedBySynonym()
    {
        var baby = await BabyAsync("metric");

        await SayAsync(baby, "en-US", new { amount = Slot("amount", "2"), volumeUnit = Slot("volumeUnit", "Ounces") });

        Assert.Equal(59, await StoredMlAsync(baby));
    }

    [Fact]
    public async Task Bottle_RetryOfTheSameRequest_LogsOnce()
    {
        var baby = await BabyAsync("us");
        var body = Intent("BottleIntent", host.TokenFor(baby.OwnerSubject), "en-US", new { amount = Slot("amount", "4"), volumeUnit = Slot("volumeUnit", "oz") }, NewRequestId());

        await host.PostAsync(body, SignedHeaders);
        await host.PostAsync(body, SignedHeaders);

        Assert.Equal(118, await StoredMlAsync(baby));
    }

    [Fact]
    public async Task LastFeed_IsToldInTheUsersSystem()
    {
        var baby = await BabyAsync("us");
        await host.PostAsync(Intent("BottleIntent", host.TokenFor(baby.OwnerSubject), "en-US", new { amount = Slot("amount", "4"), volumeUnit = Slot("volumeUnit", "oz") }), SignedHeaders);

        var json = await AlexaApiHost.ReadAsync(await host.PostAsync(Intent("LastFeedIntent", host.TokenFor(baby.OwnerSubject), "pt-BR"), SignedHeaders));

        Assert.StartsWith("A última alimentação de Lia foi uma mamadeira de 4 onças", AlexaApiHost.Speech(json), StringComparison.Ordinal);
    }
}
