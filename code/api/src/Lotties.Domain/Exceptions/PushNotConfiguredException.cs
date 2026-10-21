namespace Lotties.Domain.Exceptions;

/// <summary>
/// Push notifications are off on this server (no VAPID keys configured); every push route except the configuration
/// read is refused with this code.
/// </summary>
public sealed class PushNotConfiguredException : DomainException
{
    public PushNotConfiguredException()
        : base("push_not_configured", "Push notifications are not configured on this server.")
    {
    }
}
