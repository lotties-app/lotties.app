namespace Lotties.Domain.CommunityInsights;

/// <summary>What one release unit of one statistic is computed with: the statistic, the unit, its fixed grid, its epsilon and the noise.</summary>
internal sealed record CommunityMechanismContext(CommunityStatistic Statistic, string Unit, CommunityCellGrid Grid, double Epsilon, ICommunityNoise Noise);

/// <summary>
/// The noise mechanism of one kind of release unit. Contract: from every capped sample of one unit (and, for a percentile statistic,
/// at most <see cref="CommunityStatistic.MaxCellsPerBaby"/> cells per baby, enforced before) and that unit's epsilon, return the
/// noisy named values of every cell of the grid that has a value, such that the whole map is epsilon-differentially private for the
/// addition or removal of one baby; the cells computed and the noise drawn follow the fixed grid, never the data.
/// <see cref="Weigh"/> gives each baby's weight in each cell, which the k and dominance rules read. Built:
/// <see cref="CommunityShareMechanism"/> and <see cref="CommunityHistogramMechanism"/>.
/// </summary>
internal interface ICommunityOutputMechanism
{
    bool CanHandle(string unit);

    IReadOnlyList<CommunityWeightedSample> Weigh(IReadOnlyList<CommunityCellSample> samples);

    IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> Release(CommunityMechanismContext context, IReadOnlyList<CommunityCellSample> samples);
}

/// <summary>
/// Share outputs (design 34 sections 5 and 5.1): for every fine cell and component, the sum of the weights of the samples in it.
/// Each baby's weights of one output add up to 1 over all cells, so the L1 sensitivity of the whole vector of sums (every cell,
/// every component) is 1 and Laplace noise of scale 1 / epsilon on each sum makes the output epsilon-DP (snapped, see
/// <see cref="CommunityLaplace"/>). A coarse cell's sums are the sum of its fine cells' noisy sums (post-processing, no extra
/// budget). Shares are then clamped at 0, renormalised to add up to 1 and rounded to 0.001; a cell whose noisy sums are all 0
/// or less has no value.
/// </summary>
internal sealed class CommunityShareMechanism : ICommunityOutputMechanism
{
    /// <summary>Shares are published on this grid of decimals.</summary>
    public const int ShareDecimals = 3;

    public static CommunityShareMechanism Instance { get; } = new();

    public bool CanHandle(string unit) => CommunityOutputs.Shares.ContainsKey(unit);

    /// <summary>1 / the baby's capped samples of the output, so each baby's weights add up to 1.</summary>
    public IReadOnlyList<CommunityWeightedSample> Weigh(IReadOnlyList<CommunityCellSample> samples) => CommunityWeightedSample.Of(samples);

    public IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> Release(CommunityMechanismContext context, IReadOnlyList<CommunityCellSample> samples)
    {
        var share = CommunityOutputs.Shares[context.Unit];
        var exact = Weigh(samples).ToLookup(sample => sample.Cell);
        var scale = 1.0 / context.Epsilon;
        var fine = context.Grid.FineCells.ToDictionary(cell => cell, cell => NoisySums(share, exact[cell], scale, context.Noise));
        var coarse = context.Grid.CoarseCells.ToDictionary(cell => cell.Key, cell => SumOf(share, cell.FineCells.Select(key => fine[key])));
        return fine.Concat(coarse)
            .Select(cell => new KeyValuePair<CommunityCellKey, IReadOnlyDictionary<string, decimal>?>(cell.Key, ValuesOf(share, cell.Value)))
            .Where(cell => cell.Value is not null)
            .ToDictionary(cell => cell.Key, cell => cell.Value!);
    }

    private static double[] NoisySums(CommunityShareOutput share, IEnumerable<CommunityWeightedSample> samples, double scale, ICommunityNoise noise)
    {
        var exact = new double[share.Components.Count];
        foreach (var sample in samples)
        {
            exact[sample.Component] += sample.Weight;
        }

        return [.. exact.Select(sum => noise.Perturb(sum, scale))];
    }

    private static double[] SumOf(CommunityShareOutput share, IEnumerable<double[]> sums) =>
        [.. Enumerable.Range(0, share.Components.Count).Select(component => sums.Sum(cell => cell[component]))];

    private static IReadOnlyDictionary<string, decimal>? ValuesOf(CommunityShareOutput share, double[] noisySums)
    {
        var clamped = noisySums.Select(sum => Math.Max(0.0, sum)).ToArray();
        var total = clamped.Sum();
        return total <= 0.0
            ? null
            : share.ValuesOf([.. clamped.Select(sum => decimal.Round((decimal)(sum / total), ShareDecimals, MidpointRounding.ToEven))]);
    }
}
