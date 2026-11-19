using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class FeedingVolumePredictorTests
{
    private static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    private static readonly DateOnly BirthDate = new(2025, 9, 1);
    private static readonly DateTimeOffset Now = new(2025, 11, 15, 12, 0, 0, TimeSpan.Zero);
    private static readonly PredictionContext Context = new(BirthDate, Now);

    [Fact]
    public void Predict_ReturnsNull_WhenNoEvents()
    {
        var result = FeedingVolumePredictor.Predict([], Context, PredictionOptions.Default);
        Assert.Null(result);
    }

    [Fact]
    public void Predict_ReturnsNull_WhenNoVolumes()
    {
        var events = new[]
        {
            new ObservedEvent(Feeding, Now.AddHours(-3), Now.AddHours(-2)),
            new ObservedEvent(Feeding, Now.AddHours(-6), Now.AddHours(-5)),
        };

        var result = FeedingVolumePredictor.Predict(events, Context, PredictionOptions.Default);
        Assert.Null(result);
    }

    [Fact]
    public void Predict_ReturnsNull_WhenBelowMinimumSamples()
    {
        var events = MakeFeedingEventsWithVolume([90, 100, 110], Now);
        var result = FeedingVolumePredictor.Predict(events, Context, PredictionOptions.Default);
        Assert.Null(result);
    }

    [Fact]
    public void Predict_ReturnsPrediction_WhenEnoughSamples()
    {
        var volumes = new double[] { 80, 90, 100, 110, 120, 130 };
        var events = MakeFeedingEventsWithVolume(volumes, Now);
        var result = FeedingVolumePredictor.Predict(events, Context, PredictionOptions.Default);

        Assert.NotNull(result);
        Assert.Single(result);
        Assert.Equal(6, result[0].SampleCount);
        Assert.True(result[0].MedianVolumeMl > 0);
        Assert.True(result[0].LowerBoundMl <= result[0].MedianVolumeMl);
        Assert.True(result[0].UpperBoundMl >= result[0].MedianVolumeMl);
    }

    [Fact]
    public void Predict_IgnoresRunningEvents()
    {
        // Running events have no EndedAt, should be excluded.
        var finished = MakeFeedingEventsWithVolume([80, 90, 100, 110, 120], Now);
        var running = new ObservedEvent(Feeding, Now.AddMinutes(-5), null, VolumeMl: 150);
        var events = new List<ObservedEvent>(finished) { running };

        var result = FeedingVolumePredictor.Predict(events, Context, PredictionOptions.Default);

        Assert.NotNull(result);
        Assert.Equal(5, result[0].SampleCount);
    }

    [Fact]
    public void Predict_IgnoresZeroAndNegativeVolumes()
    {
        var events = new List<ObservedEvent>();
        foreach (var vol in new double[] { 80, 90, 100, 110, 120 })
        {
            events.Add(new ObservedEvent(Feeding, Now.AddHours(-events.Count * 3), Now.AddHours(-events.Count * 3 + 1), VolumeMl: vol));
        }
        // Add zero-volume event that should be ignored.
        events.Add(new ObservedEvent(Feeding, Now.AddHours(-20), Now.AddHours(-19), VolumeMl: 0));

        var result = FeedingVolumePredictor.Predict(events, Context, PredictionOptions.Default);

        Assert.NotNull(result);
        Assert.Equal(5, result[0].SampleCount);
    }

    private static ObservedEvent[] MakeFeedingEventsWithVolume(double[] volumes, DateTimeOffset now)
    {
        var events = new ObservedEvent[volumes.Length];
        for (var i = 0; i < volumes.Length; i++)
        {
            var start = now.AddHours(-(i + 1) * 3);
            events[i] = new ObservedEvent(Feeding, start, start.AddMinutes(20), VolumeMl: volumes[i]);
        }
        return events;
    }
}