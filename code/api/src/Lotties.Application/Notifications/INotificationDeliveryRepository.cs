using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications;

/// <summary>Persistence for <see cref="NotificationDelivery"/>: the delivery log and the idempotency claim.</summary>
public interface INotificationDeliveryRepository
{
    /// <summary>
    /// Inserts a newly claimed delivery. Returns <c>false</c>, leaving nothing tracked, when the same dedupe key was
    /// already claimed for that subscription (another tick or instance won); other database errors are rethrown.
    /// </summary>
    Task<bool> TryClaimAsync(NotificationDelivery delivery, CancellationToken cancellationToken = default);

    /// <summary>The delivery with <paramref name="deliveryId"/>, or <c>null</c>; tracked.</summary>
    Task<NotificationDelivery?> FindAsync(Guid deliveryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Pending deliveries whose next attempt is at or before <paramref name="now"/> (the retry pass; expired ones are
    /// among them and expire through the domain), oldest attempt first, at most <paramref name="limit"/>; tracked.
    /// </summary>
    Task<IReadOnlyList<NotificationDelivery>> ListPendingDueAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default);

    /// <summary>The distinct dedupe keys claimed for these users (any status, any subscription) since <paramref name="createdSince"/>.</summary>
    Task<IReadOnlyList<DeliveredNotification>> ListClaimedKeysAsync(IReadOnlyCollection<Guid> userIds, DateTimeOffset createdSince, CancellationToken cancellationToken = default);

    /// <summary>
    /// The heads-ups of <paramref name="kinds"/> claimed for these users since <paramref name="createdSince"/> that count
    /// toward the diaper caps: sent or still pending on some subscription (one per user and dedupe key, at the earliest
    /// send time, else the due time).
    /// </summary>
    Task<IReadOnlyList<SentHeadsUp>> ListSentHeadsUpsAsync(
        IReadOnlyCollection<Guid> userIds,
        IReadOnlyCollection<NotificationKind> kinds,
        DateTimeOffset createdSince,
        CancellationToken cancellationToken = default);

    /// <summary>Cancels every pending delivery of the subscription (transferred or revoked); returns how many.</summary>
    Task<int> CancelPendingForSubscriptionAsync(Guid subscriptionId, CancellationToken cancellationToken = default);

    /// <summary>Cancels the user's pending snooze re-sends of <paramref name="baseKey"/> (a dismissal); returns how many.</summary>
    Task<int> CancelPendingResendsAsync(Guid userId, NotificationKey baseKey, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: deletes deliveries created before <paramref name="createdBefore"/>; returns how many.</summary>
    Task<int> DeleteCreatedBeforeAsync(DateTimeOffset createdBefore, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
