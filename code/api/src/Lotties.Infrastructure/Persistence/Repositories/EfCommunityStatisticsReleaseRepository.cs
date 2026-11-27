using Lotties.Domain.CommunityInsights;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <summary>
/// EF Core implementation of <see cref="ICommunityStatisticsReleaseRepository"/>: staging writes, activation swap, and retention
/// of exactly two releases. All mutations go through this context (the built-in database; community statistics are control-plane
/// data, never routed to a BYO store).
/// </summary>
internal sealed class EfCommunityStatisticsReleaseRepository(LottiesDbContext context) : ICommunityStatisticsReleaseRepository
{
    public async Task<CommunityStatisticsRelease?> GetActiveAsync(CancellationToken cancellationToken = default) =>
        await context.CommunityStatisticsReleases
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Status == CommunityStatisticsReleaseStatus.Active, cancellationToken);

    public async Task<CommunityStatisticsRelease?> GetLatestAsync(CancellationToken cancellationToken = default) =>
        await context.CommunityStatisticsReleases
            .AsNoTracking()
            .OrderByDescending(r => r.ReleaseSequence)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<int> GetMaxSequenceAsync(CancellationToken cancellationToken = default)
    {
        var max = await context.CommunityStatisticsReleases
            .AsNoTracking()
            .MaxAsync(r => (int?)r.ReleaseSequence, cancellationToken);
        return max ?? 0;
    }

    public async Task SaveAsync(CommunityStatisticsRelease release, CancellationToken cancellationToken = default)
    {
        context.CommunityStatisticsReleases.Add(release);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task ActivateAndSupersedePreviousAsync(Guid newReleaseId, CancellationToken cancellationToken = default)
    {
        var newRelease = await context.CommunityStatisticsReleases
            .SingleOrDefaultAsync(r => r.Id == newReleaseId, cancellationToken)
            ?? throw new InvalidOperationException($"Release {newReleaseId} not found.");

        var previousActive = await context.CommunityStatisticsReleases
            .Where(r => r.Status == CommunityStatisticsReleaseStatus.Active && r.Id != newReleaseId)
            .ToListAsync(cancellationToken);

        newRelease.Activate();
        foreach (var previous in previousActive)
        {
            previous.Supersede();
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task PruneOldReleasesAsync(CancellationToken cancellationToken = default)
    {
        // Keep exactly two: the active and the most recent superseded. Delete everything else.
        var keepIds = await context.CommunityStatisticsReleases
            .AsNoTracking()
            .OrderByDescending(r => r.ReleaseSequence)
            .Take(2)
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        await context.CommunityStatisticsReleases
            .Where(r => !keepIds.Contains(r.Id))
            .ExecuteDeleteAsync(cancellationToken);
    }
}