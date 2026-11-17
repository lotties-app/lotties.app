using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Predictions.PredictionFixtures;

namespace Lotties.Domain.Tests.Predictions;

public sealed class AdaptiveLookBackTests
{
    private static readonly DateTimeOffset Now = TestClock.Now;

    [Fact]
    public void Resolve_AdaptationDisabled_ReturnsDefaultLookBack()
    {
        var events = Every(Feeding, TimeSpan.FromHours(4), Now.AddDays(-20), Now);
        var options = PredictionOptions.Default with { LookBackAdaptationEnabled = false };

        var result = AdaptiveLookBack.Resolve(events, Context(), options);

        Assert.Equal(TimeSpan.FromDays(14), result);
    }

    [Fact]
    public void Resolve_NoEvents_ReturnsDefaultLookBack()
    {
        var options = PredictionOptions.Default with { LookBackAdaptationEnabled = true };

        var result = AdaptiveLookBack.Resolve([], Context(), options);

        Assert.Equal(TimeSpan.FromDays(14), result);
    }

    [Fact]
    public void Resolve_SparseLogger_ExtendsBeyondFourteenDays()
    {
        // Only 4 events over 20 days: too few gaps in 14 days but enough in 21.
        var events = new List<ObservedEvent>
        {
            new(Feeding, Now.AddDays(-20), Now.AddDays(-20).AddMinutes(20)),
            new(Feeding, Now.AddDays(-15), Now.AddDays(-15).AddMinutes(20)),
            new(Feeding, Now.AddDays(-10), Now.AddDays(-10).AddMinutes(20)),
            new(Feeding, Now.AddDays(-5), Now.AddDays(-5).AddMinutes(20)),
        };
        var options = PredictionOptions.Default with
        {
            LookBackAdaptationEnabled = true,
            MinimumBucketSamples = 3,
        };

        var result = AdaptiveLookBack.Resolve(events, Context(), options);

        Assert.True(result > TimeSpan.FromDays(14), $"Expected extension beyond 14 days, got {result.TotalDays} days.");
        Assert.True(result <= TimeSpan.FromDays(28), $"Expected at most 28 days, got {result.TotalDays} days.");
    }

    [Fact]
    public void Resolve_DenseStableData_KeepsDefaultLookBack()
    {
        var events = Every(Feeding, TimeSpan.FromHours(3), Now.AddDays(-14), Now);
        var options = PredictionOptions.Default with { LookBackAdaptationEnabled = true };

        var result = AdaptiveLookBack.Resolve(events, Context(), options);

        Assert.Equal(TimeSpan.FromDays(14), result);
    }

    [Fact]
    public void Resolve_RegimeChange_ShrinksToMinLookBack()
    {
        // Older half: tight 4h gaps with small jitter (low CV). Recent half: chaotic 1-8h gaps (high CV).
        var events = new List<ObservedEvent>();
        var olderStart = Now.AddDays(-14);
        for (var i = 0; i < 42; i++)
        {
            var jitter = TimeSpan.FromMinutes((i % 3) * 5);
            events.Add(new ObservedEvent(Feeding, olderStart.AddHours(i * 4).Add(jitter), olderStart.AddHours(i * 4).Add(jitter).AddMinutes(20)));
        }

        var recentStart = Now.AddDays(-7);
        var random = new Random(99);
        var recentTime = recentStart;
        while (recentTime < Now)
        {
            var gap = TimeSpan.FromHours(1 + random.NextDouble() * 7);
            recentTime += gap;
            if (recentTime <= Now)
            {
                events.Add(new ObservedEvent(Feeding, recentTime, recentTime.AddMinutes(20)));
            }
        }

        var options = PredictionOptions.Default with
        {
            LookBackAdaptationEnabled = true,
            MinLookBack = TimeSpan.FromDays(7),
            MinimumSamples = 3,
        };

        var result = AdaptiveLookBack.Resolve(events.OrderBy(e => e.StartedAt).ToArray(), Context(), options);

        Assert.Equal(TimeSpan.FromDays(7), result);
    }

    [Fact]
    public void Resolve_NeverExtendsBeforeBirthDate()
    {
        var birthDate = DateOnly.FromDateTime(Now.AddDays(-10).DateTime);
        var events = new List<ObservedEvent>
        {
            new(Feeding, Now.AddDays(-9), Now.AddDays(-9).AddMinutes(20)),
            new(Feeding, Now.AddDays(-5), Now.AddDays(-5).AddMinutes(20)),
        };
        var context = new PredictionContext(birthDate, Now);
        var options = PredictionOptions.Default with
        {
            LookBackAdaptationEnabled = true,
            MaxLookBack = TimeSpan.FromDays(28),
        };

        var result = AdaptiveLookBack.Resolve(events, context, options);

        // Should not extend significantly beyond the baby's age (10 days); allow up to 1 day for time-of-day rounding.
        Assert.True(result <= TimeSpan.FromDays(11), $"Expected at most ~10 days (baby's age), got {result.TotalDays} days.");
    }
}