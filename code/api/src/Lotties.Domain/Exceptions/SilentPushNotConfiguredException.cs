namespace Lotties.Domain.Exceptions;

/// <summary>
/// Silent pushes for the widgets are off on this server (<c>SilentPush:Enabled</c> false), or the device's channel (APNs,
/// FCM) has no credentials: the device routes are refused with this code (docs/design/37b-widget-silent-push.md 4.1).
/// </summary>
public sealed class SilentPushNotConfiguredException : DomainException
{
    public SilentPushNotConfiguredException()
        : base("silent_push_not_configured", "Silent pushes are not configured on this server.")
    {
    }
}
