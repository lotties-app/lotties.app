namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The published list of community statistics of <c>code/api/data/community-statistics.json</c> (schema 1,
/// docs/design/34-community-insights.md sections 4 and 5): for each statistic the exact per-baby inputs, the fixed age
/// bands, the outputs, the minimum group size, the noise budget, the per-baby cap and the clipping ranges. A catalog
/// only: nothing is collected, computed or served from it yet (every entry is <c>planned</c>).
/// </summary>
public sealed record CommunityStatisticsCatalog(
    int Schema,
    int Version,
    string GeneratedFor,
    string Release,
    CommunityBandGrids BandGrids,
    IReadOnlyList<CommunityStatistic> Statistics)
{
    /// <summary>The schema version this code reads.</summary>
    public const int SupportedSchema = 1;

    /// <summary>What the file says about itself until the job exists (section 11, T4).</summary>
    public const string CatalogOnly = "catalog only, not collected";
}

/// <summary>
/// The fixed band edges (section 5 "Bands"): a fine grid of age in completed weeks, the coarser fallback grid a fine cell
/// below k is published in, and the cry age bands of docs/design/27. Edges never move with the data.
/// </summary>
public sealed record CommunityBandGrids(
    IReadOnlyList<CommunityBandSegment> AgeWeeksFine,
    IReadOnlyList<CommunityBandSegment> AgeWeeksCoarse,
    IReadOnlyList<string> CryAgeBands);

/// <summary>Bands of <see cref="StepWeeks"/> weeks from <see cref="FromWeeks"/> (inclusive) to <see cref="ToWeeks"/> (exclusive).</summary>
public sealed record CommunityBandSegment(int FromWeeks, int ToWeeks, int StepWeeks);

/// <summary>
/// One statistic of the catalog. <see cref="K"/> is the minimum of distinct babies and of distinct families per cell,
/// <see cref="KHysteresis"/> the size under which a published cell is withdrawn, <see cref="KTails"/> the size needed
/// for p3/p97 (null when the statistic has no tail output). <see cref="Proposed"/> marks values that still wait for the
/// owner's decisions O1 and O2 (section 13).
/// </summary>
public sealed record CommunityStatistic(
    string Key,
    string Description,
    IReadOnlyList<string> Inputs,
    CommunityStatisticBand Band,
    IReadOnlyList<string> Outputs,
    int K,
    int KHysteresis,
    int? KTails,
    decimal Epsilon,
    int CapPerBaby,
    IReadOnlyList<CommunityClip> Clip,
    string Status,
    bool Proposed,
    bool NotInV1,
    string? NotInV1Reason);

/// <summary>The grid a statistic is banded on and its one extra dimension (bottle kind, part of day, routine metric), if any.</summary>
public sealed record CommunityStatisticBand(string Grid, string? Dimension);

/// <summary>The published range an input is clipped to before aggregation.</summary>
public sealed record CommunityClip(string Input, decimal Min, decimal Max, string Unit);
