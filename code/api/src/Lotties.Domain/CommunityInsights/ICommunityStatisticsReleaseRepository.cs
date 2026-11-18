namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// Persistence of <see cref="CommunityStatisticsRelease"/> (docs/design/34-community-insights.md section 5): staging writes,
/// activation swap, and retention of exactly two releases (current + previous). The repository owns the lifecycle transitions;
/// callers never set <see cref="CommunityStatisticsRelease.Status"/> directly.
/// </summary>
public interface ICommunityStatisticsReleaseRepository
{
    /// <summary>The current active release, or <c>null</c> when no run has completed yet.</summary>
    Task<CommunityStatisticsRelease?> GetActiveAsync(CancellationToken cancellationToken = default);

    /// <summary>The highest sequence number, or 0 when no release exists; used to assign the next one.</summary>
    Task<int> GetMaxSequenceAsync(CancellationToken cancellationToken = default);

    /// <summary>Saves a new pending release (insert).</summary>
    Task SaveAsync(CommunityStatisticsRelease release, CancellationToken cancellationToken = default);

    /// <summary>Marks the release as active and supersedes the previous active one in a single transaction.</summary>
    Task ActivateAndSupersedePreviousAsync(Guid newReleaseId, CancellationToken cancellationToken = default);

    /// <summary>Deletes releases older than the two most recent (retention policy).</summary>
    Task PruneOldReleasesAsync(CancellationToken cancellationToken = default);
}