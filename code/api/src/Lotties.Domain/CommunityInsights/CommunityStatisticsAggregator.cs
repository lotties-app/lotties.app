namespace Lotties.Domain.CommunityInsights;

/// <summary>What one run produced: the release to serve, and the run log facts (no id, no exact count of a cell).</summary>
public sealed record CommunityAggregationResult(CommunityRelease Release, CommunityRunSummary Summary);

/// <summary>
/// The run log line of one run (design 34 section 5 "Run log"): cells published (fine and coarse), fine cells with data that were
/// not published, and the babies included, rounded to 10. Epsilon per statistic is in <see cref="CommunityRelease.Statistics"/>.
/// </summary>
public sealed record CommunityRunSummary(int CellsPublished, int CoarseCellsPublished, int FineCellsSuppressed, int BabiesIncludedRoundedToTen);

/// <summary>
/// The pure core of the community statistics run (docs/design/34-community-insights.md sections 5 and 5.1; no I/O). For each
/// statistic with an output in v1 it: reads the observations of the run's population, clipped to the catalog ranges; places each
/// in its fixed fine cell (age band and dimension value); keeps per baby and fine band the observations of at most
/// <see cref="CommunityStatistic.CapPerBaby"/> days, picked by a keyed hash of baby id and day (<see cref="CommunityDailyCap"/>);
/// weighs each baby's observations of an output to add up to 1 (one summary per baby); adds Laplace noise to the share sums of
/// every cell of the fixed grid (<see cref="CommunityShareMechanism"/>), spending the statistic's epsilon split evenly over its v1
/// outputs, so one baby spends at most <see cref="CommunityStatistic.Epsilon"/> on a statistic per release whatever cells she is
/// in; and publishes only the cells that pass k (20 babies from 20 families, in every release), dominance and complementary
/// suppression, with the coarse fallback (<see cref="CommunityPublication"/>). Percentile outputs have no mechanism and are never
/// computed.
/// </summary>
/// <remarks>
/// The publication decisions use exact counts and are not themselves differentially private (as in the synthetic study); the
/// counts never leave the core except as the group-size bucket. A family of several babies spends the budget once per baby.
/// </remarks>
public static class CommunityStatisticsAggregator
{
    /// <summary>Family dominance threshold: a cell is suppressed when one family has more than this fraction of it.</summary>
    public const decimal FamilyDominanceThreshold = 0.25m;

    private static readonly IReadOnlyList<ICommunityStatisticSampler> Samplers = [new TummyTimeSampler(), new CryOutcomeSampler()];

    private static readonly IReadOnlyList<ICommunityOutputMechanism> Mechanisms = [CommunityShareMechanism.Instance];

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
        var located = Locate(grid, SamplerFor(statistic).SamplesOf(statistic, input));
        var capped = CommunityDailyCap.Apply(located, statistic.CapPerBaby, input.CapKey);
        var epsilonPerOutput = (double)EpsilonOf(statistic) / statistic.V1Outputs.Count;
        var published = statistic.V1Outputs
            .SelectMany(output => ReleaseOutput(statistic, output.Name, grid, capped, epsilonPerOutput, noise))
            .ToArray();
        return StatisticRun.Of(statistic, grid, capped, published);
    }

    private static IReadOnlyList<CommunityOutputCell> ReleaseOutput(
        CommunityStatistic statistic,
        string output,
        CommunityCellGrid grid,
        IReadOnlyList<CommunityCellSample> capped,
        double epsilon,
        ICommunityNoise noise)
    {
        var weighted = CommunityWeightedSample.Of(capped.Where(sample => sample.Output == output));
        var populations = CommunityCellPopulation.PerFineCell(grid, weighted);
        var values = MechanismFor(output).Release(output, grid, weighted, epsilon, noise);
        return CommunityPublication.Decide(statistic, grid, populations, values);
    }

    private static IEnumerable<CommunityCellSample> Locate(CommunityCellGrid grid, IEnumerable<CommunitySample> samples) =>
        samples
            .Select(sample => new { Sample = sample, Cell = grid.FineCellOf(sample.AgeWeeks, sample.Dimension) })
            .Where(located => located.Cell is not null)
            .Select(located => new CommunityCellSample(located.Sample.BabyId, located.Sample.FamilyId, located.Sample.Day, located.Cell!.Value, located.Sample.Output, located.Sample.Component));

    private static ICommunityStatisticSampler SamplerFor(CommunityStatistic statistic) =>
        Samplers.FirstOrDefault(sampler => sampler.CanHandle(statistic))
            ?? throw new InvalidOperationException($"No sampler reads statistic '{statistic.Key}'.");

    private static ICommunityOutputMechanism MechanismFor(string output) =>
        Mechanisms.FirstOrDefault(mechanism => mechanism.CanHandle(output))
            ?? throw new InvalidOperationException($"No mechanism computes output '{output}'.");

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
