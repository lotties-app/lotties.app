using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.SilentPush;

namespace Lotties.Application.SilentPush;

/// <summary>
/// What the application needs to know about the silent push setup (implemented by the host from the <c>SilentPush</c>
/// options, docs/design/37b-widget-silent-push.md section 4.6).
/// </summary>
public interface ISilentPushConfiguration
{
    /// <summary>The master switch <c>SilentPush:Enabled</c>.</summary>
    bool IsEnabled { get; }

    /// <summary>Active devices kept per user; the least recently seen beyond it are revoked as inactive.</summary>
    int MaxDevicesPerUser { get; }

    /// <summary>The debounce and the minimum interval per baby.</summary>
    SilentPushTiming Timing { get; }

    /// <summary>Whether silent pushes are on and <paramref name="channel"/> has credentials.</summary>
    bool Accepts(SilentPushChannel channel);
}

public static class SilentPushConfigurationExtensions
{
    /// <summary>Throws <see cref="SilentPushNotConfiguredException"/> when silent pushes are off.</summary>
    public static void EnsureEnabled(this ISilentPushConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (!configuration.IsEnabled)
        {
            throw new SilentPushNotConfiguredException();
        }
    }

    /// <summary>Throws <see cref="SilentPushNotConfiguredException"/> when silent pushes are off or <paramref name="channel"/> has no credentials.</summary>
    public static void EnsureAccepts(this ISilentPushConfiguration configuration, SilentPushChannel channel)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (!configuration.Accepts(channel))
        {
            throw new SilentPushNotConfiguredException();
        }
    }
}

/// <summary>
/// The registered device the current request came from (the header <c>Lotties-Push-Device</c>), or <c>null</c>. Not
/// verified: <see cref="BabyChangeBatch.Skips"/> skips a device only when it belongs to the user who wrote.
/// </summary>
public interface ICurrentPushDevice
{
    Guid? DeviceId { get; }
}

/// <summary>No request (background jobs, tests): no origin device.</summary>
internal sealed class NoCurrentPushDevice : ICurrentPushDevice
{
    public Guid? DeviceId => null;
}

/// <summary>Where one silent push goes. <see cref="ToString"/> never shows the token.</summary>
public sealed record SilentPushTarget(Guid DeviceId, SilentPushChannel Channel, string Token, ApnsEnvironment? ApnsEnvironment)
{
    public static SilentPushTarget From(SilentPushDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        return new SilentPushTarget(device.Id, device.Channel, device.Token, device.ApnsEnvironment);
    }

    public override string ToString() => $"[silent push target {DeviceId}]";
}

/// <summary>Sends one content-free silent push (APNs background push, FCM data message). Never throws for a push service answer.</summary>
public interface ISilentPushSender
{
    Task<SilentPushOutcome> SendAsync(SilentPushTarget target, CancellationToken cancellationToken = default);
}

/// <summary>A registered device of a baby's member and that member's role.</summary>
public sealed record SilentPushRecipient(SilentPushDevice Device, BabyRole Role);

/// <summary>Persistence for <see cref="SilentPushDevice"/>. "Active" means not revoked; tokens are looked up by their hash only.</summary>
public interface ISilentPushDeviceRepository
{
    /// <summary>The device (any user, revoked or not) whose token hashes to <paramref name="tokenHash"/>; tracked.</summary>
    Task<SilentPushDevice?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default);

    /// <summary>The device <paramref name="deviceId"/> when it belongs to <paramref name="userId"/>, revoked or not; tracked.</summary>
    Task<SilentPushDevice?> FindForUserAsync(Guid userId, Guid deviceId, CancellationToken cancellationToken = default);

    /// <summary>The user's active devices; tracked (the device cap revokes some).</summary>
    Task<IReadOnlyList<SilentPushDevice>> ListActiveForUserAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The active devices of the baby's members, with their role, unless the baby's records are on an external store (no
    /// silent pushes for such a baby, as no reminders); tracked (sends record their outcome).
    /// </summary>
    Task<IReadOnlyList<SilentPushRecipient>> ListRecipientsAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new device; <c>false</c>, leaving nothing tracked, when the same token was saved first (concurrent register).</summary>
    Task<bool> TryAddAsync(SilentPushDevice device, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: revokes as inactive every active device last seen before <paramref name="seenBefore"/>; returns how many.</summary>
    Task<int> RevokeNotSeenSinceAsync(DateTimeOffset seenBefore, DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>Housekeeping: deletes devices revoked before <paramref name="revokedBefore"/>; returns how many.</summary>
    Task<int> DeleteRevokedBeforeAsync(DateTimeOffset revokedBefore, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
