using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Units;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// Measurement units in the command layer and the spoken answers (docs/design/37-measurement-units.md): a bottle amount said
/// in ounces or ml, read in the user's resolved system when no unit is said, converted to whole ml with the shared rule,
/// limited after conversion, idempotent; and the unit words of both languages.
/// </summary>
public sealed class AssistantUnitsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<(SeededBaby Baby, string Subject)> BabyWithSettingAsync(string? system)
    {
        var baby = await factory.SeedBabyAsync();
        if (system is not null)
        {
            (await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync("/api/v1/me/unit-settings", new { system })).EnsureSuccessStatusCode();
        }

        return (baby, baby.OwnerSubject);
    }

    private async Task<int> StoredMlAsync(Guid babyId)
    {
        var stored = Assert.Single(await factory.EventsAsync(babyId));
        return JsonDocument.Parse(stored.Payload.Value).RootElement.GetProperty("amount_ml").GetInt32();
    }

    [Theory]
    [InlineData("metric", 4, VolumeUnit.FluidOunces, 118)]
    [InlineData("us", 4, VolumeUnit.FluidOunces, 118)]
    [InlineData("us", 120, VolumeUnit.Milliliters, 120)]
    [InlineData("us", 4.5, VolumeUnit.FluidOunces, 133)]
    [InlineData("auto", 8, VolumeUnit.FluidOunces, 237)]
    [InlineData("metric", 120.4, VolumeUnit.Milliliters, 120)]
    public async Task LogBottleVolume_ExplicitUnit_StoresWholeMl(string system, double amount, VolumeUnit unit, int expectedMl)
    {
        var (baby, subject) = await BabyWithSettingAsync(system);

        var result = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(Invocation(), (decimal)amount, unit, BottleKind.Unspecified));

        Assert.Equal((AssistantResultCode.BottleLogged, expectedMl), (result.Code, result.AmountMl));
        Assert.Equal(expectedMl, await StoredMlAsync(baby.BabyId));
    }

    [Theory]
    [InlineData("us", null, 4, 118)]
    [InlineData("metric", null, 120, 120)]
    [InlineData("auto", "en-US", 4, 118)]
    [InlineData("auto", "pt-BR", 120, 120)]
    [InlineData("auto", "en-GB", 120, 120)]
    [InlineData("auto", null, 120, 120)]
    [InlineData(null, "en-US", 4, 118)]
    [InlineData("metric", "en-US", 120, 120)]
    [InlineData("us", "pt-BR", 4, 118)]
    public async Task LogBottleVolume_NoUnit_IsReadInTheResolvedSystem(string? system, string? locale, double amount, int expectedMl)
    {
        var (baby, subject) = await BabyWithSettingAsync(system);

        var result = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(Invocation(locale: locale), (decimal)amount, null, BottleKind.Unspecified));

        Assert.Equal(expectedMl, result.AmountMl);
        Assert.Equal(expectedMl, await StoredMlAsync(baby.BabyId));
    }

    [Theory]
    [InlineData("us", "en-US", UnitSystem.Us)]
    [InlineData("metric", "en-US", UnitSystem.Metric)]
    [InlineData("auto", "en-US", UnitSystem.Us)]
    [InlineData("auto", "pt-BR", UnitSystem.Metric)]
    [InlineData("auto", null, UnitSystem.Metric)]
    public async Task Results_CarryTheResolvedUnitSystem(string system, string? locale, UnitSystem expected)
    {
        var (_, subject) = await BabyWithSettingAsync(system);

        var result = await factory.RunAsAsync(subject, assistant => assistant.ReadBottleAverageAsync(Invocation(locale: locale)));

        Assert.Equal(expected, result.Units);
    }

    [Theory]
    [InlineData(16.9, true)]
    [InlineData(17, false)]
    [InlineData(0.01, false)]
    [InlineData(0, false)]
    public async Task LogBottleVolume_LimitsApplyAfterConversion(double ounces, bool accepted)
    {
        var (baby, subject) = await BabyWithSettingAsync("us");

        var result = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(Invocation(), (decimal)ounces, VolumeUnit.FluidOunces, BottleKind.Unspecified));

        Assert.Equal(accepted ? AssistantResultCode.BottleLogged : AssistantResultCode.InvalidAmount, result.Code);
        Assert.Equal(accepted ? 1 : 0, (await factory.EventsAsync(baby.BabyId)).Count);
        if (!accepted)
        {
            Assert.Equal((1, 500, UnitSystem.Us), (result.Min, result.Max, result.Units));
        }
    }

    [Fact]
    public async Task LogBottleVolume_NoAmountOrAHugeOne_IsInvalidAndWritesNothing()
    {
        var (baby, subject) = await BabyWithSettingAsync("us");

        var none = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(Invocation(), null, null, BottleKind.Unspecified));
        var huge = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(Invocation(), decimal.MaxValue, VolumeUnit.FluidOunces, BottleKind.Unspecified));

        Assert.All([none, huge], result => Assert.Equal(AssistantResultCode.InvalidAmount, result.Code));
        Assert.Empty(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task LogBottleVolume_SameRequestId_IsOneEventWhateverTheUnit()
    {
        var (baby, subject) = await BabyWithSettingAsync("us");
        var invocation = Invocation("same-request");

        var first = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(invocation, 4, VolumeUnit.FluidOunces, BottleKind.Formula));
        var retry = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(invocation, 4, VolumeUnit.FluidOunces, BottleKind.Formula));

        Assert.Equal((118, 118), (first.AmountMl, retry.AmountMl));
        Assert.Single(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task LogBottleVolume_IsTheSameEventIdAsTheMlCommand()
    {
        var (baby, subject) = await BabyWithSettingAsync("metric");
        var invocation = Invocation("shared-request");

        await factory.RunAsAsync(subject, assistant => assistant.LogBottleAsync(invocation, 118, BottleKind.Unspecified));
        var replay = await factory.RunAsAsync(subject, assistant => assistant.LogBottleVolumeAsync(invocation, 4, VolumeUnit.FluidOunces, BottleKind.Unspecified));

        Assert.Equal(AssistantResultCode.BottleLogged, replay.Code);
        Assert.Single(await factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public void ResultJson_NeverCarriesTheUnitHint()
    {
        var json = JsonSerializer.Serialize(new AssistantResult { Code = AssistantResultCode.BottleLogged, AsOf = DateTimeOffset.UnixEpoch, AmountMl = 118, Units = UnitSystem.Us });

        Assert.DoesNotContain("units", json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("\"AmountMl\":118", json, StringComparison.Ordinal);
    }

    private static readonly DateTimeOffset Instant = new(2026, 10, 23, 18, 15, 0, TimeSpan.Zero);

    private static AssistantResult Bottle(UnitSystem units, AssistantResultCode code) => new()
    {
        Code = code,
        AsOf = Instant,
        Baby = new AssistantBaby(Guid.NewGuid(), "Lia"),
        At = Instant,
        AmountMl = 118,
        LastAmountMl = 150,
        Count = 5,
        FeedMethod = FeedMethod.Bottle,
        Min = 1,
        Max = 500,
        Units = units,
    };

    [Theory]
    [InlineData("en-US", UnitSystem.Us, "Logged a 4 ounce bottle just now for Lia.")]
    [InlineData("en-US", UnitSystem.Metric, "Logged a 118 ml bottle just now for Lia.")]
    [InlineData("pt-BR", UnitSystem.Us, "Registrei uma mamadeira de 4 onças")]
    [InlineData("pt-BR", UnitSystem.Metric, "Registrei uma mamadeira de 118 ml")]
    public void Say_BottleLogged_UsesTheUnitSystem(string locale, UnitSystem units, string expectedStart) =>
        Assert.StartsWith(expectedStart, AlexaLanguages.For(locale).Say(Bottle(units, AssistantResultCode.BottleLogged)), StringComparison.Ordinal);

    [Theory]
    [InlineData("en-US", UnitSystem.Us, "Lia's last 5 bottles averaged 4 ounces, and the last one was 5.1 ounces.")]
    [InlineData("en-US", UnitSystem.Metric, "Lia's last 5 bottles averaged 118 ml, and the last one was 150 ml.")]
    [InlineData("pt-BR", UnitSystem.Us, "As últimas 5 mamadeiras de Lia tiveram em média 4 onças, e a última foi de 5,1 onças.")]
    [InlineData("pt-BR", UnitSystem.Metric, "As últimas 5 mamadeiras de Lia tiveram em média 118 ml, e a última foi de 150 ml.")]
    public void Say_BottleAverage_UsesTheUnitSystem(string locale, UnitSystem units, string expected) =>
        Assert.Equal(expected, AlexaLanguages.For(locale).Say(Bottle(units, AssistantResultCode.BottleAverage)));

    [Theory]
    [InlineData("en-US", UnitSystem.Us, "Lia's last feed was a 4 ounce bottle")]
    [InlineData("en-US", UnitSystem.Metric, "Lia's last feed was a 118 ml bottle")]
    [InlineData("pt-BR", UnitSystem.Us, "A última alimentação de Lia foi uma mamadeira de 4 onças")]
    [InlineData("pt-BR", UnitSystem.Metric, "A última alimentação de Lia foi uma mamadeira de 118 ml")]
    public void Say_LastFeed_UsesTheUnitSystem(string locale, UnitSystem units, string expectedStart) =>
        Assert.StartsWith(expectedStart, AlexaLanguages.For(locale).Say(Bottle(units, AssistantResultCode.LastFeed)), StringComparison.Ordinal);

    [Theory]
    [InlineData("en-US", UnitSystem.Us, "Please say an amount up to 16.9 ounces, for example: log a 4 ounce bottle.")]
    [InlineData("en-US", UnitSystem.Metric, "Please say an amount from 1 to 500 ml, for example: log a 120 ml bottle.")]
    [InlineData("pt-BR", UnitSystem.Us, "Diga uma quantidade de até 16,9 onças, por exemplo: registrar mamadeira de 4 onças.")]
    [InlineData("pt-BR", UnitSystem.Metric, "Diga uma quantidade de 1 a 500 ml, por exemplo: registrar mamadeira de 120 ml.")]
    public void Say_InvalidAmount_TellsTheLimitInTheUnitSystem(string locale, UnitSystem units, string expected) =>
        Assert.Equal(expected, AlexaLanguages.For(locale).Say(Bottle(units, AssistantResultCode.InvalidAmount)));

    [Theory]
    [InlineData("en-US", UnitSystem.Us, 30, "a 1 ounce bottle")]
    [InlineData("en-US", UnitSystem.Us, 15, "a 0.5 ounce bottle")]
    [InlineData("pt-BR", UnitSystem.Us, 30, "mamadeira de 1 onça")]
    [InlineData("pt-BR", UnitSystem.Us, 44, "mamadeira de 1,5 onça")]
    [InlineData("pt-BR", UnitSystem.Us, 120, "mamadeira de 4,1 onças")]
    public void Say_BottleLogged_Singulars(string locale, UnitSystem units, int ml, string expected) =>
        Assert.Contains(expected, AlexaLanguages.For(locale).Say(Bottle(units, AssistantResultCode.BottleLogged) with { AmountMl = ml }), StringComparison.Ordinal);

    [Fact]
    public void Say_BottleTotalsInADaySummary_FollowTheUnitSystem()
    {
        var day = new AssistantDaySummary(
            new DateOnly(2026, 10, 22),
            true,
            new Lotties.Application.Clinical.SleepDayResponse(),
            new Lotties.Application.Clinical.FeedingDayResponse { BottleMl = 236, Feeds = 3 },
            new Lotties.Application.Clinical.DiaperDayResponse());
        var result = Bottle(UnitSystem.Us, AssistantResultCode.DaySummary) with { Days = [day] };

        Assert.Contains("with 8 ounces in bottles", AlexaLanguages.For("en-US").Say(result), StringComparison.Ordinal);
        Assert.Contains("236 ml in bottles", AlexaLanguages.For("en-US").Say(result with { Units = UnitSystem.Metric }), StringComparison.Ordinal);
        Assert.Contains("8 onças em mamadeiras", AlexaLanguages.For("pt-BR").Say(result), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("en", UnitSystem.Us, 3.2, "7 pounds 1 ounce")]
    [InlineData("en", UnitSystem.Us, 0.3, "11 ounces")]
    [InlineData("en", UnitSystem.Us, 0.454, "1 pound")]
    [InlineData("en", UnitSystem.Metric, 3.2, "3.2 kilograms")]
    [InlineData("pt", UnitSystem.Us, 3.2, "7 libras e 1 onça")]
    [InlineData("pt", UnitSystem.Metric, 3.2, "3,2 quilos")]
    public void SpokenMeasures_Weight(string language, UnitSystem units, double kg, string expected) =>
        Assert.Equal(expected, Measures(language).Weight((decimal)kg, units));

    [Theory]
    [InlineData("en", UnitSystem.Us, 50, "19.7 inches")]
    [InlineData("en", UnitSystem.Metric, 50, "50 centimeters")]
    [InlineData("pt", UnitSystem.Us, 33.5, "13,2 polegadas")]
    [InlineData("pt", UnitSystem.Metric, 50, "50 centímetros")]
    public void SpokenMeasures_Length(string language, UnitSystem units, double cm, string expected) =>
        Assert.Equal(expected, Measures(language).Length((decimal)cm, units));

    [Theory]
    [InlineData("en", UnitSystem.Metric, 38, "38 degrees")]
    [InlineData("en", UnitSystem.Us, 38, "100.4 degrees")]
    [InlineData("pt", UnitSystem.Metric, 38, "38 graus")]
    [InlineData("pt", UnitSystem.Us, 37, "98,6 graus")]
    public void SpokenMeasures_Temperature(string language, UnitSystem units, double celsius, string expected) =>
        Assert.Equal(expected, Measures(language).Temperature((decimal)celsius, units));

    private static SpokenMeasures Measures(string language) => language == "en"
        ? new(CultureInfo.GetCultureInfo("en-US"), new SpokenUnitWords("ml", new("ounce", "ounces"), new("pound", "pounds"), new("kilogram", "kilograms"), new("centimeter", "centimeters"), new("inch", "inches"), new("degree", "degrees"), string.Empty), value => value == 1)
        : new(CultureInfo.GetCultureInfo("pt-BR"), new SpokenUnitWords("ml", new("onça", "onças"), new("libra", "libras"), new("quilo", "quilos"), new("centímetro", "centímetros"), new("polegada", "polegadas"), new("grau", "graus"), "e"), value => value < 2);
}
