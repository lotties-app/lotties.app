using Lotties.Domain.Common;

namespace Lotties.Domain.Tests.Common;

/// <summary><see cref="IsoWeekLabel"/>: the ISO week-year and week of the UTC instant, two-digit week, also across 1 January.</summary>
public sealed class IsoWeekLabelTests
{
    [Theory]
    [InlineData("2026-11-26T12:00:00Z", "2026-W48")]
    [InlineData("2026-01-05T00:00:00Z", "2026-W02")]
    [InlineData("2026-01-01T00:00:00Z", "2026-W01")] // a Thursday: week 1 of its own year
    [InlineData("2025-12-29T00:00:00Z", "2026-W01")] // Monday of 2026-W01, still in calendar year 2025
    [InlineData("2027-01-01T03:30:00Z", "2026-W53")] // calendar 2027, ISO week-year 2026 (which has 53 weeks)
    [InlineData("2027-01-03T23:59:59Z", "2026-W53")]
    [InlineData("2027-01-04T00:00:00Z", "2027-W01")]
    [InlineData("2024-12-30T00:00:00Z", "2025-W01")]
    [InlineData("2021-01-03T12:00:00Z", "2020-W53")]
    public void Of_GivesTheIsoWeekYearAndWeek(string instant, string expected) =>
        Assert.Equal(expected, IsoWeekLabel.Of(DateTimeOffset.Parse(instant, System.Globalization.CultureInfo.InvariantCulture)));

    [Fact]
    public void Of_TakesTheWeekInUtc_NotInTheOffsetOfTheInstant()
    {
        // Sunday 2027-01-03 23:00 in Brasilia is Monday 2027-01-04 02:00 UTC.
        var instant = new DateTimeOffset(2027, 1, 3, 23, 0, 0, TimeSpan.FromHours(-3));

        Assert.Equal("2027-W01", IsoWeekLabel.Of(instant));
    }
}
