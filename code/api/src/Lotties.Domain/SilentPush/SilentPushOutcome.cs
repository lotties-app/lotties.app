namespace Lotties.Domain.SilentPush;

/// <summary>What one push service answer means for the device (docs/design/37b-widget-silent-push.md section 4.5). There is no retry of a silent push.</summary>
public enum SilentPushOutcome
{
    /// <summary>Accepted by the push service.</summary>
    Sent,

    /// <summary>The token no longer exists (APNs 410, FCM 404 <c>UNREGISTERED</c>): revoke the device as gone.</summary>
    Gone,

    /// <summary>The token is malformed or belongs to another app or project: revoke the device as invalid.</summary>
    Invalid,

    /// <summary>An unexpected answer about this device: one more failure (ten in a row revoke it).</summary>
    Failed,

    /// <summary>429, 5xx, timeout or network error: the push is lost, the device is not blamed.</summary>
    Retryable,

    /// <summary>The server's own credentials or request were refused (APNs 403, FCM 401 after a refresh): the device is not blamed.</summary>
    ConfigurationError,

    /// <summary>The device's channel has no credentials on this server: nothing was sent.</summary>
    NotConfigured,
}
