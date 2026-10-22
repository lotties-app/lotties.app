using Lotties.Domain.Events;
using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Predictions.PredictionFixtures;

namespace Lotties.Domain.Tests.Predictions;

/// <summary>
/// <see cref="DiaperPredictions"/> (docs/design/11-patterns.md section 8): gaps between wet and dirty diapers, the lag
/// after feeds, their gates, confidence, daylight saving and the wet trend.
/// </summary>
public sealed class DiaperPredictionsTests
{
    /// <summary>A São Paulo (UTC-3) wall-clock time on 2026-01-<paramref name="day"/>.</summary>
    private static DateTimeOffset At(int day, int hour, int minute = 0) => new(2026, 1, day, hour, minute, 0, BrasiliaOffset);

    private static ObservedEvent Change(DateTimeOffset at, string content) => new(Diaper, at, at, Content: content);

    private static ObservedEvent Feed(DateTimeOffset start, int minutes) => new(Feeding, start, start.AddMinutes(minutes));

    /// <summary><paramref name="count"/> diapers of <paramref name="content"/>, <paramref name="gapMinutes"/> apart from <paramref name="first"/>.</summary>
    private static List<ObservedEvent> Every(int gapMinutes, DateTimeOffset first, int count, string content = DiaperContents.Wet) =>
        Enumerable.Range(0, count).Select(index => Change(first.AddMinutes(index * gapMinutes), content)).ToList();

    /// <summary>One 20-minute feed at 06:00 on consecutive days from the 10th, each followed by a dirty diaper <c>lag</c> minutes after it ended.</summary>
    private static List<ObservedEvent> DirtyAfterFeeds(params int[] lags) =>
        lags.SelectMany((lag, index) => new[] { Feed(At(10 + index, 6), 20), Change(At(10 + index, 6, 20).AddMinutes(lag), DiaperContents.Dirty) }).ToList();

    [Fact]
    public void Predict_RegularWetDiapers_ExpectsTheNextOneAfterTheMedianGapFromTheLatest()
    {
        var events = Every(180, At(10, 0), 16);

        var wet = Assert.IsType<DiaperGapPrediction>(DiaperPredictions.Predict(events, At(11, 22)).Wet);

        Assert.Equal(At(11, 21), wet.AnchorAt);
        Assert.Equal((180, 180, 180), ((int)wet.LowerGap.TotalMinutes, (int)wet.MedianGap.TotalMinutes, (int)wet.UpperGap.TotalMinutes));
        Assert.Equal(new NextStartWindow(At(12, 0), At(12, 0), At(12, 0)), wet.Window);
        Assert.Equal((16, 15), (wet.EventCount, wet.GapCount));
        Assert.Equal(PredictionConfidence.Medium, wet.Confidence);
    }

    [Theory]
    [InlineData(7, false)]
    [InlineData(8, true)]
    public void Predict_WetGate_NeedsEightWetDiapersInTheLastSevenDays(int count, bool predicted)
    {
        var events = Every(180, At(10, 0), count);

        Assert.Equal(predicted, DiaperPredictions.Predict(events, At(12, 0)).Wet is not null);
    }

    [Fact]
    public void Predict_WetDiapersOlderThanSevenDays_DoNotCount()
    {
        var events = Every(180, At(1, 0), 8).Concat(Every(180, At(9, 0), 4)).ToList();

        Assert.Null(DiaperPredictions.Predict(events, At(10, 0)).Wet);
    }

    [Fact]
    public void Predict_NoData_PredictsNothing()
    {
        var prediction = DiaperPredictions.Predict([], At(10, 0));

        Assert.Equal(DiaperPrediction.None, prediction);
        Assert.Null(prediction.WetExpectation());
        Assert.Null(prediction.DirtyExpectation(At(10, 0)));
    }

    [Fact]
    public void Predict_MixedCountsAsWetAndDirty_DirtyIsNotWet_ContentIsReadLeniently()
    {
        var mixed = Every(180, At(10, 0), 8, DiaperContents.Mixed);
        var dirty = Every(180, At(10, 0), 8, DiaperContents.Dirty);
        var lenient = Every(180, At(10, 0), 8, " wet ");

        Assert.NotNull(DiaperPredictions.Predict(mixed, At(12, 0)).Wet);
        Assert.NotNull(DiaperPredictions.Predict(mixed, At(12, 0)).Dirty?.Gap);
        Assert.Null(DiaperPredictions.Predict(dirty, At(12, 0)).Wet);
        Assert.NotNull(DiaperPredictions.Predict(lenient, At(12, 0)).Wet);
        Assert.Equal((true, true, false, false), (DiaperContents.IsWet("MIXED"), DiaperContents.IsDirty("mixed"), DiaperContents.IsWet("DIRTY"), DiaperContents.IsDirty(null)));
    }

    [Fact]
    public void Predict_DuplicatesAndLoggingGaps_AreDropped()
    {
        var events = Every(180, At(10, 0), 11);
        events.Add(Change(At(10, 0, 0).AddSeconds(30), DiaperContents.Wet));
        events.AddRange(Every(180, At(12, 0), 3));

        var wet = Assert.IsType<DiaperGapPrediction>(DiaperPredictions.Predict(events, At(12, 7)).Wet);

        // The 30-second duplicate and the 18-hour logging gap are dropped: 12 gaps of about 3 hours remain.
        Assert.Equal((15, 12), (wet.EventCount, wet.GapCount));
        Assert.Equal(TimeSpan.FromMinutes(180), wet.MedianGap);
    }

    [Fact]
    public void Predict_TightGaps_AreMoreConfidentThanNoisyOnes()
    {
        var tight = Every(150, At(9, 0), 24);
        var noisyGaps = Enumerable.Range(0, 12).Select(index => new[] { 60, 120, 300 }[index % 3]).ToArray();
        var noisy = noisyGaps.Select((_, index) => Change(At(10, 0).AddMinutes(noisyGaps.Take(index).Sum()), DiaperContents.Wet)).ToList();

        var tightWet = DiaperPredictions.Predict(tight, At(11, 12)).Wet!;
        var noisyWet = DiaperPredictions.Predict(noisy, At(11, 6)).Wet!;

        Assert.Equal(PredictionConfidence.High, tightWet.Confidence);
        Assert.Equal(PredictionConfidence.Low, noisyWet.Confidence);
        Assert.Equal((60, 120, 300), ((int)noisyWet.LowerGap.TotalMinutes, (int)noisyWet.MedianGap.TotalMinutes, (int)noisyWet.UpperGap.TotalMinutes));
    }

    [Fact]
    public void Predict_RecentGaps_WeighMoreThanOlderOnes()
    {
        var older = Every(240, At(3, 0), 11);
        var recent = Every(120, At(9, 0), 11);

        var wet = DiaperPredictions.Predict(older.Concat(recent), At(9, 21)).Wet!;

        Assert.Equal(TimeSpan.FromMinutes(120), wet.MedianGap);
    }

    [Fact]
    public void Predict_AcrossTheDaylightSavingChange_GapsAreElapsedTime()
    {
        var newYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var first = new DateTimeOffset(new DateTime(2026, 3, 7, 18, 0, 0), newYork.GetUtcOffset(new DateTime(2026, 3, 7, 18, 0, 0)));
        var events = Every(180, first, 10);
        var last = events[^1].StartedAt;

        var wet = DiaperPredictions.Predict(events, last.AddMinutes(30)).Wet!;

        // 2026-03-08 02:00 EST jumped to 03:00 EDT inside these 27 hours: every gap is still 180 minutes of real time.
        Assert.Equal(TimeSpan.FromMinutes(180), wet.MedianGap);
        Assert.Equal(last.AddHours(3), wet.Window.Expected);
        Assert.Equal(TimeSpan.FromHours(-4), newYork.GetUtcOffset(wet.Window.Expected));
    }

    [Fact]
    public void Predict_InputOrderAndFutureEvents_DoNotMatter()
    {
        var events = Every(180, At(10, 0), 12).Concat(DirtyAfterFeeds(25, 30, 35, 40, 45)).ToList();
        var withFuture = events.Append(Change(At(20, 0), DiaperContents.Mixed)).ToList();

        var ordered = DiaperPredictions.Predict(events, At(15, 0));
        var shuffled = DiaperPredictions.Predict(Shuffle(withFuture, 7), At(15, 0));

        Assert.Equal(ordered, shuffled);
    }

    [Theory]
    [InlineData(4, false)]
    [InlineData(5, true)]
    public void Predict_DirtyGapGate_NeedsFiveDirtyDiapersInTheLastFourteenDays(int count, bool predicted)
    {
        var events = Every(600, At(10, 0), count, DiaperContents.Dirty);

        Assert.Equal(predicted, DiaperPredictions.Predict(events, At(14, 0)).Dirty?.Gap is not null);
    }

    [Fact]
    public void Predict_DirtyAfterFeedsWithATightLag_LearnsTheLag()
    {
        var events = DirtyAfterFeeds(25, 30, 35, 40, 45);

        var lag = Assert.IsType<DiaperFeedLag>(DiaperPredictions.Predict(events, At(15, 12)).Dirty?.AfterFeed);

        Assert.Equal((30, 35, 40, 5), ((int)lag.LowerLag.TotalMinutes, (int)lag.MedianLag.TotalMinutes, (int)lag.UpperLag.TotalMinutes, lag.PairCount));
        Assert.Equal(At(14, 6, 20), lag.LatestFeedEndedAt);
        Assert.Equal(PredictionConfidence.Low, lag.Confidence);
        Assert.Equal(new NextStartWindow(At(15, 10, 30), At(15, 10, 35), At(15, 10, 40)), lag.WindowAfter(At(15, 10)));
    }

    [Fact]
    public void Predict_EightTightPairs_AreMediumConfidence()
    {
        var lag = DiaperPredictions.Predict(DirtyAfterFeeds(25, 30, 30, 35, 35, 40, 40, 45), At(18, 12)).Dirty!.AfterFeed!;

        Assert.Equal((8, PredictionConfidence.Medium), (lag.PairCount, lag.Confidence));
    }

    [Theory]
    [InlineData(new[] { 10, 40, 80, 120, 170 })]
    [InlineData(new[] { 25, 30, 35, 40 })]
    public void Predict_NoisyLagsOrTooFewPairs_HaveNoAfterFeedSignal(int[] lags)
    {
        Assert.Null(DiaperPredictions.Predict(DirtyAfterFeeds(lags), At(16, 12)).Dirty?.AfterFeed);
    }

    [Fact]
    public void Predict_OnlyTheFirstDirtyDiaperWithinThreeHoursOfAFinishedFeedIsAPair()
    {
        var events = DirtyAfterFeeds(30, 30, 30, 30);
        events.Add(Change(At(13, 7, 30), DiaperContents.Dirty));
        events.Add(Feed(At(14, 6), 20));
        events.Add(Change(At(14, 10, 30), DiaperContents.Dirty));
        events.Add(new ObservedEvent(Feeding, At(15, 6), null));
        events.Add(Change(At(15, 6, 40), DiaperContents.Dirty));

        var fourPairs = DiaperPredictions.Predict(events, At(15, 12)).Dirty?.AfterFeed;
        var fifth = DiaperPredictions.Predict(events.Append(Feed(At(15, 9), 0)).Append(Change(At(15, 9, 30), DiaperContents.Dirty)), At(15, 12)).Dirty?.AfterFeed;

        // The second dirty diaper after the feed of the 13th, the one 4 h 10 min after the 14th's feed and the one during
        // a running feed are no pairs; a fifth pair after the instant feed of the 15th passes the gate.
        Assert.Null(fourPairs);
        Assert.Equal((5, At(15, 9)), (fifth?.PairCount, fifth?.LatestFeedEndedAt));
    }

    [Fact]
    public void Predict_InstantFeed_LagCountsFromItsStart()
    {
        var events = Enumerable.Range(0, 5)
            .SelectMany(index => new[] { Feed(At(10 + index, 6), 0), Change(At(10 + index, 6, 30), DiaperContents.Dirty) })
            .ToList();

        var lag = DiaperPredictions.Predict(events, At(15, 0)).Dirty!.AfterFeed!;

        Assert.Equal(TimeSpan.FromMinutes(30), lag.MedianLag);
    }

    [Fact]
    public void DirtyExpectation_AfterARecentFeedWithoutADirtyDiaperSince_UsesTheLag()
    {
        var events = DirtyAfterFeeds(25, 30, 35, 40, 45);
        events.Add(Feed(At(15, 10), 15));

        var expected = DiaperPredictions.Predict(events, At(15, 11)).DirtyExpectation(At(15, 11));

        Assert.Equal(DiaperSignal.DirtyAfterFeed, expected?.Signal);
        Assert.Equal(At(15, 10, 15), expected!.AnchorAt);
        Assert.Equal(new NextStartWindow(At(15, 10, 45), At(15, 10, 50), At(15, 10, 55)), expected.Window);
    }

    [Fact]
    public void DirtyExpectation_DirtyDiaperSinceTheFeedOrAnOldFeed_FallsBackToTheGaps()
    {
        var events = DirtyAfterFeeds(25, 30, 35, 40, 45);
        events.Add(Feed(At(15, 10), 15));
        var handled = events.Append(Change(At(15, 10, 40), DiaperContents.Dirty)).ToList();

        var afterDirty = DiaperPredictions.Predict(handled, At(15, 11)).DirtyExpectation(At(15, 11));
        var oldFeed = DiaperPredictions.Predict(events, At(15, 13, 16)).DirtyExpectation(At(15, 13, 16));

        Assert.Equal((DiaperSignal.DirtyGap, At(15, 10, 40)), (afterDirty?.Signal, afterDirty?.AnchorAt));
        Assert.Equal((DiaperSignal.DirtyGap, At(14, 7, 5)), (oldFeed?.Signal, oldFeed?.AnchorAt));
    }

    [Fact]
    public void DirtyExpectation_NoGapSignalAndTheFeedHandled_IsNothing()
    {
        var lag = DiaperPredictions.Predict(DirtyAfterFeeds(25, 30, 35, 40, 45), At(15, 0)).Dirty!.AfterFeed;
        var lagOnly = new DiaperPrediction(null, new DirtyDiaperPrediction(null, lag, At(14, 7, 5)), null);

        Assert.Null(lagOnly.DirtyExpectation(At(15, 0)));
        Assert.Equal(DiaperSignal.DirtyAfterFeed, (lagOnly with { Dirty = lagOnly.Dirty! with { LastDirtyAt = At(14, 6) } }).DirtyExpectation(At(14, 7))?.Signal);
    }

    [Fact]
    public void WetExpectation_IsAnchoredAtTheLatestWetDiaper()
    {
        var prediction = DiaperPredictions.Predict(Every(180, At(10, 0), 10), At(11, 4));

        Assert.Equal(new DiaperExpectation(DiaperSignal.WetGap, At(11, 3), new NextStartWindow(At(11, 6), At(11, 6), At(11, 6))), prediction.WetExpectation());
    }

    [Fact]
    public void Predict_WetDiapersDroppedSharplyInTheLastDay_IsNoted()
    {
        var usual = Every(180, At(10, 0), 48);
        var dropped = usual.Append(Change(At(16, 12), DiaperContents.Wet)).ToList();
        var steady = Every(180, At(10, 0), 56);

        var droppedTrend = DiaperPredictions.Predict(dropped, At(17, 0)).WetTrend!;
        var steadyTrend = DiaperPredictions.Predict(steady, At(17, 0)).WetTrend!;

        Assert.Equal((1, 8.0, true), (droppedTrend.Recent, droppedTrend.UsualPerSpan, droppedTrend.DroppedSharply));
        Assert.Equal((8, 8.0, false), (steadyTrend.Recent, steadyTrend.UsualPerSpan, steadyTrend.DroppedSharply));
    }

    [Fact]
    public void Predict_LessThanTwoDaysOfWetHistory_HasNoTrend()
    {
        Assert.Null(DiaperPredictions.Predict(Every(180, At(10, 0), 16), At(11, 22)).WetTrend);
    }

    [Fact]
    public void Read_DiaperContent_IsTheContentMemberWhenItIsAString()
    {
        Assert.Equal("MIXED", EventPayloadFacts.Read(EventPayload.From("""{"content":"MIXED"}""")).Content);
        Assert.Null(EventPayloadFacts.Read(EventPayload.From("""{"content":3}""")).Content);
    }
}
