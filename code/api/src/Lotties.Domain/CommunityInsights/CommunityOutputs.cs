namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The catalog outputs (docs/design/34-community-insights.md sections 4 and 5.1) and what the aggregation core can compute of them:
/// the share outputs (<see cref="Shares"/>, one release unit each) and the published quartiles (<see cref="Quantiles"/>, read
/// together from one noisy histogram per cell, the release unit <see cref="QuantileUnit"/>) have a built mechanism; every other
/// percentile has none and stays <c>notInV1</c>.
/// </summary>
public static class CommunityOutputs
{
    public const string ShareOfDaysWithAny = "share_of_days_with_any";

    public const string ShareHelpedByCause = "share_helped_by_cause";

    public const string ShareSuggestedEqualsHelped = "share_suggested_equals_helped";

    /// <summary>Every output name the catalog may use.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        "p3", "p10", "p15", "p25", "p50", "p75", "p85", "p90", "p97",
        "bottles_per_day_p50", ShareOfDaysWithAny,
        "shift_ratio_p90", "shift_ratio_p97",
        ShareHelpedByCause, ShareSuggestedEqualsHelped,
    ];

    /// <summary>The release unit of a percentile statistic: one histogram per cell, read for every published quartile.</summary>
    public const string QuantileUnit = "quantiles";

    /// <summary>The percentiles the histogram mechanism publishes (owner default of 2026-11-27: p25, p50 and p75 only).</summary>
    public static readonly IReadOnlyList<string> Quantiles = ["p25", "p50", "p75"];

    /// <summary>The outputs that are percentiles (in v1 only the <see cref="Quantiles"/> of tier C statistics).</summary>
    public static readonly IReadOnlyList<string> Percentiles =
    [
        "p3", "p10", "p15", "p25", "p50", "p75", "p85", "p90", "p97", "bottles_per_day_p50", "shift_ratio_p90", "shift_ratio_p97",
    ];

    /// <summary>Outputs outside p10-p90, published only at <see cref="CommunityStatisticsValidator.MinimumKTails"/> babies.</summary>
    public static readonly IReadOnlyList<string> Tails = ["p3", "p97", "shift_ratio_p97"];

    /// <summary>
    /// The share outputs the core computes and the categories one observation of each falls in. <see cref="ShareSuggestedEqualsHelped"/>
    /// has none (dropped from v1 on 2026-11-27; its input, the suggested cause, is not read).
    /// </summary>
    public static readonly IReadOnlyDictionary<string, CommunityShareOutput> Shares = new Dictionary<string, CommunityShareOutput>(StringComparer.Ordinal)
    {
        [ShareOfDaysWithAny] = new(ShareOfDaysWithAny, ["with", "without"], PublishesFirstComponentOnly: true),
        [ShareHelpedByCause] = new(ShareHelpedByCause, CommunityCryCauses.Helped, PublishesFirstComponentOnly: false),
    };

    /// <summary>Whether the core has a mechanism for <paramref name="output"/> (only such an output may be in v1).</summary>
    public static bool IsBuilt(string output) => Shares.ContainsKey(output) || Quantiles.Contains(output);

    /// <summary>The release unit an output is computed in: its own name for a share, <see cref="QuantileUnit"/> for a quartile.</summary>
    public static string UnitOf(string output) => Quantiles.Contains(output) ? QuantileUnit : output;
}

/// <summary>
/// A share output: every observation falls in one of <see cref="Components"/>, and the cell publishes the share of each component
/// (<c>name.component</c>), or, when <see cref="PublishesFirstComponentOnly"/>, only the share of the first one under the output's
/// own name (the second is one minus it).
/// </summary>
public sealed record CommunityShareOutput(string Name, IReadOnlyList<string> Components, bool PublishesFirstComponentOnly)
{
    /// <summary>The named values of one cell for the given shares (one per component, in component order).</summary>
    public IReadOnlyDictionary<string, decimal> ValuesOf(IReadOnlyList<decimal> shares) =>
        PublishesFirstComponentOnly
            ? new Dictionary<string, decimal>(StringComparer.Ordinal) { [Name] = shares[0] }
            : Components.Zip(shares).ToDictionary(pair => $"{Name}.{pair.First}", pair => pair.Second, StringComparer.Ordinal);

    /// <summary>The index of <paramref name="component"/>, or -1 when it is not one of <see cref="Components"/>.</summary>
    public int IndexOf(string component) => Components.ToList().IndexOf(component);
}
