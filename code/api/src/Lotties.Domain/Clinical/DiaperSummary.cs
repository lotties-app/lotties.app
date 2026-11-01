namespace Lotties.Domain.Clinical;

/// <summary>A logged diaper change as the clinical summary reads it: its start and the payload <c>content</c> (<c>WET</c>, <c>DIRTY</c>, <c>MIXED</c>, any case). Callers pass only events that are not soft deleted.</summary>
public sealed record DiaperObservation(DateTimeOffset StartedAt, string? Content)
{
    private const string Wet = "WET";
    private const string Dirty = "DIRTY";
    private const string Mixed = "MIXED";

    private string? Normalized => Content?.ToUpperInvariant();

    /// <summary>Wet or mixed: a mixed diaper counts in both wet and dirty.</summary>
    public bool IsWet => Normalized is Wet or Mixed;

    /// <summary>Dirty or mixed.</summary>
    public bool IsDirty => Normalized is Dirty or Mixed;
}

/// <summary>Diaper changes of one local day (by the day the change started); <see cref="Wet"/> counts WET and MIXED, <see cref="Dirty"/> DIRTY and MIXED.</summary>
public sealed record DiaperDaySummary(DateOnly Date, int Total, int Wet, int Dirty);

/// <summary>The diapers of a range, as the parents' Insights compute it (<c>diaperModel.ts</c>): averages over the completed days with changes.</summary>
public sealed record DiaperSummary(IReadOnlyList<DiaperDaySummary> Days, double? PerDay, double? WetPerDay, double? DirtyPerDay);

/// <summary>Computes the <see cref="DiaperSummary"/>; pure, no I/O.</summary>
public static class DiaperSummaries
{
    /// <param name="observed">The baby's non-deleted diaper changes (those starting after now are ignored).</param>
    /// <param name="window">The local days to cover.</param>
    public static DiaperSummary Summarize(IReadOnlyList<DiaperObservation> observed, ClinicalWindow window)
    {
        ArgumentNullException.ThrowIfNull(observed);
        ArgumentNullException.ThrowIfNull(window);
        var changes = observed.Where(item => item.StartedAt <= window.Now).ToArray();
        var days = window.Days.Select(day => SummarizeDay(day, changes)).ToArray();
        var counted = ClinicalStatistics.CompletedDaysWithData(days, day => day.Total > 0, day => day.Date, window.Today);
        return new DiaperSummary(
            days,
            ClinicalStatistics.Mean(counted.Select(day => (double)day.Total).ToArray()),
            ClinicalStatistics.Mean(counted.Select(day => (double)day.Wet).ToArray()),
            ClinicalStatistics.Mean(counted.Select(day => (double)day.Dirty).ToArray()));
    }

    private static DiaperDaySummary SummarizeDay(ClinicalDay day, IReadOnlyList<DiaperObservation> changes)
    {
        var started = changes.Where(item => day.Contains(item.StartedAt)).ToArray();
        return new DiaperDaySummary(day.Date, started.Length, started.Count(item => item.IsWet), started.Count(item => item.IsDirty));
    }
}
