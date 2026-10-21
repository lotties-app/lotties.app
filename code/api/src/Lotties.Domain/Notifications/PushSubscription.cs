using Lotties.Domain.Common;

namespace Lotties.Domain.Notifications;

/// <summary>Why a push subscription stopped being used.</summary>
public enum SubscriptionRevokeReason
{
    /// <summary>The user turned notifications off on the device, removed it or logged out.</summary>
    User,

    /// <summary>The push service answered 404/410 or the subscription expired.</summary>
    Gone,

    /// <summary>The push service rejected our VAPID credentials or keys (400/403), or sends kept failing.</summary>
    Invalid,

    /// <summary>Not seen for a long time, or beyond the per-user device cap.</summary>
    Inactive,

    /// <summary>Another user subscribed with the same browser endpoint.</summary>
    Transferred,
}

/// <summary>
/// One browser push endpoint of a user (aggregate). Server-generated id; looked up by <see cref="EndpointHash"/>.
/// Revocation is soft. Subscribing again with the same endpoint refreshes it, un-revokes it and, when another user
/// subscribes, transfers it (the latest sign-in owns the device).
/// </summary>
public sealed class PushSubscription
{
    public const int DeviceLabelMaxLength = 60;

    private PushSubscription()
    {
    }

    private PushSubscription(Guid id, Guid userId, PushEndpoint endpoint, DateTimeOffset createdAt)
    {
        Id = id;
        UserId = userId;
        Endpoint = endpoint;
        EndpointHash = endpoint.Hash;
        CreatedAt = createdAt;
        LastSeenAt = createdAt;
    }

    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public PushEndpoint Endpoint { get; private set; }

    public string EndpointHash { get; private set; } = string.Empty;

    public PushKeys Keys { get; private set; }

    public NotificationLocale Locale { get; private set; }

    public string? DeviceLabel { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset LastSeenAt { get; private set; }

    public DateTimeOffset? LastSuccessAt { get; private set; }

    public int ConsecutiveFailures { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    public SubscriptionRevokeReason? RevokedReason { get; private set; }

    public bool IsRevoked => RevokedAt is not null;

    /// <summary>Not revoked and not past its push-service expiration time.</summary>
    public bool IsActiveAt(DateTimeOffset now) => !IsRevoked && !HasExpiredAt(now);

    public bool HasExpiredAt(DateTimeOffset now) => ExpiresAt is { } expires && expires <= UtcTime.Normalize(now);

    public static PushSubscription Create(
        Guid userId,
        PushEndpoint endpoint,
        PushKeys keys,
        NotificationLocale locale,
        string? deviceLabel,
        DateTimeOffset? expiresAt,
        DateTimeOffset now)
    {
        var subscription = new PushSubscription(Guid.NewGuid(), Ids.Required(userId, nameof(userId)), endpoint, UtcTime.Normalize(now));
        subscription.ApplyDetails(keys, locale, deviceLabel, expiresAt);
        return subscription;
    }

    /// <summary>
    /// Subscribing again with this endpoint: new keys, locale, label and expiry, <see cref="LastSeenAt"/> bumped,
    /// un-revoked. Returns <c>true</c> when it moved from another user to <paramref name="userId"/> (that user's pending
    /// deliveries for it must be cancelled).
    /// </summary>
    public bool Refresh(Guid userId, PushKeys keys, NotificationLocale locale, string? deviceLabel, DateTimeOffset? expiresAt, DateTimeOffset now)
    {
        var transferred = UserId != Ids.Required(userId, nameof(userId));
        ApplyDetails(keys, locale, deviceLabel, expiresAt);
        UserId = userId;
        LastSeenAt = UtcTime.Normalize(now);
        RevokedAt = null;
        RevokedReason = null;
        ConsecutiveFailures = transferred ? 0 : ConsecutiveFailures;
        return transferred;
    }

    /// <summary>Soft revoke; idempotent (the first reason and time are kept).</summary>
    public void Revoke(SubscriptionRevokeReason reason, DateTimeOffset now)
    {
        if (IsRevoked)
        {
            return;
        }

        RevokedAt = UtcTime.Normalize(now);
        RevokedReason = reason;
    }

    /// <summary>A 2xx from the push service.</summary>
    public void RecordSuccess(DateTimeOffset now)
    {
        LastSuccessAt = UtcTime.Normalize(now);
        ConsecutiveFailures = 0;
    }

    /// <summary>A failed send; after <see cref="NotificationRules.MaxConsecutiveFailures"/> in a row the subscription is revoked as invalid.</summary>
    public void RecordFailure(DateTimeOffset now)
    {
        ConsecutiveFailures++;
        if (ConsecutiveFailures >= NotificationRules.MaxConsecutiveFailures)
        {
            Revoke(SubscriptionRevokeReason.Invalid, now);
        }
    }

    /// <summary>The subscriptions to revoke as inactive so that at most <paramref name="maxActive"/> remain: the least recently seen first.</summary>
    public static IReadOnlyList<PushSubscription> BeyondCap(IReadOnlyList<PushSubscription> active, int maxActive)
    {
        ArgumentNullException.ThrowIfNull(active);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxActive);
        return active
            .OrderByDescending(subscription => subscription.LastSeenAt)
            .ThenByDescending(subscription => subscription.CreatedAt)
            .ThenBy(subscription => subscription.Id)
            .Skip(maxActive)
            .ToArray();
    }

    private void ApplyDetails(PushKeys keys, NotificationLocale locale, string? deviceLabel, DateTimeOffset? expiresAt)
    {
        var label = Text.Optional(deviceLabel, "deviceLabel", DeviceLabelMaxLength);
        Keys = keys;
        Locale = locale;
        DeviceLabel = label;
        ExpiresAt = UtcTime.Normalize(expiresAt);
    }
}
