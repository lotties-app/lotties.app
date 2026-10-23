using Lotties.Domain.Clinical;
using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Clinical.ClinicalFixtures;

namespace Lotties.Domain.Tests.Clinical;

/// <summary>Golden cases of the sleep numbers: they must equal the parents' Insights (<c>sleepModel.ts</c>).</summary>
public sealed class SleepSummaryTests
{
    private static readonly DateTimeOffset NowJan10Noon = Brazil.Local(1, 10, 12);

    [Fact]
    public void Summarize_NightAcrossMidnight_IsSplitBetweenTheTwoDays()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var night = Sleep(Brazil.Local(1, 9, 21), Brazil.Local(1, 10, 6, 30), SleepKinds.Night);

        var summary = SleepSummaries.Summarize([night], window);

        Assert.Equal((180d, 0d, 180d), (Minutes(summary.Days[0].NightMs), Minutes(summary.Days[0].NapMs), Minutes(summary.Days[0].TotalMs)));
        Assert.Equal((390d, 0d, 390d), (Minutes(summary.Days[1].NightMs), Minutes(summary.Days[1].NapMs), Minutes(summary.Days[1].TotalMs)));
    }

    [Fact]
    public void Summarize_NightAcrossMidnight_LongestStretchIsTheWholeNightOnTheDayItStarted()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var night = Sleep(Brazil.Local(1, 9, 21), Brazil.Local(1, 10, 6, 30), SleepKinds.Night);

        var summary = SleepSummaries.Summarize([night], window);

        Assert.Equal((570d, 0d), (Minutes(summary.Days[0].LongestMs), Minutes(summary.Days[1].LongestMs)));
        Assert.Equal(570d, Minutes(summary.LongestStretchMs!.Value));
        Assert.Equal(night.StartedAt, summary.LongestStretchStartedAt);
    }

    [Fact]
    public void Summarize_TodayIsLeftOutOfTheAveragesWhenAnotherDayHasData()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var night = Sleep(Brazil.Local(1, 9, 21), Brazil.Local(1, 10, 6, 30), SleepKinds.Night);

        var summary = SleepSummaries.Summarize([night], window);

        Assert.Equal(1, summary.DaysCounted);
        Assert.Equal((180d, 0d, 180d), (Minutes(summary.AverageNightMs!.Value), Minutes(summary.AverageNapMs!.Value), Minutes(summary.AverageTotalMs!.Value)));
    }

    [Fact]
    public void Summarize_TodayIsCountedWhenItIsTheOnlyDayWithData()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var nap = Sleep(Brazil.Local(1, 10, 9), Brazil.Local(1, 10, 10, 30), SleepKinds.Nap);

        var summary = SleepSummaries.Summarize([nap], window);

        Assert.Equal(1, summary.DaysCounted);
        Assert.Equal((90d, 1d), (Minutes(summary.AverageNapMs!.Value), summary.NapsPerDay));
        Assert.Equal(0d, summary.AverageNightMs);
    }

    [Fact]
    public void Summarize_NothingLogged_HasZeroRowsAndNoAverages()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);

        var summary = SleepSummaries.Summarize([], window);

        Assert.Equal(2, summary.Days.Count);
        Assert.All(summary.Days, day => Assert.Equal(0d, day.TotalMs));
        Assert.Equal((0, null, null, null, null, null), (summary.DaysCounted, summary.AverageTotalMs, summary.NapsPerDay, summary.LongestStretchMs, summary.BedtimeMedian, summary.WakeMedian));
    }

    [Fact]
    public void Summarize_PausesAreRemovedFromTheNap()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var nap = Sleep(Brazil.Local(1, 9, 13), Brazil.Local(1, 9, 15), SleepKinds.Nap, pausedSeconds: 1800);

        var summary = SleepSummaries.Summarize([nap], window);

        Assert.Equal((90d, 1, 90d), (Minutes(summary.Days[0].NapMs), summary.Days[0].Naps, Minutes(summary.Days[0].LongestMs)));
    }

    [Fact]
    public void Summarize_PausesOfASessionAcrossMidnightAreSpreadEvenlyOverIt()
    {
        var window = Window(Brazil, (1, 9), (1, 10), NowJan10Noon);
        var night = Sleep(Brazil.Local(1, 9, 21), Brazil.Local(1, 10, 6, 30), SleepKinds.Night, pausedSeconds: 57 * 60);

        var summary = SleepSummaries.Summarize([night], window);

        Assert.Equal((513d * 180 / 570, 513d * 390 / 570), (Minutes(summary.Days[0].NightMs), Minutes(summary.Days[1].NightMs)));
    }

    [Fact]
    public void Summarize_RunningNap_IsCountedUntilNow()
    {
        var window = Window(Brazil, (1, 10), (1, 10), NowJan10Noon);
        var running = Sleep(Brazil.Local(1, 10, 11), null, SleepKinds.Nap);

        var summary = SleepSummaries.Summarize([running], window);

        Assert.Equal(60d, Minutes(summary.Days[0].NapMs));
        Assert.Equal(60d, Minutes(summary.LongestStretchMs!.Value));
    }

    [Fact]
    public void Summarize_RunningNapThatIsPausedNow_DoesNotCountThePauseSoFar()
    {
        var window = Window(Brazil, (1, 10), (1, 10), NowJan10Noon);
        var paused = Sleep(Brazil.Local(1, 10, 11), null, SleepKinds.Nap, pausedAt: Brazil.Local(1, 10, 11, 40));

        var summary = SleepSummaries.Summarize([paused], window);

        Assert.Equal(40d, Minutes(summary.Days[0].NapMs));
    }

    [Fact]
    public void Summarize_EventsThatStartAfterNow_AreIgnored()
    {
        var window = Window(Brazil, (1, 10), (1, 10), NowJan10Noon);
        var later = Sleep(Brazil.Local(1, 10, 13), Brazil.Local(1, 10, 14), SleepKinds.Nap);

        var summary = SleepSummaries.Summarize([later], window);

        Assert.Equal(0d, summary.Days[0].TotalMs);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("nap", false)]
    [InlineData("night", true)]
    public void Summarize_KindAbsentIsANap_NightIsANight(string? kind, bool isNight)
    {
        var window = Window(Brazil, (1, 9), (1, 9), NowJan10Noon);
        var session = Sleep(Brazil.Local(1, 9, 10), Brazil.Local(1, 9, 11), kind);

        var day = SleepSummaries.Summarize([session], window).Days[0];

        Assert.Equal(isNight ? (60d, 0d) : (0d, 60d), (Minutes(day.NightMs), Minutes(day.NapMs)));
    }

    [Theory]
    [InlineData("bed_time")]
    [InlineData("woke_up")]
    [InlineData("fell_asleep")]
    [InlineData("night_waking")]
    [InlineData("something_new")]
    public void Summarize_MarkersWakingsAndUnknownKinds_AreNotSleep(string kind)
    {
        var window = Window(Brazil, (1, 9), (1, 9), NowJan10Noon);
        var notSleep = Sleep(Brazil.Local(1, 9, 10), Brazil.Local(1, 9, 11), kind);

        var summary = SleepSummaries.Summarize([notSleep], window);

        Assert.Equal((0d, 0, 0d, 0), (summary.Days[0].TotalMs, summary.Days[0].Naps, summary.Days[0].LongestMs, summary.DaysCounted));
        Assert.Null(summary.LongestStretchMs);
    }

    [Fact]
    public void Summarize_NapsPerDayAndAveragesAreOverCompletedDaysWithSleep()
    {
        var window = Window(Brazil, (1, 7), (1, 10), NowJan10Noon);
        var sessions = new[]
        {
            Sleep(Brazil.Local(1, 7, 9), Brazil.Local(1, 7, 10), SleepKinds.Nap),
            Sleep(Brazil.Local(1, 7, 14), Brazil.Local(1, 7, 15), SleepKinds.Nap),
            Sleep(Brazil.Local(1, 7, 20), Brazil.Local(1, 8, 4), SleepKinds.Night),
            Sleep(Brazil.Local(1, 9, 9), Brazil.Local(1, 9, 11), SleepKinds.Nap),
            Sleep(Brazil.Local(1, 10, 9), Brazil.Local(1, 10, 10), SleepKinds.Nap),
        };

        var summary = SleepSummaries.Summarize(sessions, window);

        Assert.Equal(3, summary.DaysCounted);
        Assert.Equal(1.0d, summary.NapsPerDay!.Value, precision: 9);
        Assert.Equal((360d + 240d + 120d) / 3, Minutes(summary.AverageTotalMs!.Value), precision: 9);
    }

    [Fact]
    public void Summarize_BedtimeAndWakeMedians_AcrossMidnight_AreMeasuredFromNoon()
    {
        var window = Window(Brazil, (1, 5), (1, 6), NowJan10Noon);
        var sessions = new[]
        {
            Sleep(Brazil.Local(1, 5, 23, 30), Brazil.Local(1, 6, 7), SleepKinds.Night),
            Sleep(Brazil.Local(1, 7, 0, 30), Brazil.Local(1, 7, 8), SleepKinds.Night),
            Sleep(Brazil.Local(1, 5, 6), null, SleepKinds.WokeUp),
        };

        var summary = SleepSummaries.Summarize(sessions, window);

        Assert.Equal(new TimeOnly(0, 0), summary.BedtimeMedian);
        Assert.Equal(new TimeOnly(6, 30), summary.WakeMedian);
    }

    [Fact]
    public void Summarize_BedTimeMarkerBeatsTheNightThatStartedLater()
    {
        var window = Window(Brazil, (1, 5), (1, 5), NowJan10Noon);
        var sessions = new[]
        {
            Sleep(Brazil.Local(1, 5, 21), Brazil.Local(1, 6, 6), SleepKinds.Night),
            Sleep(Brazil.Local(1, 5, 20), null, SleepKinds.BedTime),
            Sleep(Brazil.Local(1, 5, 20, 30), null, SleepKinds.BedTime),
        };

        var summary = SleepSummaries.Summarize(sessions, window);

        Assert.Equal(new TimeOnly(20, 0), summary.BedtimeMedian);
    }

    [Fact]
    public void Summarize_WakeIsTheLatestNightEndBetween3And12_ElseTheEarliestMarkerBetween4And11_AndAHalfMinuteMedianRoundsUp()
    {
        // 07:15 on the 5th (the later of two night ends) and 07:00 on the 6th (the earliest marker in 04:00-11:00; 03:30 is too early):
        // the median of 435 and 420 minutes is 427.5, which rounds half up to 428 = 07:08 like Math.round in the parents' app.
        var window = Window(Brazil, (1, 5), (1, 6), NowJan10Noon);
        var sessions = new[]
        {
            Sleep(Brazil.Local(1, 4, 21), Brazil.Local(1, 5, 5, 30), SleepKinds.Night),
            Sleep(Brazil.Local(1, 5, 5, 45), Brazil.Local(1, 5, 7, 15), SleepKinds.Night),
            Sleep(Brazil.Local(1, 6, 3, 30), null, SleepKinds.WokeUp),
            Sleep(Brazil.Local(1, 6, 9), null, SleepKinds.WokeUp),
            Sleep(Brazil.Local(1, 6, 7), null, SleepKinds.WokeUp),
        };

        var summary = SleepSummaries.Summarize(sessions, window);

        Assert.Equal(new TimeOnly(7, 8), summary.WakeMedian);
        Assert.Equal(new TimeOnly(7, 15), SleepSummaries.Summarize(sessions.Take(2).ToArray(), window).WakeMedian);
    }

    [Fact]
    public void Summarize_SpringForwardDay_IsCutAtLocalMidnightNotEvery24Hours()
    {
        var now = NewYork.Local(3, 12, 12);
        var window = Window(NewYork, (3, 7), (3, 9), now);
        var nightIntoTheShortDay = Sleep(NewYork.Local(3, 7, 22), NewYork.Local(3, 8, 8), SleepKinds.Night);
        var napAcrossTheNextMidnight = Sleep(NewYork.Local(3, 8, 23), NewYork.Local(3, 9, 1), SleepKinds.Nap);

        var summary = SleepSummaries.Summarize([nightIntoTheShortDay, napAcrossTheNextMidnight], window);

        Assert.Equal(TimeSpan.FromHours(23), window.Days[1].End - window.Days[1].Start);
        Assert.Equal(120d, Minutes(summary.Days[0].NightMs));
        Assert.Equal(420d, Minutes(summary.Days[1].NightMs));
        Assert.Equal((60d, 60d), (Minutes(summary.Days[1].NapMs), Minutes(summary.Days[2].NapMs)));
    }

    [Fact]
    public void Summarize_FallBackDay_IsCutAtLocalMidnightNotEvery24Hours()
    {
        var now = NewYork.Local(11, 5, 12);
        var window = Window(NewYork, (10, 31), (11, 2), now);
        var night = Sleep(NewYork.Local(11, 1, 22), NewYork.Local(11, 2, 6), SleepKinds.Night);

        var summary = SleepSummaries.Summarize([night], window);

        Assert.Equal(TimeSpan.FromHours(25), window.Days[1].End - window.Days[1].Start);
        Assert.Equal((120d, 360d), (Minutes(summary.Days[1].NightMs), Minutes(summary.Days[2].NightMs)));
        Assert.Equal(0d, summary.Days[0].TotalMs);
    }

    [Fact]
    public void Summarize_NightThatStartedBeforeTheRange_CountsItsPartInsideTheFirstDay()
    {
        var window = Window(Brazil, (1, 9), (1, 9), NowJan10Noon);
        var night = Sleep(Brazil.Local(1, 8, 22), Brazil.Local(1, 9, 6), SleepKinds.Night);

        var summary = SleepSummaries.Summarize([night], window);

        Assert.Equal(360d, Minutes(summary.Days[0].NightMs));
        Assert.Equal(0d, Minutes(summary.Days[0].LongestMs));
        Assert.Null(summary.LongestStretchMs);
    }

    [Fact]
    public void Summarize_LongestStretch_IsTheLongestEffectiveSessionStartedInTheRange()
    {
        var window = Window(Brazil, (1, 8), (1, 9), NowJan10Noon);
        var sessions = new[]
        {
            Sleep(Brazil.Local(1, 8, 20), Brazil.Local(1, 9, 4), SleepKinds.Night, pausedSeconds: 3 * 3600),
            Sleep(Brazil.Local(1, 9, 20), Brazil.Local(1, 10, 3), SleepKinds.Night),
            Sleep(Brazil.Local(1, 9, 13), Brazil.Local(1, 9, 14), SleepKinds.Nap),
        };

        var summary = SleepSummaries.Summarize(sessions, window);

        Assert.Equal(420d, Minutes(summary.LongestStretchMs!.Value));
        Assert.Equal(sessions[1].StartedAt, summary.LongestStretchStartedAt);
    }
}
