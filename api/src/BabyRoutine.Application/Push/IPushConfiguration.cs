using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Application.Push;

/// <summary>
/// What the application needs to know about the push setup (implemented by the host from the <c>Push</c> options):
/// whether push is on (all VAPID values configured), the public key browsers subscribe with, and the device cap.
/// </summary>
public interface IPushConfiguration
{
    bool IsEnabled { get; }

    /// <summary>The VAPID public key (base64url uncompressed P-256), or <c>null</c> when push is off.</summary>
    string? PublicKey { get; }

    /// <summary>Active subscriptions kept per user; the least recently seen beyond it are revoked as inactive.</summary>
    int MaxSubscriptionsPerUser { get; }
}

public static class PushConfigurationExtensions
{
    /// <summary>Throws <see cref="PushNotConfiguredException"/> when push is off.</summary>
    public static void EnsureEnabled(this IPushConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (!configuration.IsEnabled)
        {
            throw new PushNotConfiguredException();
        }
    }
}
