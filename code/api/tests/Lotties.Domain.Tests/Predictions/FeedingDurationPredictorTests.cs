using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class FeedingDurationPredictorTests
{
    private static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    private static readonly DateOnly BirthDate = new(2025, 9, 1);
    private static readonly DateTimeOffset Now = new(2025, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private static readonly PredictionContext Context = new(BirthDate, Now);

    [Fact]
    public void Predict_ReturnsNull_WhenNoEvents()
    {
        var result = FeedingDurationPredictor.Predict([], 120, Context, PredictionOptions.Default);
        Assert.Null(result);
    }

    [Fact]
    public void Predict_ReturnsNull_WhenTargetVolumeIsZero()
    {
        var events = MakeFeedingEventsWithDurationAndVolume(
            [(100, 15), (120, 18), (90, 14), (110, 16), (130, 20)], Now);
        var result = FeedingDurationPredictor.Predict(events, 0, Context, PredictionOptions.Default);
        Assert.Null(result);
    }

    [Fact]
    public void Predict_ReturnsNull_WhenBelowMinimumSamples()
    {
        var events = MakeFeedingEventsWithDurationAndVolume(
            [(100, 15), (120, 18), (90, 14)], Now);
        var result = FeedingDurationPredictor.Predict(events, 120, Context, PredictionOptions.Default);
        Assert.Null(result);
    }

    [Fact]
    public void Predict_ReturnsPrediction_WhenEnoughSamples()
    {
        // Duration roughly proportional to volume: ~0.15 min/ml + 2 min base.
        var events = MakeFeedingEventsWithDurationAndVolume(
            [(80, 14), (100, 17), (120, 20), (140, 23), (160, 26), (90, 15.5)], Now);
        var result = FeedingDurationPredictor.Predict(events, 120, Context, PredictionOptions.Default);

        Assert.NotNull(result);
        Assert.Equal(6, result.SampleCount);
        Assert.Equal(120, result.VolumeMl);
        Assert.True(result.ExpectedDurationMinutes > 0);
    }

    [Fact]
    public void Predict_IgnoresRunningEvents()
    {
        var finished = MakeFeedingEventsWithDurationAndVolume(
            [(100, 15), (120, 18), (90, 14), (110, 16), (130, 20)], Now);
        // Running event has no EndedAt, so EffectiveDuration is null.
        var running = new ObservedEvent(Feeding, Now.AddMinutes(-5), null, VolumeMl: 150);
        var events = new List<ObservedEvent>(finished) { running };

        var result = FeedingDurationPredictor.Predict(events, 120, Context, PredictionOptions.Default);

        Assert.NotNull(result);
        Assert.Equal(5, result.SampleCount);
    }

    [Fact]
    public void Predict_IgnoresEventsWithoutVolume()
    {
        var withVolume = MakeFeedingEventsWithDurationAndVolume(
            [(100, 15), (120, 18), (90, 14), (110, 16), (130, 20)], Now);
        var withoutVolume = new ObservedEvent(Feeding, Now.AddHours(-1), Now.AddMinutes(-40));
        var events = new List<ObservedEvent>(withVolume) { withoutVolume };

        var result = FeedingDurationPredictor.Predict(events, 120, Context, PredictionOptions.Default);

        Assert.NotNull(result);
        Assert.Equal(5, result.SampleCount);
    }

    private static ObservedEvent[] MakeFeedingEventsWithDurationAndVolume(
        (double VolumeMl, double DurationMinutes)[] samples, DateTimeOffset now)
    {
        var events = new ObservedEvent[samples.Length];
        for (var i = 0; i < samples.Length; i++)
        {
            var start = now.AddHours(-(i + 1) * 3);
            var end = start.AddMinutes(samples[i].DurationMinutes);
            events[i] = new ObservedEvent(Feeding, start, end, VolumeMl: samples[i].VolumeMl);
        }
        return events;
    }
}