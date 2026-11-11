using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Rhythm;

/// <summary>The summaries the rhythm metrics share (docs/design/48-baby-rhythm.md section 3); pure.</summary>
internal static class RhythmStatistics
{
    private const double Lower = 0.25;
    private const double Middle = 0.5;
    private const double Upper = 0.75;

    /// <summary>Circular mean and spread of clock times from at least <paramref name="minimum"/> samples (see <see cref="ClockSummary"/>).</summary>
    public static ClockSummary Clock(IReadOnlyList<int> minutesOfDay, int minimum, TimeSpan maximumSpread)
    {
        if (minutesOfDay.Count < minimum)
        {
            return new ClockSummary(RhythmStatus.NotEnoughData, null, null, minutesOfDay.Count);
        }

        var circle = CircularSummary.Of(minutesOfDay);
        TimeSpan? spread = double.IsFinite(circle.Spread) ? TimeSpan.FromMinutes(Math.Round(circle.Spread, MidpointRounding.AwayFromZero)) : null;
        return circle.Spread > maximumSpread.TotalMinutes
            ? new ClockSummary(RhythmStatus.Varies, null, spread, minutesOfDay.Count)
            : new ClockSummary(RhythmStatus.Ok, new TimeOnly(circle.Mean / 60, circle.Mean % 60), spread, minutesOfDay.Count);
    }

    /// <summary>25th percentile, median and 75th percentile of at least <paramref name="minimum"/> durations, to the minute.</summary>
    public static DurationSummary Durations(IReadOnlyList<TimeSpan> values, int minimum) =>
        values.Count < minimum
            ? new DurationSummary(RhythmStatus.NotEnoughData, values.Count, null, null, null)
            : new DurationSummary(RhythmStatus.Ok, values.Count, Quantile(values, Lower), Quantile(values, Middle), Quantile(values, Upper));

    /// <summary>25th percentile, median and 75th percentile of at least <paramref name="minimum"/> counts (and <paramref name="enough"/>).</summary>
    public static CountSummary Counts(IReadOnlyList<int> counts, int minimum, bool enough = true) =>
        counts.Count < minimum || !enough
            ? new CountSummary(RhythmStatus.NotEnoughData, counts.Count, null, null, null)
            : new CountSummary(RhythmStatus.Ok, counts.Count, Quantile(counts, Lower), Quantile(counts, Middle), Quantile(counts, Upper));

    /// <summary>The interpolated median, to the minute.</summary>
    public static TimeSpan Median(IReadOnlyList<TimeSpan> values) => Quantile(values, Middle);

    /// <summary>The interpolated median of <paramref name="counts"/>.</summary>
    public static double Median(IReadOnlyList<int> counts) => Quantile(counts, Middle);

    /// <summary>The median absolute deviation from the median (the night-to-night spread), to the minute.</summary>
    public static TimeSpan MedianAbsoluteDeviation(IReadOnlyList<TimeSpan> values)
    {
        var median = WeightedStatistics.InterpolatedQuantile(values, Middle);
        return Median(values.Select(value => (value - median).Duration()).ToArray());
    }

    private static TimeSpan Quantile(IReadOnlyList<TimeSpan> values, double quantile) =>
        WeightedStatistics.RoundToMinute(WeightedStatistics.InterpolatedQuantile(values, quantile));

    /// <summary>Linear interpolation between the two closest ranks (as <see cref="WeightedStatistics.InterpolatedQuantile"/>).</summary>
    private static double Quantile(IReadOnlyList<int> counts, double quantile)
    {
        var ordered = counts.Order().ToArray();
        var position = quantile * (ordered.Length - 1);
        var lower = (int)Math.Floor(position);
        var upper = Math.Min(lower + 1, ordered.Length - 1);
        return ordered[lower] + ((ordered[upper] - ordered[lower]) * (position - lower));
    }
}
