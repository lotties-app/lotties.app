namespace Lotties.Domain.CommunityInsights;

/// <summary>A calendar quarter in UTC (January-March is quarter 1).</summary>
public readonly record struct CommunityQuarter(int Year, int Quarter) : IComparable<CommunityQuarter>
{
    /// <summary>The quarter <paramref name="instant"/> falls in, in UTC.</summary>
    public static CommunityQuarter Of(DateTimeOffset instant)
    {
        var utc = instant.UtcDateTime;
        return new CommunityQuarter(utc.Year, ((utc.Month - 1) / 3) + 1);
    }

    /// <summary>The first instant of the quarter, UTC.</summary>
    public DateTimeOffset Start => new(Year, ((Quarter - 1) * 3) + 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>The first instant of the next quarter, UTC.</summary>
    public DateTimeOffset NextStart => Start.AddMonths(3);

    public int CompareTo(CommunityQuarter other) => (Year * 4) + Quarter - ((other.Year * 4) + other.Quarter);

    public override string ToString() => $"{Year}-Q{Quarter}";

    public static bool operator <(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) < 0;

    public static bool operator >(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) > 0;

    public static bool operator <=(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) <= 0;

    public static bool operator >=(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) >= 0;
}

/// <summary>What the job is about to write: a release with statistics (spends privacy budget) or a placeholder (spends none).</summary>
public enum CommunityReleaseKind
{
    Release,
    Placeholder,
}

/// <summary>
/// What the cadence knows of the latest stored release: when it was generated and whether it counts against its quarter. A
/// placeholder does not count; a release with statistics does, and so does a row the reader cannot parse (fail closed: it might be
/// one).
/// </summary>
public sealed record CommunityStoredRelease(DateTimeOffset GeneratedAt, bool CountsAgainstQuarter)
{
    /// <summary>The cadence view of a stored row's served content.</summary>
    public static CommunityStoredRelease Of(DateTimeOffset generatedAt, string statisticsJson)
    {
        ArgumentNullException.ThrowIfNull(statisticsJson);
        return new CommunityStoredRelease(generatedAt, !IsPlaceholder(statisticsJson));
    }

    private static bool IsPlaceholder(string statisticsJson)
    {
        try
        {
            return CommunityReleaseJson.Parse(statisticsJson).IsPlaceholder;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

/// <summary>
/// The release cadence of community statistics (owner decision of 2026-11-27, docs/design/34-community-insights.md section 5.1): at
/// most one release with statistics per calendar quarter (UTC), never weekly, because every release spends privacy budget. Decided
/// from the latest stored release only, so no configuration, restart or second run can publish twice in a quarter:
/// <list type="bullet">
/// <item>no stored release: due;</item>
/// <item>the latest was generated in a later quarter than now (a clock behind): never due (fail closed);</item>
/// <item>the latest was generated in an earlier quarter: due;</item>
/// <item>same quarter: a release is due only when the latest is a placeholder (placeholders do not count against the quarter); a
/// placeholder is never due (nothing to replace).</item>
/// </list>
/// The job writes no placeholder after a release of the same quarter, so the latest stored row always tells whether the quarter's
/// release was spent; a row that cannot be read counts as a release.
/// </summary>
public static class CommunityReleaseCadence
{
    public static bool IsDue(CommunityReleaseKind kind, DateTimeOffset now, CommunityStoredRelease? latest)
    {
        if (latest is null)
        {
            return true;
        }

        var current = CommunityQuarter.Of(now);
        var latestQuarter = CommunityQuarter.Of(latest.GeneratedAt);
        return latestQuarter < current || (latestQuarter == current && kind == CommunityReleaseKind.Release && !latest.CountsAgainstQuarter);
    }
}
