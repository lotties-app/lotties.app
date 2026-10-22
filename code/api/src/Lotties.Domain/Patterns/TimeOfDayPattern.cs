namespace Lotties.Domain.Patterns;

/// <summary>How sure a pattern is, from how many days support it and how tight they are.</summary>
public enum PatternConfidence
{
    Low,
    Medium,
    High,
}

/// <summary>
/// One day that supports a pattern: the local calendar date of its first event inside the window and the local times of
/// its events inside the window, in order (a window around midnight may hold 23:50 and 00:10 of the same night).
/// </summary>
public sealed record PatternDay(DateOnly Date, IReadOnlyList<TimeOnly> Times);

/// <summary>One occurrence of the usual window on the local timeline: from <see cref="Start"/> to <see cref="End"/>.</summary>
public sealed record PatternWindow(DateTime Start, DateTime End);

/// <summary>
/// A time of day something keeps happening at, found by <see cref="RecurringTimeOfDayPattern.Detect"/>. Times are local
/// wall-clock times; the window runs from <see cref="WindowStart"/> to <see cref="WindowEnd"/> and crosses midnight when
/// the end is earlier than the start.
/// </summary>
/// <param name="Typical">The circular mean of the days' times, to the minute.</param>
/// <param name="Spread">The circular standard deviation of the days' times, to the minute.</param>
/// <param name="Days">The supporting days, oldest first.</param>
/// <param name="EventDayCount">Days of the look-back with any event (the share inside the window is measured against them).</param>
/// <param name="RecentDayCount">Supporting days in the recent part of the look-back.</param>
public sealed record TimeOfDayPattern(
    TimeOnly Typical,
    TimeOnly WindowStart,
    TimeOnly WindowEnd,
    TimeSpan Spread,
    PatternConfidence Confidence,
    IReadOnlyList<PatternDay> Days,
    int EventDayCount,
    int RecentDayCount)
{
    /// <summary>How long the window is (at most <see cref="RecurringTimeOfDayOptions.MaximumWidth"/>).</summary>
    public TimeSpan Width => WindowEnd - WindowStart;

    /// <summary>The occurrence of the window that starts on the local date <paramref name="date"/>.</summary>
    public PatternWindow WindowStartingOn(DateOnly date)
    {
        var start = date.ToDateTime(WindowStart);
        return new PatternWindow(start, start + Width);
    }
}
