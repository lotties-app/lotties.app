using BabyRoutine.Application.Notifications;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Claims rely on the unique <c>(subscription_id, dedupe_key)</c> index: of two ticks or instances claiming the same
/// notification for the same device, the second insert is a unique violation and <see cref="TryClaimAsync"/> returns
/// <c>false</c>. Cancellations are set-based updates of pending rows only, matching <see cref="NotificationDelivery.Cancel"/>.
/// </remarks>
internal sealed class EfNotificationDeliveryRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations) : INotificationDeliveryRepository
{
    public Task<bool> TryClaimAsync(NotificationDelivery delivery, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, delivery, cancellationToken);

    public Task<NotificationDelivery?> FindAsync(Guid deliveryId, CancellationToken cancellationToken = default) =>
        context.NotificationDeliveries.SingleOrDefaultAsync(delivery => delivery.Id == deliveryId, cancellationToken);

    public async Task<IReadOnlyList<NotificationDelivery>> ListPendingDueAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);
        return await context.NotificationDeliveries
            .Where(delivery => delivery.Status == DeliveryStatus.Pending && delivery.NextAttemptAt != null && delivery.NextAttemptAt <= now)
            .OrderBy(delivery => delivery.NextAttemptAt)
            .ThenBy(delivery => delivery.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DeliveredNotification>> ListClaimedKeysAsync(IReadOnlyCollection<Guid> userIds, DateTimeOffset createdSince, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        var claimed = await context.NotificationDeliveries
            .AsNoTracking()
            .Where(delivery => userIds.Contains(delivery.UserId) && delivery.CreatedAt >= createdSince)
            .Select(delivery => new { delivery.UserId, delivery.DedupeKey })
            .Distinct()
            .ToListAsync(cancellationToken);
        return claimed.Select(key => new DeliveredNotification(key.UserId, key.DedupeKey)).ToArray();
    }

    public Task<int> CancelPendingForSubscriptionAsync(Guid subscriptionId, CancellationToken cancellationToken = default) =>
        CancelAsync(context.NotificationDeliveries.Where(delivery => delivery.SubscriptionId == subscriptionId), cancellationToken);

    public Task<int> CancelPendingResendsAsync(Guid userId, NotificationKey baseKey, CancellationToken cancellationToken = default) =>
        CancelAsync(
            context.NotificationDeliveries.Where(delivery => delivery.UserId == userId && delivery.BaseKey == baseKey && delivery.DedupeKey != baseKey),
            cancellationToken);

    public Task<int> DeleteCreatedBeforeAsync(DateTimeOffset createdBefore, CancellationToken cancellationToken = default) =>
        context.NotificationDeliveries
            .Where(delivery => delivery.CreatedAt < createdBefore)
            .ExecuteDeleteAsync(cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private static Task<int> CancelAsync(IQueryable<NotificationDelivery> deliveries, CancellationToken cancellationToken)
    {
        DateTimeOffset? noNextAttempt = null;
        return deliveries
            .Where(delivery => delivery.Status == DeliveryStatus.Pending)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(delivery => delivery.Status, DeliveryStatus.Cancelled)
                    .SetProperty(delivery => delivery.NextAttemptAt, noNextAttempt),
                cancellationToken);
    }
}
