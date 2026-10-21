using BabyRoutine.Application.Notifications;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// The unique <c>endpoint_hash</c> index decides concurrent subscribes of the same browser (<see cref="TryAddAsync"/>).
/// Housekeeping revokes with set-based updates that touch only non-revoked rows, so the first revoke reason is kept
/// as <see cref="PushSubscription.Revoke"/> does.
/// </remarks>
internal sealed class EfPushSubscriptionRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations) : IPushSubscriptionRepository
{
    public Task<PushSubscription?> FindByEndpointHashAsync(string endpointHash, CancellationToken cancellationToken = default) =>
        context.PushSubscriptions.SingleOrDefaultAsync(subscription => subscription.EndpointHash == endpointHash, cancellationToken);

    public Task<PushSubscription?> FindForUserAsync(Guid userId, Guid subscriptionId, CancellationToken cancellationToken = default) =>
        context.PushSubscriptions.SingleOrDefaultAsync(subscription => subscription.Id == subscriptionId && subscription.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<PushSubscription>> ListActiveForUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.PushSubscriptions
            .Where(subscription => subscription.UserId == userId && subscription.RevokedAt == null)
            .OrderByDescending(subscription => subscription.LastSeenAt)
            .ThenBy(subscription => subscription.Id)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<PushSubscription>> ListActiveForUsersAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        return await context.PushSubscriptions
            .Where(subscription => userIds.Contains(subscription.UserId) && subscription.RevokedAt == null)
            .OrderBy(subscription => subscription.UserId)
            .ThenBy(subscription => subscription.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PushSubscription>> ListByIdsAsync(IReadOnlyCollection<Guid> subscriptionIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(subscriptionIds);
        return await context.PushSubscriptions
            .Where(subscription => subscriptionIds.Contains(subscription.Id))
            .ToListAsync(cancellationToken);
    }

    public Task<bool> TryAddAsync(PushSubscription subscription, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, subscription, cancellationToken);

    public Task<int> RevokeNotSeenSinceAsync(DateTimeOffset seenBefore, DateTimeOffset now, CancellationToken cancellationToken = default) =>
        RevokeAsync(
            context.PushSubscriptions.Where(subscription => subscription.RevokedAt == null && subscription.LastSeenAt < seenBefore),
            SubscriptionRevokeReason.Inactive,
            now,
            cancellationToken);

    public Task<int> RevokeExpiredAsync(DateTimeOffset now, CancellationToken cancellationToken = default) =>
        RevokeAsync(
            context.PushSubscriptions.Where(subscription => subscription.RevokedAt == null && subscription.ExpiresAt != null && subscription.ExpiresAt <= now),
            SubscriptionRevokeReason.Gone,
            now,
            cancellationToken);

    public Task<int> CountActiveAsync(DateTimeOffset now, CancellationToken cancellationToken = default) =>
        context.PushSubscriptions.CountAsync(
            subscription => subscription.RevokedAt == null && (subscription.ExpiresAt == null || subscription.ExpiresAt > now),
            cancellationToken);

    public Task<int> DeleteRevokedBeforeAsync(DateTimeOffset revokedBefore, CancellationToken cancellationToken = default) =>
        context.PushSubscriptions
            .Where(subscription => subscription.RevokedAt != null && subscription.RevokedAt < revokedBefore)
            .ExecuteDeleteAsync(cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private static Task<int> RevokeAsync(IQueryable<PushSubscription> subscriptions, SubscriptionRevokeReason reason, DateTimeOffset now, CancellationToken cancellationToken)
    {
        DateTimeOffset? revokedAt = now.ToUniversalTime();
        SubscriptionRevokeReason? revokedReason = reason;
        return subscriptions.ExecuteUpdateAsync(
            setters => setters
                .SetProperty(subscription => subscription.RevokedAt, revokedAt)
                .SetProperty(subscription => subscription.RevokedReason, revokedReason),
            cancellationToken);
    }
}
