using Lotties.Domain.Babies;

namespace Lotties.Domain.AccessLogs;

/// <summary>Which accesses are recorded, and how often.</summary>
public static class AccessLogThrottle
{
    /// <summary>At most one entry per member and baby in this window.</summary>
    public static readonly TimeSpan Window = TimeSpan.FromHours(1);

    /// <summary>The newest entries the Owner sees.</summary>
    public const int ListLimit = 50;

    /// <summary>Whether a member with <paramref name="role"/> has her accesses recorded: v1 records Doctors only.</summary>
    public static bool IsRecorded(BabyRole role) => role.IsDoctor();

    /// <summary>Whether a new entry is due at <paramref name="now"/> after the member's latest one at <paramref name="latestAt"/> (none = due).</summary>
    public static bool IsDue(DateTimeOffset? latestAt, DateTimeOffset now) => latestAt is not { } latest || now - latest >= Window;
}
