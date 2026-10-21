using Lotties.Application.Notifications;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Portable optimistic lease: the row is read, <see cref="JobLease.TryAcquire"/> decides, and the update carries the
/// row version read (<c>xmin</c> on PostgreSQL, the emulated integer token on the SQLite test database). An instance
/// that read the same lease as a faster one fails the update with <see cref="DbUpdateConcurrencyException"/> and loses;
/// two first-ever inserts race on the primary key. The lease entity is always detached afterwards so the next call
/// reads the stored row again.
/// </remarks>
internal sealed class EfJobLeaseRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IJobLeaseRepository
{
    public async Task<bool> TryAcquireAsync(string name, string holderId, DateTimeOffset now, TimeSpan duration, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var lease = await context.JobLeases.SingleOrDefaultAsync(stored => stored.Name == name, cancellationToken);
        return lease is null
            ? await TryCreateAsync(JobLease.Create(name, holderId, now, duration), cancellationToken)
            : await TryTakeAsync(lease, holderId, now, duration, cancellationToken);
    }

    private async Task<bool> TryCreateAsync(JobLease lease, CancellationToken cancellationToken)
    {
        try
        {
            return await UniqueInserts.TryInsertAsync(context, uniqueViolations, lease, cancellationToken);
        }
        finally
        {
            context.Entry(lease).State = EntityState.Detached;
        }
    }

    private async Task<bool> TryTakeAsync(JobLease lease, string holderId, DateTimeOffset now, TimeSpan duration, CancellationToken cancellationToken)
    {
        try
        {
            return lease.TryAcquire(holderId, now, duration) && await SavedAsync(cancellationToken);
        }
        finally
        {
            context.Entry(lease).State = EntityState.Detached;
        }
    }

    private async Task<bool> SavedAsync(CancellationToken cancellationToken)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }
    }
}
