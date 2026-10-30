using Lotties.Domain.Assistants;
using Lotties.Domain.Clinical;

namespace Lotties.Domain.Tests.Assistants;

/// <summary>The "how much did she drink today" / "how many feeds today" numbers (docs/design/32-assistants.md).</summary>
public sealed class AssistantFeedTotalsTests
{
    private static readonly DateTimeOffset At = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);

    private static FeedObservation Bottle(double? ml, string? type = null) => new(At, FeedObservation.BottleMethod, ml, type);

    [Fact]
    public void Of_NoFeeds_IsAllZero()
    {
        var totals = AssistantFeedTotals.Of([]);

        Assert.Equal(new AssistantFeedTotals(0, 0, 0, 0, 0, new AssistantBottleSplit(0, 0), new AssistantBottleSplit(0, 0)), totals);
    }

    [Fact]
    public void Of_MixedFeeds_CountsMethodsAndSumsTheDrunkAmountsBySplit()
    {
        var totals = AssistantFeedTotals.Of(
        [
            Bottle(90, "formula"),
            Bottle(100, "breast_milk"),
            Bottle(60),
            new FeedObservation(At, FeedObservation.BreastMethod),
            new FeedObservation(At, FeedObservation.SolidMethod),
            new FeedObservation(At, null),
        ]);

        Assert.Equal((6, 3, 1, 1, 250), (totals.Feeds, totals.Bottles, totals.Breast, totals.Solid, totals.BottleMl));
        Assert.Equal(new AssistantBottleSplit(1, 90), totals.Formula);
        Assert.Equal(new AssistantBottleSplit(1, 100), totals.BreastMilk);
    }

    [Fact]
    public void Of_BottleWithoutAmount_IsCountedButAddsNoMl_AndANamedFormulaCountsAsFormula()
    {
        var totals = AssistantFeedTotals.Of([Bottle(null), new FeedObservation(At, FeedObservation.BottleMethod, 120, null, Guid.NewGuid(), "NAN")]);

        Assert.Equal((2, 120), (totals.Bottles, totals.BottleMl));
        Assert.Equal(new AssistantBottleSplit(1, 120), totals.Formula);
        Assert.Equal(new AssistantBottleSplit(0, 0), totals.BreastMilk);
    }

    [Fact]
    public void Of_RoundsTheSumOnce()
    {
        var totals = AssistantFeedTotals.Of([Bottle(60.4, "formula"), Bottle(60.4, "formula")]);

        Assert.Equal(121, totals.BottleMl);
    }
}
