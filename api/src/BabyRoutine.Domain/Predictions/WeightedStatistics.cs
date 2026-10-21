namespace BabyRoutine.Domain.Predictions;

/// <summary>Recency-weighted quantiles, plain medians and interpolated quantiles. Pure and order independent.</summary>
internal static class WeightedStatistics
{
    private const double Half = 0.5;
    private const double Median = 0.5;

    /// <summary>
    /// The smallest sample length whose cumulative recency weight reaches <paramref name="quantile"/> of the total.
    /// A sample <paramref name="halfLife"/> older than <paramref name="now"/> weighs half as much as a current one.
    /// </summary>
    public static TimeSpan Quantile(IReadOnlyList<TimedSample> samples, double quantile, DateTimeOffset now, TimeSpan halfLife)
    {
        EnsureNotEmpty(samples);
        var ordered = samples.OrderBy(sample => sample.Length).ThenBy(sample => sample.At).ToArray();
        var cumulative = CumulativeWeights(ordered, now, halfLife);
        var target = cumulative[^1] * quantile;
        var index = Array.FindIndex(cumulative, weight => weight >= target);
        return ordered[index < 0 ? ordered.Length - 1 : index].Length;
    }

    public static TimeSpan WeightedMedian(IReadOnlyList<TimedSample> samples, DateTimeOffset now, TimeSpan halfLife) =>
        Quantile(samples, Median, now, halfLife);

    /// <summary>
    /// Unweighted quantile with linear interpolation between the two closest ranks (the numpy default), used for
    /// clock times where recency weighting is not wanted.
    /// </summary>
    public static TimeSpan InterpolatedQuantile(IReadOnlyList<TimeSpan> values, double quantile)
    {
        if (values.Count == 0)
        {
            throw new ArgumentException("At least one value is required.", nameof(values));
        }

        var ordered = values.Order().ToArray();
        var position = quantile * (ordered.Length - 1);
        var lower = (int)Math.Floor(position);
        var upper = Math.Min(lower + 1, ordered.Length - 1);
        var fraction = position - lower;
        var ticks = ordered[lower].Ticks + ((ordered[upper].Ticks - ordered[lower].Ticks) * fraction);
        return TimeSpan.FromTicks((long)Math.Round(ticks, MidpointRounding.AwayFromZero));
    }

    /// <summary>Rounds to the whole minute, midpoint away from zero.</summary>
    public static TimeSpan RoundToMinute(TimeSpan value) =>
        TimeSpan.FromMinutes(Math.Round(value.TotalMinutes, MidpointRounding.AwayFromZero));

    /// <summary>The lower middle sample length, without weights.</summary>
    public static TimeSpan PlainMedian(IReadOnlyList<TimedSample> samples)
    {
        EnsureNotEmpty(samples);
        var ordered = samples.Select(sample => sample.Length).Order().ToArray();
        return ordered[(ordered.Length - 1) / 2];
    }

    public static double RecencyWeight(DateTimeOffset at, DateTimeOffset now, TimeSpan halfLife) =>
        Math.Pow(Half, Math.Max(0, (now - at).TotalDays) / halfLife.TotalDays);

    private static double[] CumulativeWeights(IReadOnlyList<TimedSample> ordered, DateTimeOffset now, TimeSpan halfLife)
    {
        var cumulative = new double[ordered.Count];
        var running = 0.0;
        for (var index = 0; index < ordered.Count; index++)
        {
            running += RecencyWeight(ordered[index].At, now, halfLife);
            cumulative[index] = running;
        }

        return cumulative;
    }

    private static void EnsureNotEmpty(IReadOnlyList<TimedSample> samples)
    {
        if (samples.Count == 0)
        {
            throw new ArgumentException("At least one sample is required.", nameof(samples));
        }
    }
}
