using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Predictions.PredictionFixtures;
using static Lotties.Domain.Tests.Predictions.SleepFixtures;

namespace Lotties.Domain.Tests.Predictions;

/// <summary>
/// Heuristic v1.1 bed-time prediction (docs/ml/BENCHMARK.md "recent bed-time clocks"; parity with
/// ml/benchmark/baselines.py `bedtime_same_hour`): q25, median and q75 of the last 14 bed-time clocks that are still
/// later than now, unweighted and linearly interpolated.
/// </summary>
public sealed class BedTimePredictionTests
{
    [Fact]
    public void Predict_ResultCarriesTheEngineVersion()
    {
        Assert.Equal("heuristic-1.1", Predict([]).EngineVersion);
    }

    [Fact]
    public void Predict_FixtureEvening_PredictsTonightsBedTimeAndTypicalNight()
    {
        var now = At(0, 18);

        var bedTime = Predict(FixtureDays(now), Context(now)).BedTime!;

        Assert.Equal(Sleep, bedTime.TypeKey);
        Assert.Equal(SleepKinds.Night, bedTime.Kind);
        Assert.Equal(new NextStartWindow(At(0, 20), At(0, 20), At(0, 20)), bedTime.NextStart);
        Assert.Equal(new DurationEstimate(TimeSpan.FromHours(10.5), 7), bedTime.ExpectedDuration);
        Assert.Equal(7, bedTime.SampleCount);
        Assert.Equal(PredictionConfidence.Low, bedTime.Confidence);
        Assert.Equal(PredictionBasis.BedTimeClock, bedTime.Reason.Basis);
        Assert.Equal(new TimeOnly(20, 0), bedTime.Reason.MedianClock);
        Assert.Equal(7, bedTime.Reason.RecentBedTimeCount);
        Assert.Equal(
            "Median bed time 20:00 over the last 14 days, 7 samples (of 7 recent bed times). Typical duration 10h 30m (7 samples).",
            bedTime.Reason.Text);
    }

    [Fact]
    public void Predict_MorningAfterTheNight_PredictsTonight()
    {
        var now = At(0, 8);

        var bedTime = Predict(FixtureDays(now), Context(now)).BedTime!;

        Assert.Equal(At(0, 20), bedTime.NextStart.Expected);
    }

    [Fact]
    public void Predict_NightInProgress_HasNoBedTime()
    {
        var now = At(0, 23);

        Assert.Null(Predict(FixtureDays(now), Context(now)).BedTime);
    }

    [Fact]
    public void Predict_TonightsNightAlreadyEnded_HasNoBedTime()
    {
        var now = At(0, 22);
        var events = FixtureDays(At(0, 17))
            .Append(Marker(SleepKinds.BedTime, At(0, 19)))
            .Append(Marker(SleepKinds.WokeUp, At(0, 21)));

        Assert.Null(Predict(events, Context(now)).BedTime);
    }

    [Theory]
    [InlineData(4, false)]
    [InlineData(5, true)]
    public void Predict_BedTimesInLookBack_NeedsAtLeastFive(int nights, bool expectsBedTime)
    {
        var now = At(0, 12);
        var events = Enumerable.Range(1, nights).SelectMany(day => Night(-day, 20));

        var bedTime = Predict(events, Context(now)).BedTime;

        Assert.Equal(expectsBedTime, bedTime is not null);
    }

    [Fact]
    public void Predict_BedTimesOlderThanLookBack_AreIgnored()
    {
        var now = At(0, 12);
        var events = Enumerable.Range(13, 5).SelectMany(day => Night(-day, 20));

        Assert.Null(Predict(events, Context(now)).BedTime);
    }

    [Theory]
    [InlineData(8, 0, 19, 38, 20, 15, 20, 53, 6)]
    [InlineData(20, 15, 20, 45, 21, 0, 21, 15, 3)]
    public void Predict_SpreadBedTimes_WindowFromTheClocksStillLaterThanNow(
        int nowHour, int nowMinute, int earliestHour, int earliestMinute, int expectedHour, int expectedMinute, int latestHour, int latestMinute, int samples)
    {
        var now = At(0, nowHour, nowMinute);

        var bedTime = Predict(SpreadBedTimes(), Context(now)).BedTime!;

        Assert.Equal(
            new NextStartWindow(At(0, earliestHour, earliestMinute), At(0, expectedHour, expectedMinute), At(0, latestHour, latestMinute)),
            bedTime.NextStart);
        Assert.Equal(samples, bedTime.SampleCount);
        Assert.Equal(6, bedTime.Reason.RecentBedTimeCount);
    }

    [Fact]
    public void Predict_EveryRecentBedTimeAlreadyPassed_HasNoBedTime()
    {
        var now = At(0, 21, 45);

        Assert.Null(Predict(SpreadBedTimes(), Context(now)).BedTime);
    }

    [Fact]
    public void Predict_BedTimesAroundMidnight_TreatsEarlyMorningClocksAsLateEvening()
    {
        var now = At(0, 23, 50);
        var events = new[] { (-5, 23, 30), (-4, 24, 0), (-3, 24, 30), (-2, 23, 45), (-1, 24, 15) }
            .SelectMany(bed => Night(bed.Item1, bed.Item2, bed.Item3));

        var bedTime = Predict(events, Context(now)).BedTime!;

        Assert.Equal(new NextStartWindow(At(1, 0, 8), At(1, 0, 15), At(1, 0, 23)), bedTime.NextStart);
        Assert.Equal(3, bedTime.SampleCount);
        Assert.Equal(new TimeOnly(0, 15), bedTime.Reason.MedianClock);
    }

    [Theory]
    [InlineData(-180, 20)]
    [InlineData(0, 23)]
    public void Predict_FamilyOffset_SameInstantsWithTheClockInLocalTime(int utcOffsetMinutes, int expectedClockHour)
    {
        var now = At(0, 18).ToOffset(TimeSpan.FromMinutes(utcOffsetMinutes));

        var bedTime = Predict(FixtureDays(now), Context(now)).BedTime!;

        Assert.Equal(At(0, 20), bedTime.NextStart.Expected);
        Assert.Equal(TimeSpan.Zero, bedTime.NextStart.Expected.Offset);
        Assert.Equal(new TimeOnly(expectedClockHour, 0), bedTime.Reason.MedianClock);
    }

    [Fact]
    public void Predict_BedTimeMarkerAndNightTimerTheSameEvening_CountsOneBedTimePerEvening()
    {
        var now = At(0, 12);
        var events = Enumerable.Range(1, 5).SelectMany(day => Night(-day, 20)
            .Append(Logged(SleepKinds.Night, At(-day, 20, 40), At(-day + 1, 6))));

        var bedTime = Predict(events, Context(now)).BedTime!;

        Assert.Equal(5, bedTime.Reason.RecentBedTimeCount);
        Assert.Equal(At(0, 20), bedTime.NextStart.Expected);
    }

    [Fact]
    public void Predict_ShuffledInputOrEventOffsets_IsDeterministic()
    {
        var now = At(0, 8);
        var history = FixtureDays(now).Concat(SpreadBedTimes()).ToList();
        var asIndia = history.Select(item => item with { StartedAt = item.StartedAt.ToOffset(TimeSpan.FromHours(5.5)), EndedAt = item.EndedAt?.ToOffset(TimeSpan.FromHours(5.5)) });
        var expected = Predict(history, Context(now));

        Assert.Equal(expected.BedTime, Predict(asIndia, Context(now)).BedTime);
        foreach (var seed in Enumerable.Range(1, 20))
        {
            var shuffled = Predict(Shuffle(history, seed), Context(now));
            Assert.Equal(expected.BedTime, shuffled.BedTime);
            Assert.Equal(expected.Predictions, shuffled.Predictions);
        }
    }

    /// <summary>Bed times 19:00, 19:30, 20:00, 20:30, 21:00 and 21:30 over the six evenings before today.</summary>
    private static IEnumerable<ObservedEvent> SpreadBedTimes() =>
        Enumerable.Range(0, 6).SelectMany(index => Night(index - 6, 19 + (index / 2), (index % 2) * 30));
}
