namespace Lotties.Domain.Patterns;

/// <summary>
/// The rules of <see cref="RecurringTimeOfDayPattern.Detect"/> (docs/design/11-patterns.md). <see cref="Default"/> holds the
/// shipped values; other instances exist for tests and for later uses of the detector (fussiness, diapers).
/// </summary>
public sealed record RecurringTimeOfDayOptions
{
    public static RecurringTimeOfDayOptions Default { get; } = new();

    /// <summary>Local calendar days looked at, today included.</summary>
    public int LookBackDays { get; init; } = 14;

    /// <summary>The recent part of the look-back (today and the days before it) the pattern must still show in.</summary>
    public int RecentDays { get; init; } = 7;

    /// <summary>Fewest days of the recent part with an event inside the window.</summary>
    public int MinimumRecentDays { get; init; } = 4;

    /// <summary>How far from the cluster's centre an event may be to take part in the spread.</summary>
    public TimeSpan ClusterRadius { get; init; } = TimeSpan.FromMinutes(90);

    /// <summary>Largest circular standard deviation of the cluster that is still a pattern.</summary>
    public TimeSpan MaximumSpread { get; init; } = TimeSpan.FromMinutes(45);

    /// <summary>The window reaches at least this far on each side of the usual time (else one standard deviation).</summary>
    public TimeSpan MinimumHalfWidth { get; init; } = TimeSpan.FromMinutes(30);

    /// <summary>The window is never wider than this.</summary>
    public TimeSpan MaximumWidth { get; init; } = TimeSpan.FromHours(3);

    /// <summary>Smallest share of the days with an event that must have one inside the window.</summary>
    public double MinimumCoverage { get; init; } = 0.6;

    /// <summary>Days inside the window from which the confidence is medium.</summary>
    public int MediumConfidenceDays { get; init; } = 6;

    /// <summary>Days inside the window from which the confidence is high (with a spread up to <see cref="HighConfidenceSpread"/>).</summary>
    public int HighConfidenceDays { get; init; } = 8;

    /// <summary>Largest spread of a high-confidence pattern.</summary>
    public TimeSpan HighConfidenceSpread { get; init; } = TimeSpan.FromMinutes(30);
}
