namespace Lotties.Domain.Predictions;

/// <summary>Gap statistics for one diaper sub-type (wet-only or dirty-only).</summary>
public sealed record DiaperGapStats(
    TimeSpan MedianGap,
    TimeSpan P10Gap,
    TimeSpan P90Gap,
    int SampleCount);

/// <summary>The result of splitting diaper events into wet and dirty sub-types and computing gap statistics for each.</summary>
public sealed record DiaperPatternAnalysis(DiaperGapStats? WetGapStats, DiaperGapStats? DirtyGapStats);

/// <summary>
/// Pure domain analyzer that splits diaper events into wet-only and dirty-only based on their payload content
/// (<see cref="DiaperContents"/>), then computes separate gap statistics for each sub-type. No I/O.
/// </summary>
public static class DiaperPatternAnalyzer
{
    /// <summary>Fewest gaps a sub-type needs before its statistics are returned.</summary>
    public const int MinimumGaps = 3;

    /// <summary>
    /// Analyzes diaper events, splitting them into wet and dirty sub-types and computing gap statistics for each.
    /// A diaper marked <c>MIXED</c> counts in both sub-types. Returns <c>null</c> for a sub-type with fewer than
    /// <see cref="MinimumGaps"/> usable gaps.
    /// </summary>
    public static DiaperPatternAnalysis Analyze(
        IReadOnlyList<ObservedEvent> diaperEvents,
        DateTimeOffset now,
        TimeSpan lookBack)
    {
        ArgumentNullException.ThrowIfNull(diaperEvents);

        var inWindow = diaperEvents
            .Where(e => e.StartedAt >= now - lookBack && e.StartedAt <= now)
            .OrderBy(e => e.StartedAt)
            .ToArray();

        var wetTimes = inWindow
            .Where(e => DiaperContents.IsWet(e.Content))
            .Select(e => e.StartedAt)
            .ToArray();

        var dirtyTimes = inWindow
            .Where(e => DiaperContents.IsDirty(e.Content))
            .Select(e => e.StartedAt)
            .ToArray();

        return new DiaperPatternAnalysis(
            ComputeGapStats(wetTimes),
            ComputeGapStats(dirtyTimes));
    }

    private static DiaperGapStats? ComputeGapStats(DateTimeOffset[] times)
    {
        if (times.Length < MinimumGaps + 1)
        {
            return null;
        }

        var gaps = new TimeSpan[times.Length - 1];
        for (var i = 0; i < gaps.Length; i++)
        {
            gaps[i] = times[i + 1] - times[i];
        }

        // Drop duplicates (under 1 minute).
        var usable = gaps.Where(g => g >= TimeSpan.FromMinutes(1)).ToArray();
        if (usable.Length < MinimumGaps)
        {
            return null;
        }

        return new DiaperGapStats(
            WeightedStatistics.InterpolatedQuantile(usable, 0.5),
            WeightedStatistics.InterpolatedQuantile(usable, 0.1),
            WeightedStatistics.InterpolatedQuantile(usable, 0.9),
            usable.Length);
    }
}