namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The served content of one community statistics release (docs/design/34-community-insights.md section 6), serialised by
/// <see cref="CommunityReleaseJson"/> (schema <see cref="CommunityReleaseJson.SchemaVersion"/>): when it was generated, from which
/// catalog version, whether it is a placeholder, the parameters of every statistic it computed, and the published cells. A cell
/// below the thresholds is absent, never present with a reason. Nothing in it is an exact count or an identifier.
/// </summary>
/// <remarks>
/// A release with no cells means "nothing passed the thresholds": every caller falls back to the published norms or its built-in
/// default, as for a statistic with no cell. A placeholder (<see cref="IsPlaceholder"/>, written by the job while it reads no events)
/// never has cells nor statistics, is read the same way, and does not count against the quarter (<see cref="CommunityReleaseCadence"/>).
/// </remarks>
public sealed record CommunityRelease(
    DateTimeOffset GeneratedAt,
    int CatalogVersion,
    bool IsPlaceholder,
    IReadOnlyList<CommunityReleaseStatistic> Statistics,
    IReadOnlyList<CommunityReleaseCell> Cells)
{
    /// <summary>The release the job writes while it computes nothing: no statistic, no cell.</summary>
    public static CommunityRelease Placeholder(DateTimeOffset generatedAt, int catalogVersion) =>
        new(generatedAt.ToUniversalTime(), catalogVersion, IsPlaceholder: true, [], []);

    /// <summary>
    /// The cell a baby of <paramref name="ageWeeks"/> completed weeks reads for <paramref name="statistic"/> and
    /// <paramref name="dimension"/>: her fine cell when published, else the narrowest published (coarse) cell holding her age; null
    /// when none is published (the caller falls back to the published norms).
    /// </summary>
    public CommunityReleaseCell? CellFor(string statistic, int ageWeeks, string? dimension) =>
        Cells.Where(cell => string.Equals(cell.Statistic, statistic, StringComparison.Ordinal)
                && string.Equals(cell.Dimension, dimension, StringComparison.Ordinal)
                && cell.Band.Contains(ageWeeks))
            .OrderBy(cell => cell.Band.Weeks)
            .FirstOrDefault();
}

/// <summary>The parameters one statistic of a release was computed with: published at <see cref="K"/> babies from as many families, budget <see cref="Epsilon"/>.</summary>
public sealed record CommunityReleaseStatistic(string Key, int K, decimal Epsilon);

/// <summary>
/// One published cell: the statistic, the age band, the dimension value (null when the statistic has none), the named output values
/// (a share vector is one value per component, <c>share_helped_by_cause.hunger</c>; a scalar share is named after its output; a
/// later quantile output adds <c>p10</c>..<c>p90</c> the same way) and the coarse group size, never a count.
/// </summary>
public sealed record CommunityReleaseCell(
    string Statistic,
    CommunityBand Band,
    string? Dimension,
    IReadOnlyDictionary<string, decimal> Outputs,
    CommunityGroupSize Babies)
{
    /// <summary>The catalog output a value name belongs to: the part before the first dot.</summary>
    public static string OutputOf(string valueName)
    {
        ArgumentNullException.ThrowIfNull(valueName);
        var dot = valueName.IndexOf('.', StringComparison.Ordinal);
        return dot < 0 ? valueName : valueName[..dot];
    }

    /// <summary>The catalog outputs this cell publishes.</summary>
    public IReadOnlySet<string> OutputNames => Outputs.Keys.Select(OutputOf).ToHashSet(StringComparer.Ordinal);
}

/// <summary>An age band in completed weeks, <see cref="FromWeeks"/> inclusive to <see cref="ToWeeks"/> exclusive.</summary>
public readonly record struct CommunityBand(int FromWeeks, int ToWeeks)
{
    /// <summary>The width of the band in weeks.</summary>
    public int Weeks => ToWeeks - FromWeeks;

    public bool Contains(int ageWeeks) => ageWeeks >= FromWeeks && ageWeeks < ToWeeks;

    /// <summary>Whether <paramref name="inner"/> lies inside this band.</summary>
    public bool Holds(CommunityBand inner) => inner.FromWeeks >= FromWeeks && inner.ToWeeks <= ToWeeks;
}

/// <summary>
/// The coarse number of distinct babies behind a published cell (section 6): never an exact count. A published cell always has at
/// least <see cref="CommunityStatistic.K"/> (20) babies, so the lowest bucket is exact about its lower bound.
/// </summary>
public enum CommunityGroupSize
{
    /// <summary><c>"20-49"</c>.</summary>
    Babies20To49,

    /// <summary><c>"50-99"</c>.</summary>
    Babies50To99,

    /// <summary><c>"100+"</c>.</summary>
    Babies100Plus,
}

/// <summary>The buckets of <see cref="CommunityGroupSize"/> and their wire names.</summary>
public static class CommunityGroupSizes
{
    public const string Wire20To49 = "20-49";

    public const string Wire50To99 = "50-99";

    public const string Wire100Plus = "100+";

    /// <summary>The bucket of <paramref name="distinctBabies"/> babies (a published cell has at least k).</summary>
    public static CommunityGroupSize Of(int distinctBabies) => distinctBabies switch
    {
        >= 100 => CommunityGroupSize.Babies100Plus,
        >= 50 => CommunityGroupSize.Babies50To99,
        _ => CommunityGroupSize.Babies20To49,
    };

    public static string ToWire(CommunityGroupSize size) => size switch
    {
        CommunityGroupSize.Babies20To49 => Wire20To49,
        CommunityGroupSize.Babies50To99 => Wire50To99,
        CommunityGroupSize.Babies100Plus => Wire100Plus,
        _ => throw new ArgumentOutOfRangeException(nameof(size), size, "Unknown group size."),
    };

    /// <summary>The bucket a wire name stands for; null for anything else.</summary>
    public static CommunityGroupSize? FromWire(string? wire) => wire switch
    {
        Wire20To49 => CommunityGroupSize.Babies20To49,
        Wire50To99 => CommunityGroupSize.Babies50To99,
        Wire100Plus => CommunityGroupSize.Babies100Plus,
        _ => null,
    };
}
