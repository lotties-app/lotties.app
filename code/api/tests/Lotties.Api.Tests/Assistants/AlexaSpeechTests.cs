using Lotties.Api.Assistants.Alexa;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;

namespace Lotties.Api.Tests.Assistants;

/// <summary>The skill's two languages: every result code and prompt rendered in en-US and pt-BR, clock and relative times, SSML escaping.</summary>
public sealed class AlexaSpeechTests
{
    private static readonly DateTimeOffset AsOf = new(2026, 10, 23, 18, 15, 0, TimeSpan.Zero);

    public static TheoryData<string, AssistantResultCode, bool> EveryCodeInEveryLanguage()
    {
        var cases = new TheoryData<string, AssistantResultCode, bool>();
        foreach (var locale in new[] { "en-US", "pt-BR" })
        {
            foreach (var code in Enum.GetValues<AssistantResultCode>())
            {
                cases.Add(locale, code, true);
                cases.Add(locale, code, false);
            }
        }

        return cases;
    }

    [Theory]
    [MemberData(nameof(EveryCodeInEveryLanguage))]
    public void Say_EveryResultCode_IsOneFinishedSentenceWithoutPlaceholders(string locale, AssistantResultCode code, bool withZone)
    {
        var text = AlexaLanguages.For(locale).Say(Full(code, withZone ? "America/Sao_Paulo" : null));

        Assert.False(string.IsNullOrWhiteSpace(text));
        Assert.DoesNotContain("{", text, StringComparison.Ordinal);
        Assert.DoesNotContain("  ", text, StringComparison.Ordinal);
        Assert.True(text.EndsWith('.') || text.EndsWith('?'), text);
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Say_EveryPrompt_HasText(string locale)
    {
        var language = AlexaLanguages.For(locale);

        Assert.All(Enum.GetValues<AlexaPrompt>(), prompt => Assert.False(string.IsNullOrWhiteSpace(language.Say(prompt).Text)));
    }

    [Theory]
    [InlineData("en-US", "en-US")]
    [InlineData("en-GB", "en-US")]
    [InlineData("pt-BR", "pt-BR")]
    [InlineData("pt-PT", "pt-BR")]
    [InlineData("de-DE", "en-US")]
    [InlineData(null, "en-US")]
    public void For_Locale_PicksTheLanguage(string? locale, string expected)
    {
        Assert.Equal(expected, AlexaLanguages.For(locale).Locale);
    }

    [Fact]
    public void Say_Bottle_English12HourClock()
    {
        var result = Result(AssistantResultCode.BottleLogged, "America/New_York") with { At = AsOf, AmountMl = 120, BottleKind = BottleKind.Unspecified };

        Assert.Equal("Logged a 120 ml bottle at 2:15 PM for Charlotte.", AlexaLanguages.For("en-US").Say(result));
    }

    [Fact]
    public void Say_Bottle_Portuguese24HourClockAndFormulaName()
    {
        var result = Result(AssistantResultCode.BottleLogged, "America/Sao_Paulo") with { At = AsOf, AmountMl = 120, BottleKind = BottleKind.Formula, FormulaName = "Nan 1" };

        Assert.Equal("Registrei uma mamadeira de 120 ml de Nan 1 às 15:15 para Charlotte.", AlexaLanguages.For("pt-BR").Say(result));
    }

    [Fact]
    public void Say_WithoutZone_SpeaksRelativeTimes()
    {
        var result = Result(AssistantResultCode.LastFeed, null) with { At = AsOf.AddMinutes(-80), FeedMethod = FeedMethod.Breast, Side = BreastSide.Left, Running = false };

        Assert.Equal("Charlotte's last feed was nursing on the left side, 1 hour and 20 minutes ago.", AlexaLanguages.For("en-US").Say(result));
        Assert.Equal("A última alimentação de Charlotte foi amamentação no peito esquerdo, há 1 hora e 20 minutos.", AlexaLanguages.For("pt-BR").Say(result));
    }

    [Fact]
    public void Say_SleepEnded_Portuguese()
    {
        var result = Result(AssistantResultCode.SleepEnded, "America/Sao_Paulo") with { At = AsOf, Minutes = 125 };

        Assert.Equal("Charlotte acordou às 15:15, depois de dormir 2 horas e 5 minutos.", AlexaLanguages.For("pt-BR").Say(result));
    }

    [Fact]
    public void Say_OneOClockInPortuguese_UsesTheSingularArticle()
    {
        var result = Result(AssistantResultCode.SleepStarted, "Etc/UTC") with { At = new DateTimeOffset(2026, 10, 23, 1, 5, 0, TimeSpan.Zero) };

        Assert.Equal("Certo. Charlotte dormiu à 01:05.", AlexaLanguages.For("pt-BR").Say(result));
    }

    [Fact]
    public void Say_NextAppointment_DaysAndClock()
    {
        var tomorrow = Result(AssistantResultCode.NextAppointment, "America/Sao_Paulo") with { Appointment = new AssistantAppointment(AsOf.AddDays(1), "Pediatra", "consultation") };
        var later = Result(AssistantResultCode.NextAppointment, "America/Sao_Paulo") with { Appointment = new AssistantAppointment(AsOf.AddDays(3), "Pediatra", "consultation") };

        Assert.Equal("A próxima consulta de Charlotte é Pediatra, amanhã às 15:15.", AlexaLanguages.For("pt-BR").Say(tomorrow));
        Assert.Equal("Charlotte's next appointment is Pediatra, on Monday, October 26 at 3:15 PM.", AlexaLanguages.For("en-US").Say(later));
    }

    [Fact]
    public void Say_VaccinesDue_NamesInTheLanguage()
    {
        var doses = new[]
        {
            new AssistantVaccineDose("bcg", new Dictionary<string, string> { ["en"] = "BCG", ["pt-BR"] = "BCG" }, new Dictionary<string, string>(), false, new DateOnly(2026, 10, 1)),
            new AssistantVaccineDose("hepb", new Dictionary<string, string> { ["en"] = "Hepatitis B", ["pt-BR"] = "Hepatite B" }, new Dictionary<string, string>(), true, new DateOnly(2026, 9, 1)),
        };
        var result = Result(AssistantResultCode.VaccinesDue, null) with { Count = 2, Overdue = 1, Vaccines = doses };

        Assert.Equal("Pelo calendário de vacinas, Charlotte tem 2 doses pendentes, 1 atrasada: BCG e Hepatite B. Você pode vê-las no app.", AlexaLanguages.For("pt-BR").Say(result));
        Assert.Equal("By the vaccine schedule, Charlotte has 2 vaccine doses due, 1 of them overdue: BCG and Hepatitis B. You can see them in the app.", AlexaLanguages.For("en-US").Say(result));
    }

    [Fact]
    public void Ssml_EscapesTheFamilysText()
    {
        Assert.Equal("<speak>Logged for &lt;Ana &amp; &quot;Bia&quot;&gt;.</speak>", Ssml.Speak("Logged for <Ana & \"Bia\">."));
    }

    private static AssistantResult Result(AssistantResultCode code, string? zone) =>
        new() { Code = code, AsOf = AsOf, Baby = new AssistantBaby(Guid.NewGuid(), "Charlotte"), TimeZone = zone };

    /// <summary>A result with every fact set, so every template finds what it reads.</summary>
    private static AssistantResult Full(AssistantResultCode code, string? zone) => Result(code, zone) with
    {
        At = AsOf.AddMinutes(-45),
        EndedAt = AsOf.AddMinutes(-30),
        Minutes = 75,
        Running = false,
        AmountMl = 120,
        BottleKind = BottleKind.Formula,
        FormulaName = "Nan 1",
        FeedMethod = FeedMethod.Bottle,
        Side = BreastSide.Right,
        Diaper = DiaperKind.Both,
        Count = 3,
        Wet = 2,
        Dirty = 1,
        Overdue = 1,
        Min = AssistantLimits.BottleMinMl,
        Max = AssistantLimits.BottleMaxMl,
        Window = AssistantDayWindow.Today,
        Appointment = new AssistantAppointment(AsOf.AddDays(5), "Pediatra", "consultation"),
        Vaccines = [new AssistantVaccineDose("bcg", new Dictionary<string, string> { ["en"] = "BCG", ["pt-BR"] = "BCG" }, new Dictionary<string, string>(), true, new DateOnly(2026, 10, 1))],
        Babies = [new AssistantBabyAccess(Guid.NewGuid(), "Lia", "parent", true, true), new AssistantBabyAccess(Guid.NewGuid(), "Theo", "viewer", false, false)],
        Age = new AssistantBabyAge(97, 13, 3),
        Days = [Day(new DateOnly(2026, 10, 22), complete: true), Day(new DateOnly(2026, 10, 23), complete: false)],
        EarliestDate = new DateOnly(2025, 10, 23),
        LatestDate = new DateOnly(2026, 10, 23),
    };

    private static AssistantDaySummary Day(DateOnly date, bool complete) => new(
        date,
        complete,
        new Lotties.Application.Clinical.SleepDayResponse { Date = date, TotalMinutes = 600, NightMinutes = 480, NapMinutes = 120, Naps = 2, LongestMinutes = 300 },
        new Lotties.Application.Clinical.FeedingDayResponse { Date = date, Feeds = 7, BottleMl = 360, Breast = 4, Bottle = 3, Solid = 0 },
        new Lotties.Application.Clinical.DiaperDayResponse { Date = date, Total = 6, Wet = 5, Dirty = 2 });

    [Theory]
    [InlineData("en-US", "On October 22, Charlotte slept 10 hours with 2 naps, had 7 feeds with 360 ml in bottles, and 6 diapers.")]
    [InlineData("pt-BR", "Em 22 de outubro, Charlotte dormiu 10 horas com 2 sonecas, teve 7 alimentações, 360 ml em mamadeiras e 6 fraldas.")]
    public void Say_DaySummary_TellsTheDayTotals(string locale, string expected)
    {
        var result = Result(AssistantResultCode.DaySummary, "America/Sao_Paulo") with { Days = [Day(new DateOnly(2026, 10, 22), complete: true)] };

        Assert.Equal(expected, AlexaLanguages.For(locale).Say(result));
    }
}
