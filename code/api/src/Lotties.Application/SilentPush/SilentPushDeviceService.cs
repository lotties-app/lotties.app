using Lotties.Application.Users;
using Lotties.Domain.Notifications;
using Lotties.Domain.SilentPush;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.SilentPush;

/// <summary>The caller's app installs that want silent pushes (docs/design/37b-widget-silent-push.md section 4.1).</summary>
public interface ISilentPushDeviceService
{
    /// <summary>
    /// Upsert by token: creates the device, or refreshes it (environment, last seen), un-revokes it and, when it belonged
    /// to another user, moves it to the caller. Then revokes the caller's least recently seen devices beyond the cap.
    /// Throws <see cref="Domain.Exceptions.SilentPushNotConfiguredException"/> when the channel is off.
    /// </summary>
    Task<RegisterSilentPushDeviceResult> RegisterAsync(RegisterSilentPushDeviceRequest request, CancellationToken cancellationToken = default);

    /// <summary>Revokes one of the caller's devices; unknown ids and another user's are a no-op.</summary>
    Task UnregisterAsync(Guid deviceId, CancellationToken cancellationToken = default);
}

internal sealed class SilentPushDeviceService(
    ISilentPushDeviceRepository devices,
    ISilentPushConfiguration configuration,
    ICurrentUser currentUser,
    TimeProvider timeProvider,
    ILogger<SilentPushDeviceService> logger) : ISilentPushDeviceService
{
    public async Task<RegisterSilentPushDeviceResult> RegisterAsync(RegisterSilentPushDeviceRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        configuration.EnsureEnabled();
        var channel = request.ParsedChannel();
        configuration.EnsureAccepts(channel);
        var token = SilentPushToken.From(channel, request.Token);
        var environment = request.ParsedApnsEnvironment();
        var user = await currentUser.GetUserAsync(cancellationToken);
        var existing = await devices.FindByTokenHashAsync(token.Hash, cancellationToken);
        var result = existing is null
            ? await CreateAsync(user.Id, token, environment, cancellationToken)
            : await RefreshAsync(user.Id, existing, environment, cancellationToken);
        await RevokeBeyondCapAsync(user.Id, cancellationToken);
        return result;
    }

    public async Task UnregisterAsync(Guid deviceId, CancellationToken cancellationToken = default)
    {
        configuration.EnsureEnabled();
        var user = await currentUser.GetUserAsync(cancellationToken);
        var device = await devices.FindForUserAsync(user.Id, deviceId, cancellationToken);
        if (device is null || device.IsRevoked)
        {
            logger.LogDebug("Silent push unregister matched no active device of the caller; no-op");
            return;
        }

        await RevokeAsync(device, SubscriptionRevokeReason.User, cancellationToken);
    }

    private async Task<RegisterSilentPushDeviceResult> CreateAsync(Guid userId, SilentPushToken token, ApnsEnvironment? environment, CancellationToken cancellationToken)
    {
        var created = SilentPushDevice.Register(userId, token, environment, timeProvider.GetUtcNow());
        if (!await devices.TryAddAsync(created, cancellationToken))
        {
            return await RefreshAsync(userId, await FindConcurrentWinnerAsync(token, cancellationToken), environment, cancellationToken);
        }

        logger.LogInformation("User {UserId} registered silent push device {DeviceId} ({Channel})", userId, created.Id, SilentPushCodes.Of(created.Channel));
        return new RegisterSilentPushDeviceResult(created, Created: true);
    }

    private async Task<RegisterSilentPushDeviceResult> RefreshAsync(Guid userId, SilentPushDevice existing, ApnsEnvironment? environment, CancellationToken cancellationToken)
    {
        var previousUserId = existing.UserId;
        var transferred = existing.Refresh(userId, environment, timeProvider.GetUtcNow());
        await devices.SaveChangesAsync(cancellationToken);
        LogTransfer(transferred, existing, previousUserId);
        return new RegisterSilentPushDeviceResult(existing, Created: false);
    }

    private void LogTransfer(bool transferred, SilentPushDevice device, Guid previousUserId)
    {
        if (transferred)
        {
            logger.LogInformation("Silent push device {DeviceId} moved from user {PreviousUserId} to {UserId}", device.Id, previousUserId, device.UserId);
        }
    }

    private async Task RevokeBeyondCapAsync(Guid userId, CancellationToken cancellationToken)
    {
        var active = await devices.ListActiveForUserAsync(userId, cancellationToken);
        foreach (var device in SilentPushDevice.BeyondCap(active, configuration.MaxDevicesPerUser))
        {
            await RevokeAsync(device, SubscriptionRevokeReason.Inactive, cancellationToken);
        }
    }

    private async Task RevokeAsync(SilentPushDevice device, SubscriptionRevokeReason reason, CancellationToken cancellationToken)
    {
        device.Revoke(reason, timeProvider.GetUtcNow());
        await devices.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Silent push device {DeviceId} of user {UserId} revoked ({Reason})", device.Id, device.UserId, NotificationCodes.Of(reason));
    }

    private async Task<SilentPushDevice> FindConcurrentWinnerAsync(SilentPushToken token, CancellationToken cancellationToken)
    {
        logger.LogInformation("Silent push token was registered concurrently; refreshing the stored device");
        return await devices.FindByTokenHashAsync(token.Hash, cancellationToken)
            ?? throw new InvalidOperationException("A silent push device was reported as existing but could not be loaded.");
    }
}
