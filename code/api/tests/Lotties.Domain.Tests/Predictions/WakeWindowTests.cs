using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Predictions.PredictionFixtures;

namespace Lotties.Domain.Tests.Predictions;

public sealed class WakeWindowTests
{
    private static readonly LocalClock SaoPaulo = LocalClock.WithOffset(BrasiliaOffset);
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    /// <summary>A São Paulo (UTC-3) wall-clock time on 2026-01-<paramref name="day"/>.</summary>
    private static DateTimeOffset At(int day, int hour, int minute = 0) => new(2026, 1, day, hour, minute, 0, BrasiliaOffset);

    private static ObservedEvent Nap(DateTimeOffset start, int minutes) => new(Sleep, start, start.AddMinutes(minutes), SleepKinds.Nap);

    private static ObservedEvent Marker(string kind, DateTimeOffset at) => new(Sleep, at, at, kind);

    /// <summary>
    /// Naps on 2026-01-<paramref name="day"/> at 06:00, 08:40, 11:00, 13:30, 16:10 and 19:00 (30-60 min): five daytime
    /// stretches of 100, 110, 120, 130 and 140 minutes, the last one starting at 16:40.
    /// </summary>
    private static List<ObservedEvent> FiveStretches(int day = 9) =>
    [
        Nap(At(day, 6), 60),
        Nap(At(day, 8, 40), 30),
        Nap(At(day, 11), 30),
        Nap(At(day, 13, 30), 30),
        Nap(At(day, 16, 10), 30),
        Nap(At(day, 19), 30),
    ];

    private static WakeWindow? Measure(IEnumerable<ObservedEvent> events, DateTimeOffset now, LocalClock? clock = null) =>
        WakeWindows.Measure(events, now, clock ?? SaoPaulo);

    [Fact]
    public void Measure_FiveDaytimeStretches_LimitIsTheInterpolatedSeventyFifthPercentile()
    {
        var window = Assert.IsType<WakeWindow>(Measure(FiveStretches(), At(9, 21)));

        Assert.Equal(TimeSpan.FromMinutes(130), window.Limit);
        Assert.Equal([100, 110, 120, 130, 140], window.Stretches.Select(stretch => (int)stretch.Length.TotalMinutes));
        Assert.Equal(At(9, 7), window.Stretches[0].Start);
        Assert.Equal(At(9, 19, 30), window.AwakeSince);
        Assert.Equal(At(9, 21, 40), window.LimitAt);
        Assert.Equal(TimeSpan.FromMinutes(90), window.AwakeFor(At(9, 21)));
    }

    [Fact]
    public void Measure_BetweenRanks_InterpolatesAndRoundsToTheMinute()
    {
        var events = FiveStretches().Append(Nap(At(8, 10), 30)).Append(Nap(At(8, 12, 25), 30)).ToList();

        var window = Assert.IsType<WakeWindow>(Measure(events, At(9, 21)));

        // 100, 110, 115 (yesterday 10:30-12:25), 120, 130, 140: position 3.75 between 120 and 130 (127.5).
        Assert.Equal(6, window.Stretches.Count);
        Assert.Equal(TimeSpan.FromMinutes(128), window.Limit);
    }

    [Fact]
    public void Measure_FewerThanFiveStretches_ReturnsNothing()
    {
        var events = FiveStretches().Take(5).ToList();

        Assert.Null(Measure(events, At(9, 21)));
        Assert.Null(Measure([], At(9, 21)));
    }

    [Theory]
    [InlineData(4, 59, false)]
    [InlineData(5, 0, true)]
    [InlineData(17, 59, true)]
    [InlineData(18, 0, false)]
    public void Measure_OnlyStretchesStartingFromFiveUntilEighteenCount(int hour, int minute, bool counted)
    {
        var start = At(8, hour, minute);
        var events = FiveStretches().Append(Nap(start.AddMinutes(-30), 30)).Append(Nap(start.AddMinutes(120), 30)).ToList();

        var window = Assert.IsType<WakeWindow>(Measure(events, At(9, 21)));

        Assert.Equal(counted, window.Stretches.Any(stretch => stretch.Start == start));
    }

    [Fact]
    public void Measure_StretchesOlderThanFourteenDays_AreIgnored()
    {
        var events = FiveStretches(day: 1).Skip(1).Concat(FiveStretches(day: 16)).ToList();

        var window = Assert.IsType<WakeWindow>(Measure(events, At(16, 21)));

        Assert.All(window.Stretches, stretch => Assert.True(stretch.Start >= At(16, 21).AddDays(-14)));
        Assert.Equal(5, window.Stretches.Count);
    }

    [Fact]
    public void Measure_OverlappingLogsAndAMissedNap_AreDropped()
    {
        var events = FiveStretches();
        events.Add(Nap(At(9, 8, 50), 10));
        events.Add(Nap(At(8, 7), 30));

        var window = Assert.IsType<WakeWindow>(Measure(events, At(9, 21)));

        // The nap inside another nap adds nothing; 07:30 yesterday to 06:00 today (22.5 h) is over 3x the median.
        Assert.Equal([100, 110, 120, 130, 140], window.Stretches.Select(stretch => (int)stretch.Length.TotalMinutes));
    }

    [Fact]
    public void Measure_IsIndependentOfInputOrder()
    {
        var events = FiveStretches();

        var forward = Measure(events, At(9, 21));
        var backward = Measure(Enumerable.Reverse(events).ToList(), At(9, 21));

        Assert.Equal(forward!.Limit, backward!.Limit);
        Assert.Equal(forward.Stretches, backward.Stretches);
        Assert.Equal(forward.AwakeSince, backward.AwakeSince);
    }

    [Fact]
    public void Measure_WhileASleepRuns_KeepsTheLimitButHasNoCurrentStretch()
    {
        var events = FiveStretches();
        events.Add(new ObservedEvent(Sleep, At(9, 20, 30), null, SleepKinds.Nap));

        var window = Assert.IsType<WakeWindow>(Measure(events, At(9, 21)));

        Assert.Equal(TimeSpan.FromMinutes(130), window.Limit);
        Assert.Null(window.AwakeSince);
        Assert.Null(window.LimitAt);
        Assert.Null(window.AwakeFor(At(9, 21)));
    }

    [Fact]
    public void Measure_AfterALoneFellAsleepMarker_HasNoCurrentStretch()
    {
        var events = FiveStretches();
        events.Add(Marker(SleepKinds.FellAsleep, At(9, 20, 40)));

        Assert.Null(Measure(events, At(9, 21))!.AwakeSince);
    }

    [Fact]
    public void Measure_NightWakingAfterTheLastSleep_HasNoCurrentStretch()
    {
        var events = FiveStretches();
        events.Add(new ObservedEvent(Sleep, At(9, 20), At(10, 2), SleepKinds.Night));
        var waking = new ObservedEvent(Sleep, At(10, 2), At(10, 2, 30), SleepKinds.NightWaking);

        var without = Measure(events, At(10, 3));
        var with = Measure(events.Append(waking), At(10, 3));

        Assert.Equal(At(10, 2), without!.AwakeSince);
        Assert.Null(with!.AwakeSince);
    }

    [Fact]
    public void Measure_NightWakingInsideTheNight_DoesNotHideTheMorningStretch()
    {
        var events = FiveStretches();
        events.Add(new ObservedEvent(Sleep, At(9, 20), At(10, 6, 30), SleepKinds.Night));
        events.Add(new ObservedEvent(Sleep, At(10, 2), At(10, 2, 20), SleepKinds.NightWaking));

        Assert.Equal(At(10, 6, 30), Measure(events, At(10, 7))!.AwakeSince);
    }

    [Fact]
    public void Measure_BedTimeAndWokeUpMarkers_StartTheMorningStretch()
    {
        var events = FiveStretches();
        events.Add(Marker(SleepKinds.BedTime, At(9, 20, 30)));
        events.Add(Marker(SleepKinds.WokeUp, At(10, 6, 15)));
        events.Add(Nap(At(10, 8, 45), 40));

        var window = Assert.IsType<WakeWindow>(Measure(events, At(10, 10)));

        Assert.Contains(window.Stretches, stretch => stretch.Start == At(10, 6, 15) && stretch.Length == TimeSpan.FromMinutes(150));
        Assert.Equal(At(10, 9, 25), window.AwakeSince);
    }

    [Fact]
    public void Measure_OtherTypesAndFutureEvents_AreIgnored()
    {
        var events = FiveStretches();
        events.Add(new ObservedEvent(Feeding, At(9, 20), At(9, 20, 20)));
        events.Add(Nap(At(9, 22), 30));

        var window = Assert.IsType<WakeWindow>(Measure(events, At(9, 21)));

        Assert.Equal(5, window.Stretches.Count);
        Assert.Equal(At(9, 19, 30), window.AwakeSince);
    }

    [Fact]
    public void Measure_AcrossTheDaylightSavingChange_ReadsDaytimeInTheZone()
    {
        // 2026-03-07 is EST (UTC-5); from 2026-03-08 02:00 New York is on EDT (UTC-4).
        static DateTimeOffset NewYorkAt(int day, int hour, int minute = 0)
        {
            var local = new DateTime(2026, 3, day, hour, minute, 0, DateTimeKind.Unspecified);
            return new DateTimeOffset(local, NewYork.GetUtcOffset(local));
        }

        static ObservedEvent NewYorkNap(int day, int hour, int minute, int minutes) => Nap(NewYorkAt(day, hour, minute), minutes);

        var events = new List<ObservedEvent>
        {
            NewYorkNap(7, 16, 30, 60),
            NewYorkNap(7, 19, 0, 30),
            NewYorkNap(9, 6, 0, 60),
            NewYorkNap(9, 8, 40, 30),
            NewYorkNap(9, 11, 0, 30),
            NewYorkNap(9, 13, 30, 30),
            NewYorkNap(9, 16, 10, 30),
            NewYorkNap(9, 19, 0, 30),
        };
        var now = NewYorkAt(9, 21);

        var inZone = Assert.IsType<WakeWindow>(Measure(events, now, LocalClock.InZone(NewYork)));
        var fixedOffset = Assert.IsType<WakeWindow>(Measure(events, now, LocalClock.WithOffset(NewYork.GetUtcOffset(now))));

        // 17:30 EST on the 7th is 18:30 at the summer offset: daytime only when read in the zone.
        Assert.Equal(6, inZone.Stretches.Count);
        Assert.Equal(5, fixedOffset.Stretches.Count);
        Assert.Equal(TimeSpan.FromMinutes(90), inZone.Stretches[0].Length);
    }
}
