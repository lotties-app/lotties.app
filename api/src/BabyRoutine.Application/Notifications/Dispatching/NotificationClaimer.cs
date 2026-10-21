using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Notifications.Dispatching;

/// <summary>The claims of one tick ready to send, and how many were claimed (or claimed and already expired).</summary>
internal sealed record ClaimBatch(IReadOnlyList<OutgoingPush> Outgoing, int Claimed, int Expired);

/// <summary>
/// Tick step 4, first half (design section 7): every planned notification is claimed for each active subscription of
/// its user by inserting the pending delivery row before anything is sent. The unique
/// <c>(subscription_id, dedupe_key)</c> index makes a claim another tick or instance already made fail; that one is
/// skipped. Each claim is committed on its own, so a crash before the send leaves a pending row the retry step sends.
/// </summary>
internal sealed class NotificationClaimer(
    IPushSubscriptionRepository subscriptions,
    INotificationDeliveryRepository deliveries,
    ILogger<NotificationClaimer> logger)
{
    public async Task<ClaimBatch> ClaimAsync(IReadOnlyList<PlannedNotification> planned, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        if (planned.Count == 0)
        {
            return new ClaimBatch([], 0, 0);
        }

        var userIds = planned.Select(notification => notification.UserId).Distinct().ToArray();
        var active = (await subscriptions.ListActiveForUsersAsync(userIds, cancellationToken))
            .Where(subscription => subscription.IsActiveAt(now))
            .ToLookup(subscription => subscription.UserId);
        var claimed = 0;
        var outgoing = new List<OutgoingPush>();
        foreach (var (notification, subscription) in planned.SelectMany(notification => active[notification.UserId].Select(subscription => (notification, subscription))))
        {
            var issued = await TryClaimAsync(notification, subscription, now, cancellationToken);
            claimed += issued is null ? 0 : 1;
            if (issued is not null && !issued.Delivery.ExpireIfPastTimeToLive(now))
            {
                outgoing.Add(OutgoingPush.Create(issued.Delivery, subscription, notification.Content, issued.ActionToken, notification.Urgency, now));
            }
        }

        return new ClaimBatch(outgoing, claimed, claimed - outgoing.Count);
    }

    private async Task<IssuedDelivery?> TryClaimAsync(PlannedNotification notification, PushSubscription subscription, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var issued = NotificationDelivery.Claim(Guid.NewGuid(), subscription.Id, notification, now);
        if (await deliveries.TryClaimAsync(issued.Delivery, cancellationToken))
        {
            return issued;
        }

        logger.LogDebug("Push {Kind} for subscription {SubscriptionId} was already claimed by another tick or instance", NotificationCodes.Of(notification.Kind), subscription.Id);
        return null;
    }
}
