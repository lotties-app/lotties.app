using BabyRoutine.Domain.Predictions;

namespace BabyRoutine.Domain.Tests.Predictions;

public sealed class PredictionRulesTests
{
    private static readonly DateOnly BirthDate = new(2025, 1, 15);

    [Theory]
    [InlineData("2025-01-01", AgeBand.UnderThreeMonths)]
    [InlineData("2025-04-14", AgeBand.UnderThreeMonths)]
    [InlineData("2025-04-15", AgeBand.ThreeToSixMonths)]
    [InlineData("2025-07-14", AgeBand.ThreeToSixMonths)]
    [InlineData("2025-07-15", AgeBand.SixToTwelveMonths)]
    [InlineData("2026-01-14", AgeBand.SixToTwelveMonths)]
    [InlineData("2026-01-15", AgeBand.TwelveMonthsPlus)]
    public void AgeBandsAt_CompletedMonths_PicksBand(string date, AgeBand expected)
    {
        Assert.Equal(expected, AgeBands.At(BirthDate, DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture)));
    }

    [Theory]
    [InlineData(AgeBand.UnderThreeMonths, "0-3m")]
    [InlineData(AgeBand.ThreeToSixMonths, "3-6m")]
    [InlineData(AgeBand.SixToTwelveMonths, "6-12m")]
    [InlineData(AgeBand.TwelveMonthsPlus, "12m+")]
    public void AgeBandsLabel_EachBand_IsShortLabel(AgeBand band, string expected)
    {
        Assert.Equal(expected, AgeBands.Label(band));
    }

    [Theory]
    [InlineData(21, 59, DayPhase.Day)]
    [InlineData(22, 0, DayPhase.Night)]
    [InlineData(9, 59, DayPhase.Night)]
    [InlineData(10, 0, DayPhase.Day)]
    public void DayPhasesOf_UtcInstant_UsesLocalOffset(int utcHour, int utcMinute, DayPhase expected)
    {
        var instant = new DateTimeOffset(2026, 1, 10, utcHour, utcMinute, 0, TimeSpan.Zero);

        Assert.Equal(expected, DayPhases.Of(instant, TimeSpan.FromHours(-3), PredictionOptions.Default));
    }

    [Theory]
    [InlineData(190, "3h 10m")]
    [InlineData(45, "45m")]
    [InlineData(120, "2h")]
    [InlineData(0, "0m")]
    [InlineData(59.5, "1h")]
    public void DurationText_Minutes_IsCompact(double minutes, string expected)
    {
        Assert.Equal(expected, PredictionReason.DurationText(TimeSpan.FromMinutes(minutes)));
    }

    [Fact]
    public void ReasonText_StartIntervalWithQualifiersAndDuration_ListsAllParts()
    {
        var reason = new PredictionReason(
            PredictionBasis.StartInterval,
            new TimeSpan(3, 10, 0),
            42,
            TimeSpan.FromDays(14),
            AgeBand.ThreeToSixMonths,
            DayPhase.Night,
            new DurationEstimate(TimeSpan.FromMinutes(25), 40),
            AssumesEventInProgressEnds: false);

        Assert.Equal(
            "Median every 3h 10m over the last 14 days (night, age 3-6m), 42 samples. Typical duration 25m (40 samples).",
            reason.Text);
    }

    [Fact]
    public void ReasonText_AwakeWindowInProgressWithoutQualifiers_MentionsExpectedEnd()
    {
        var reason = new PredictionReason(
            PredictionBasis.AwakeWindow,
            TimeSpan.FromMinutes(90),
            12,
            TimeSpan.FromDays(14),
            AgeBand: null,
            Phase: null,
            TypicalDuration: null,
            AssumesEventInProgressEnds: true);

        Assert.Equal(
            "Median awake window 1h 30m after the last wake over the last 14 days, 12 samples. Measured from the expected end of the one in progress.",
            reason.Text);
    }
}
