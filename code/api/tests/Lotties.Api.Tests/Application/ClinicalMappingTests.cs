using Lotties.Application.Clinical;
using Lotties.Domain.Clinical;
using Lotties.Domain.Vaccinations;

namespace Lotties.Api.Tests.Application;

/// <summary>How the doctor's views round the domain summaries: whole minutes, one decimal for the per-day averages, <c>HH:mm</c> clock times.</summary>
public sealed class ClinicalMappingTests
{
    [Theory]
    [InlineData(0d, 0)]
    [InlineData(29_999d, 0)]
    [InlineData(30_000d, 1)]
    [InlineData(89_999d, 1)]
    [InlineData(90_000d, 2)]
    [InlineData(3_600_000d, 60)]
    public void Minutes_RoundHalfUpToWholeMinutes(double milliseconds, int expected)
    {
        Assert.Equal(expected, ClinicalRounding.Minutes(milliseconds));
        Assert.Equal(expected, ClinicalRounding.Minutes((double?)milliseconds));
    }

    [Fact]
    public void Minutes_NoValue_IsNull()
    {
        Assert.Null(ClinicalRounding.Minutes((double?)null));
    }

    [Theory]
    [InlineData(2.95, 3.0)]
    [InlineData(3.333333, 3.3)]
    [InlineData(3.35, 3.4)]
    [InlineData(0.05, 0.1)]
    [InlineData(0.04, 0.0)]
    [InlineData(135d, 135.0)]
    public void OneDecimal_RoundsHalfUpWithoutBinaryNoise(double value, double expected)
    {
        Assert.Equal(expected, ClinicalRounding.OneDecimal(value));
    }

    [Fact]
    public void OneDecimal_NoValue_IsNull()
    {
        Assert.Null(ClinicalRounding.OneDecimal((double?)null));
    }

    [Theory]
    [InlineData(0, 0, "00:00")]
    [InlineData(6, 5, "06:05")]
    [InlineData(23, 59, "23:59")]
    public void Clock_IsHoursAndMinutesWithTwoDigits(int hour, int minute, string expected)
    {
        Assert.Equal(expected, ClinicalRounding.Clock(new TimeOnly(hour, minute)));
        Assert.Null(ClinicalRounding.Clock((TimeOnly?)null));
    }

    [Fact]
    public void SleepSection_FromASummary_RoundsEachNumberItsOwnWay()
    {
        var day = new SleepDaySummary(new DateOnly(2026, 1, 9), NightMs: 90_000, NapMs: 29_999, Naps: 2, LongestMs: 3_600_000);
        var summary = new SleepSummary([day], 90_000, 30_000, 1.25, 1, 4_500_000, new DateTimeOffset(2026, 1, 9, 21, 0, 0, TimeSpan.Zero), new TimeOnly(21, 0), null);

        SleepSectionResponse section = summary;

        var mapped = Assert.Single(section.Days);
        Assert.Equal((2, 0, 2, 2, 60), (mapped.NightMinutes, mapped.NapMinutes, mapped.TotalMinutes, mapped.Naps, mapped.LongestMinutes));
        Assert.Equal((2, 2, 1, 1.3, 75), (section.AverageNightMinutes, section.AverageTotalMinutes, section.AverageNapMinutes, section.NapsPerDay, section.LongestStretchMinutes));
        Assert.Equal(("21:00", null), (section.BedtimeMedian, section.WakeMedian));
    }

    [Fact]
    public void SleepSection_WithoutCountedDays_HasNullAverages()
    {
        var summary = new SleepSummary([], null, null, null, 0, null, null, null, null);

        SleepSectionResponse section = summary;

        Assert.Equal((null, null, null, null, null, 0), (section.AverageTotalMinutes, section.AverageNightMinutes, section.NapsPerDay, section.LongestStretchMinutes, section.BedtimeMedian, section.DaysCounted));
    }

    [Fact]
    public void FeedingSection_FromASummary_RoundsMlAndTheIntervalInMinutes()
    {
        var day = new FeedingDaySummary(new DateOnly(2026, 1, 9), 3, 210.04, 1, 2, 0);
        var summary = new FeedingSummary([day], 3.333, 18_900_000, 135.25, 1, 2, 0, [new FormulaUsage(null, "Nan", 2, 30.06)]);

        FeedingSectionResponse section = summary;

        Assert.Equal((3.3, 315, 135.3), (section.FeedsPerDay, section.AverageIntervalMinutes, section.BottleMlPerDay));
        Assert.Equal(210.0, section.Days[0].BottleMl);
        Assert.Equal(("Nan", 30.1), (section.Formulas[0].Name, section.Formulas[0].Ml));
    }

    [Theory]
    [InlineData(DoseState.Due, "due")]
    [InlineData(DoseState.Overdue, "overdue")]
    public void DueDose_StateIsALowerCaseWord(DoseState state, string expected)
    {
        var names = new LocalizedText(new Dictionary<string, string> { ["en"] = "BCG", ["pt-BR"] = "BCG" });
        var label = new LocalizedText(new Dictionary<string, string> { ["en"] = "Single dose", ["pt-BR"] = "Dose unica" });

        DueDoseResponse response = new DueDose("bcg-1", "bcg", names, label, state, new DateOnly(2026, 1, 10));

        Assert.Equal((expected, "bcg-1", "bcg", "2026-01-10"), (response.State, response.DoseId, response.VaccineKey, response.DueOn.ToString("yyyy-MM-dd")));
        Assert.Equal("Dose unica", response.DoseLabel["pt-BR"]);
        Assert.Equal("BCG", response.VaccineNames["en"]);
    }
}
