using System.Globalization;
using Lotties.Domain.Rest;

namespace Lotties.Domain.Tests.Rest;

/// <summary>
/// The rest history of docs/design/41-caregiver-rest.md "History": per-night estimates from <see cref="RestEstimator"/>, the
/// work-overlap flag, the weekday/weekend summary with its 4-night minimum and the typical night. The window ends on Sunday
/// 2026-11-08, so 14 nights hold 10 weekday nights (Mon-Fri) and 4 weekend nights (Sat-Sun).
/// </summary>
public sealed class RestHistoryBuilderTests
{
    private const string Utc = "UTC";
    private const string Sp = "America/Sao_Paulo"; // UTC-3, no daylight saving now
    private static readonly Guid Person = Guid.NewGuid();
    private static readonly Guid Other = Guid.NewGuid();
    private static readonly Guid Baby = Guid.NewGuid();
    private static readonly DateOnly LastNight = new(2026, 11, 8);
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

    private static DateTimeOffset At(string zone, DateOnly date, int hour, int minute = 0)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(new TimeOnly(hour, minute)), DateTimeKind.Unspecified);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(zone);
        return new DateTimeOffset(local - tz.GetUtcOffset(local), TimeSpan.Zero);
    }

    private static RestSettings Settings(string zone = Utc, IReadOnlyList<RestWorkWindow>? work = null, bool enabled = true) =>
        new(enabled, zone, work ?? [], new TimeOnly(19, 0), new TimeOnly(7, 0), 20, 20);

    /// <summary>The baby sleeps from <paramref name="bedHour"/> on <paramref name="night"/> until <paramref name="wake"/> minutes after midnight; logged by someone else.</summary>
    private static RestEvent Sleep(DateOnly night, int wakeMinutesAfterMidnight, string zone = Utc, int bedHour = 21)
    {
        var start = At(zone, night, bedHour);
        var end = At(zone, night.AddDays(1), 0) + TimeSpan.FromMinutes(wakeMinutesAfterMidnight);
        return new RestEvent(Baby, true, start, end, Other, start, false);
    }

    private static RestHistory Build(
        RestSettings settings,
        IEnumerable<RestEvent> events,
        int nights = 14,
        IReadOnlyDictionary<DateOnly, DateTimeOffset>? answers = null) =>
        RestHistoryBuilder.Build(new RestHistoryInput(settings, Person, LastNight, nights, Now, answers ?? new Dictionary<DateOnly, DateTimeOffset>(), events));

    private static IEnumerable<DateOnly> Window(int nights = 14) =>
        Enumerable.Range(0, nights).Select(offset => LastNight.AddDays(offset - nights + 1));

    private static bool IsWeekend(DateOnly night) => night.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;

    [Fact]
    public void Build_EmptyHistory_ReportsEveryNightAsNotEnoughLog_AndNoSummary()
    {
        var history = Build(Settings(), []);

        Assert.Equal(RestStatus.Ok, history.Status);
        Assert.Equal(14, history.NightsRequested);
        Assert.Equal(Window(), history.Nights.Select(night => night.Estimate.Night));
        Assert.All(history.Nights, night =>
        {
            Assert.Equal(RestStatus.NotEnoughLog, night.Estimate.Status);
            Assert.False(night.Counted);
            Assert.Null(night.Confidence);
        });
        Assert.Equal(new RestGroupSummary(0, null), history.WeekdayWeekend.Weekday);
        Assert.Equal(new RestGroupSummary(0, null), history.WeekdayWeekend.Weekend);
        Assert.Equal(0, history.TypicalNight.CountedNights);
        Assert.Empty(history.TypicalNight.Hours);
    }

    [Fact]
    public void Build_Disabled_ReturnsDisabledWithoutNights()
    {
        var history = Build(Settings(enabled: false), [Sleep(LastNight, 360)]);

        Assert.Equal(RestStatus.Disabled, history.Status);
        Assert.Empty(history.Nights);
        Assert.Equal(0, history.WeekdayWeekend.Weekday.CountedNights);
        Assert.Empty(history.TypicalNight.Hours);
        Assert.Equal(20, history.Constants.FallAsleepMinutes);
    }

    [Fact]
    public void Build_TwentyEightNights_EndsAtTheLastNight()
    {
        var history = Build(Settings(), [], nights: 28);

        Assert.Equal(28, history.Nights.Count);
        Assert.Equal(new DateOnly(2026, 10, 12), history.Nights[0].Estimate.Night);
        Assert.Equal(LastNight, history.Nights[^1].Estimate.Night);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(7)]
    [InlineData(15)]
    public void Build_NightsOtherThan14Or28_Throws(int nights) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => Build(Settings(), [], nights));

    [Fact]
    public void Build_EachNight_IsTheOneNightEstimate()
    {
        var events = Window().Select(night => Sleep(night, 360)).ToList();
        var settings = Settings();

        var history = Build(settings, events);

        Assert.All(history.Nights, night =>
        {
            var single = RestEstimator.Estimate(new RestInput(settings, Person, night.Estimate.Night, Now, null, events));
            Assert.Equal(single.Status, night.Estimate.Status);
            Assert.Equal(single.Parts, night.Estimate.Parts);
        });
    }

    [Fact]
    public void Build_WeekdayAndWeekend_GroupByTheLocalDateTheNightStarts_UtcZone()
    {
        // Weekday nights rest 21:20 to 06:00 (520 min); weekend nights 21:20 to 08:00 (640 min).
        var events = Window().Select(night => Sleep(night, IsWeekend(night) ? 480 : 360)).ToList();

        var history = Build(Settings(), events);

        Assert.All(history.Nights, night => Assert.True(night.Counted));
        Assert.Equal(new RestGroupSummary(10, new RestMinutesRange(520, 520, 520)), history.WeekdayWeekend.Weekday);
        Assert.Equal(new RestGroupSummary(4, new RestMinutesRange(640, 640, 640)), history.WeekdayWeekend.Weekend);
    }

    [Fact]
    public void Build_WeekdayAndWeekend_UseTheLocalDate_NotTheUtcDate_InAZoneWithAnOffset()
    {
        // In Sao Paulo the baby goes to bed at 22:00 local, which is 01:00 UTC of the next day: Friday 2026-11-06 22:00 local is
        // Saturday in UTC, Sunday 2026-11-08 22:00 local is Monday in UTC. Friday stays a weekday night, Sunday a weekend one.
        var friday = new DateOnly(2026, 11, 6);
        var sunday = new DateOnly(2026, 11, 8);
        var events = new[] { Sleep(friday, 360, Sp, bedHour: 22), Sleep(sunday, 360, Sp, bedHour: 22) };

        var history = Build(Settings(Sp), events);

        Assert.Equal(DayOfWeek.Saturday, events[0].StartedAt.UtcDateTime.DayOfWeek);
        Assert.Equal(DayOfWeek.Monday, events[1].StartedAt.UtcDateTime.DayOfWeek);
        Assert.Equal(new RestGroupSummary(1, null), history.WeekdayWeekend.Weekday);
        Assert.Equal(new RestGroupSummary(1, null), history.WeekdayWeekend.Weekend);
        Assert.Equal([friday, sunday], history.Nights.Where(night => night.Counted).Select(night => night.Estimate.Night));
    }

    [Fact]
    public void Build_GroupBelowFourNights_ReturnsOnlyItsCount()
    {
        // Only three weekend nights have a logged baby sleep; every weekday night does.
        var events = Window().Where(night => night != LastNight).Select(night => Sleep(night, 360)).ToList();

        var history = Build(Settings(), events);

        Assert.Equal(new RestGroupSummary(3, null), history.WeekdayWeekend.Weekend);
        Assert.NotNull(history.WeekdayWeekend.Weekday.RestedMinutes);
        Assert.Equal(RestStatus.NotEnoughLog, history.Nights[^1].Estimate.Status);
    }

    [Fact]
    public void Build_TypicalNight_BelowFourCountedNights_HasOnlyTheCount()
    {
        var events = Window().TakeLast(3).Select(night => Sleep(night, 360)).ToList();

        var history = Build(Settings(), events);

        Assert.Equal(3, history.TypicalNight.CountedNights);
        Assert.Empty(history.TypicalNight.Hours);
    }

    [Fact]
    public void Build_Percentiles_InterpolateAndRoundToFiveMinutes()
    {
        // Four weekend nights rest 403, 421, 458 and 499 minutes (bed 21:00 + 20, final wake 04:03, 04:21, 04:58, 05:39).
        // p25 = 403 + 0.75 * 18 = 416.5 -> 415; median = 439.5 -> 440; p75 = 458 + 0.25 * 41 = 468.25 -> 470.
        var weekend = Window().Where(IsWeekend).ToList();
        int[] wakes = [243, 261, 298, 339];
        var events = weekend.Select((night, index) => Sleep(night, wakes[index])).ToList();

        var history = Build(Settings(), events);

        Assert.Equal(new RestGroupSummary(4, new RestMinutesRange(415, 440, 470)), history.WeekdayWeekend.Weekend);
        Assert.Equal(new RestGroupSummary(0, null), history.WeekdayWeekend.Weekday);
    }

    [Fact]
    public void Build_WorkWindowOverlappingTheNight_IsReportedButExcluded()
    {
        // An overnight shift on Mondays (22:00 to 06:00) overlaps Monday nights; a day job (08:00 to 17:00) overlaps no night.
        var work = new List<RestWorkWindow>
        {
            new([1], new TimeOnly(22, 0), new TimeOnly(6, 0)),
            new([1, 2, 3, 4, 5], new TimeOnly(8, 0), new TimeOnly(17, 0)),
        };
        var events = Window().Select(night => Sleep(night, 360)).ToList();

        var history = Build(Settings(work: work), events);

        var mondays = history.Nights.Where(night => night.Estimate.Night.DayOfWeek == DayOfWeek.Monday).ToList();
        Assert.Equal(2, mondays.Count);
        Assert.All(mondays, night =>
        {
            Assert.True(night.WorkOverlap);
            Assert.False(night.Counted);
            Assert.Equal(RestStatus.Ok, night.Estimate.Status);
            Assert.NotEmpty(night.Estimate.Parts);
        });
        Assert.All(history.Nights.Except(mondays), night => Assert.False(night.WorkOverlap));
        Assert.Equal(8, history.WeekdayWeekend.Weekday.CountedNights);
        Assert.Equal(4, history.WeekdayWeekend.Weekend.CountedNights);
        Assert.Equal(12, history.TypicalNight.CountedNights);
    }

    [Fact]
    public void Build_TypicalNight_SharesPerLocalHour_FromTheNightStartHour()
    {
        // Four nights rest from 21:20; two end at the baby's wake (06:00), two at a morning answer of 05:20.
        var nights = Window().TakeLast(4).ToList();
        var events = nights.Select(night => Sleep(night, 360)).ToList();
        var answers = nights.Take(2).ToDictionary(night => night, night => At(Utc, night.AddDays(1), 5, 20));

        var history = Build(Settings(), events, answers: answers);

        var hours = history.TypicalNight.Hours;
        Assert.Equal(4, history.TypicalNight.CountedNights);
        Assert.Equal(24, hours.Count);
        Assert.Equal([19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], hours.Select(hour => hour.Hour));
        double Share(int hour) => hours.Single(item => item.Hour == hour).Share;
        Assert.Equal(0, Share(20));
        Assert.Equal(1, Share(21)); // 40 of 60 minutes asleep
        Assert.Equal(1, Share(4));
        Assert.Equal(0.5, Share(5)); // 20 minutes for the two answered nights, 60 for the others
        Assert.Equal(0, Share(6));
        Assert.Equal(0, Share(12));
    }

    [Fact]
    public void Build_TypicalNight_RoundsSharesToTwoDecimals()
    {
        // Of seven nights, three rest through 04:00 to 05:00, three end at 04:10 (10 minutes of that hour) and one at 03:00:
        // the share of hour 4 is 3/7 = 0.428... -> 0.43.
        var nights = Window().TakeLast(7).ToList();
        int[] wakes = [300, 300, 300, 250, 250, 250, 180];
        var events = nights.Select((night, index) => Sleep(night, wakes[index])).ToList();

        var history = Build(Settings(), events);

        Assert.Equal(0.43, history.TypicalNight.Hours.Single(hour => hour.Hour == 4).Share);
    }

    [Fact]
    public void Build_NightWithAnOngoingPart_IsReportedButNotCounted()
    {
        var start = At(Utc, LastNight, 21);
        var open = new RestEvent(Baby, true, start, null, Other, start, false);

        var history = Build(Settings(), [open]);

        var last = history.Nights[^1];
        Assert.Equal(RestStatus.Ok, last.Estimate.Status);
        Assert.Null(Assert.Single(last.Estimate.Parts).End);
        Assert.False(last.Counted);
    }

    [Fact]
    public void Build_NightWithLowConfidencePart_HasLowConfidence()
    {
        var history = Build(Settings(), [Sleep(LastNight, 360)]);

        Assert.Equal(RestConfidence.Low, history.Nights[^1].Confidence);
    }

    [Theory]
    [InlineData("2026-11-09T06:59:00Z", "2026-11-07")]
    [InlineData("2026-11-09T07:00:00Z", "2026-11-08")]
    [InlineData("2026-11-09T23:00:00Z", "2026-11-08")]
    public void LastFinishedNight_IsTheLatestNightWhoseWindowEnded(string now, string expected)
    {
        var night = RestHistoryBuilder.LastFinishedNight(Settings(), DateTimeOffset.Parse(now, CultureInfo.InvariantCulture));

        Assert.Equal(DateOnly.Parse(expected, CultureInfo.InvariantCulture), night);
    }

    [Fact]
    public void LastFinishedNight_UsesThePersonsZone()
    {
        // 09:30 UTC is 06:30 in Sao Paulo: the night of 2026-11-08 there has not ended yet.
        var night = RestHistoryBuilder.LastFinishedNight(Settings(Sp), new DateTimeOffset(2026, 11, 9, 9, 30, 0, TimeSpan.Zero));

        Assert.Equal(new DateOnly(2026, 11, 7), night);
    }
}
