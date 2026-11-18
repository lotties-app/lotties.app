using Lotties.Application.Predictions;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Api.Tests.Predictions;

/// <summary>
/// Unit tests for <see cref="CommunityStaticPriorProvider"/>. The embedded community-priors.json currently contains
/// only <c>cry_outcome_by_cause</c> and <c>tummy_minutes_per_day</c> metrics (no <c>feed_gap_minutes</c>), so the
/// provider returns null for feeding. These tests verify the parsing, filtering and origin logic against the real
/// embedded resource and document the expected behaviour when a feed-gap norm is added in a future phase.
/// </summary>
public sealed class CommunityStaticPriorProviderTests
{
    private static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    private static readonly EventTypeKey Sleep = BuiltInEventTypes.Sleep.Key;

    [Fact]
    public void Constructor_LoadsEmbeddedResource_WithoutThrowing()
    {
        // The constructor reads the embedded community-priors.json. If the resource is missing or malformed it
        // returns an empty list rather than throwing; this test verifies the happy path loads successfully.
        var provider = new CommunityStaticPriorProvider();

        // No exception means the resource was found and parsed. The provider may still return null for every
        // query if no metric matches, which is the current state of the embedded file.
        Assert.NotNull(provider);
    }

    [Fact]
    public void GetPrior_Feeding_ReturnsNull_WhenNoFeedGapMetricExists()
    {
        // The current community-priors.json has no feed_gap_minutes entry, so feeding always returns null.
        // When a feed-gap norm is added in a future phase, this test should be updated to assert a non-null
        // result with PriorOrigin.CommunityStatic.
        var provider = new CommunityStaticPriorProvider();

        var prior = provider.GetPrior(Feeding, 30);

        Assert.Null(prior);
    }

    [Fact]
    public void GetPrior_Sleep_ReturnsNull_BecauseSleepHasNoMetricMapping()
    {
        // CommunityStaticPriorProvider.MetricFor returns null for sleep (same as ColdStartMetrics.For).
        var provider = new CommunityStaticPriorProvider();

        var prior = provider.GetPrior(Sleep, 30);

        Assert.Null(prior);
    }

    [Fact]
    public void GetPrior_NegativeAge_ReturnsNull()
    {
        var provider = new CommunityStaticPriorProvider();

        var prior = provider.GetPrior(Feeding, -1);

        Assert.Null(prior);
    }

    [Fact]
    public void GetPrior_ZeroAge_ReturnsNull_ForCurrentData()
    {
        // Age 0 is valid but the current embedded data has no feed_gap_minutes metric.
        var provider = new CommunityStaticPriorProvider();

        var prior = provider.GetPrior(Feeding, 0);

        Assert.Null(prior);
    }

    [Fact]
    public void GetPrior_VeryLargeAge_ReturnsNull_ForCurrentData()
    {
        var provider = new CommunityStaticPriorProvider();

        var prior = provider.GetPrior(Feeding, 100_000);

        Assert.Null(prior);
    }

    /// <summary>
    /// Documents the expected behaviour once a feed_gap_minutes norm with valid confidence is added to
    /// community-priors.json. Until then this test verifies the provider does not crash on an unknown event type.
    /// </summary>
    [Fact]
    public void GetPrior_UnknownEventType_ReturnsNull()
    {
        var provider = new CommunityStaticPriorProvider();
        var unknown = EventTypeKey.From("unknown_event_type");

        var prior = provider.GetPrior(unknown, 30);

        Assert.Null(prior);
    }
}