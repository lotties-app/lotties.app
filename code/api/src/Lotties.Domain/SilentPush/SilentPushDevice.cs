using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;

namespace Lotties.Domain.SilentPush;

/// <summary>
/// One app install that shows widgets and wants a content-free "something changed" push (aggregate,
/// docs/design/37b-widget-silent-push.md section 4.1). Server-generated id, which the app sends back as its origin
/// header; looked up by <see cref="TokenHash"/>. Revocation is soft. Registering the same token again refreshes it,
/// un-revokes it and, when another user registers it, moves it to that user (the latest sign-in owns the device).
/// </summary>
public sealed class SilentPushDevice
{
    private const string EnvironmentField = "apnsEnvironment";

    private SilentPushDevice()
    {
    }

    private SilentPushDevice(Guid id, Guid userId, SilentPushToken token, ApnsEnvironment? environment, DateTimeOffset now)
    {
        Id = id;
        UserId = userId;
        Channel = token.Channel;
        Token = token.Value;
        TokenHash = token.Hash;
        ApnsEnvironment = environment;
        CreatedAt = now;
        LastSeenAt = now;
    }

    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public SilentPushChannel Channel { get; private set; }

    /// <summary>The push service's token for this install; never logged or returned.</summary>
    public string Token { get; private set; } = string.Empty;

    public string TokenHash { get; private set; } = string.Empty;

    /// <summary>The APNs environment of the token; <c>null</c> for FCM.</summary>
    public ApnsEnvironment? ApnsEnvironment { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset LastSeenAt { get; private set; }

    public DateTimeOffset? LastSentAt { get; private set; }

    public int ConsecutiveFailures { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    public SubscriptionRevokeReason? RevokedReason { get; private set; }

    public bool IsRevoked => RevokedAt is not null;

    /// <summary>A new device. An APNs token needs its environment, an FCM token must not have one.</summary>
    public static SilentPushDevice Register(Guid userId, SilentPushToken token, ApnsEnvironment? environment, DateTimeOffset now) =>
        new(Guid.NewGuid(), Ids.Required(userId, nameof(userId)), token, EnsureEnvironmentFits(token.Channel, environment), UtcTime.Normalize(now));

    /// <summary>
    /// Registering this token again: environment and <see cref="LastSeenAt"/> updated, un-revoked. Returns <c>true</c> when
    /// it moved from another user to <paramref name="userId"/> (its failure count starts again).
    /// </summary>
    public bool Refresh(Guid userId, ApnsEnvironment? environment, DateTimeOffset now)
    {
        var transferred = UserId != Ids.Required(userId, nameof(userId));
        ApnsEnvironment = EnsureEnvironmentFits(Channel, environment);
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

    /// <summary>The push service accepted a push for this device.</summary>
    public void RecordSent(DateTimeOffset now)
    {
        LastSentAt = UtcTime.Normalize(now);
        ConsecutiveFailures = 0;
    }

    /// <summary>A send failed for a reason of the device; after <see cref="SilentPushRules.MaxConsecutiveFailures"/> in a row it is revoked as invalid.</summary>
    public void RecordFailure(DateTimeOffset now)
    {
        ConsecutiveFailures++;
        if (ConsecutiveFailures >= SilentPushRules.MaxConsecutiveFailures)
        {
            Revoke(SubscriptionRevokeReason.Invalid, now);
        }
    }

    /// <summary>Applies one send's outcome: sent clears the failures, gone and invalid revoke, a failure counts; the rest change nothing.</summary>
    public void RecordOutcome(SilentPushOutcome outcome, DateTimeOffset now)
    {
        Action<DateTimeOffset> apply = outcome switch
        {
            SilentPushOutcome.Sent => RecordSent,
            SilentPushOutcome.Gone => at => Revoke(SubscriptionRevokeReason.Gone, at),
            SilentPushOutcome.Invalid => at => Revoke(SubscriptionRevokeReason.Invalid, at),
            SilentPushOutcome.Failed => RecordFailure,
            _ => _ => { },
        };
        apply(now);
    }

    /// <summary>The devices to revoke as inactive so that at most <paramref name="maxActive"/> remain: the least recently seen first.</summary>
    public static IReadOnlyList<SilentPushDevice> BeyondCap(IReadOnlyList<SilentPushDevice> active, int maxActive)
    {
        ArgumentNullException.ThrowIfNull(active);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxActive);
        return active
            .OrderByDescending(device => device.LastSeenAt)
            .ThenByDescending(device => device.CreatedAt)
            .ThenBy(device => device.Id)
            .Skip(maxActive)
            .ToArray();
    }

    private static ApnsEnvironment? EnsureEnvironmentFits(SilentPushChannel channel, ApnsEnvironment? environment) => (channel, environment) switch
    {
        (SilentPushChannel.Apns, null) => throw new DomainValidationException(EnvironmentField, "apnsEnvironment is required for an apns token."),
        (SilentPushChannel.Fcm, not null) => throw new DomainValidationException(EnvironmentField, "apnsEnvironment is only for an apns token."),
        _ => environment,
    };
}
