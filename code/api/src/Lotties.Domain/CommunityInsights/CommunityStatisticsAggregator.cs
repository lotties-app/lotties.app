namespace Lotties.Domain.CommunityInsights;

/// <summary>What one run produced: the release to serve, and the run log facts (no id, no exact count of a cell).</summary>
public sealed record CommunityAggregationResult(CommunityRelease Release, CommunityRunSummary Summary);

/// <summary>
/// The run log line of one run (design 34 section 5 "Run log"): cells published (fine and coarse), fine cells with data that were
/// not published, and the babies included, rounded to 10. Epsilon per statistic is in <see cref="CommunityRelease.Statistics"/>.
/// </summary>
public sealed record CommunityRunSummary(int CellsPublished, int CoarseCellsPublished, int FineCellsSuppressed, int BabiesIncludedRoundedToTen);

/// <summary>
/// The pure core of the community statistics run (docs/design/34-community-insights.md sections 5, 5.1 and 5.1.1; no I/O). For
/// each statistic with an output in v1 it: reads the observations of the run's population, clipped to the catalog ranges (a
/// percentile statistic only those of its window, the previous calendar quarter); places each in its fixed fine cell (age band and
/// dimension value); keeps per baby and fine band the observations of at most <see cref="CommunityStatistic.CapPerBaby"/> days,
/// picked by a keyed hash of baby id and day (<see cref="CommunityDailyCap"/>); for a percentile statistic keeps each baby in at most
/// <see cref="CommunityStatistic.MaxCellsPerBaby"/> cells (<see cref="CommunityCellBound"/>); splits the statistic's epsilon evenly
/// over its release units (each share output; the quartiles together) and runs each unit's mechanism over the fixed grid
/// (<see cref="CommunityShareMechanism"/>: each baby's weights add up to 1; <see cref="CommunityHistogramMechanism"/>: one summary
/// per baby and cell, epsilon per cell the unit's divided by the cell bound), so one baby spends at most
/// <see cref="CommunityStatistic.Epsilon"/> on a statistic per release; and publishes only the cells that pass k (20 babies from 20
/// families, in every release), dominance and complementary suppression, with the coarse fallback (<see cref="CommunityPublication"/>).
/// </summary>
/// <remarks>
/// The publication decisions use exact counts and are not themselves differentially private (as in the synthetic study); the
/// counts never leave the core except as the group-size bucket. A family of several babies spends the budget once per baby.
/// </remarks>
public static class CommunityStatisticsAggregator
{
    /// <summary>Family dominance threshold: a cell is suppressed when one family has more than this fraction of it.</summary>
    public const decimal FamilyDominanceThreshold = 0.25m;

    /// <summary>The window value of a percentile statistic: the previous calendar quarter of the release.</summary>
    public const string PreviousQuarterWindow = "previous_quarter";

    private static readonly IReadOnlyList<ICommunityStatisticSampler> Samplers =
    [
        new TummyTimeSampler(),
        new CryOutcomeSampler(),
        new BottleSampler(),
        new RoutineSampler("night_sleep_minutes", day => day.NightSleepMinutes),
        new RoutineSampler("naps_per_day", day => day.NapsPerDay),
        new RoutineSampler("day_sleep_minutes", day => day.DaySleepMinutes),
    ];

    private static readonly IReadOnlyList<ICommunityOutputMechanism> Mechanisms = [CommunityShareMechanism.Instance, CommunityHistogramMechanism.Instance];

    /// <summary>
    /// One run over <paramref name="input"/>. <paramref name="noise"/> must be <see cref="SnappedLaplaceNoise.Cryptographic"/> for a
    /// release that is served; tests inject a seeded or noise-free one.
    /// </summary>
    public static CommunityAggregationResult Aggregate(CommunityAggregationInput input, ICommunityNoise noise)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(noise);
        var catalog = CommunityStatisticsValidator.EnsureValid(input.Catalog);
        var runs = catalog.InV1.Select(statistic => AggregateStatistic(input, statistic, noise)).ToArray();
        var release = new CommunityRelease(
            input.GeneratedAt.ToUniversalTime(),
            catalog.Version,
            IsPlaceholder: false,
            [.. runs.Select(run => run.Parameters)],
            [.. runs.SelectMany(run => run.Cells)]);
        return new CommunityAggregationResult(release, SummaryOf(runs));
    }

    /// <summary>Whether the core reads observations for <paramref name="statistic"/> (only such a statistic may be in v1).</summary>
    public static bool CanRead(CommunityStatistic statistic) => Samplers.Any(sampler => sampler.CanHandle(statistic));

    /// <summary>The catalog inputs the core reads for <paramref name="statistic"/>, or null when it reads none.</summary>
    public static IReadOnlyList<string>? InputsReadFor(CommunityStatistic statistic) =>
        Samplers.FirstOrDefault(sampler => sampler.CanHandle(statistic))?.Reads;

    /// <summary>
    /// The dominance rule on raw values (design 34 section 5), kept for the community prediction aggregator: whether one family gave
    /// more than <see cref="FamilyDominanceThreshold"/> of the values. <paramref name="familyOfEachValue"/> holds the family of
    /// every value (one entry per value, after capping). An empty cell is not dominated (it is suppressed by k).
    /// </summary>
    public static bool IsDominatedByOneFamily(IReadOnlyCollection<Guid> familyOfEachValue)
    {
        ArgumentNullException.ThrowIfNull(familyOfEachValue);
        if (familyOfEachValue.Count == 0)
        {
            return false;
        }

        var maxFamilyCount = familyOfEachValue.GroupBy(family => family).Max(family => family.Count());
        return (decimal)maxFamilyCount / familyOfEachValue.Count > FamilyDominanceThreshold;
    }

    private static StatisticRun AggregateStatistic(CommunityAggregationInput input, CommunityStatistic statistic, ICommunityNoise noise)
    {
        var grid = CommunityCellGrid.For(input.Catalog.BandGrids, statistic);
        var bounded = BoundedSamples(input, statistic, grid);
        var units = statistic.V1Outputs.Select(output => CommunityOutputs.UnitOf(output.Name)).Distinct(StringComparer.Ordinal).ToArray();
        var epsilonPerUnit = (double)EpsilonOf(statistic) / units.Length;
        var published = units
            .SelectMany(unit => ReleaseUnit(new CommunityMechanismContext(statistic, unit, grid, epsilonPerUnit, noise), bounded))
            .ToArray();
        return StatisticRun.Of(statistic, grid, bounded, published);
    }

    /// <summary>
    /// The samples one statistic reads, before any k or dominance decision: its window (percentile statistics), its fixed cells, the
    /// day cap per baby and band, and the cell bound per baby (percentile statistics).
    /// </summary>
    internal static IReadOnlyList<CommunityCellSample> BoundedSamples(CommunityAggregationInput input, CommunityStatistic statistic, CommunityCellGrid grid)
    {
        var windowed = InWindow(statistic, input.GeneratedAt, SamplerFor(statistic).SamplesOf(statistic, input));
        var capped = CommunityDailyCap.Apply(Locate(grid, windowed), statistic.CapPerBaby, input.CapKey);
        return statistic.MaxCellsPerBaby is { } maxCells ? CommunityCellBound.Apply(capped, maxCells, input.CapKey) : capped;
    }

    private static IEnumerable<CommunitySample> InWindow(CommunityStatistic statistic, DateTimeOffset generatedAt, IEnumerable<CommunitySample> samples)
    {
        if (statistic.Window != PreviousQuarterWindow)
        {
            return samples;
        }

        var window = CommunityDataWindow.PreviousQuarterOf(generatedAt);
        return samples.Where(sample => window.Contains(sample.Day));
    }

    private static IReadOnlyList<CommunityOutputCell> ReleaseUnit(CommunityMechanismContext context, IReadOnlyList<CommunityCellSample> samples)
    {
        var mechanism = MechanismFor(context.Unit);
        var unitSamples = samples.Where(sample => sample.Output == context.Unit).ToArray();
        var populations = CommunityCellPopulation.PerFineCell(context.Grid, mechanism.Weigh(unitSamples));
        var values = mechanism.Release(context, unitSamples);
        return CommunityPublication.Decide(context.Statistic, context.Grid, populations, values);
    }

    private static IEnumerable<CommunityCellSample> Locate(CommunityCellGrid grid, IEnumerable<CommunitySample> samples) =>
        samples
            .Select(sample => new { Sample = sample, Cell = grid.FineCellOf(sample.AgeWeeks, sample.Dimension) })
            .Where(located => located.Cell is not null)
            .Select(located => new CommunityCellSample(located.Sample.BabyId, located.Sample.FamilyId, located.Sample.Day, located.Cell!.Value, located.Sample.Output, located.Sample.Component, located.Sample.Value));

    private static ICommunityStatisticSampler SamplerFor(CommunityStatistic statistic) =>
        Samplers.FirstOrDefault(sampler => sampler.CanHandle(statistic))
            ?? throw new InvalidOperationException($"No sampler reads statistic '{statistic.Key}'.");

    private static ICommunityOutputMechanism MechanismFor(string unit) =>
        Mechanisms.FirstOrDefault(mechanism => mechanism.CanHandle(unit))
            ?? throw new InvalidOperationException($"No mechanism computes '{unit}'.");

    private static decimal EpsilonOf(CommunityStatistic statistic) =>
        statistic.Epsilon ?? throw new InvalidOperationException($"Statistic '{statistic.Key}' is in v1 without an epsilon.");

    private static CommunityRunSummary SummaryOf(IReadOnlyList<StatisticRun> runs)
    {
        var babies = runs.SelectMany(run => run.Babies).Distinct().Count();
        return new CommunityRunSummary(
            runs.Sum(run => run.Cells.Count),
            runs.Sum(run => run.CoarseCellsPublished),
            runs.Sum(run => run.FineCellsSuppressed),
            (int)Math.Round(babies / 10.0, MidpointRounding.AwayFromZero) * 10);
    }

    /// <summary>One statistic's part of the release and of the run summary.</summary>
    private sealed record StatisticRun(
        CommunityReleaseStatistic Parameters,
        IReadOnlyList<CommunityReleaseCell> Cells,
        int CoarseCellsPublished,
        int FineCellsSuppressed,
        IReadOnlySet<Guid> Babies)
    {
        public static StatisticRun Of(CommunityStatistic statistic, CommunityCellGrid grid, IReadOnlyList<CommunityCellSample> capped, IReadOnlyList<CommunityOutputCell> published)
        {
            var cells = published.GroupBy(cell => cell.Key).Select(group => CellOf(statistic, group)).ToArray();
            var publishedKeys = published.Select(cell => cell.Key).ToHashSet();
            var withData = capped.Select(sample => sample.Cell).ToHashSet();
            return new StatisticRun(
                new CommunityReleaseStatistic(statistic.Key, statistic.K, EpsilonOf(statistic)),
                cells,
                grid.CoarseCells.Count(coarse => publishedKeys.Contains(coarse.Key)),
                grid.FineCells.Count(cell => withData.Contains(cell) && !publishedKeys.Contains(cell)),
                capped.Select(sample => sample.BabyId).ToHashSet());
        }

        private static CommunityReleaseCell CellOf(CommunityStatistic statistic, IGrouping<CommunityCellKey, CommunityOutputCell> outputs)
        {
            var values = outputs.SelectMany(output => output.Values).ToDictionary(StringComparer.Ordinal);
            var babies = CommunityCellPopulation.Union(outputs.Select(output => output.Population)).Babies.Count;
            return new CommunityReleaseCell(statistic.Key, outputs.Key.Band, outputs.Key.Dimension, values, CommunityGroupSizes.Of(babies));
        }
    }
}
