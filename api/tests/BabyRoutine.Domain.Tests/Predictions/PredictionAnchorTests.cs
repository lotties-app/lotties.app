using BabyRoutine.Domain.Predictions;
using static BabyRoutine.Domain.Tests.Predictions.PredictionFixtures;

namespace BabyRoutine.Domain.Tests.Predictions;

public sealed class PredictionAnchorTests
{
    private static readonly DateTimeOffset Now = TestClock.Now;

    [Fact]
    public void AnchorAt_StartInterval_IsTheLastStart()
    {
        var events = Every(TummyTime, TimeSpan.FromHours(4), Now.AddHours(-13), Now.AddHours(-1));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(Now.AddHours(-1), prediction.AnchorAt);
        Assert.Equal(TimeSpan.Zero, prediction.AnchorAt.Offset);
    }

    [Fact]
    public void AnchorAt_AwakeWindow_IsTheEndOfTheLastSleep()
    {
        var events = Every(Sleep, TimeSpan.FromHours(3.5), Now.AddDays(-14), Now.AddHours(-2), TimeSpan.FromHours(1.5));
        var lastWake = events[^1].EndedAt!.Value;

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.Equal(lastWake, prediction.AnchorAt);
        Assert.False(prediction.Reason.AssumesEventInProgressEnds);
    }

    [Fact]
    public void AnchorAt_SleepRunning_IsTheExpectedWakeNotBeforeNow()
    {
        var events = Every(Sleep, TimeSpan.FromHours(3.5), Now.AddDays(-14), Now.AddHours(-4), TimeSpan.FromHours(1.5));
        events.Add(new ObservedEvent(Sleep, Now.AddMinutes(-10), null));

        var prediction = Assert.Single(Predict(events).Predictions);

        Assert.True(prediction.Reason.AssumesEventInProgressEnds);
        Assert.True(prediction.AnchorAt >= Now);
    }
}
