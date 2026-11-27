namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The fixed histogram of a percentile statistic and its read-out, as the percentiles study defines them
/// (ml/benchmark/community_percentiles.py and community_percentiles_built.py; the C# tests cross-check them on the study's
/// vectors): bins of the catalog's width starting half a step below the clip minimum, an isotonic cumulative count clipped at 0,
/// p25, p50 and p75 interpolated inside their bin, clipped to the range and rounded half to even to the published step.
/// </summary>
public static class CommunityHistogram
{
    /// <summary>The published levels, in percent, in <see cref="CommunityOutputs.Quantiles"/> order.</summary>
    public static readonly IReadOnlyList<int> Levels = [25, 50, 75];

    /// <summary>The bin edges: from min - step/2 by <paramref name="binWidth"/> until max is covered, rounded to 9 decimals.</summary>
    public static IReadOnlyList<double> Edges(double min, double max, double step, double binWidth)
    {
        var start = min - (step / 2);
        var count = (int)Math.Ceiling(((max - start) / binWidth) - 1e-9);
        return [.. Enumerable.Range(0, count + 1).Select(index => Math.Round(start + (binWidth * index), 9, MidpointRounding.ToEven))];
    }

    /// <summary>The count of each bin: [edge i, edge i+1), the last bin also holding its right edge; values are clamped into the edges.</summary>
    public static double[] Counts(IEnumerable<double> values, IReadOnlyList<double> edges)
    {
        var counts = new double[edges.Count - 1];
        foreach (var value in values)
        {
            counts[BinOf(value, edges)] += 1.0;
        }

        return counts;
    }

    /// <summary>The bin of one value (the number of edges at or below it, minus one, kept inside the bins).</summary>
    public static int BinOf(double value, IReadOnlyList<double> edges)
    {
        var clamped = Math.Clamp(value, edges[0], edges[^1]);
        var atOrBelow = edges.Count(edge => edge <= clamped);
        return Math.Clamp(atOrBelow - 1, 0, edges.Count - 2);
    }

    /// <summary>p25, p50, p75 of noisy counts, or null when the noisy total is 0 or less (the cell publishes nothing).</summary>
    public static IReadOnlyList<double>? Read(IReadOnlyList<double> noisyCounts, IReadOnlyList<double> edges, double min, double max, double step)
    {
        var cdf = Isotonic(CumulativeSums(noisyCounts)).Select(value => Math.Max(0.0, value)).ToArray();
        var total = cdf[^1];
        return total <= 0.0
            ? null
            : [.. Levels.Select(level => Round(Math.Clamp(Interpolate(cdf, edges, level / 100.0 * total), min, max), step))];
    }

    /// <summary>The median of one baby's values in a cell (the mean of the two middle values for an even count).</summary>
    public static double Median(IReadOnlyList<double> values)
    {
        var sorted = values.Order().ToArray();
        var middle = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2.0;
    }

    private static double[] CumulativeSums(IReadOnlyList<double> counts)
    {
        var sums = new double[counts.Count];
        var running = 0.0;
        for (var index = 0; index < counts.Count; index++)
        {
            running += counts[index];
            sums[index] = running;
        }

        return sums;
    }

    /// <summary>The least-squares non-decreasing fit with equal weights (pool adjacent violators), as the study computes it.</summary>
    private static double[] Isotonic(double[] values)
    {
        var blocks = new List<IsotonicBlock>();
        foreach (var value in values)
        {
            blocks.Add(new IsotonicBlock(value, 1));
            MergeViolators(blocks);
        }

        return [.. blocks.SelectMany(block => Enumerable.Repeat(block.Value, block.Weight))];
    }

    private static void MergeViolators(List<IsotonicBlock> blocks)
    {
        while (blocks.Count > 1 && blocks[^2].Value > blocks[^1].Value)
        {
            var last = blocks[^1];
            var before = blocks[^2];
            blocks.RemoveRange(blocks.Count - 2, 2);
            blocks.Add(new IsotonicBlock(((before.Value * before.Weight) + (last.Value * last.Weight)) / (before.Weight + last.Weight), before.Weight + last.Weight));
        }
    }

    /// <summary>The value at <paramref name="target"/> on the cumulative counts (searchsorted left, then linear inside the bin).</summary>
    private static double Interpolate(double[] cdf, IReadOnlyList<double> edges, double target)
    {
        var withZero = cdf.Prepend(0.0).ToArray();
        var first = Array.FindIndex(withZero, value => value >= target);
        var bin = Math.Clamp(first < 0 ? withZero.Length : first, 1, edges.Count - 1);
        var low = withZero[bin - 1];
        var high = withZero[bin];
        var fraction = high <= low ? 0.5 : (target - low) / (high - low);
        return edges[bin - 1] + (fraction * (edges[bin] - edges[bin - 1]));
    }

    private static double Round(double value, double step) => Math.Round(value / step, MidpointRounding.ToEven) * step;

    private readonly record struct IsotonicBlock(double Value, int Weight);
}

/// <summary>
/// The percentile mechanism (option A of the percentiles study as bounded on 2026-11-27, docs/design/34-community-insights.md section
/// 5.1.1): per cell, one summary per baby (her median of the cell's capped values), a uniform half-step jitter, clipping to the
/// metric's range, the fixed bins of <see cref="CommunityHistogram"/>, and snapped Laplace noise of scale 1 / epsilon-per-cell on
/// every bin (L1 sensitivity 1 per cell: adding or removing one baby moves one count of each of her cells by 1). The epsilon per cell
/// is the unit's epsilon divided by <see cref="CommunityStatistic.MaxCellsPerBaby"/>; the core has already kept every baby in at
/// most that many cells, so one baby spends at most the unit's epsilon per release. p25, p50 and p75 are read from each noisy
/// histogram (post-processing); a cell whose noisy total is 0 or less has no value. There is no coarse fallback.
/// </summary>
internal sealed class CommunityHistogramMechanism : ICommunityOutputMechanism
{
    public static CommunityHistogramMechanism Instance { get; } = new();

    public bool CanHandle(string unit) => unit == CommunityOutputs.QuantileUnit;

    /// <summary>One per baby and cell: a baby is one summary, one count, in each of her cells.</summary>
    public IReadOnlyList<CommunityWeightedSample> Weigh(IReadOnlyList<CommunityCellSample> samples) =>
        [.. samples.DistinctBy(sample => (sample.BabyId, sample.Cell)).Select(sample => new CommunityWeightedSample(sample.BabyId, sample.FamilyId, sample.Cell, 0, 1.0))];

    public IReadOnlyDictionary<CommunityCellKey, IReadOnlyDictionary<string, decimal>> Release(CommunityMechanismContext context, IReadOnlyList<CommunityCellSample> samples)
    {
        var statistic = context.Statistic;
        var spec = statistic.Histogram ?? throw new InvalidOperationException($"Statistic '{statistic.Key}' has no histogram.");
        var cells = statistic.MaxCellsPerBaby ?? throw new InvalidOperationException($"Statistic '{statistic.Key}' has no cell bound.");
        var clip = statistic.Clip.Single();
        var histogram = new Histogram((double)clip.Min, (double)clip.Max, (double)spec.Step, CommunityHistogram.Edges((double)clip.Min, (double)clip.Max, (double)spec.Step, (double)spec.BinWidth));
        var summaries = SummariesPerCell(samples);
        var scale = cells / context.Epsilon;
        return context.Grid.FineCells
            .Select(cell => new KeyValuePair<CommunityCellKey, IReadOnlyDictionary<string, decimal>?>(cell, ValuesOf(histogram, summaries[cell], scale, context.Noise)))
            .Where(cell => cell.Value is not null)
            .ToDictionary(cell => cell.Key, cell => cell.Value!);
    }

    /// <summary>Each baby's median per cell, babies in id order (so a seeded run draws its jitter in a fixed order).</summary>
    private static ILookup<CommunityCellKey, double> SummariesPerCell(IReadOnlyList<CommunityCellSample> samples) =>
        samples.GroupBy(sample => (sample.Cell, sample.BabyId))
            .OrderBy(group => group.Key.BabyId)
            .ToLookup(group => group.Key.Cell, group => CommunityHistogram.Median([.. group.Select(sample => sample.Value)]));

    private static IReadOnlyDictionary<string, decimal>? ValuesOf(Histogram histogram, IEnumerable<double> summaries, double scale, ICommunityNoise noise)
    {
        var jittered = summaries.Select(summary => Math.Clamp(summary + noise.Jitter(histogram.Step / 2), histogram.Min, histogram.Max)).ToArray();
        var noisy = CommunityHistogram.Counts(jittered, histogram.Edges).Select(count => noise.Perturb(count, scale)).ToArray();
        var quartiles = CommunityHistogram.Read(noisy, histogram.Edges, histogram.Min, histogram.Max, histogram.Step);
        return quartiles is null
            ? null
            : CommunityOutputs.Quantiles.Zip(quartiles).ToDictionary(pair => pair.First, pair => (decimal)pair.Second, StringComparer.Ordinal);
    }

    private sealed record Histogram(double Min, double Max, double Step, IReadOnlyList<double> Edges);
}
