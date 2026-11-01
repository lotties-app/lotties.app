using Lotties.Application.Push;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>A pending delivery ready to send: its (tracked) row, the subscription it goes to and the built message.</summary>
internal sealed record OutgoingPush(NotificationDelivery Delivery, PushSubscription Subscription, PushMessage Message)
{
    /// <summary>
    /// The message for <paramref name="delivery"/>: the payload from <paramref name="content"/> in the device's locale, the
    /// topic from the dedupe key's base, and <c>TTL</c> = what is left of the delivery's time to live at <paramref name="now"/>.
    /// The caller has checked that the delivery has not expired.
    /// </summary>
    public static OutgoingPush Create(
        NotificationDelivery delivery,
        PushSubscription subscription,
        NotificationContent content,
        NotificationActionToken? token,
        NotificationUrgency urgency,
        DateTimeOffset now)
    {
        var payload = PushPayloads.Build(delivery.Id, delivery.Kind, content, delivery.DedupeKey, subscription.Locale, token);
        return new OutgoingPush(delivery, subscription, PushMessage.Create(payload, delivery.DedupeKey, delivery.ExpiresAt - now, urgency));
    }
}

/// <summary>What a batch of sends did (counts only).</summary>
internal sealed record SendSummary(int Sent, int Retrying, int Failed, int Gone)
{
    public static SendSummary Empty { get; } = new(0, 0, 0, 0);

    public SendSummary Add(SendSummary other) => new(Sent + other.Sent, Retrying + other.Retrying, Failed + other.Failed, Gone + other.Gone);

    public static SendSummary Of(DeliveryAttemptOutcome outcome) => outcome switch
    {
        DeliveryAttemptOutcome.Sent => new(1, 0, 0, 0),
        DeliveryAttemptOutcome.Retry => new(0, 1, 0, 0),
        DeliveryAttemptOutcome.Gone => new(0, 0, 0, 1),
        _ => new(0, 0, 1, 0),
    };
}
