using Lotties.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// Tick step 5, at most hourly (design section 5, retention): subscriptions past their push-service expiration are
/// revoked <c>gone</c>, those not seen for 90 days <c>inactive</c>, those revoked for 30 days deleted (their deliveries
/// cascade); deliveries older than 14 days and actions unchanged for 7 days are deleted. All set-based.
/// </summary>
internal sealed class NotificationHousekeeping(
    IPushSubscriptionRepository subscriptions,
    INotificationDeliveryRepository deliveries,
    INotificationActionRepository actions,
    ILogger<NotificationHousekeeping> logger)
{
    public async Task RunAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var expired = await subscriptions.RevokeExpiredAsync(now, cancellationToken);
        var inactive = await subscriptions.RevokeNotSeenSinceAsync(now - NotificationRules.InactiveSubscriptionAge, now, cancellationToken);
        var deletedSubscriptions = await subscriptions.DeleteRevokedBeforeAsync(now - NotificationRules.RevokedSubscriptionRetention, cancellationToken);
        var deletedDeliveries = await deliveries.DeleteCreatedBeforeAsync(now - NotificationRules.DeliveryRetention, cancellationToken);
        var deletedActions = await actions.DeleteUpdatedBeforeAsync(now - NotificationRules.ActionRetention, cancellationToken);
        if (expired + inactive + deletedSubscriptions + deletedDeliveries + deletedActions == 0)
        {
            return;
        }

        logger.LogInformation(
            "Push housekeeping: {ExpiredCount} subscriptions expired, {InactiveCount} inactive, {DeletedSubscriptionCount} deleted; {DeletedDeliveryCount} deliveries and {DeletedActionCount} actions deleted",
            expired,
            inactive,
            deletedSubscriptions,
            deletedDeliveries,
            deletedActions);
    }
}
