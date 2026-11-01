using BabyRoutine.Domain.Predictions;
using static BabyRoutine.Domain.Tests.Predictions.PredictionFixtures;

namespace BabyRoutine.Domain.Tests.Predictions;

public sealed class PredictionEngineTests
{
    private static readonly DateTimeOffset Now = TestClock.Now;

    [Fact]
    public void Predict_NoEvents_ReturnsEmptySet()
    {
        var result = Predict([]);

        Assert.Empty(result.Predictions);
        Assert.Empty(result.InsufficientData);
    }

    [Fact]
    public void Predict_OneEvent_ReportsInsufficientDataExplicitly()
    {
        var result = Predict([new ObservedEvent(TummyTime, Now.AddHours(-1), Now.AddMinutes(-50))]);

        Assert.Empty(result.Predictions);
        var missing = Assert.Single(result.InsufficientData);
        Assert.Equal(TummyTime, missing.TypeKey);
        Assert.Equal(0, missing.SampleCount);
        Assert.Equal(3, missing.RequiredSamples);
        Assert.Equal("Not enough data: 0 of 3 intervals needed over the last 14 days.", missing.Reason);
    }

    [Fact]
    public void Predict_ThreeIntervals_PredictsWithLowConfidence()
    {
        var events = Every(TummyTime, TimeSpan.FromHours(4), Now.AddHours(-13), Now.AddHours(-1));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(3, prediction.SampleCount);
        Assert.Equal(PredictionConfidence.Low, prediction.Confidence);
        Assert.Equal(Now.AddHours(3), prediction.NextStart.Expected);
    }

    [Theory]
    [InlineData(3, PredictionConfidence.Low)]
    [InlineData(9, PredictionConfidence.Low)]
    [InlineData(10, PredictionConfidence.Medium)]
    [InlineData(29, PredictionConfidence.Medium)]
    [InlineData(30, PredictionConfidence.High)]
    public void Predict_SampleCount_SetsConfidence(int intervals, PredictionConfidence expected)
    {
        var events = Every(TummyTime, TimeSpan.FromHours(4), Now.AddHours(-4 * intervals), Now);

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(intervals, prediction.SampleCount);
        Assert.Equal(expected, prediction.Confidence);
    }

    [Fact]
    public void Predict_FeedingEveryThreeHours_ExpectsLastStartPlusThreeHoursAndTypicalDuration()
    {
        var events = Every(Feeding, TimeSpan.FromHours(3), Now.AddDays(-14), Now.AddHours(-1), TimeSpan.FromMinutes(20));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(Feeding, prediction.TypeKey);
        Assert.Equal(new NextStartWindow(Now, Now, Now), prediction.NextStart);
        Assert.Equal(TimeSpan.FromMinutes(20), prediction.ExpectedDuration!.Median);
        Assert.Equal(PredictionConfidence.High, prediction.Confidence);
        Assert.Equal(PredictionBasis.StartInterval, prediction.Reason.Basis);
        Assert.Equal(DayPhase.Day, prediction.Reason.Phase);
        Assert.Equal(AgeBand.UnderThreeMonths, prediction.Reason.AgeBand);
    }

    [Theory]
    [InlineData(21, 23, DayPhase.Night)]
    [InlineData(11, 13, DayPhase.Day)]
    public void Predict_FeedingWithDayAndNightRhythms_UsesPhaseOfLastFeed(int localNowHour, int expectedLocalHour, DayPhase expectedPhase)
    {
        var now = new DateTimeOffset(2026, 1, 10, localNowHour, 0, 0, BrasiliaOffset);
        var events = LocalDailyFeeds(now, [3, 7, 10, 13, 16, 19, 23]);

        var prediction = Assert.Single(Predict(events, Context(now)).Predictions);

        Assert.Equal(new DateTimeOffset(2026, 1, 10, expectedLocalHour, 0, 0, BrasiliaOffset), prediction.NextStart.Expected);
        Assert.Equal(expectedPhase, prediction.Reason.Phase);
    }

    [Fact]
    public void Predict_TooFewSamplesInCurrentPhase_FallsBackToWholeDay()
    {
        var now = new DateTimeOffset(2026, 1, 10, 21, 0, 0, TimeSpan.Zero);
        var events = LocalDailyFeeds(now, [9, 12, 15, 18])
            .Append(new ObservedEvent(Feeding, now.AddHours(-1), now.AddMinutes(-40)));

        var prediction = Assert.Single(Predict(events, Context(now)).Predictions);

        Assert.Null(prediction.Reason.Phase);
        Assert.Equal(now.AddHours(2), prediction.NextStart.Expected);
    }

    [Fact]
    public void Predict_SleepNaps_PredictsFromLastWakePlusAwakeWindow()
    {
        var events = Every(Sleep, TimeSpan.FromHours(3.5), Now.AddDays(-14), Now.AddHours(-2), TimeSpan.FromHours(1.5));
        var lastWake = events[^1].EndedAt!.Value;

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(PredictionBasis.AwakeWindow, prediction.Reason.Basis);
        Assert.Equal(lastWake.AddHours(2), prediction.NextStart.Expected);
        Assert.Equal(TimeSpan.FromHours(1.5), prediction.ExpectedDuration!.Median);
        Assert.StartsWith("Median awake window 2h after the last wake over the last 14 days", prediction.Reason.Text);
    }

    [Fact]
    public void Predict_SleepInProgress_MeasuresFromExpectedWake()
    {
        var events = Every(Sleep, TimeSpan.FromHours(3.5), Now.AddDays(-14), Now.AddHours(-2), TimeSpan.FromHours(1.5))
            .Append(new ObservedEvent(Sleep, Now.AddMinutes(-30), null));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(Now.AddHours(3), prediction.NextStart.Expected);
        Assert.True(prediction.Reason.AssumesEventInProgressEnds);
        Assert.EndsWith("Measured from the expected end of the one in progress.", prediction.Reason.Text);
    }

    [Fact]
    public void Predict_SleepInProgressLongerThanTypical_MeasuresFromNow()
    {
        var events = Every(Sleep, TimeSpan.FromHours(3.5), Now.AddDays(-14), Now.AddHours(-6), TimeSpan.FromHours(1.5))
            .Append(new ObservedEvent(Sleep, Now.AddHours(-3), null));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(Now.AddHours(2), prediction.NextStart.Expected);
    }

    [Fact]
    public void Predict_FeedingInProgress_CountsItsStartButNotItsDuration()
    {
        var runningStart = Now.AddMinutes(-10);
        var events = Every(Feeding, TimeSpan.FromHours(3), Now.AddDays(-14), Now.AddHours(-1), TimeSpan.FromMinutes(20))
            .Append(new ObservedEvent(Feeding, runningStart, null));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(runningStart.AddHours(3), prediction.NextStart.Expected);
        Assert.Equal(TimeSpan.FromMinutes(20), prediction.ExpectedDuration!.Median);
    }

    [Fact]
    public void Predict_DuplicateTimestamps_IgnoresZeroIntervals()
    {
        var once = Every(TummyTime, TimeSpan.FromHours(4), Now.AddDays(-14), Now.AddHours(-1), TimeSpan.FromMinutes(10));

        var prediction = Assert.Single(Predict(once.Concat(once)).Predictions);

        Assert.Equal(once.Count - 1, prediction.SampleCount);
        Assert.Equal(Now, prediction.NextStart.Expected);
    }

    [Fact]
    public void Predict_InstantEvents_HasNoExpectedDuration()
    {
        var events = Every(Diaper, TimeSpan.FromHours(3), Now.AddDays(-2), Now.AddHours(-1));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Null(prediction.ExpectedDuration);
        Assert.DoesNotContain("Typical duration", prediction.Reason.Text);
    }

    [Fact]
    public void Predict_LoggingGap_IsExcludedAsOutlier()
    {
        var events = Every(TummyTime, TimeSpan.FromHours(3), Now.AddDays(-4), Now.AddHours(-1));
        events.RemoveRange(10, 3);

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(27, prediction.SampleCount);
        Assert.Equal(events[^1].StartedAt.AddHours(3), prediction.NextStart.Latest);
    }

    [Fact]
    public void Predict_RhythmChangedRecently_WeightsRecentDaysHigher()
    {
        var older = Every(TummyTime, TimeSpan.FromHours(4), Now.AddDays(-14), Now.AddDays(-4));
        var recent = Every(TummyTime, TimeSpan.FromHours(2), Now.AddDays(-4).AddHours(2), Now.AddHours(-1));

        var prediction = Assert.Single(Predict(older.Concat(recent)).Predictions);

        Assert.True(older.Count > recent.Count);
        Assert.Equal(TimeSpan.FromHours(2), prediction.Reason.MedianGap);
        Assert.Equal(Now, prediction.NextStart.Expected);
    }

    [Fact]
    public void Predict_EnoughSamplesInCurrentAgeBand_UsesOnlyThatBand()
    {
        var birthday = new DateTimeOffset(2026, 1, 6, 0, 0, 0, TimeSpan.Zero);
        var events = Every(TummyTime, TimeSpan.FromHours(2), Now.AddDays(-14), birthday.AddHours(-1))
            .Concat(Every(TummyTime, TimeSpan.FromHours(3), birthday, Now.AddHours(-1)));

        var prediction = Assert.Single(Predict(events, Context(birthDate: new DateOnly(2025, 10, 6))).Predictions);

        Assert.Equal(AgeBand.ThreeToSixMonths, prediction.Reason.AgeBand);
        Assert.Equal(TimeSpan.FromHours(3), prediction.Reason.MedianGap);
        Assert.Contains("age 3-6m", prediction.Reason.Text);
    }

    [Fact]
    public void Predict_TooFewSamplesInCurrentAgeBand_FallsBackToAllAges()
    {
        var birthday = new DateTimeOffset(2026, 1, 10, 0, 0, 0, TimeSpan.Zero);
        var events = Every(TummyTime, TimeSpan.FromHours(2), Now.AddDays(-14), birthday.AddHours(-1))
            .Concat(Every(TummyTime, TimeSpan.FromHours(3), birthday, Now.AddHours(-1)));

        var prediction = Assert.Single(Predict(events, Context(birthDate: new DateOnly(2025, 10, 10))).Predictions);

        Assert.Null(prediction.Reason.AgeBand);
    }

    [Fact]
    public void Predict_EventsOutsideLookBackOrInFuture_AreIgnored()
    {
        var tooOld = Every(TummyTime, TimeSpan.FromHours(1), Now.AddDays(-20), Now.AddDays(-14).AddHours(-1));
        var inWindow = Every(TummyTime, TimeSpan.FromHours(4), Now.AddDays(-14), Now.AddHours(-1));
        var future = Every(TummyTime, TimeSpan.FromMinutes(30), Now.AddHours(1), Now.AddHours(5));

        var prediction = Assert.Single(Predict(tooOld.Concat(inWindow).Concat(future)).Predictions);

        Assert.Equal(inWindow.Count - 1, prediction.SampleCount);
        Assert.Equal(Now, prediction.NextStart.Expected);
    }

    [Fact]
    public void Predict_SameInstantsWithDifferentOffsets_GivesSameResult()
    {
        var now = Now.ToOffset(BrasiliaOffset);
        var history = RealisticHistory(now, BrasiliaOffset);
        var asUtc = history.Select(item => item with { StartedAt = item.StartedAt.ToUniversalTime(), EndedAt = item.EndedAt?.ToUniversalTime() });
        var asIndia = history.Select(item => item with { StartedAt = item.StartedAt.ToOffset(TimeSpan.FromHours(5.5)), EndedAt = item.EndedAt?.ToOffset(TimeSpan.FromHours(5.5)) });

        var expected = Predict(history, Context(now));

        Assert.Equal(expected.Predictions, Predict(asUtc, Context(now)).Predictions);
        Assert.Equal(expected.Predictions, Predict(asIndia, Context(now)).Predictions);
    }

    [Fact]
    public void Predict_ShuffledInput_IsDeterministic()
    {
        var now = Now.ToOffset(BrasiliaOffset);
        var context = Context(now);

        foreach (var seed in Enumerable.Range(1, 20))
        {
            var history = RealisticHistory(now, BrasiliaOffset, seed);
            var expected = Predict(history, context);
            var shuffled = Predict(Shuffle(history, seed * 7919), context);

            Assert.Equal(expected.Predictions, shuffled.Predictions);
            Assert.Equal(expected.InsufficientData, shuffled.InsufficientData);
        }
    }

    [Fact]
    public void Predict_RealisticHistory_PredictsFeedingAndSleepWithinPlausibleRanges()
    {
        var now = Now.ToOffset(BrasiliaOffset);
        var history = RealisticHistory(now, BrasiliaOffset);
        var lastFeedStart = history.Where(item => item.TypeKey == Feeding).Max(item => item.StartedAt);

        var result = Predict(history, Context(now));

        Assert.Equal([Feeding, Sleep], result.Predictions.Select(prediction => prediction.TypeKey));
        var feeding = result.Predictions[0];
        var sleep = result.Predictions[1];
        Assert.Equal(PredictionConfidence.High, feeding.Confidence);
        Assert.InRange(feeding.NextStart.Expected - lastFeedStart, TimeSpan.FromHours(2.5), TimeSpan.FromHours(4.5));
        Assert.InRange(feeding.ExpectedDuration!.Median, TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(30));
        Assert.Equal(PredictionBasis.AwakeWindow, sleep.Reason.Basis);
        Assert.InRange(sleep.Reason.MedianGap, TimeSpan.FromMinutes(20), TimeSpan.FromHours(2));
        Assert.InRange(sleep.ExpectedDuration!.Median, TimeSpan.FromHours(1), TimeSpan.FromHours(3.5));
        Assert.True(feeding.NextStart.Earliest <= feeding.NextStart.Expected && feeding.NextStart.Expected <= feeding.NextStart.Latest);
    }

    private static List<ObservedEvent> LocalDailyFeeds(DateTimeOffset now, int[] localHours)
    {
        var today = DateOnly.FromDateTime(now.DateTime);
        return Enumerable.Range(0, 15)
            .Select(daysBack => today.AddDays(-daysBack))
            .SelectMany(date => localHours.Select(hour => new DateTimeOffset(date.ToDateTime(new TimeOnly(hour, 0)), now.Offset)))
            .Where(start => start <= now)
            .Select(start => new ObservedEvent(Feeding, start, start.AddMinutes(20)))
            .ToList();
    }
}
