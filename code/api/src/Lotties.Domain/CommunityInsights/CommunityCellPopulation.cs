namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// One capped sample with its weight in its output: 1 divided by the baby's number of capped samples of that output over every cell,
/// so each baby's samples of one output add up to exactly 1 (one summary per baby: a family logging 30 spells a day weighs the same
/// as one logging 5, and adding or removing one baby moves the output's sums by at most 1 in total).
/// </summary>
internal readonly record struct CommunityWeightedSample(Guid BabyId, Guid FamilyId, CommunityCellKey Cell, int Component, double Weight)
{
    /// <summary>The weighted samples of one output's capped samples.</summary>
    public static IReadOnlyList<CommunityWeightedSample> Of(IEnumerable<CommunityCellSample> samples) =>
        [.. samples.GroupBy(sample => sample.BabyId).SelectMany(WeightedBaby)];

    private static IEnumerable<CommunityWeightedSample> WeightedBaby(IGrouping<Guid, CommunityCellSample> baby)
    {
        var weight = 1.0 / baby.Count();
        return baby.Select(sample => new CommunityWeightedSample(sample.BabyId, sample.FamilyId, sample.Cell, sample.Component, weight));
    }
}

/// <summary>
/// Who is behind one cell of one output: the distinct babies, the distinct families and each family's weight in the cell. The
/// publication rules read it; it is never published (only the coarse bucket of <see cref="Babies"/> is).
/// </summary>
internal sealed class CommunityCellPopulation
{
    private readonly IReadOnlyDictionary<Guid, double> familyWeights;

    private CommunityCellPopulation(IReadOnlySet<Guid> babies, IReadOnlyDictionary<Guid, double> familyWeights)
    {
        Babies = babies;
        this.familyWeights = familyWeights;
    }

    public static CommunityCellPopulation Empty { get; } = new(new HashSet<Guid>(), new Dictionary<Guid, double>());

    public IReadOnlySet<Guid> Babies { get; }

    public int FamilyCount => familyWeights.Count;

    /// <summary>The largest share one family has of the cell's weight (0 for an empty cell).</summary>
    public double LargestFamilyShare
    {
        get
        {
            var total = familyWeights.Values.Sum();
            return total <= 0.0 ? 0.0 : familyWeights.Values.Max() / total;
        }
    }

    /// <summary>The population of each fine cell of <paramref name="grid"/> (empty for a cell with no sample).</summary>
    public static IReadOnlyDictionary<CommunityCellKey, CommunityCellPopulation> PerFineCell(CommunityCellGrid grid, IReadOnlyList<CommunityWeightedSample> samples)
    {
        var byCell = samples.ToLookup(sample => sample.Cell);
        return grid.FineCells.ToDictionary(cell => cell, cell => Of(byCell[cell]));
    }

    public static CommunityCellPopulation Of(IEnumerable<CommunityWeightedSample> samples)
    {
        var list = samples.ToArray();
        var weights = list.GroupBy(sample => sample.FamilyId).ToDictionary(family => family.Key, family => family.Sum(sample => sample.Weight));
        return new CommunityCellPopulation(list.Select(sample => sample.BabyId).ToHashSet(), weights);
    }

    /// <summary>The population of several cells together (a coarse cell, or what is left of it after its published fine cells).</summary>
    public static CommunityCellPopulation Union(IEnumerable<CommunityCellPopulation> populations)
    {
        var list = populations.ToArray();
        var babies = list.SelectMany(population => population.Babies).ToHashSet();
        var weights = list.SelectMany(population => population.familyWeights)
            .GroupBy(family => family.Key)
            .ToDictionary(family => family.Key, family => family.Sum(entry => entry.Value));
        return new CommunityCellPopulation(babies, weights);
    }

    /// <summary>
    /// The publication rule of design 34 section 5: at least <paramref name="minimum"/> distinct babies from at least as many
    /// distinct families, and no family above <see cref="CommunityStatisticsAggregator.FamilyDominanceThreshold"/> of the weight.
    /// </summary>
    public bool Meets(int minimum) =>
        Babies.Count >= minimum
        && FamilyCount >= minimum
        && LargestFamilyShare <= (double)CommunityStatisticsAggregator.FamilyDominanceThreshold;
}
