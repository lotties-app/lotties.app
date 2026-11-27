using System.Text.Json;

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

    /// <summary>The quarter before this one.</summary>
    public CommunityQuarter Previous => Of(Start.AddDays(-1));

    /// <summary>The calendar days of the quarter, as dates: its first day to its last day, both included.</summary>
    public CommunityDataWindow Days => new(DateOnly.FromDateTime(Start.UtcDateTime), DateOnly.FromDateTime(NextStart.UtcDateTime).AddDays(-1));

    public int CompareTo(CommunityQuarter other) => (Year * 4) + Quarter - ((other.Year * 4) + other.Quarter);

    public override string ToString() => $"{Year}-Q{Quarter}";

    public static bool operator <(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) < 0;

    public static bool operator >(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) > 0;

    public static bool operator <=(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) <= 0;

    public static bool operator >=(CommunityQuarter left, CommunityQuarter right) => left.CompareTo(right) >= 0;
}

/// <summary>
/// The local days one release of a percentile statistic reads (owner decision of 2026-11-27): <see cref="From"/> to
/// <see cref="To"/>, both included, compared with each observation's local date. A local date belongs to exactly one calendar
/// quarter, so the windows of two releases never share a day.
/// </summary>
public readonly record struct CommunityDataWindow(DateOnly From, DateOnly To)
{
    /// <summary>
    /// The window of a release generated at <paramref name="generatedAt"/>: the last complete calendar quarter before the release's
    /// own (UTC) quarter. A late release still reads only that quarter; a skipped quarter's days are never read by a later release.
    /// </summary>
    public static CommunityDataWindow PreviousQuarterOf(DateTimeOffset generatedAt) => CommunityQuarter.Of(generatedAt).Previous.Days;

    public bool Contains(DateOnly day) => day >= From && day <= To;
}

/// <summary>What the job is about to write: a release with statistics (spends privacy budget) or a placeholder (spends none).</summary>
public enum CommunityReleaseKind
{
    Release,
    Placeholder,
}

/// <summary>
/// What the cadence knows of the latest stored release: when it was generated and whether it counts against its quarter. A
/// placeholder does not count, nor does the phase-1 placeholder row written before the current format (exactly
/// <c>{"schema":1,"cells":[],"generatedBy":"phase-1-placeholder"}</c>); a release with statistics does, and so does any other row the
/// reader cannot parse (fail closed: it might be one).
/// </summary>
public sealed record CommunityStoredRelease(DateTimeOffset GeneratedAt, bool CountsAgainstQuarter)
{
    private const string LegacyPlaceholderMarker = "phase-1-placeholder";

    /// <summary>The cadence view of a stored row's served content.</summary>
    public static CommunityStoredRelease Of(DateTimeOffset generatedAt, string statisticsJson)
    {
        ArgumentNullException.ThrowIfNull(statisticsJson);
        return new CommunityStoredRelease(generatedAt, !(IsPlaceholder(statisticsJson) || IsLegacyPlaceholder(statisticsJson)));
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

    /// <summary>Exactly the phase-1 placeholder: an object of three properties, schema 1, an empty cells array and the marker.</summary>
    private static bool IsLegacyPlaceholder(string statisticsJson)
    {
        try
        {
            using var document = JsonDocument.Parse(statisticsJson);
            return IsLegacyShape(document.RootElement);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool IsLegacyShape(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object
        && root.EnumerateObject().Count() == 3
        && root.TryGetProperty("schema", out var schema) && schema.ValueKind == JsonValueKind.Number && schema.TryGetInt32(out var version) && version == 1
        && root.TryGetProperty("cells", out var cells) && cells.ValueKind == JsonValueKind.Array && cells.GetArrayLength() == 0
        && root.TryGetProperty("generatedBy", out var marker) && marker.ValueKind == JsonValueKind.String && marker.GetString() == LegacyPlaceholderMarker;
}

/// <summary>
/// The release cadence of community statistics (owner decision of 2026-11-27, docs/design/34-community-insights.md section 5.1.1):
/// at most one release with statistics per calendar quarter (UTC), never weekly, because every release spends privacy budget.
/// Decided from the latest stored release only, so no configuration, restart or second run can publish twice in a quarter:
/// <list type="bullet">
/// <item>a release is never due in the first <see cref="ReleaseGrace"/> of a quarter, so every local day of the previous quarter (its
/// window) has ended in every time zone;</item>
/// <item>no stored release: due;</item>
/// <item>the latest was generated in a later quarter than now (a clock behind): never due (fail closed);</item>
/// <item>the latest was generated in an earlier quarter: due;</item>
/// <item>same quarter: a release is due only when the latest is a placeholder (placeholders do not count against the quarter); a
/// placeholder is never due (nothing to replace).</item>
/// </list>
/// The job writes no placeholder after a release of the same quarter, so the latest stored row always tells whether the quarter's
/// release was spent; a row that cannot be read counts as a release, except the phase-1 placeholder.
/// </summary>
public static class CommunityReleaseCadence
{
    /// <summary>
    /// The start of a quarter during which no release is due: the last local day of the previous quarter ends at most 12 hours after
    /// the quarter's UTC start (at UTC-12), so after one day every day of the window is over.
    /// </summary>
    public static readonly TimeSpan ReleaseGrace = TimeSpan.FromDays(1);

    public static bool IsDue(CommunityReleaseKind kind, DateTimeOffset now, CommunityStoredRelease? latest) =>
        !InGrace(kind, now) && IsFree(kind, now, latest);

    private static bool InGrace(CommunityReleaseKind kind, DateTimeOffset now) =>
        kind == CommunityReleaseKind.Release && now < CommunityQuarter.Of(now).Start + ReleaseGrace;

    private static bool IsFree(CommunityReleaseKind kind, DateTimeOffset now, CommunityStoredRelease? latest)
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
