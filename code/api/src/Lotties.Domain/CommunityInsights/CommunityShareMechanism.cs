namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The noise mechanism of one kind of output. Contract: from every capped, weighted sample of one output and that output's epsilon,
/// return the noisy named values of every fine and coarse cell of the grid that has a value, such that the whole map is
/// epsilon-differentially private for the addition or removal of one baby; the cells computed and the noise drawn follow the fixed
/// grid, never the data. Built: <see cref="CommunityShareMechanism"/>. A quantile mechanism for the percentile outputs joins here
/// later and publishes <c>p10</c>..<c>p90</c> in the same cell shape.
/// </summary>
internal interface ICommunityOutputMechanism
{
    bool CanHandle(string output);

    IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> Release(
        string output,
        CommunityCellGrid grid,
        IReadOnlyList<CommunityWeightedSample> samples,
        double epsilon,
        ICommunityNoise noise);
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

    public bool CanHandle(string output) => CommunityOutputs.Shares.ContainsKey(output);

    public IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> Release(
        string output,
        CommunityCellGrid grid,
        IReadOnlyList<CommunityWeightedSample> samples,
        double epsilon,
        ICommunityNoise noise)
    {
        var share = CommunityOutputs.Shares[output];
        var exact = samples.ToLookup(sample => sample.Cell);
        var scale = 1.0 / epsilon;
        var fine = grid.FineCells.ToDictionary(cell => cell, cell => NoisySums(share, exact[cell], scale, noise));
        var coarse = grid.CoarseCells.ToDictionary(cell => cell.Key, cell => SumOf(share, cell.FineCells.Select(key => fine[key])));
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
