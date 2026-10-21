using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Prescriptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>The fixed numbers of the push notification rules (docs/design/09-push-notifications.md sections 2, 3 and 5).</summary>
public static class NotificationRules
{
    /// <summary>A dose slot whose due time is pushed further than this past the slot gets no reminder.</summary>
    public static readonly TimeSpan SlotMatchWindow = MedicationStatusCalculator.SlotMatchWindow;

    /// <summary>A dose reminder whose send time is older than this is not sent (after downtime).</summary>
    public static readonly TimeSpan DoseStaleCutoff = TimeSpan.FromMinutes(30);

    /// <summary>A nap reminder whose send time is older than this is not sent.</summary>
    public static readonly TimeSpan NapStaleCutoff = TimeSpan.FromMinutes(15);

    public static readonly TimeSpan DoseTimeToLive = TimeSpan.FromMinutes(90);

    /// <summary>A nap reminder lives until the window's latest start, at most this long.</summary>
    public static readonly TimeSpan NapMaxTimeToLive = TimeSpan.FromMinutes(60);

    public static readonly TimeSpan TestTimeToLive = TimeSpan.FromMinutes(5);

    public static readonly TimeSpan SnoozeLength = TimeSpan.FromMinutes(30);

    public const int MaxSnoozes = 3;

    /// <summary>Snooze/dismiss is accepted up to this long after the delivery's due time.</summary>
    public static readonly TimeSpan ActionWindow = TimeSpan.FromHours(12);

    /// <summary>Send attempts per delivery.</summary>
    public const int MaxAttempts = 3;

    /// <summary>Consecutive failed sends after which a subscription is revoked as invalid.</summary>
    public const int MaxConsecutiveFailures = 10;

    /// <summary>Default cap of active subscriptions per user (the least recently seen is revoked beyond it).</summary>
    public const int DefaultMaxSubscriptionsPerUser = 10;

    public static readonly TimeSpan DeliveryRetention = TimeSpan.FromDays(14);

    public static readonly TimeSpan ActionRetention = TimeSpan.FromDays(7);

    public static readonly TimeSpan RevokedSubscriptionRetention = TimeSpan.FromDays(30);

    /// <summary>An active subscription not seen for this long is revoked as inactive.</summary>
    public static readonly TimeSpan InactiveSubscriptionAge = TimeSpan.FromDays(90);

    /// <summary>Only members who can log (Owner, Parent) receive or opt into baby reminders; Viewers never do.</summary>
    public static bool CanReceive(BabyRole role) => role is BabyRole.Owner or BabyRole.Parent;

    /// <summary>Wait before re-sending after a retryable failure (no <c>Retry-After</c>): 1 minute, then 4 minutes.</summary>
    public static TimeSpan RetryDelayAfter(int attempts) => attempts <= 1 ? TimeSpan.FromMinutes(1) : TimeSpan.FromMinutes(4);
}
