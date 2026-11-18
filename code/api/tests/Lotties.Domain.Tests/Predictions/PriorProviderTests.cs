using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class PriorProviderTests
{
    private static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    private static readonly EventTypeKey Sleep = BuiltInEventTypes.Sleep.Key;

    #region AgeNormPriorProvider

    [Fact]
    public void AgeNormPriorProvider_ReturnsPublishedNormOrigin_WhenNormExists()
    {
        var norms = BuildNormsWithFeedGap(30, 180);
        var provider = new AgeNormPriorProvider(norms);

        var prior = provider.GetPrior(Feeding, 30);

        Assert.NotNull(prior);
        Assert.Equal(PriorOrigin.PublishedNorm, prior.Origin);
        Assert.Equal(Feeding, prior.TypeKey);
        Assert.Equal(TimeSpan.FromMinutes(180), prior.MedianGap);
        Assert.Equal(30, prior.AgeDays);
        Assert.Equal(AgeNormMetrics.FeedGapMinutes, prior.Metric);
    }

    [Fact]
    public void AgeNormPriorProvider_ReturnsNull_WhenNoNormMatches()
    {
        // Empty norm set has no feed gap norm.
        var norms = BuildEmptyNormSet();
        var provider = new AgeNormPriorProvider(norms);

        var prior = provider.GetPrior(Feeding, 30);

        Assert.Null(prior);
    }

    [Fact]
    public void AgeNormPriorProvider_ReturnsNull_ForUnsupportedEventType()
    {
        // Sleep has no cold-start metric (ColdStartMetrics.For returns null).
        var norms = BuildNormsWithFeedGap(30, 180);
        var provider = new AgeNormPriorProvider(norms);

        var prior = provider.GetPrior(Sleep, 30);

        Assert.Null(prior);
    }

    [Fact]
    public void AgeNormPriorProvider_ReturnsNull_ForLowConfidenceNorm()
    {
        // IsUsableAsPrior gate: low-confidence norms are excluded by PriorFor.
        var norms = BuildNormsWithFeedGapAndConfidence(30, 180, AgeNormConfidence.Low, needsReview: false);
        var provider = new AgeNormPriorProvider(norms);

        var prior = provider.GetPrior(Feeding, 30);

        Assert.Null(prior);
    }

    [Fact]
    public void AgeNormPriorProvider_ReturnsNull_ForNeedsReviewNorm()
    {
        // IsUsableAsPrior gate: needsReview norms are excluded by PriorFor.
        var norms = BuildNormsWithFeedGapAndConfidence(30, 180, AgeNormConfidence.High, needsReview: true);
        var provider = new AgeNormPriorProvider(norms);

        var prior = provider.GetPrior(Feeding, 30);

        Assert.Null(prior);
    }

    [Fact]
    public void AgeNormPriorProvider_ReturnsNull_ForNegativeAge()
    {
        var norms = BuildNormsWithFeedGap(30, 180);
        var provider = new AgeNormPriorProvider(norms);

        var prior = provider.GetPrior(Feeding, -1);

        Assert.Null(prior);
    }

    #endregion

    #region CompositePriorProvider

    [Fact]
    public void CompositePriorProvider_ReturnsFirstNonNullResult()
    {
        var expected = new ColdStartPrior(Feeding, TimeSpan.FromHours(3), null, 30, "test", PriorOrigin.CommunityStatic);
        var first = new StubPriorProvider(expected);
        var second = new StubPriorProvider(null);
        var composite = new CompositePriorProvider([first, second]);

        var result = composite.GetPrior(Feeding, 30);

        Assert.Same(expected, result);
    }

    [Fact]
    public void CompositePriorProvider_SkipsProvidersThatReturnNull()
    {
        var expected = new ColdStartPrior(Feeding, TimeSpan.FromHours(2), null, 60, "test", PriorOrigin.PublishedNorm);
        var nullProvider = new StubPriorProvider(null);
        var hitProvider = new StubPriorProvider(expected);
        var composite = new CompositePriorProvider([nullProvider, hitProvider]);

        var result = composite.GetPrior(Feeding, 60);

        Assert.Same(expected, result);
    }

    [Fact]
    public void CompositePriorProvider_ReturnsNull_WhenAllProvidersReturnNull()
    {
        var composite = new CompositePriorProvider([new StubPriorProvider(null), new StubPriorProvider(null)]);

        var result = composite.GetPrior(Feeding, 30);

        Assert.Null(result);
    }

    [Fact]
    public void CompositePriorProvider_RespectsPriorityOrder_FirstProviderWins()
    {
        var highPriority = new ColdStartPrior(Feeding, TimeSpan.FromHours(3), null, 30, "high", PriorOrigin.PublishedNorm);
        var lowPriority = new ColdStartPrior(Feeding, TimeSpan.FromHours(4), null, 30, "low", PriorOrigin.CommunityStatic);
        var composite = new CompositePriorProvider([new StubPriorProvider(highPriority), new StubPriorProvider(lowPriority)]);

        var result = composite.GetPrior(Feeding, 30);

        Assert.Same(highPriority, result);
        Assert.Equal(PriorOrigin.PublishedNorm, result!.Origin);
    }

    [Fact]
    public void CompositePriorProvider_EmptyChain_ReturnsNull()
    {
        var composite = new CompositePriorProvider([]);

        var result = composite.GetPrior(Feeding, 30);

        Assert.Null(result);
    }

    [Fact]
    public void CompositePriorProvider_NullProvidersList_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => new CompositePriorProvider(null!));
    }

    #endregion

    #region Helpers

    private static AgeNormSet BuildNormsWithFeedGap(int ageDays, decimal typicalMinutes) =>
        BuildNormsWithFeedGapAndConfidence(ageDays, typicalMinutes, AgeNormConfidence.High, needsReview: false);

    private static AgeNormSet BuildNormsWithFeedGapAndConfidence(int ageDays, decimal typicalMinutes, string confidence, bool needsReview)
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
            confidence,
            needsReview,
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

    private static AgeNormSet BuildEmptyNormSet() => new(
        AgeNormSet.SupportedSchemaVersion,
        new DateOnly(2026, 1, 1),
        "test",
        ["minutes"],
        [AgeNormPopulations.All],
        ["recommended"],
        ["median"],
        [new AgeNormMetric(AgeNormMetrics.FeedGapMinutes, "minutes", "Feed gap", null)],
        [],
        []);

    /// <summary>A trivial IPriorProvider stub that returns a fixed value regardless of inputs.</summary>
    private sealed class StubPriorProvider(ColdStartPrior? prior) : IPriorProvider
    {
        public ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays) => prior;
    }

    #endregion
}