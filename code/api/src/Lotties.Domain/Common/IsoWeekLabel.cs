using System.Globalization;

namespace Lotties.Domain.Common;

/// <summary>
/// The ISO 8601 week of an instant, taken in UTC, as <c>yyyy-Www</c> with the ISO week-year (e.g. <c>2026-W47</c>). Around 1 January
/// the week-year is not the calendar year: 2027-01-01 is in <c>2026-W53</c> and 2024-12-30 in <c>2025-W01</c>. Names the community
/// statistics release (<c>CommunityStatisticsRelease.ReleaseId</c>) and the temporal bucket of the community prediction aggregates.
/// </summary>
public static class IsoWeekLabel
{
    /// <summary>The ISO week label of <paramref name="instant"/> in UTC.</summary>
    public static string Of(DateTimeOffset instant)
    {
        var date = instant.UtcDateTime;
        return string.Create(CultureInfo.InvariantCulture, $"{ISOWeek.GetYear(date)}-W{ISOWeek.GetWeekOfYear(date):00}");
    }
}
