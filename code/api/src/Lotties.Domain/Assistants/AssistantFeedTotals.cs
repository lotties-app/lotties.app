using Lotties.Domain.Clinical;

namespace Lotties.Domain.Assistants;

/// <summary>The bottles of one content (formula or breast milk): how many, and the ml drunk of those with an amount.</summary>
public sealed record AssistantBottleSplit(int Bottles, int Ml);

/// <summary>
/// The feeds of a stretch of time as the "how much did she drink today" and "how many feeds today" questions tell them:
/// the feeds by method and the bottle ml. The ml is the drunk-amount rule every server total uses
/// (<see cref="Events.BottleAmounts.DrunkMl"/> through <see cref="FeedObservation.BottleMl"/>: the drunk amount, else the prepared
/// one), so the figure matches the clinical summary and the web. Bottles that did not say what they held are in the totals
/// only. Facts only, pure, no I/O.
/// </summary>
public sealed record AssistantFeedTotals(int Feeds, int Bottles, int Breast, int Solid, int BottleMl, AssistantBottleSplit Formula, AssistantBottleSplit BreastMilk)
{
    public const string BreastMilkType = "breast_milk";

    /// <param name="feeds">The baby's non-deleted feeds of the stretch (already limited to it).</param>
    public static AssistantFeedTotals Of(IEnumerable<FeedObservation> feeds)
    {
        ArgumentNullException.ThrowIfNull(feeds);
        var all = feeds.ToArray();
        var bottles = all.Where(feed => feed.IsBottle).ToArray();
        return new AssistantFeedTotals(
            all.Length,
            bottles.Length,
            all.Count(feed => feed.Method == FeedObservation.BreastMethod),
            all.Count(feed => feed.Method == FeedObservation.SolidMethod),
            WholeMl(bottles),
            Split(bottles.Where(feed => feed.IsFormulaBottle).ToArray()),
            Split(bottles.Where(feed => !feed.IsFormulaBottle && feed.BottleFeedingType == BreastMilkType).ToArray()));
    }

    private static AssistantBottleSplit Split(FeedObservation[] bottles) => new(bottles.Length, WholeMl(bottles));

    private static int WholeMl(IEnumerable<FeedObservation> bottles) =>
        (int)Math.Round(bottles.Sum(feed => feed.BottleMl ?? 0), MidpointRounding.AwayFromZero);
}
