using Lotties.Domain.Clinical;
using Lotties.Domain.Exceptions;
using static Lotties.Domain.Tests.Clinical.ClinicalFixtures;

namespace Lotties.Domain.Tests.Clinical;

public sealed class ClinicalRangeAndWindowTests
{
    [Fact]
    public void Create_ValidRange_KeepsBothEnds()
    {
        var range = ClinicalRange.Create(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 7));

        Assert.Equal((new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 7), 7), (range.From, range.To, range.DayCount));
    }

    [Fact]
    public void Create_SingleDay_IsValid()
    {
        Assert.Equal(1, ClinicalRange.Create(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 1)).DayCount);
    }

    [Fact]
    public void Create_Exactly92Days_IsValid_93IsNot()
    {
        var from = new DateOnly(2026, 1, 1);

        var ok = ClinicalRange.Create(from, from.AddDays(91));
        var error = Assert.Throws<DomainValidationException>(() => ClinicalRange.Create(from, from.AddDays(92)));

        Assert.Equal(92, ok.DayCount);
        Assert.Equal("to", error.Field);
    }

    [Fact]
    public void Create_ToBeforeFrom_ThrowsOnTo()
    {
        var error = Assert.Throws<DomainValidationException>(() => ClinicalRange.Create(new DateOnly(2026, 1, 2), new DateOnly(2026, 1, 1)));

        Assert.Equal("to", error.Field);
    }

    [Fact]
    public void Create_MissingEnds_ThrowOnTheMissingField()
    {
        var day = new DateOnly(2026, 1, 1);

        Assert.Equal("from", Assert.Throws<DomainValidationException>(() => ClinicalRange.Create(null, day)).Field);
        Assert.Equal("to", Assert.Throws<DomainValidationException>(() => ClinicalRange.Create(day, null)).Field);
    }

    [Fact]
    public void Create_YearsOutsideTheSupportedOnes_Throw()
    {
        Assert.Equal("from", Assert.Throws<DomainValidationException>(() => ClinicalRange.Create(new DateOnly(1999, 12, 31), new DateOnly(2026, 1, 1))).Field);
        Assert.Equal("to", Assert.Throws<DomainValidationException>(() => ClinicalRange.Create(new DateOnly(2026, 1, 1), new DateOnly(2101, 1, 1))).Field);
    }

    [Theory]
    [InlineData("2026-03-08", "2026-03-10")]
    [InlineData(" 2026-03-08 ", "2026-03-08")]
    public void Parse_IsoDates_AreRead(string from, string to)
    {
        var range = ClinicalRange.Parse(from, to);

        Assert.Equal(new DateOnly(2026, 3, 8), range.From);
    }

    [Theory]
    [InlineData(null, "2026-03-08", "from")]
    [InlineData("", "2026-03-08", "from")]
    [InlineData("2026-03-08", null, "to")]
    [InlineData("08/03/2026", "2026-03-08", "from")]
    [InlineData("2026-03-08", "2026-3-8x", "to")]
    [InlineData("2026-02-30", "2026-03-08", "from")]
    public void Parse_MissingOrMalformedDates_ThrowOnTheField(string? from, string? to, string field)
    {
        var error = Assert.Throws<DomainValidationException>(() => ClinicalRange.Parse(from, to));

        Assert.Equal(field, error.Field);
    }

    [Fact]
    public void LastDays_EndsWithTheGivenDayAndIncludesIt()
    {
        var range = ClinicalRange.LastDays(new DateOnly(2026, 1, 10), 7);

        Assert.Equal((new DateOnly(2026, 1, 4), new DateOnly(2026, 1, 10)), (range.From, range.To));
    }

    [Fact]
    public void Window_Days_StartAtLocalMidnightAndAreContiguous()
    {
        var window = Window(Brazil, (1, 9), (1, 11), Brazil.Local(1, 10, 12));

        Assert.Equal(3, window.Days.Count);
        Assert.Equal(Brazil.Local(1, 9, 0), window.Days[0].Start);
        Assert.Equal(window.Days[0].End, window.Days[1].Start);
        Assert.Equal(Brazil.Local(1, 12, 0), window.End);
        Assert.All(window.Days, day => Assert.Equal(TimeSpan.FromHours(24), day.End - day.Start));
    }

    [Fact]
    public void Window_TodayIsTheLocalDateOfNow_NotTheUtcDate()
    {
        var lateEvening = Brazil.Local(1, 9, 22);

        var window = Window(Brazil, (1, 9), (1, 10), lateEvening);

        Assert.Equal(new DateOnly(2026, 1, 9), window.Today);
        Assert.Equal(new DateOnly(2026, 1, 10), DateOnly.FromDateTime(lateEvening.UtcDateTime));
    }

    [Fact]
    public void Window_DaylightSavingDays_Are23And25HoursLong()
    {
        var spring = Window(NewYork, (3, 7), (3, 9), NewYork.Local(3, 12, 12));
        var autumn = Window(NewYork, (10, 31), (11, 2), NewYork.Local(11, 5, 12));

        Assert.Equal([24d, 23d, 24d], spring.Days.Select(day => (day.End - day.Start).TotalHours).ToArray());
        Assert.Equal([24d, 25d, 24d], autumn.Days.Select(day => (day.End - day.Start).TotalHours).ToArray());
    }

    [Fact]
    public void Window_At_IsTheLocalWallClockHourOfTheDayShiftedByDays()
    {
        var window = Window(Brazil, (1, 9), (1, 9), Brazil.Local(1, 10, 12));

        Assert.Equal(Brazil.Local(1, 9, 15), window.At(window.Days[0], 15));
        Assert.Equal(Brazil.Local(1, 10, 3), window.At(window.Days[0], 3, dayOffset: 1));
    }

    [Fact]
    public void Day_Contains_StartIncludedEndExcluded()
    {
        var day = Window(Brazil, (1, 9), (1, 9), Brazil.Local(1, 10, 12)).Days[0];

        Assert.Equal((true, true, false, false), (day.Contains(day.Start), day.Contains(day.End.AddTicks(-1)), day.Contains(day.End), day.Contains(day.Start.AddTicks(-1))));
    }
}


public sealed class TimelineRangeTests
{
    private static readonly DateTimeOffset Start = new(2026, 3, 8, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_ValidRange_NormalizesToUtc()
    {
        var range = TimelineRange.Create(new DateTimeOffset(2026, 3, 8, 0, 0, 0, TimeSpan.FromHours(-3)), new DateTimeOffset(2026, 3, 9, 0, 0, 0, TimeSpan.FromHours(-3)));

        Assert.Equal((new DateTimeOffset(2026, 3, 8, 3, 0, 0, TimeSpan.Zero), TimeSpan.Zero), (range.From, range.From.Offset));
        Assert.Equal(new DateTimeOffset(2026, 3, 9, 3, 0, 0, TimeSpan.Zero), range.To);
    }

    [Fact]
    public void Create_ExactlyEightDays_IsValid_MoreIsNot()
    {
        var ok = TimelineRange.Create(Start, Start.AddDays(8));
        var error = Assert.Throws<DomainValidationException>(() => TimelineRange.Create(Start, Start.AddDays(8).AddSeconds(1)));

        Assert.Equal(Start.AddDays(8), ok.To);
        Assert.Equal("to", error.Field);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3600)]
    public void Create_ToNotAfterFrom_ThrowsOnTo(int secondsAfterFrom)
    {
        var error = Assert.Throws<DomainValidationException>(() => TimelineRange.Create(Start, Start.AddSeconds(secondsAfterFrom)));

        Assert.Equal("to", error.Field);
    }

    [Fact]
    public void Create_MissingBounds_ThrowOnTheMissingField()
    {
        Assert.Equal("from", Assert.Throws<DomainValidationException>(() => TimelineRange.Create(null, Start)).Field);
        Assert.Equal("to", Assert.Throws<DomainValidationException>(() => TimelineRange.Create(Start, null)).Field);
    }
}
