using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Predictions.PredictionFixtures;

namespace Lotties.Domain.Tests.Predictions;

public sealed class ColdStartPriorTests
{
    private static readonly DateTimeOffset Now = TestClock.Now;

    [Fact]
    public void Predict_NoEvents_WithAgeNorms_ReturnsColdStartPrediction()
    {
        var ageDays = 30;
        var birthDate = DateOnly.FromDateTime(Now.AddDays(-ageDays).DateTime);
        var context = new PredictionContext(birthDate, Now);
        var norms = BuildNormsWithFeedGap(ageDays, 180); // 3 hours
        var options = PredictionOptions.Default with { LookBackAdaptationEnabled = false };

        var result = PredictionEngine.Predict([], context, options, norms);

        var prediction = Assert.Single(result.Predictions);
        Assert.Equal(Feeding, prediction.TypeKey);
        Assert.Equal(PredictionConfidence.Low, prediction.Confidence);
        Assert.Equal(0, prediction.SampleCount);
        Assert.Equal(TimeSpan.FromMinutes(180), prediction.Reason.MedianGap);
    }

    [Fact]
    public void Predict_NoEvents_WithoutAgeNorms_ReportsInsufficientData()
    {
        var result = PredictionEngine.Predict([], Context(), PredictionOptions.Default);

        Assert.Empty(result.Predictions);
        Assert.Empty(result.InsufficientData);
    }

    [Fact]
    public void Predict_FewEvents_WithAgeNorms_PrefersDataOverColdStart()
    {
        var ageDays = 60;
        var birthDate = DateOnly.FromDateTime(Now.AddDays(-ageDays).DateTime);
        var context = new PredictionContext(birthDate, Now);
        var norms = BuildNormsWithFeedGap(ageDays, 180);
        var events = Every(Feeding, TimeSpan.FromHours(4), Now.AddDays(-5), Now);
        var options = PredictionOptions.Default with { LookBackAdaptationEnabled = false };

        var result = PredictionEngine.Predict(events, context, options, norms);

        var prediction = Assert.Single(result.Predictions);
        Assert.True(prediction.SampleCount > 0, "Expected data-driven prediction, not cold start.");
        Assert.NotEqual(PredictionConfidence.Low, prediction.Confidence);
    }

    [Fact]
    public void Predict_SleepWithNoNorm_ReportsInsufficientData()
    {
        // Sleep has no cold-start metric (wake windows have no published norm).
        var ageDays = 30;
        var birthDate = DateOnly.FromDateTime(Now.AddDays(-ageDays).DateTime);
        var context = new PredictionContext(birthDate, Now);
        var norms = BuildNormsWithFeedGap(ageDays, 180);
        var events = new List<ObservedEvent>
        {
            new(Sleep, Now.AddHours(-2), Now.AddHours(-1)),
        };
        var options = PredictionOptions.Default with { LookBackAdaptationEnabled = false };

        var result = PredictionEngine.Predict(events, context, options, norms);

        Assert.DoesNotContain(result.Predictions, p => p.TypeKey == Sleep);
    }

    [Fact]
    public void FromNorm_NullTypical_ReturnsNull()
    {
        var norm = new AgeNorm(
            "test", AgeNormMetrics.FeedGapMinutes, AgeNormPopulations.All, null,
            new AgeNormBand(0, 91, 0m, 13m, "0-3m"),
            120, null, 240, "minutes",
            null, [], "high", false, null, null, []);

        Assert.Null(ColdStartMetrics.FromNorm(Feeding, norm, 30));
    }

    [Fact]
    public void FromNorm_UnsupportedMetric_ReturnsNull()
    {
        var norm = new AgeNorm(
            "test", AgeNormMetrics.LongestSleepHours, AgeNormPopulations.All, null,
            new AgeNormBand(0, 91, 0m, 13m, "0-3m"),
            4, 6, 8, "hours",
            null, [], "high", false, null, null, []);

        Assert.Null(ColdStartMetrics.FromNorm(Sleep, norm, 30));
    }

    private static AgeNormSet BuildNormsWithFeedGap(int ageDays, decimal typicalMinutes)
    {
        var band = new AgeNormBand(
            Math.Max(0, ageDays - 30),
            ageDays + 30,
            0m,
            52m,
            "test band");
        var norm = new AgeNorm(
            "test-feed-gap",
            AgeNormMetrics.FeedGapMinutes,
            AgeNormPopulations.All,
            null,
            band,
            typicalMinutes - 60,
            typicalMinutes,
            typicalMinutes + 60,
            "minutes",
            null,
            [],
            "high",
            false,
            null,
            null,
            []);
        return new AgeNormSet(
            AgeNormSet.SupportedSchemaVersion,
            new DateOnly(2026, 1, 1),
            "test",
            ["minutes"],
            [AgeNormPopulations.All],
            ["recommended"],
            ["median"],
            [new AgeNormMetric(AgeNormMetrics.FeedGapMinutes, "minutes", "Feed gap", null)],
            [],
            [norm]);
    }
}