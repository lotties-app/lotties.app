using Lotties.Domain.Patterns;

namespace Lotties.Domain.Tests.Patterns;

public sealed class RecurringTimeOfDayPatternTests
{
    private static readonly DateOnly Today = new(2026, 10, 21);

    /// <summary>A local time <paramref name="daysAgo"/> days before <see cref="Today"/>.</summary>
    private static DateTime At(int daysAgo, int hour, int minute = 0) => Today.AddDays(-daysAgo).ToDateTime(new TimeOnly(hour, minute));

    private static TimeOfDayPattern? Detect(IEnumerable<DateTime> times, RecurringTimeOfDayOptions? options = null) =>
        RecurringTimeOfDayPattern.Detect(times, Today, options);

    [Fact]
    public void Detect_TightClusterOnFiveOfSevenDays_ReturnsTheUsualWindow()
    {
        var times = new[] { At(0, 18, 0), At(1, 18, 10), At(2, 17, 50), At(4, 18, 5), At(6, 17, 55) };

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times));

        Assert.Equal(new TimeOnly(18, 0), pattern.Typical);
        Assert.Equal((new TimeOnly(17, 30), new TimeOnly(18, 30)), (pattern.WindowStart, pattern.WindowEnd));
        Assert.Equal(TimeSpan.FromHours(1), pattern.Width);
        Assert.True(pattern.Spread <= TimeSpan.FromMinutes(8), $"spread {pattern.Spread}");
        Assert.Equal(5, pattern.Days.Count);
        Assert.Equal((5, 5), (pattern.EventDayCount, pattern.RecentDayCount));
        Assert.Equal(PatternConfidence.Low, pattern.Confidence);
        Assert.Equal(Today.AddDays(-6), pattern.Days[0].Date);
        Assert.Equal([new TimeOnly(17, 55)], pattern.Days[0].Times);
        Assert.Equal(Today, pattern.Days[^1].Date);
        Assert.Equal([new TimeOnly(18, 0)], pattern.Days[^1].Times);
    }

    [Fact]
    public void Detect_NoisyTimes_ReturnsNoPattern()
    {
        var times = new[] { At(0, 3, 10), At(1, 9, 0), At(2, 14, 20), At(3, 20, 0), At(4, 23, 30), At(5, 11, 0), At(6, 17, 0), At(8, 6, 45) };

        Assert.Null(Detect(times));
    }

    [Fact]
    public void Detect_SpreadOverFortyFiveMinutes_ReturnsNoPattern()
    {
        var times = new[] { At(0, 16, 40), At(1, 17, 20), At(2, 18, 0), At(3, 18, 40), At(4, 19, 20), At(5, 18, 0) };

        Assert.Null(Detect(times));
    }

    [Fact]
    public void Detect_AroundMidnight_WrapsOnTheCircleAndCountsEachNightOnce()
    {
        var times = new[]
        {
            At(6, 23, 50),
            At(4, 0, 10),
            At(4, 23, 45),
            At(2, 0, 5),
            At(2, 23, 55),
            At(1, 23, 50),
            At(0, 0, 15),
        };

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times));

        Assert.True(pattern.Typical >= new TimeOnly(23, 55) || pattern.Typical <= new TimeOnly(0, 1), $"typical {pattern.Typical}");
        Assert.True(pattern.WindowStart > pattern.WindowEnd, $"window {pattern.WindowStart}-{pattern.WindowEnd}");
        Assert.Equal(TimeSpan.FromHours(1), pattern.Width);
        Assert.Equal(6, pattern.Days.Count);
        Assert.Contains(pattern.Days, day => day.Date == Today.AddDays(-1) && day.Times.SequenceEqual([new TimeOnly(23, 50), new TimeOnly(0, 15)]));
    }

    [Fact]
    public void WindowStartingOn_WindowAcrossMidnight_EndsOnTheNextDate()
    {
        var pattern = new TimeOfDayPattern(new TimeOnly(0, 0), new TimeOnly(23, 30), new TimeOnly(0, 30), TimeSpan.Zero, PatternConfidence.Low, [], 0, 0);

        var window = pattern.WindowStartingOn(new DateOnly(2026, 10, 5));

        Assert.Equal(new PatternWindow(new DateTime(2026, 10, 5, 23, 30, 0), new DateTime(2026, 10, 6, 0, 30, 0)), window);
    }

    [Fact]
    public void Detect_ThreeRecentDays_ReturnsNoPatternEvenWithOlderSupport()
    {
        var older = Enumerable.Range(7, 7).Select(daysAgo => At(daysAgo, 18, 0));
        var recent = new[] { At(0, 18, 0), At(1, 18, 0), At(2, 18, 0) };

        Assert.Null(Detect(older.Concat(recent)));
    }

    [Fact]
    public void Detect_FourRecentDaysInsideTheWindow_IsEnough()
    {
        var times = new[] { At(0, 18, 0), At(2, 18, 0), At(4, 18, 0), At(6, 18, 0) };

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times));

        Assert.Equal(4, pattern.RecentDayCount);
    }

    [Fact]
    public void Detect_EventsOlderThanTheLookBackOrAfterToday_AreIgnored()
    {
        var times = new[] { At(0, 18, 0), At(2, 18, 0), At(4, 18, 0), At(14, 18, 0), At(-1, 18, 0) };

        Assert.Null(Detect(times));
    }

    [Fact]
    public void Detect_LessThanSixtyPercentOfEventDaysInsideTheWindow_ReturnsNoPattern()
    {
        var inside = new[] { At(0, 18, 0), At(1, 18, 5), At(2, 17, 55), At(3, 18, 0) };
        var outside = new[] { At(8, 9, 0), At(9, 12, 0), At(10, 6, 0), At(11, 14, 0) };

        Assert.Null(Detect(inside.Concat(outside)));
    }

    [Fact]
    public void Detect_SeveralEventsOnOneDay_CountTheDayOnce()
    {
        var times = Enumerable.Range(0, 5)
            .SelectMany(daysAgo => new[] { At(daysAgo, 18, 0), At(daysAgo, 18, 10), At(daysAgo, 18, 20), At(daysAgo, 9, 0) })
            .ToArray();

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times));

        Assert.Equal(5, pattern.Days.Count);
        Assert.Equal(5, pattern.EventDayCount);
        Assert.All(pattern.Days, day => Assert.Equal([new TimeOnly(18, 0), new TimeOnly(18, 10), new TimeOnly(18, 20)], day.Times));
        Assert.Equal(new TimeOnly(18, 10), pattern.Typical);
    }

    [Fact]
    public void Detect_SpreadAboveThirtyMinutes_WidensTheWindowToOneStandardDeviation()
    {
        var times = new[] { At(0, 17, 20), At(1, 18, 40), At(2, 17, 20), At(3, 18, 40), At(4, 17, 20), At(5, 18, 40) };

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times));

        Assert.Equal(new TimeOnly(18, 0), pattern.Typical);
        Assert.Equal(TimeSpan.FromMinutes(40), pattern.Spread);
        Assert.Equal((new TimeOnly(17, 20), new TimeOnly(18, 40)), (pattern.WindowStart, pattern.WindowEnd));
    }

    [Fact]
    public void Detect_WideSpreadAllowedByOptions_ClampsTheWindowToThreeHours()
    {
        var options = new RecurringTimeOfDayOptions
        {
            ClusterRadius = TimeSpan.FromHours(4),
            MaximumSpread = TimeSpan.FromHours(4),
            MinimumCoverage = 0,
            MinimumRecentDays = 1,
        };
        var times = new[] { At(0, 16, 0), At(1, 20, 0), At(2, 17, 0), At(3, 19, 0), At(4, 16, 0), At(5, 20, 0) };

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times, options));

        Assert.True(pattern.Spread > TimeSpan.FromMinutes(90), $"spread {pattern.Spread}");
        Assert.Equal(TimeSpan.FromHours(3), pattern.Width);
        Assert.Equal((new TimeOnly(16, 30), new TimeOnly(19, 30)), (pattern.WindowStart, pattern.WindowEnd));
    }

    [Theory]
    [InlineData(5, 0, PatternConfidence.Low)]
    [InlineData(6, 0, PatternConfidence.Medium)]
    [InlineData(8, 0, PatternConfidence.High)]
    [InlineData(8, 35, PatternConfidence.Medium)]
    public void Detect_Confidence_ComesFromDaysAndSpread(int days, int swingMinutes, PatternConfidence expected)
    {
        var times = Enumerable.Range(0, days).Select(daysAgo => At(daysAgo, 18, 0).AddMinutes(daysAgo % 2 == 0 ? -swingMinutes : swingMinutes));

        var pattern = Assert.IsType<TimeOfDayPattern>(Detect(times));

        Assert.Equal(expected, pattern.Confidence);
    }

    [Fact]
    public void Detect_OrderOfInput_DoesNotMatter()
    {
        var times = new[] { At(0, 18, 0), At(1, 18, 10), At(2, 17, 50), At(4, 18, 5), At(6, 17, 55), At(3, 9, 0) };

        var forward = Detect(times);
        var backward = Detect(Enumerable.Reverse(times));

        Assert.Equal(forward!.Typical, backward!.Typical);
        Assert.Equal(forward.Days.Select(day => day.Date), backward.Days.Select(day => day.Date));
    }

    [Fact]
    public void Detect_NoEvents_ReturnsNoPattern()
    {
        Assert.Null(Detect([]));
    }
}
