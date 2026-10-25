namespace Lotties.Domain.CryReasons;

/// <summary>The everyday causes the ranking weighs, in their stable tie order. <see cref="Comfort"/> is the always-present fallback.</summary>
public enum CryCause
{
    Hunger,
    Sleepy,
    Diaper,
    Gas,
    Comfort,
}

/// <summary>How strongly the log suggests a cause (never a probability).</summary>
public enum CryLevel
{
    Likely,
    Possible,
    Unlikely,
}

/// <summary>Newborn under 6 weeks, 6 weeks to 3 months, 3 to 6 months, 6 months and over (the web's <c>CryAgeBand</c>).</summary>
public enum CryAgeBand
{
    Newborn,
    Weeks6to3m,
    Months3to6,
    Months6plus,
}

/// <summary>When to call someone instead of looking at the log; the same list every time (the web's <c>CRY_RED_FLAGS</c>).</summary>
public enum CryRedFlag
{
    Fever,
    Inconsolable,
    RefusingFeeds,
    UnusualSleepiness,
    BulgingOrStiffFontanelle,
}

/// <summary>
/// One structured reason behind a cause, the web's <c>CryFact</c> flattened: <see cref="Kind"/> says which members are set
/// (<c>sinceLastFeed</c>: minutes, usualGapMinutes, smallerFeed; <c>feedingNow</c>: minutes; <c>awakeFor</c>: minutes,
/// windowMinutes; <c>nightTime</c>; <c>sinceLastDiaper</c>: minutes, usualGapMinutes; <c>dirtyDue</c>: signal, expectedAt;
/// <c>recentFeedNoBurp</c> and <c>reliefAfterFeed</c>: minutesSinceFeed; <c>bellyPattern</c>: typicalClock;
/// <c>eveningFussy</c>: typicalClock or none; <c>noData</c>: reason). Minutes are whole minutes.
/// </summary>
public sealed record CryFact
{
    public required string Kind { get; init; }

    public int? Minutes { get; init; }

    public int? UsualGapMinutes { get; init; }

    public bool? SmallerFeed { get; init; }

    public int? WindowMinutes { get; init; }

    public string? Signal { get; init; }

    public DateTimeOffset? ExpectedAt { get; init; }

    public int? MinutesSinceFeed { get; init; }

    public string? TypicalClock { get; init; }

    public string? Reason { get; init; }
}

/// <summary>One cause with its level, its ordering score (0..1, 3 decimals; never shown as a probability) and its facts.</summary>
public sealed record CryCauseRank(CryCause Cause, CryLevel Level, double Score, IReadOnlyList<CryFact> Facts);

/// <summary>The ranking: all five causes, score descending (ties keep the <see cref="CryCause"/> order), and the red flags.</summary>
public sealed record CryReasonResult(IReadOnlyList<CryCauseRank> Causes, IReadOnlyList<CryRedFlag> RedFlags);
