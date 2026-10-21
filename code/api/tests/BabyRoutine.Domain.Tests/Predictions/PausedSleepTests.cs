using BabyRoutine.Domain.Predictions;
using static BabyRoutine.Domain.Tests.Predictions.PredictionFixtures;
using static BabyRoutine.Domain.Tests.Predictions.SleepFixtures;

namespace BabyRoutine.Domain.Tests.Predictions;

/// <summary>
/// Pauses (the baby stirred or was briefly awake) are excluded from sleep durations: typical durations use the effective
/// duration, and a running sleep's expected end adds the pauses it already had. Awake windows (end to next start) are
/// unchanged.
/// </summary>
public sealed class PausedSleepTests
{
    private static readonly TimeSpan FifteenMinutes = TimeSpan.FromMinutes(15);

    private static IEnumerable<ObservedEvent> WithPausedNaps(IEnumerable<ObservedEvent> events) =>
        events.Select(item => item.Kind == SleepKinds.Nap ? item with { Paused = FifteenMinutes } : item);

    [Fact]
    public void Predict_EveningNapInProgress_WithoutPauses_IsUnchanged()
    {
        var now = At(0, 19, 45);

        var sleep = PredictSleep(FixtureDays(now).Append(Logged(SleepKinds.Nap, At(0, 19, 15), null)), now);

        Assert.Equal(At(0, 22, 45), sleep.NextStart.Expected);
    }

    [Fact]
    public void Predict_PausedNapsAndRunningNapWithAPause_UseEffectiveDurationsPlusTheRunningPause()
    {
        var now = At(0, 19, 45);
        var running = Logged(SleepKinds.Nap, At(0, 19, 15), null) with { Paused = TimeSpan.FromMinutes(10) };

        var sleep = PredictSleep(WithPausedNaps(FixtureDays(now)).Append(running), now);

        // Finished naps last 45, 75 and 45 minutes without their pauses (typical 45 min): wake 19:15 + 45 min + 10 min
        // already paused = 20:10, plus the unchanged 2h 30m night-phase awake window.
        Assert.True(sleep.Reason.AssumesEventInProgressEnds);
        Assert.Equal(At(0, 22, 40), sleep.NextStart.Expected);
    }

    [Fact]
    public void Predict_PausedNaps_ShortenTheExpectedNapDuration()
    {
        var now = At(0, 10, 30);
        var plain = PredictSleep(FixtureDays(now), now);

        var paused = PredictSleep(WithPausedNaps(FixtureDays(now)), now);

        Assert.Equal(plain.NextStart, paused.NextStart);
        Assert.Equal(plain.ExpectedDuration!.Median - FifteenMinutes, paused.ExpectedDuration!.Median);
    }

    [Fact]
    public void EffectiveDuration_OfObservedEvent_ExcludesPausesAndIsNullWhileRunning()
    {
        var finished = Logged(SleepKinds.Nap, At(0, 23, 30), At(1, 1)) with { Paused = TimeSpan.FromMinutes(20) };

        Assert.Equal((TimeSpan?)TimeSpan.FromMinutes(70), finished.EffectiveDuration);
        Assert.Null(Logged(SleepKinds.Nap, At(0, 9), null).EffectiveDuration);
    }
}
