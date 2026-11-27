namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The published list of community statistics of <c>code/api/data/community-statistics.json</c> (schema 2,
/// docs/design/34-community-insights.md sections 4, 5 and 5.1): for each statistic the exact per-baby inputs, the fixed age
/// bands, the outputs with their noise tier, the minimum group size, the noise budget, the per-baby cap and the clipping
/// ranges. Nothing is collected or served from it yet (every entry is <c>planned</c>); the pure aggregation core
/// (<see cref="CommunityStatisticsAggregator"/>) computes the outputs that are in v1.
/// </summary>
public sealed record CommunityStatisticsCatalog(
    int Schema,
    int Version,
    string GeneratedFor,
    string Release,
    CommunityBandGrids BandGrids,
    IReadOnlyList<CommunityStatistic> Statistics)
{
    /// <summary>The schema version this code reads (2: outputs carry a noise tier, epsilon may be null, cry bands carry weeks, no hysteresis).</summary>
    public const int SupportedSchema = 2;

    /// <summary>What the file says about itself until the job reads data (section 11, T5).</summary>
    public const string CatalogOnly = "catalog only, not collected";

    /// <summary>The statistics with at least one output in v1, in catalog order.</summary>
    public IReadOnlyList<CommunityStatistic> InV1 => [.. Statistics.Where(statistic => statistic.IsInV1)];
}

/// <summary>
/// The fixed band edges (section 5 "Bands"): a fine grid of age in completed weeks, the coarser fallback grid a fine cell
/// below k is published in, the 4-week grid of the percentile statistics (no fallback), and the cry age bands of docs/design/27
/// on fixed week edges (read from age in completed weeks). Edges never move with the data.
/// </summary>
public sealed record CommunityBandGrids(
    IReadOnlyList<CommunityBandSegment> AgeWeeksFine,
    IReadOnlyList<CommunityBandSegment> AgeWeeksCoarse,
    IReadOnlyList<CommunityBandSegment> AgeWeeks4,
    IReadOnlyList<CommunityNamedBand> CryAgeBands);

/// <summary>Bands of <see cref="StepWeeks"/> weeks from <see cref="FromWeeks"/> (inclusive) to <see cref="ToWeeks"/> (exclusive).</summary>
public sealed record CommunityBandSegment(int FromWeeks, int ToWeeks, int StepWeeks);

/// <summary>
/// One cry age band (<see cref="Name"/> as the web's <c>cryAgeBand</c>) on fixed edges in completed weeks, from
/// <see cref="FromWeeks"/> (inclusive) to <see cref="ToWeeks"/> (exclusive). The web bands by calendar months (3 and 6);
/// the community cells use these week edges, so a baby may sit a few days in a neighbouring band at a month edge.
/// </summary>
public sealed record CommunityNamedBand(string Name, int FromWeeks, int ToWeeks);

/// <summary>
/// One statistic of the catalog. <see cref="K"/> is the minimum of distinct babies and of distinct families for a cell to be
/// published, in every release (no hysteresis, owner decision of 2026-11-27), <see cref="KTails"/> the size needed for p3/p97
/// (null when the statistic has no tail output). <see cref="Epsilon"/> is the budget one baby spends on this statistic per
/// release, over all its cells and v1 outputs (null when nothing of it is in v1). For a statistic with an output in v1,
/// <see cref="Inputs"/> are exactly what the aggregation core reads. A percentile statistic (tier C) also has
/// <see cref="MaxCellsPerBaby"/> (one baby is in at most that many of its cells per release, so the epsilon per cell is
/// <see cref="Epsilon"/> divided by it), <see cref="Window"/> (the days a release reads) and <see cref="Histogram"/> (bins and
/// published step); the share statistics have none. <see cref="Proposed"/> marks values that still wait for the owner's decision O1
/// (section 13).
/// </summary>
public sealed record CommunityStatistic(
    string Key,
    string Description,
    IReadOnlyList<string> Inputs,
    CommunityStatisticBand Band,
    IReadOnlyList<CommunityStatisticOutput> Outputs,
    int K,
    int? KTails,
    decimal? Epsilon,
    int CapPerBaby,
    int? MaxCellsPerBaby,
    string? Window,
    CommunityHistogramSpec? Histogram,
    IReadOnlyList<CommunityClip> Clip,
    string Status,
    bool Proposed,
    bool NotInV1,
    string? NotInV1Reason)
{
    /// <summary>Whether at least one output is in v1.</summary>
    public bool IsInV1 => Outputs.Any(output => output.IsInV1);

    /// <summary>The outputs in v1, in catalog order.</summary>
    public IReadOnlyList<CommunityStatisticOutput> V1Outputs => [.. Outputs.Where(output => output.IsInV1)];

    /// <summary>The clipping range of <paramref name="input"/>, or null when the statistic does not clip it.</summary>
    public CommunityClip? ClipOf(string input) => Clip.FirstOrDefault(clip => string.Equals(clip.Input, input, StringComparison.Ordinal));
}

/// <summary>One output of a statistic and the noise tier it is published in (section 5.1), or <see cref="CommunityOutputTier.NotInV1"/>.</summary>
public sealed record CommunityStatisticOutput(string Name, CommunityOutputTier Tier)
{
    public bool IsInV1 => Tier != CommunityOutputTier.NotInV1;
}

/// <summary>The noise tiers of section 5.1 (O2, decided 2026-11-11).</summary>
public enum CommunityOutputTier
{
    /// <summary>Strict: epsilon 0.2 per statistic per weekly release.</summary>
    A,

    /// <summary>Relaxed: epsilon about 5 per statistic per weekly release; weak formal guarantee, stated as such.</summary>
    B,

    /// <summary>
    /// Percentiles, option A as bounded on 2026-11-27: a noisy histogram per cell at epsilon 2 per cell and release, at most 4 cells
    /// per baby per statistic (8 per statistic per release), reading only the previous calendar quarter; weak formal guarantee.
    /// </summary>
    C,

    /// <summary>Deferred: not computed nor published in v1.</summary>
    NotInV1,
}

/// <summary>The fixed histogram of a percentile statistic: bins of <see cref="BinWidth"/> offset by half a <see cref="Step"/>, values published on multiples of <see cref="Step"/>.</summary>
public sealed record CommunityHistogramSpec(decimal BinWidth, decimal Step);

/// <summary>The grid a statistic is banded on and its one extra dimension (bottle kind, part of day, routine metric), if any.</summary>
public sealed record CommunityStatisticBand(string Grid, string? Dimension);

/// <summary>The published range an input is clipped to before aggregation.</summary>
public sealed record CommunityClip(string Input, decimal Min, decimal Max, string Unit)
{
    /// <summary>The value held inside [<see cref="Min"/>, <see cref="Max"/>].</summary>
    public decimal Apply(decimal value) => Math.Clamp(value, Min, Max);
}
