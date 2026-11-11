using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;

namespace Lotties.Domain.SilentPush;

/// <summary>The rules of silent pushes (docs/design/37b-widget-silent-push.md sections 4.3 to 4.5).</summary>
public static class SilentPushRules
{
    /// <summary>Failed sends in a row that revoke a device as invalid (the Web Push rule).</summary>
    public const int MaxConsecutiveFailures = NotificationRules.MaxConsecutiveFailures;

    /// <summary>A device the app has not registered again for this long is revoked as inactive.</summary>
    public static readonly TimeSpan InactiveAfter = TimeSpan.FromDays(60);

    /// <summary>Revoked devices are deleted this long after their revocation.</summary>
    public static readonly TimeSpan RevokedRetention = TimeSpan.FromDays(30);

    /// <summary>
    /// Every member who sees the baby in the parents' shell, and so on her widgets: Owner, Parent, Caregiver and Viewer.
    /// Never a Doctor: her patients never enter the parents' shell or its sync.
    /// </summary>
    public static bool CanReceive(BabyRole role) => role is not BabyRole.Doctor;
}

/// <summary>When a batch of changes may be pushed: the debounce after its first change and the minimum time between two pushes for one baby.</summary>
public sealed record SilentPushTiming
{
    public SilentPushTiming(TimeSpan debounce, TimeSpan minInterval)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(debounce, TimeSpan.Zero);
        ArgumentOutOfRangeException.ThrowIfLessThan(minInterval, TimeSpan.Zero);
        Debounce = debounce;
        MinInterval = minInterval;
    }

    public TimeSpan Debounce { get; }

    public TimeSpan MinInterval { get; }
}

/// <summary>Who made a change: the user and, when the request named one of her registered devices, that device.</summary>
public sealed record SilentPushOrigin(Guid UserId, Guid? DeviceId);

/// <summary>
/// The changes of one baby not pushed yet (docs/design/37b section 4.3): one batch per baby, due a debounce after its first
/// change and never sooner than the minimum interval after the previous push. It keeps its sole origin while every change
/// comes from the same user and device; a change from another origin makes it mixed, and then no device is skipped (each
/// writer lacks the other's change).
/// </summary>
public sealed record BabyChangeBatch
{
    private BabyChangeBatch(Guid babyId, DateTimeOffset firstChangeAt, SilentPushOrigin? soleOrigin)
    {
        BabyId = babyId;
        FirstChangeAt = firstChangeAt;
        SoleOrigin = soleOrigin;
    }

    public Guid BabyId { get; }

    public DateTimeOffset FirstChangeAt { get; }

    /// <summary>The origin of every change so far; <c>null</c> once two origins wrote.</summary>
    public SilentPushOrigin? SoleOrigin { get; private init; }

    public static BabyChangeBatch Start(Guid babyId, SilentPushOrigin origin, DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(origin);
        return new BabyChangeBatch(babyId, at, origin);
    }

    /// <summary>This batch with one more change from <paramref name="origin"/>.</summary>
    public BabyChangeBatch With(SilentPushOrigin origin)
    {
        ArgumentNullException.ThrowIfNull(origin);
        return SoleOrigin == origin ? this : this with { SoleOrigin = null };
    }

    /// <summary>When it may be pushed: the debounce after its first change, and not before the interval after the last push.</summary>
    public DateTimeOffset DueAt(DateTimeOffset? lastPushedAt, SilentPushTiming timing)
    {
        ArgumentNullException.ThrowIfNull(timing);
        var afterDebounce = FirstChangeAt + timing.Debounce;
        return lastPushedAt is { } last && last + timing.MinInterval > afterDebounce ? last + timing.MinInterval : afterDebounce;
    }

    /// <summary>Whether <paramref name="device"/> made every change of the batch itself (it already has them): it gets no push.</summary>
    public bool Skips(SilentPushDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        return SoleOrigin is { DeviceId: { } deviceId } origin && deviceId == device.Id && origin.UserId == device.UserId;
    }
}
