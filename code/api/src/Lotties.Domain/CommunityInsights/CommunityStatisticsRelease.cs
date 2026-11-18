using Lotties.Domain.Common;

namespace Lotties.Domain.CommunityInsights;

/// <summary>The lifecycle state of a community statistics release.</summary>
public enum CommunityStatisticsReleaseStatus
{
    /// <summary>Being built; not yet visible to readers.</summary>
    Pending,

    /// <summary>The current published release; readers use this one.</summary>
    Active,

    /// <summary>Replaced by a newer active release; kept for rollback until the next supersession.</summary>
    Superseded,
}

/// <summary>
/// One weekly snapshot of aggregated community statistics (docs/design/34-community-insights.md section 5): the idempotency key
/// (<see cref="ReleaseId"/>), the monotonic sequence number, the generation time, the computed cells as a JSON blob, and the
/// lifecycle status. Exactly two releases are retained at any time (current + previous); older ones are deleted on swap.
/// </summary>
public sealed class CommunityStatisticsRelease
{
    private CommunityStatisticsRelease()
    {
        ReleaseId = string.Empty;
        StatisticsJson = string.Empty;
    }

    public Guid Id { get; private set; }

    /// <summary>Idempotency key for the run that produced this release (e.g. <c>2026-W47</c>); unique across all releases.</summary>
    public string ReleaseId { get; private set; }

    /// <summary>Monotonically increasing sequence; used to order releases and to retain exactly two.</summary>
    public int ReleaseSequence { get; private set; }

    /// <summary>When the aggregation run finished writing this release, UTC.</summary>
    public DateTimeOffset GeneratedAtUtc { get; private set; }

    /// <summary>The computed cells as a JSON blob; schema defined by <see cref="CommunityStatisticsCatalog"/>.</summary>
    public string StatisticsJson { get; private set; }

    /// <summary>Lifecycle state: only one release is <see cref="CommunityStatisticsReleaseStatus.Active"/> at a time.</summary>
    public CommunityStatisticsReleaseStatus Status { get; private set; }

    /// <summary>Row creation time, UTC.</summary>
    public DateTimeOffset CreatedAtUtc { get; private set; }

    /// <summary>Creates a new pending release for the given run.</summary>
    public static CommunityStatisticsRelease CreatePending(string releaseId, int sequence, string statisticsJson, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(releaseId);
        ArgumentException.ThrowIfNullOrWhiteSpace(statisticsJson);
        return new CommunityStatisticsRelease
        {
            Id = Guid.NewGuid(),
            ReleaseId = releaseId,
            ReleaseSequence = sequence,
            GeneratedAtUtc = UtcTime.Normalize(now),
            StatisticsJson = statisticsJson,
            Status = CommunityStatisticsReleaseStatus.Pending,
            CreatedAtUtc = UtcTime.Normalize(now),
        };
    }

    /// <summary>Marks this release as the active one (called after staging write succeeds).</summary>
    public void Activate() => Status = CommunityStatisticsReleaseStatus.Active;

    /// <summary>Marks this release as superseded by a newer active release.</summary>
    public void Supersede() => Status = CommunityStatisticsReleaseStatus.Superseded;

    /// <summary>Rehydrates a stored row; for EF Core only.</summary>
    public static CommunityStatisticsRelease Rehydrate(
        Guid id,
        string releaseId,
        int releaseSequence,
        DateTimeOffset generatedAtUtc,
        string statisticsJson,
        CommunityStatisticsReleaseStatus status,
        DateTimeOffset createdAtUtc)
    {
        return new CommunityStatisticsRelease
        {
            Id = id,
            ReleaseId = releaseId,
            ReleaseSequence = releaseSequence,
            GeneratedAtUtc = generatedAtUtc,
            StatisticsJson = statisticsJson,
            Status = status,
            CreatedAtUtc = createdAtUtc,
        };
    }
}