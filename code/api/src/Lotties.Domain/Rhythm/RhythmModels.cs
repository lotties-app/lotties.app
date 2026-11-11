using Lotties.Domain.Patterns;

namespace Lotties.Domain.Rhythm;

/// <summary>Whether a rhythm metric has a value (docs/design/48-baby-rhythm.md section 3).</summary>
public enum RhythmStatus
{
    /// <summary>Enough data; the value is given.</summary>
    Ok,

    /// <summary>Fewer samples than the minimum: no value, nothing guessed.</summary>
    NotEnoughData,

    /// <summary>A clock (bed time, wake-up) whose spread is over the limit: no usual time.</summary>
    Varies,

    /// <summary>An association whose groups are large enough but whose medians differ too little.</summary>
    NoClearDifference,
}

/// <summary>What splits the nights of an association.</summary>
public enum RhythmFactor
{
    /// <summary>At least the threshold of feeds in the hours before bed time vs fewer.</summary>
    EveningFeeds,

    /// <summary>A dirty diaper during the day before the night vs none (diapers logged).</summary>
    DirtyDiaperDay,
}

/// <summary>What is compared between the two groups of nights.</summary>
public enum RhythmOutcome
{
    NightLength,
    LongestStretch,
    FirstStretch,
}

/// <summary>
/// One counted night, placed on its evening (the local date of its bed time on a day starting at
/// <see cref="RhythmOptions.EveningDayStartsAt"/>). Lengths are elapsed time.
/// </summary>
/// <param name="LongestStretch">The longest piece of the night's sleep between logged wakings.</param>
/// <param name="FirstStretch">Bed time to the first logged waking, or to the wake-up without one.</param>
public sealed record RhythmNight(DateOnly Evening, DateTimeOffset BedTime, DateTimeOffset WakeUp, TimeSpan LongestStretch, TimeSpan FirstStretch)
{
    /// <summary>Wake-up minus bed time.</summary>
    public TimeSpan Length => WakeUp - BedTime;

    public TimeSpan Of(RhythmOutcome outcome) => outcome switch
    {
        RhythmOutcome.NightLength => Length,
        RhythmOutcome.LongestStretch => LongestStretch,
        _ => FirstStretch,
    };
}

/// <summary>
/// A usual clock time (bed time, wake-up): the circular mean (local, to the minute) and the circular standard deviation
/// (whole minutes; <c>null</c> when the times cancel out), from <paramref name="Nights"/> nights. <see cref="Usual"/> is
/// set only when <see cref="Status"/> is <see cref="RhythmStatus.Ok"/>; the spread also with <see cref="RhythmStatus.Varies"/>.
/// </summary>
public sealed record ClockSummary(RhythmStatus Status, TimeOnly? Usual, TimeSpan? Spread, int Nights);

/// <summary>Durations: interpolated 25th percentile, median and 75th percentile (whole minutes) of <paramref name="Count"/> samples, set only when ok.</summary>
public sealed record DurationSummary(RhythmStatus Status, int Count, TimeSpan? P25, TimeSpan? Median, TimeSpan? P75);

/// <summary>Counts per day: interpolated 25th percentile, median and 75th percentile over <paramref name="Count"/> days, set only when ok.</summary>
public sealed record CountSummary(RhythmStatus Status, int Count, double? P25, double? Median, double? P75);

/// <summary>Naps per bracketed day and the usual nap starts found by <see cref="RecurringTimeOfDayPattern"/> (by usual time).</summary>
public sealed record NapRhythm(CountSummary PerDay, IReadOnlyList<TimeOfDayPattern> UsualStarts);

/// <summary>Feeds per day and the start-to-start gap between feeds.</summary>
public sealed record FeedRhythm(CountSummary PerDay, DurationSummary Gap);

/// <summary>
/// One outcome of an association: the group sizes, the night-to-night spread (median absolute deviation of all the
/// qualifying nights, whole minutes) and, only when <see cref="Status"/> is <see cref="RhythmStatus.Ok"/>, the medians and
/// their difference (with minus without).
/// </summary>
public sealed record AssociationOutcome(
    RhythmOutcome Outcome,
    RhythmStatus Status,
    int NightsWith,
    int NightsWithout,
    TimeSpan? MedianWith,
    TimeSpan? MedianWithout,
    TimeSpan? Difference,
    TimeSpan? Spread);

/// <summary>A factor and its outcomes in the order of <see cref="RhythmOutcome"/>; <paramref name="Threshold"/> is the evening feed count that splits the nights.</summary>
public sealed record RhythmAssociation(RhythmFactor Factor, int? Threshold, IReadOnlyList<AssociationOutcome> Outcomes);

/// <summary>
/// The baby's rhythm over the local days <paramref name="FirstDay"/> to <paramref name="LastDay"/>
/// (docs/design/48-baby-rhythm.md): facts from her own log only, nothing compared with anyone.
/// </summary>
public sealed record RhythmMeasurement(
    DateOnly FirstDay,
    DateOnly LastDay,
    IReadOnlyList<RhythmNight> Nights,
    ClockSummary BedTime,
    ClockSummary WakeUp,
    DurationSummary NightLength,
    DurationSummary LongestStretch,
    DurationSummary FirstStretch,
    NapRhythm Naps,
    FeedRhythm Feeds,
    IReadOnlyList<RhythmAssociation> Associations);
