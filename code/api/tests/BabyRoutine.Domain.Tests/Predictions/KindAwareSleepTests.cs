using BabyRoutine.Domain.Predictions;
using static BabyRoutine.Domain.Tests.Predictions.PredictionFixtures;
using static BabyRoutine.Domain.Tests.Predictions.SleepFixtures;

namespace BabyRoutine.Domain.Tests.Predictions;

/// <summary>
/// Heuristic v1.1, kind-aware running sleeps (docs/ml/BENCHMARK.md, `heuristic_kind`; parity with
/// ml/benchmark/heuristic.py `wake_prediction(kind_aware=True)`): the expected end of a running sleep comes from
/// finished sessions of the same kind only. v1 took it from every session of the same day/night phase, so a nap
/// after 19:00 was expected to last a night and a bed time before 19:00 to last a nap.
/// </summary>
public sealed class KindAwareSleepTests
{
    [Fact]
    public void Predict_EveningNapInProgress_EndsLikeANapNotLikeANight()
    {
        var now = At(0, 19, 45);
        var events = FixtureDays(now).Append(Logged(SleepKinds.Nap, At(0, 19, 15), null));

        var result = Predict(events, Context(now));

        var sleep = Assert.Single(result.Predictions);
        Assert.True(sleep.Reason.AssumesEventInProgressEnds);
        // Typical nap 1h -> wake 20:15, plus the 2h 30m night-phase awake window. v1 used the nights of the night
        // phase (10h 30m), so it expected the wake at 05:45 and the next sleep at 08:15 tomorrow.
        Assert.Equal(At(0, 22, 45), sleep.NextStart.Expected);
        Assert.Equal(At(0, 20), result.BedTime!.NextStart.Expected);
    }

    [Fact]
    public void Predict_EarlyBedTimeInProgress_EndsLikeANightNotLikeANap()
    {
        var now = At(0, 19);
        var events = FixtureDays(now).Append(Marker(SleepKinds.BedTime, At(0, 18, 30)));

        var result = Predict(events, Context(now));

        var sleep = Assert.Single(result.Predictions);
        Assert.True(sleep.Reason.AssumesEventInProgressEnds);
        // Typical night 10h 30m -> wake 05:00, plus the 2h 30m night-phase awake window. v1 used the naps of the day
        // phase (1h), so it expected the wake at 19:30 and the next sleep at 22:00 tonight.
        Assert.Equal(At(1, 7, 30), sleep.NextStart.Expected);
        Assert.Null(result.BedTime);
    }

    [Fact]
    public void Predict_FixtureNightInProgress_StillEndsAtTheTypicalWakeUp()
    {
        var now = At(0, 23);

        var sleep = PredictSleep(FixtureDays(now), now);

        Assert.True(sleep.Reason.AssumesEventInProgressEnds);
        Assert.Equal(At(1, 9), sleep.NextStart.Expected);
    }

    [Fact]
    public void Predict_TooFewFinishedSessionsOfTheRunningKind_HasNoTypicalDurationAndMeasuresFromNow()
    {
        var now = At(0, 9, 30);
        var events = Enumerable.Range(1, 5).SelectMany(day => Night(-day, 20))
            .Append(Logged(SleepKinds.Nap, At(-2, 10), At(-2, 11)))
            .Append(Logged(SleepKinds.Nap, At(-1, 10), At(-1, 11)))
            .Append(Logged(SleepKinds.Nap, At(0, 9), null));

        var sleep = PredictSleep(events, now);

        // Two finished naps are fewer than the 3 samples needed, and nights never stand in for a nap: the running nap
        // has no typical duration, so the next start is measured from now. v1 used the five 10h nights and measured
        // from 19:00.
        Assert.True(sleep.Reason.AssumesEventInProgressEnds);
        Assert.Equal(now + sleep.Reason.MedianGap, sleep.NextStart.Expected);
    }

    [Theory]
    [InlineData(true, 11)]
    [InlineData(false, 12)]
    public void Predict_RunningNap_UsesNapsOfTheCurrentAgeBandWhenEnoughElseAllNaps(bool enoughInBand, int expectedWakeHour)
    {
        var turnedThreeMonths = new DateOnly(2025, 10, 7);
        var now = At(0, 10, 30);
        var olderBand = Enumerable.Range(4, 5).Select(day => Logged(SleepKinds.Nap, At(-day, 10), At(-day, 12)));
        var inBandHours = enoughInBand ? new[] { 10, 13 } : [10];
        var inBandDays = enoughInBand ? Enumerable.Range(1, 3) : Enumerable.Range(1, 2);
        var currentBand = inBandDays.SelectMany(day => inBandHours.Select(hour => Logged(SleepKinds.Nap, At(-day, hour), At(-day, hour + 1))));
        var events = olderBand.Concat(currentBand).Append(Logged(SleepKinds.Nap, At(0, 10), null));

        var sleep = Assert.Single(Predict(events, Context(now, turnedThreeMonths)).Predictions);

        Assert.True(sleep.Reason.AssumesEventInProgressEnds);
        Assert.Equal(At(0, expectedWakeHour), sleep.NextStart.Expected - sleep.Reason.MedianGap);
    }
}
