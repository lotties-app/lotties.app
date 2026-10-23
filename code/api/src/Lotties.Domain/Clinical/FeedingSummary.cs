namespace Lotties.Domain.Clinical;

/// <summary>
/// A logged feed as the clinical summary reads it: its start, the payload <c>method</c> (<c>breast</c>, <c>bottle</c>,
/// <c>solid</c>), the bottle <c>amount_ml</c> and <c>bottle_feeding_type</c> and the formula members
/// (<c>formula_id</c>, <c>formula_name</c>). Callers pass only events that are not soft deleted.
/// </summary>
public sealed record FeedObservation(
    DateTimeOffset StartedAt,
    string? Method,
    double? AmountMl = null,
    string? BottleFeedingType = null,
    Guid? FormulaId = null,
    string? FormulaName = null)
{
    public const string BreastMethod = "breast";
    public const string BottleMethod = "bottle";
    public const string SolidMethod = "solid";
    public const string FormulaFeedingType = "formula";

    public bool IsBottle => Method == BottleMethod;

    /// <summary>The logged amount of a bottle feed (ml), or <c>null</c> (no amount, or not a bottle).</summary>
    public double? BottleMl => IsBottle && AmountMl is > 0 ? AmountMl : null;

    /// <summary>Whether it is a bottle of formula: the bottle content says so, or a formula was named.</summary>
    public bool IsFormulaBottle =>
        IsBottle && (BottleFeedingType == FormulaFeedingType || FormulaId is not null || !string.IsNullOrWhiteSpace(FormulaName));
}

/// <summary>Feeding of one local day: the feeds that started that day, the bottle ml logged and the feeds by method.</summary>
public sealed record FeedingDaySummary(DateOnly Date, int Feeds, double BottleMl, int Breast, int Bottle, int Solid);

/// <summary>A formula the bottles were made with: how many bottles and the ml logged for them.</summary>
public sealed record FormulaUsage(Guid? FormulaId, string Name, int Feeds, double Ml);

/// <summary>
/// The feeding of a range, as the parents' Insights compute it (<c>feedingModel.ts</c>): feeds per local day (by the day a
/// feed started), the mean gap between consecutive feeds (gaps up to 8 hours), the averages over the completed days with
/// data, and the counts by method and by formula.
/// </summary>
public sealed record FeedingSummary(
    IReadOnlyList<FeedingDaySummary> Days,
    double? FeedsPerDay,
    double? AverageIntervalMs,
    double? BottleMlPerDay,
    int BreastCount,
    int BottleCount,
    int SolidCount,
    IReadOnlyList<FormulaUsage> Formulas);

/// <summary>Computes the <see cref="FeedingSummary"/>; pure, no I/O.</summary>
public static class FeedingSummaries
{
    /// <summary>A longer gap means a feed was probably not logged, so it is left out of the average.</summary>
    public static readonly TimeSpan MaxFeedGap = TimeSpan.FromHours(8);

    /// <param name="observed">The baby's non-deleted feeds.</param>
    /// <param name="window">The local days to cover; only feeds that started inside them and not after now count.</param>
    public static FeedingSummary Summarize(IReadOnlyList<FeedObservation> observed, ClinicalWindow window)
    {
        ArgumentNullException.ThrowIfNull(observed);
        ArgumentNullException.ThrowIfNull(window);
        var feeds = observed
            .Where(item => item.StartedAt >= window.Start && item.StartedAt < window.End && item.StartedAt <= window.Now)
            .OrderBy(item => item.StartedAt)
            .ToArray();
        var days = window.Days.Select(day => SummarizeDay(day, feeds)).ToArray();
        var withFeeds = ClinicalStatistics.CompletedDaysWithData(days, day => day.Feeds > 0, day => day.Date, window.Today);
        var withMl = ClinicalStatistics.CompletedDaysWithData(days, day => day.BottleMl > 0, day => day.Date, window.Today);
        return new FeedingSummary(
            days,
            ClinicalStatistics.Mean(withFeeds.Select(day => (double)day.Feeds).ToArray()),
            ClinicalStatistics.Mean(Gaps(feeds)),
            ClinicalStatistics.Mean(withMl.Select(day => day.BottleMl).ToArray()),
            feeds.Count(item => item.Method == FeedObservation.BreastMethod),
            feeds.Count(item => item.IsBottle),
            feeds.Count(item => item.Method == FeedObservation.SolidMethod),
            Formulas(feeds));
    }

    private static FeedingDaySummary SummarizeDay(ClinicalDay day, IReadOnlyList<FeedObservation> feeds)
    {
        var started = feeds.Where(item => day.Contains(item.StartedAt)).ToArray();
        return new FeedingDaySummary(
            day.Date,
            started.Length,
            started.Sum(item => item.BottleMl ?? 0),
            started.Count(item => item.Method == FeedObservation.BreastMethod),
            started.Count(item => item.IsBottle),
            started.Count(item => item.Method == FeedObservation.SolidMethod));
    }

    /// <summary>Gaps in milliseconds between consecutive feed starts, longer than zero and up to <see cref="MaxFeedGap"/>.</summary>
    private static double[] Gaps(IReadOnlyList<FeedObservation> feeds) =>
        feeds.Zip(feeds.Skip(1), (previous, next) => (next.StartedAt - previous.StartedAt).TotalMilliseconds)
            .Where(gap => gap > 0 && gap <= MaxFeedGap.TotalMilliseconds)
            .ToArray();

    /// <summary>
    /// The bottles of formula grouped by the formula id (else by the name, ignoring case): feeds, ml logged, and the name
    /// as the latest bottle of the group wrote it (empty when none named the formula). Most used first.
    /// </summary>
    private static IReadOnlyList<FormulaUsage> Formulas(IReadOnlyList<FeedObservation> feeds) =>
        feeds
            .Where(item => item.IsFormulaBottle)
            .GroupBy(FormulaKey)
            .Select(ToUsage)
            .OrderByDescending(usage => usage.Feeds)
            .ThenByDescending(usage => usage.Ml)
            .ThenBy(usage => usage.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private static string FormulaKey(FeedObservation feed) => feed switch
    {
        { FormulaId: { } id } => id.ToString("N"),
        _ => "name:" + (feed.FormulaName ?? string.Empty).Trim().ToUpperInvariant(),
    };

    private static FormulaUsage ToUsage(IGrouping<string, FeedObservation> group)
    {
        var latestNamed = group.LastOrDefault(item => !string.IsNullOrWhiteSpace(item.FormulaName));
        return new FormulaUsage(
            group.Select(item => item.FormulaId).FirstOrDefault(id => id is not null),
            latestNamed?.FormulaName?.Trim() ?? string.Empty,
            group.Count(),
            group.Sum(item => item.BottleMl ?? 0));
    }
}
