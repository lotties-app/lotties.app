using BabyRoutine.Application.Notifications;
using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Push;

/// <summary>The caller's push devices (docs/design/09-push-notifications.md section 6). Every call but the config read needs push on.</summary>
public interface IPushSubscriptionService
{
    /// <summary>Whether push is on and the VAPID public key; works when push is off.</summary>
    PushConfigResponse GetConfig();

    /// <summary>
    /// Upsert by endpoint: creates the device, or refreshes it (keys, locale, label, last seen), un-revokes it and,
    /// when it belonged to another user, transfers it and cancels that user's pending deliveries for it. Then revokes
    /// the caller's least recently seen devices beyond the cap. Throws for endpoints outside the allowlist.
    /// </summary>
    Task<SubscribePushResult> SubscribeAsync(SubscribePushRequest request, CancellationToken cancellationToken = default);

    /// <summary>Revokes the caller's device with this endpoint; unknown or another user's endpoint is a no-op.</summary>
    Task RevokeByEndpointAsync(RevokePushSubscriptionRequest request, CancellationToken cancellationToken = default);

    /// <summary>The caller's active devices, most recently seen first.</summary>
    Task<IReadOnlyList<PushSubscriptionResponse>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Revokes one of the caller's devices; unknown ids are a no-op.</summary>
    Task RevokeAsync(Guid subscriptionId, CancellationToken cancellationToken = default);
}

internal sealed class PushSubscriptionService : IPushSubscriptionService
{
    private readonly IPushSubscriptionRepository _subscriptions;
    private readonly INotificationDeliveryRepository _deliveries;
    private readonly PushEndpointAllowlist _allowlist;
    private readonly IPushConfiguration _configuration;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<PushSubscriptionService> _logger;

    public PushSubscriptionService(
        IPushSubscriptionRepository subscriptions,
        INotificationDeliveryRepository deliveries,
        PushEndpointAllowlist allowlist,
        IPushConfiguration configuration,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<PushSubscriptionService> logger)
    {
        _subscriptions = subscriptions ?? throw new ArgumentNullException(nameof(subscriptions));
        _deliveries = deliveries ?? throw new ArgumentNullException(nameof(deliveries));
        _allowlist = allowlist ?? throw new ArgumentNullException(nameof(allowlist));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public PushConfigResponse GetConfig() => new()
    {
        Enabled = _configuration.IsEnabled,
        PublicKey = _configuration.IsEnabled ? _configuration.PublicKey : null,
    };

    public async Task<SubscribePushResult> SubscribeAsync(SubscribePushRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        _configuration.EnsureEnabled();
        var details = SubscriptionDetails.From(request, _allowlist);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var existing = await _subscriptions.FindByEndpointHashAsync(details.Endpoint.Hash, cancellationToken);
        var result = existing is null
            ? await CreateAsync(user.Id, details, cancellationToken)
            : await RefreshAsync(user.Id, existing, details, cancellationToken);
        await RevokeBeyondCapAsync(user.Id, cancellationToken);
        return result;
    }

    public async Task RevokeByEndpointAsync(RevokePushSubscriptionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        _configuration.EnsureEnabled();
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var subscription = string.IsNullOrEmpty(request.Endpoint)
            ? null
            : await _subscriptions.FindByEndpointHashAsync(PushEndpoint.HashOf(request.Endpoint), cancellationToken);
        await RevokeByUserAsync(subscription?.UserId == user.Id ? subscription : null, cancellationToken);
    }

    public async Task<IReadOnlyList<PushSubscriptionResponse>> ListAsync(CancellationToken cancellationToken = default)
    {
        _configuration.EnsureEnabled();
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var active = await _subscriptions.ListActiveForUserAsync(user.Id, cancellationToken);
        return active.Where(subscription => subscription.IsActiveAt(now)).Select(subscription => (PushSubscriptionResponse)subscription).ToArray();
    }

    public async Task RevokeAsync(Guid subscriptionId, CancellationToken cancellationToken = default)
    {
        _configuration.EnsureEnabled();
        var user = await _currentUser.GetUserAsync(cancellationToken);
        await RevokeByUserAsync(await _subscriptions.FindForUserAsync(user.Id, subscriptionId, cancellationToken), cancellationToken);
    }

    private async Task<SubscribePushResult> CreateAsync(Guid userId, SubscriptionDetails details, CancellationToken cancellationToken)
    {
        var created = PushSubscription.Create(userId, details.Endpoint, details.Keys, details.Locale, details.DeviceLabel, details.ExpiresAt, _timeProvider.GetUtcNow());
        if (!await _subscriptions.TryAddAsync(created, cancellationToken))
        {
            return await RefreshAsync(userId, await FindConcurrentWinnerAsync(details.Endpoint, cancellationToken), details, cancellationToken);
        }

        _logger.LogInformation("User {UserId} subscribed push device {SubscriptionId}", userId, created.Id);
        return new SubscribePushResult(created, Created: true);
    }

    private async Task<SubscribePushResult> RefreshAsync(Guid userId, PushSubscription existing, SubscriptionDetails details, CancellationToken cancellationToken)
    {
        var previousUserId = existing.UserId;
        var transferred = existing.Refresh(userId, details.Keys, details.Locale, details.DeviceLabel, details.ExpiresAt, _timeProvider.GetUtcNow());
        await _subscriptions.SaveChangesAsync(cancellationToken);
        await CancelPendingAfterTransferAsync(transferred, existing, previousUserId, cancellationToken);
        return new SubscribePushResult(existing, Created: false);
    }

    private async Task CancelPendingAfterTransferAsync(bool transferred, PushSubscription subscription, Guid previousUserId, CancellationToken cancellationToken)
    {
        if (!transferred)
        {
            return;
        }

        var cancelled = await _deliveries.CancelPendingForSubscriptionAsync(subscription.Id, cancellationToken);
        _logger.LogInformation(
            "Push device {SubscriptionId} moved from user {PreviousUserId} to {UserId}; {CancelledCount} pending deliveries cancelled",
            subscription.Id,
            previousUserId,
            subscription.UserId,
            cancelled);
    }

    private async Task RevokeBeyondCapAsync(Guid userId, CancellationToken cancellationToken)
    {
        var active = await _subscriptions.ListActiveForUserAsync(userId, cancellationToken);
        var beyondCap = PushSubscription.BeyondCap(active, _configuration.MaxSubscriptionsPerUser);
        foreach (var subscription in beyondCap)
        {
            await RevokeAsync(subscription, SubscriptionRevokeReason.Inactive, cancellationToken);
        }
    }

    private async Task RevokeByUserAsync(PushSubscription? subscription, CancellationToken cancellationToken)
    {
        if (subscription is null || subscription.IsRevoked)
        {
            _logger.LogDebug("Push device revoke matched no active device of the caller; no-op");
            return;
        }

        await RevokeAsync(subscription, SubscriptionRevokeReason.User, cancellationToken);
    }

    private async Task RevokeAsync(PushSubscription subscription, SubscriptionRevokeReason reason, CancellationToken cancellationToken)
    {
        subscription.Revoke(reason, _timeProvider.GetUtcNow());
        await _subscriptions.SaveChangesAsync(cancellationToken);
        await _deliveries.CancelPendingForSubscriptionAsync(subscription.Id, cancellationToken);
        _logger.LogInformation("Push device {SubscriptionId} of user {UserId} revoked ({Reason})", subscription.Id, subscription.UserId, NotificationCodes.Of(reason));
    }

    private async Task<PushSubscription> FindConcurrentWinnerAsync(PushEndpoint endpoint, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Push endpoint was subscribed concurrently; refreshing the stored device");
        return await _subscriptions.FindByEndpointHashAsync(endpoint.Hash, cancellationToken)
            ?? throw new InvalidOperationException("A push subscription was reported as existing but could not be loaded.");
    }

    /// <summary>The validated subscribe request: allowlisted endpoint, keys of the right sizes, supported locale.</summary>
    private sealed record SubscriptionDetails(PushEndpoint Endpoint, PushKeys Keys, NotificationLocale Locale, string? DeviceLabel, DateTimeOffset? ExpiresAt)
    {
        public static SubscriptionDetails From(SubscribePushRequest request, PushEndpointAllowlist allowlist) => new(
            allowlist.EnsureAllows(PushEndpoint.From(request.Endpoint)),
            PushKeys.Create(request.Keys?.P256dh, request.Keys?.Auth),
            NotificationLocale.FromOrDefault(request.Locale),
            request.DeviceLabel,
            request.ExpiresAt());
    }
}
