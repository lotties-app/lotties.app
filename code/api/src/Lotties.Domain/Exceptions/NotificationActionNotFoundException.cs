namespace Lotties.Domain.Exceptions;

/// <summary>
/// A snooze/dismiss request names an unknown delivery, carries a wrong token or comes too late. One code for every
/// case, so the anonymous action route reveals nothing about which deliveries exist.
/// </summary>
public sealed class NotificationActionNotFoundException : DomainException
{
    public NotificationActionNotFoundException(Guid deliveryId)
        : base("notification_action_not_found", "The notification action is not available.")
    {
        DeliveryId = deliveryId;
    }

    public Guid DeliveryId { get; }
}
