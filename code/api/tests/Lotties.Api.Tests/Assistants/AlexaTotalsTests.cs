using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Units;
using static Lotties.Api.Tests.Assistants.AlexaRequests;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// "How much did she drink today" and "how many feeds today" (<c>BottleTodayIntent</c>, <c>FeedsTodayIntent</c>): the
/// command results, the spoken answers in both languages and both unit systems, and the interaction models (a question
/// never lands in a write intent).
/// </summary>
public sealed class AlexaTotalsTests(AlexaApiHost host) : IClassFixture<AlexaApiHost>
{
    private static DateTimeOffset Now => DateTimeOffset.UtcNow;

    private ApiFactory Factory => host.Factory;

    private async Task<SeededBaby> BabyWithAFeedingDayAsync(string? unitSystem = null)
    {
        var baby = await Factory.SeedBabyAsync();
        if (unitSystem is not null)
        {
            (await Factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync("/api/v1/me/unit-settings", new { system = unitSystem })).EnsureSuccessStatusCode();
        }

        var feeding = BuiltInEventTypes.FeedingId;
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, feeding, Now.AddMinutes(-50), Now.AddMinutes(-50), """{"method":"bottle","amount_ml":120,"amount_drunk_ml":90,"bottle_feeding_type":"formula"}""");
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, feeding, Now.AddMinutes(-40), Now.AddMinutes(-40), """{"method":"bottle","amount_ml":100,"bottle_feeding_type":"breast_milk"}""");
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, feeding, Now.AddMinutes(-30), Now.AddMinutes(-20), """{"method":"breast","side":"left"}""");
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, feeding, Now.AddDays(-3), Now.AddDays(-3), """{"method":"bottle","amount_ml":200}""");
        return baby;
    }

    private async Task<string> SayAsync(SeededBaby baby, string intent, string locale = "en-US") =>
        AlexaApiHost.Speech(await AlexaApiHost.ReadAsync(await host.PostAsync(Intent(intent, host.TokenFor(baby.OwnerSubject), locale), SignedHeaders)));

    private static string Ounces(int ml) => UnitConversions.MlToFluidOunces(ml).ToString("0.#", CultureInfo.InvariantCulture);

    [Fact]
    public async Task ReadBottleToday_SumsTheDrunkAmountAndSplitsFormulaFromBreastMilk()
    {
        var baby = await BabyWithAFeedingDayAsync();

        var result = await Factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadBottleTodayAsync(Invocation()));

        Assert.Equal((AssistantResultCode.BottleToday, AssistantDayWindow.LastDay, 2, 190), (result.Code, result.Window!.Value, result.Count!.Value, result.AmountMl!.Value));
        Assert.Equal((1, 90, 1, 100), (result.FormulaBottles!.Bottles, result.FormulaBottles.Ml, result.BreastMilkBottles!.Bottles, result.BreastMilkBottles.Ml));
    }

    [Fact]
    public async Task ReadFeedsToday_CountsBottlesAndBreast_AndLeavesOlderFeedsOut()
    {
        var baby = await BabyWithAFeedingDayAsync();

        var result = await Factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadFeedsTodayAsync(Invocation(fallbackZone: "Etc/UTC")));

        Assert.Equal(AssistantResultCode.FeedsToday, result.Code);
        Assert.Equal(AssistantDayWindow.Today, result.Window);
        Assert.InRange(result.Count!.Value, 0, 3);
        Assert.Equal(result.Count, result.BottleFeeds + result.BreastFeeds + result.SolidFeeds);
    }

    [Fact]
    public async Task Reads_NothingLogged_AreZeroNotMissing()
    {
        var baby = await Factory.SeedBabyAsync();

        var bottles = await Factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadBottleTodayAsync(Invocation()));
        var feeds = await Factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadFeedsTodayAsync(Invocation()));

        Assert.Equal((AssistantResultCode.BottleToday, 0, 0), (bottles.Code, bottles.Count!.Value, bottles.AmountMl!.Value));
        Assert.Equal((AssistantResultCode.FeedsToday, 0), (feeds.Code, feeds.Count!.Value));
    }

    [Theory]
    [InlineData("BottleTodayIntent", "en-US", "The baby has had no bottles in the last 24 hours.")]
    [InlineData("FeedsTodayIntent", "en-US", "The baby has had no feeds in the last 24 hours.")]
    [InlineData("BottleTodayIntent", "pt-BR", "O bebê não tomou nenhuma mamadeira hoje.")]
    [InlineData("FeedsTodayIntent", "pt-BR", "O bebê não teve nenhuma alimentação hoje.")]
    public async Task Post_WithoutData_SaysSo(string intent, string locale, string expected)
    {
        var baby = await Factory.SeedBabyAsync();

        Assert.Equal(expected, await SayAsync(baby, intent, locale));
    }

    [Fact]
    public async Task Post_BottleToday_English_Metric()
    {
        var baby = await BabyWithAFeedingDayAsync("metric");

        Assert.Equal("The baby drank 190 ml in 2 bottles in the last 24 hours: 1 of formula, 90 ml, and 1 of breast milk, 100 ml.", await SayAsync(baby, "BottleTodayIntent"));
    }

    [Fact]
    public async Task Post_BottleToday_English_UsesOuncesForAUsPerson()
    {
        var baby = await BabyWithAFeedingDayAsync("us");

        Assert.Equal(
            $"The baby drank {Ounces(190)} ounces in 2 bottles in the last 24 hours: 1 of formula, {Ounces(90)} ounces, and 1 of breast milk, {Ounces(100)} ounces.",
            await SayAsync(baby, "BottleTodayIntent"));
    }

    [Fact]
    public async Task Post_BottleToday_Portuguese_FollowsTheStoredUnit()
    {
        var metric = await BabyWithAFeedingDayAsync("metric");
        var us = await BabyWithAFeedingDayAsync("us");

        Assert.StartsWith("O bebê tomou 190 ml em 2 mamadeiras", await SayAsync(metric, "BottleTodayIntent", "pt-BR"), StringComparison.Ordinal);
        Assert.StartsWith($"O bebê tomou {Ounces(190).Replace('.', ',')} onças em 2 mamadeiras", await SayAsync(us, "BottleTodayIntent", "pt-BR"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Post_FeedsToday_SpeaksTheBottleAndBreastSplit_InBothLanguages()
    {
        var baby = await BabyWithAFeedingDayAsync();

        Assert.Equal("The baby has had 3 feeds in the last 24 hours: 2 bottles and 1 nursing session.", await SayAsync(baby, "FeedsTodayIntent"));
        Assert.Equal("O bebê teve 3 alimentações hoje: 2 mamadeiras e 1 mamada no peito.", await SayAsync(baby, "FeedsTodayIntent", "pt-BR"));
    }

    [Fact]
    public async Task Post_BottleToday_OnlyBreastMilk_HasNoSplitSentence()
    {
        var baby = await Factory.SeedBabyAsync();
        (await Factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync("/api/v1/me/unit-settings", new { system = "metric" })).EnsureSuccessStatusCode();
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.FeedingId, Now.AddMinutes(-5), Now.AddMinutes(-5), """{"method":"bottle","amount_ml":80,"bottle_feeding_type":"breast_milk"}""");

        Assert.Equal("The baby drank 80 ml in 1 bottle in the last 24 hours.", await SayAsync(baby, "BottleTodayIntent"));
    }

    // The interaction models: a question can never match a write intent.

    private static readonly string[] Locales = ["en-US", "pt-BR"];

    private static List<(string Intent, string[] Samples, string[] Slots)> Intents(string locale)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "alexa", $"interaction-model.{locale}.json")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        using var model = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory.FullName, "alexa", $"interaction-model.{locale}.json")));
        return model.RootElement.GetProperty("interactionModel").GetProperty("languageModel").GetProperty("intents").EnumerateArray()
            .Select(intent => (
                intent.GetProperty("name").GetString()!,
                intent.TryGetProperty("samples", out var samples) ? samples.EnumerateArray().Select(sample => sample.GetString()!).ToArray() : [],
                intent.TryGetProperty("slots", out var slots) ? slots.EnumerateArray().Select(slot => slot.GetProperty("name").GetString()!).ToArray() : []))
            .ToList();
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_NewQuestionIntents_AreKnownHaveSamplesAndNoSlots(string locale)
    {
        var intents = Intents(locale);

        foreach (var name in new[] { "BottleTodayIntent", "FeedsTodayIntent" })
        {
            var intent = Assert.Single(intents, candidate => candidate.Intent == name);
            Assert.InRange(intent.Samples.Length, 6, 12);
            Assert.Empty(intent.Slots);
            Assert.Contains(name, AlexaSkill.KnownIntents);
        }
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_NoSampleIsInTwoIntents_AndSlotNamesAreUnique(string locale)
    {
        var intents = Intents(locale);

        var samples = intents.SelectMany(intent => intent.Samples.Select(sample => (intent.Intent, Sample: sample.ToLowerInvariant()))).ToList();
        Assert.Empty(samples.GroupBy(entry => entry.Sample).Where(group => group.Count() > 1).Select(group => group.Key));
        var slots = intents.SelectMany(intent => intent.Slots).ToList();
        Assert.Equal(slots.Count, slots.Distinct(StringComparer.Ordinal).Count());
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_BottleAndNursingSamples_NeverLookLikeAQuestion(string locale)
    {
        var questionStarts = new[] { "how ", "what ", "when ", "why ", "quanto", "quanta", "quando", "qual ", "por que", "quantos", "quantas" };

        foreach (var write in Intents(locale).Where(intent => intent.Intent is "BottleIntent" or "NursingIntent"))
        {
            Assert.All(write.Samples, sample =>
            {
                Assert.DoesNotContain(questionStarts, start => sample.StartsWith(start, StringComparison.OrdinalIgnoreCase));
                Assert.DoesNotContain("hoje", sample, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("today", sample, StringComparison.OrdinalIgnoreCase);
            });
        }
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_TheQuestionSamplesAreTheNewIntentsAlone(string locale)
    {
        var intents = Intents(locale);
        var others = intents.Where(intent => intent.Intent is not ("BottleTodayIntent" or "FeedsTodayIntent")).SelectMany(intent => intent.Samples).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var sample in intents.Where(intent => intent.Intent is "BottleTodayIntent" or "FeedsTodayIntent").SelectMany(intent => intent.Samples))
        {
            Assert.DoesNotContain(sample, others);
        }

        Assert.Contains(locale == "en-US" ? "how many bottles today" : "quantos mls de mamadeira tomou hoje", intents.SelectMany(intent => intent.Samples), StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Post_AlreadySleeping_NeverSaysSinceAgo()
    {
        var baby = await Factory.SeedBabyAsync();
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, Now.AddHours(-6), null, """{"kind":"nap"}""");

        var english = await SayAsync(baby, "SleepStartIntent");
        var portuguese = await SayAsync(baby, "SleepStartIntent", "pt-BR");

        Assert.Matches(@"^The baby is already sleeping for \d+ hours?( and \d+ minutes?)?\.$", english);
        Assert.Matches(@"^O bebê já está dormindo desde \d{2}:\d{2}\.$", portuguese);
    }
}
