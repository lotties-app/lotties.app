namespace Lotties.Domain.CommunityInsights;

/// <summary>One cell of a statistic: an age band and the dimension value (null when the statistic has none).</summary>
public readonly record struct CommunityCellKey(CommunityBand Band, string? Dimension);

/// <summary>A coarse fallback cell and the fine cells it is made of (same dimension value, fine bands inside the coarse band).</summary>
public sealed record CommunityCoarseCell(CommunityCellKey Key, IReadOnlyList<CommunityCellKey> FineCells);

/// <summary>
/// The fixed bands of the catalog grids (docs/design/34-community-insights.md section 5 "Bands"): the fine age grid, its coarse
/// fallback, and the cry age bands (no coarse grid). Edges come from the catalog only, never from the data.
/// </summary>
public static class CommunityBandGrid
{
    /// <summary>The fine bands of <paramref name="grid"/>, in age order; empty for an unknown grid.</summary>
    public static IReadOnlyList<CommunityBand> FineBands(CommunityBandGrids grids, string grid)
    {
        ArgumentNullException.ThrowIfNull(grids);
        return grid switch
        {
            CommunityStatisticsValidator.AgeWeeksGrid => Expand(grids.AgeWeeksFine),
            CommunityStatisticsValidator.CryAgeBandGrid => [.. grids.CryAgeBands.Select(band => new CommunityBand(band.FromWeeks, band.ToWeeks))],
            _ => [],
        };
    }

    /// <summary>The coarse fallback bands of <paramref name="grid"/>; the cry grid has none.</summary>
    public static IReadOnlyList<CommunityBand> CoarseBands(CommunityBandGrids grids, string grid)
    {
        ArgumentNullException.ThrowIfNull(grids);
        return grid == CommunityStatisticsValidator.AgeWeeksGrid ? Expand(grids.AgeWeeksCoarse) : [];
    }

    /// <summary>The band of <paramref name="bands"/> holding <paramref name="ageWeeks"/>, or null outside the grid.</summary>
    public static CommunityBand? BandOf(IReadOnlyList<CommunityBand> bands, int ageWeeks) =>
        bands.Where(band => band.Contains(ageWeeks)).Select(band => (CommunityBand?)band).FirstOrDefault();

    private static IReadOnlyList<CommunityBand> Expand(IReadOnlyList<CommunityBandSegment> segments) =>
        [.. segments.Where(segment => segment.StepWeeks > 0).SelectMany(StepsOf)];

    private static IEnumerable<CommunityBand> StepsOf(CommunityBandSegment segment) =>
        Enumerable.Range(0, (segment.ToWeeks - segment.FromWeeks) / segment.StepWeeks)
            .Select(step => segment.FromWeeks + (step * segment.StepWeeks))
            .Select(from => new CommunityBand(from, from + segment.StepWeeks));
}

/// <summary>
/// Every cell one statistic can publish, fixed by the catalog: its fine bands times its dimension values, and the coarse bands
/// (except those identical to a fine band) times the same values, each with the fine cells it is made of.
/// </summary>
public sealed class CommunityCellGrid
{
    private readonly IReadOnlyList<CommunityBand> fineBands;

    private readonly IReadOnlySet<CommunityCellKey> fineCellSet;

    private CommunityCellGrid(IReadOnlyList<CommunityBand> fineBands, IReadOnlyList<CommunityCellKey> fineCells, IReadOnlyList<CommunityCoarseCell> coarseCells)
    {
        this.fineBands = fineBands;
        fineCellSet = fineCells.ToHashSet();
        FineCells = fineCells;
        CoarseCells = coarseCells;
    }

    /// <summary>The fine cells, band by band, each band in dimension value order.</summary>
    public IReadOnlyList<CommunityCellKey> FineCells { get; }

    /// <summary>The coarse fallback cells, in the same order.</summary>
    public IReadOnlyList<CommunityCoarseCell> CoarseCells { get; }

    public static CommunityCellGrid For(CommunityBandGrids grids, CommunityStatistic statistic)
    {
        ArgumentNullException.ThrowIfNull(grids);
        ArgumentNullException.ThrowIfNull(statistic);
        var fineBands = CommunityBandGrid.FineBands(grids, statistic.Band.Grid);
        var dimensions = CommunityDimensions.ValuesOf(statistic.Band.Dimension);
        var fineCells = CellsOf(fineBands, dimensions);
        var coarseBands = CommunityBandGrid.CoarseBands(grids, statistic.Band.Grid).Where(band => !fineBands.Contains(band));
        var coarseCells = CellsOf([.. coarseBands], dimensions).Select(key => new CommunityCoarseCell(key, [.. fineCells.Where(fine => IsInside(fine, key))])).ToArray();
        return new CommunityCellGrid(fineBands, fineCells, coarseCells);
    }

    /// <summary>The fine cell of an observation at <paramref name="ageWeeks"/> with <paramref name="dimension"/>; null outside the grid.</summary>
    public CommunityCellKey? FineCellOf(int ageWeeks, string? dimension)
    {
        var band = CommunityBandGrid.BandOf(fineBands, ageWeeks);
        return band is null || !fineCellSet.Contains(new CommunityCellKey(band.Value, dimension))
            ? null
            : new CommunityCellKey(band.Value, dimension);
    }

    private static IReadOnlyList<CommunityCellKey> CellsOf(IReadOnlyList<CommunityBand> bands, IReadOnlyList<string?> dimensions) =>
        [.. bands.SelectMany(band => dimensions.Select(dimension => new CommunityCellKey(band, dimension)))];

    private static bool IsInside(CommunityCellKey fine, CommunityCellKey coarse) =>
        string.Equals(fine.Dimension, coarse.Dimension, StringComparison.Ordinal) && coarse.Band.Holds(fine.Band);
}
