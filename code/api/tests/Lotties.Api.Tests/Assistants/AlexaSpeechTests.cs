using Lotties.Api.Assistants.Alexa;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.CryReasons;

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
    public void Say_NextNapWindow_English12HourClock()
    {
        var window = new AssistantTimeWindow(AsOf.AddMinutes(30), AsOf.AddMinutes(60), AsOf.AddMinutes(90));
        var result = Result(AssistantResultCode.NextNapWindow, "America/New_York") with { Estimate = window };

        Assert.Equal("Charlotte's next nap window is probably between 2:45 PM and 3:45 PM.", AlexaLanguages.For("en-US").Say(result));
    }

    [Fact]
    public void Say_NextNapWindow_PortugueseAndAWindowThatHasPassed()
    {
        var ahead = Result(AssistantResultCode.NextNapWindow, "America/Sao_Paulo") with { Estimate = new AssistantTimeWindow(AsOf.AddMinutes(30), AsOf.AddMinutes(60), AsOf.AddMinutes(90)) };
        var passed = ahead with { Estimate = new AssistantTimeWindow(AsOf.AddMinutes(-90), AsOf.AddMinutes(-60), AsOf.AddMinutes(-30)) };

        Assert.Equal("A próxima janela de sono de Charlotte deve ser entre 15:45 e 16:45.", AlexaLanguages.For("pt-BR").Say(ahead));
        Assert.Equal("Charlotte's nap window was between 12:45 PM and 1:45 PM.", AlexaLanguages.For("en-US").Say(passed with { TimeZone = "America/New_York" }));
    }

    [Fact]
    public void Say_NextFeed_WithoutZone_SpeaksRelativeTimes()
    {
        var result = Result(AssistantResultCode.NextFeed, null) with { Estimate = new AssistantTimeWindow(AsOf.AddMinutes(10), AsOf.AddMinutes(40), AsOf.AddMinutes(70)) };

        Assert.Equal("Charlotte's next feed is expected in about 40 minutes.", AlexaLanguages.For("en-US").Say(result));
        Assert.Equal("A próxima mamada de Charlotte é esperada daqui a cerca de 40 minutos.", AlexaLanguages.For("pt-BR").Say(result));
    }

    [Fact]
    public void Say_NextDiaper_TellsWetAndDirty()
    {
        var result = Result(AssistantResultCode.NextDiaper, "America/Sao_Paulo") with
        {
            WetEstimate = new AssistantTimeWindow(AsOf.AddMinutes(10), AsOf.AddMinutes(30), AsOf.AddMinutes(50)),
            DirtyEstimate = new AssistantTimeWindow(AsOf.AddMinutes(60), AsOf.AddMinutes(90), AsOf.AddMinutes(120)),
        };

        Assert.Equal("The next wet diaper is expected around 3:45 PM, usually between 3:25 PM and 4:05 PM. The next dirty diaper is expected around 4:45 PM, usually between 4:15 PM and 5:15 PM.", AlexaLanguages.For("en-US").Say(result));
    }

    [Fact]
    public void Say_BottleAverageAndDiaperAverage_AreFactsInBothLanguages()
    {
        var bottles = Result(AssistantResultCode.BottleAverage, null) with { Count = 5, AmountMl = 120, LastAmountMl = 140 };
        var diapers = Result(AssistantResultCode.DiapersAverage, null) with { Count = 4, PerDay = 6.5, WetPerDay = 4.5, DirtyPerDay = 2 };

        Assert.Equal("Charlotte's last 5 bottles averaged 120 ml, and the last one was 140 ml.", AlexaLanguages.For("en-US").Say(bottles));
        Assert.Equal("As últimas 5 mamadeiras de Charlotte tiveram em média 120 ml, e a última foi de 140 ml.", AlexaLanguages.For("pt-BR").Say(bottles));
        Assert.Equal("Over the last 4 days with diapers, Charlotte used about 6.5 diapers a day: about 4.5 wet and 2 dirty.", AlexaLanguages.For("en-US").Say(diapers));
        Assert.Equal("Nos últimos 4 dias com fraldas, Charlotte usou cerca de 6,5 fraldas por dia: cerca de 4,5 com xixi e 2 com cocô.", AlexaLanguages.For("pt-BR").Say(diapers));
    }

    [Theory]
    [InlineData("en-US", "From what is logged for Charlotte: Hunger looks likely: the last feed was 3 hours and 10 minutes ago, and the usual gap is about 2 hours and 30 minutes. Gas looks possible: belly pain often shows up around 6:30 PM. This is not a diagnosis or medical advice. Call your pediatrician or emergency services if there is a fever (babies under 3 months with a fever need a call right away), crying you cannot soothe, refusing feeds, unusual sleepiness or being hard to wake and a bulging or stiff soft spot on the head.")]
    [InlineData("pt-BR", "Pelo que está registrado de Charlotte: Fome parece provável: a última mamada foi há 3 horas e 10 minutos, e o intervalo habitual é de cerca de 2 horas e 30 minutos. Gases parecem possíveis: a dor de barriga costuma aparecer por volta das 18:30. Isto não é um diagnóstico nem orientação médica. Ligue para o pediatra ou para a emergência se houver febre (bebês com menos de 3 meses com febre precisam de uma ligação na hora), choro que você não consegue acalmar, recusa para mamar ou comer, sonolência fora do comum ou dificuldade para acordar e moleira estufada ou dura.")]
    public void Say_CryReasons_TellsTheTopCausesWithTheirFactsThenAlwaysTheSafetySentence(string locale, string expected)
    {
        var result = Full(AssistantResultCode.CryReasons, "America/Sao_Paulo");

        var spoken = AlexaLanguages.For(locale).Say(result with { TimeZone = "Etc/UTC" });

        Assert.Equal(expected, spoken);
    }

    [Theory]
    [InlineData("en-US", "There isn't enough in the log to point at a cause.", "Call your pediatrician or emergency services if there is a fever")]
    [InlineData("pt-BR", "Não há registros suficientes para apontar uma causa.", "Ligue para o pediatra ou para a emergência se houver febre")]
    public void Say_CryNoData_StillGivesTheSafetySentence(string locale, string cause, string safety)
    {
        var result = Result(AssistantResultCode.CryNoData, null) with { RedFlags = RedFlags };

        var spoken = AlexaLanguages.For(locale).Say(result);

        Assert.StartsWith(cause, spoken, StringComparison.Ordinal);
        Assert.Contains(safety, spoken, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Say_CryAnswers_NeverAdviseARemedyOrADose(string locale)
    {
        var language = AlexaLanguages.For(locale);
        var spoken = new[] { language.Say(Full(AssistantResultCode.CryReasons, "Etc/UTC")), language.Say(Full(AssistantResultCode.CryNoData, null)) };

        Assert.All(spoken, text => Assert.DoesNotMatch(@"(?i)\b(try|tente|dose|mg|ibuprofen|paracetamol|dipirona|rock|embal|swaddle|cueiro)\b", text));
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
        Estimate = new AssistantTimeWindow(AsOf.AddMinutes(20), AsOf.AddMinutes(40), AsOf.AddMinutes(70)),
        WetEstimate = new AssistantTimeWindow(AsOf.AddMinutes(10), AsOf.AddMinutes(30), AsOf.AddMinutes(50)),
        DirtyEstimate = new AssistantTimeWindow(AsOf.AddMinutes(60), AsOf.AddMinutes(90), AsOf.AddMinutes(120)),
        PerDay = 6.5,
        WetPerDay = 4.5,
        DirtyPerDay = 2.5,
        LastAmountMl = 140,
        CryCauses =
        [
            new AssistantCryCause(CryCause.Hunger, CryLevel.Likely, [new CryFact { Kind = "sinceLastFeed", Minutes = 190, UsualGapMinutes = 150 }]),
            new AssistantCryCause(CryCause.Gas, CryLevel.Possible, [new CryFact { Kind = "bellyPattern", TypicalClock = "18:30" }]),
        ],
        RedFlags = RedFlags,
        EntryType = "feeding",
    };

    private static readonly string[] RedFlags = ["fever", "inconsolable", "refusing_feeds", "unusual_sleepiness", "bulging_or_stiff_fontanelle"];

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
