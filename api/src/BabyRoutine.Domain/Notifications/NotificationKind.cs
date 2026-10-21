namespace BabyRoutine.Domain.Notifications;

/// <summary>What a push notification is about. Codes (<see cref="NotificationCodes"/>) are stored, sent and used as i18n keys.</summary>
public enum NotificationKind
{
    /// <summary>A scheduled medicine dose slot is due and not logged yet (<c>dose_due</c>).</summary>
    DoseDue,

    /// <summary>The estimated nap window opens (<c>nap_window</c>).</summary>
    NapWindow,

    /// <summary>A test sent on demand from Settings (<c>test</c>).</summary>
    Test,
}

/// <summary>Web Push <c>Urgency</c> header value.</summary>
public enum NotificationUrgency
{
    Normal,
    High,
}

/// <summary>Why a reminder that was due for a recipient was not planned in a tick (metric <c>push.skipped{reason}</c>).</summary>
public enum NotificationSkipReason
{
    /// <summary>Its send time is older than the stale cutoff (e.g. after downtime).</summary>
    Stale,

    /// <summary>Inside the recipient's quiet hours.</summary>
    QuietHours,

    /// <summary>An interval group pushes availability past the slot's match window.</summary>
    Unavailable,

    /// <summary>The 24 h dose limit is reached.</summary>
    Limit,

    /// <summary>The recipient snoozed it and the snooze has not ended.</summary>
    Snoozed,

    /// <summary>The recipient stopped reminders for it.</summary>
    Dismissed,
}

/// <summary>Stable lower snake case codes of the notification enums.</summary>
public static class NotificationCodes
{
    public static string Of(NotificationKind kind) => kind switch
    {
        NotificationKind.DoseDue => "dose_due",
        NotificationKind.NapWindow => "nap_window",
        NotificationKind.Test => "test",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown notification kind."),
    };

    public static string Of(NotificationUrgency urgency) => urgency switch
    {
        NotificationUrgency.Normal => "normal",
        NotificationUrgency.High => "high",
        _ => throw new ArgumentOutOfRangeException(nameof(urgency), urgency, "Unknown urgency."),
    };

    public static string Of(NotificationSkipReason reason) => reason switch
    {
        NotificationSkipReason.Stale => "stale",
        NotificationSkipReason.QuietHours => "quiet_hours",
        NotificationSkipReason.Unavailable => "unavailable",
        NotificationSkipReason.Limit => "limit",
        NotificationSkipReason.Snoozed => "snoozed",
        NotificationSkipReason.Dismissed => "dismissed",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, "Unknown skip reason."),
    };

    public static string Of(DeliveryStatus status) => status switch
    {
        DeliveryStatus.Pending => "pending",
        DeliveryStatus.Sent => "sent",
        DeliveryStatus.Failed => "failed",
        DeliveryStatus.Expired => "expired",
        DeliveryStatus.Gone => "gone",
        DeliveryStatus.Cancelled => "cancelled",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown delivery status."),
    };

    public static string Of(SubscriptionRevokeReason reason) => reason switch
    {
        SubscriptionRevokeReason.User => "user",
        SubscriptionRevokeReason.Gone => "gone",
        SubscriptionRevokeReason.Invalid => "invalid",
        SubscriptionRevokeReason.Inactive => "inactive",
        SubscriptionRevokeReason.Transferred => "transferred",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, "Unknown revoke reason."),
    };

    public static string Of(NotificationActionKind action) => action switch
    {
        NotificationActionKind.Snoozed => "snoozed",
        NotificationActionKind.Dismissed => "dismissed",
        _ => throw new ArgumentOutOfRangeException(nameof(action), action, "Unknown notification action."),
    };

    /// <summary>The enum value of <typeparamref name="TEnum"/> whose code is <paramref name="code"/>.</summary>
    public static bool TryParse<TEnum>(string? code, out TEnum value)
        where TEnum : struct, Enum
    {
        value = Enum.GetValues<TEnum>().FirstOrDefault(candidate => CodeOf(candidate) == code);
        return code is not null && CodeOf(value) == code;
    }

    private static string CodeOf<TEnum>(TEnum value)
        where TEnum : struct, Enum => value switch
    {
        NotificationKind kind => Of(kind),
        NotificationUrgency urgency => Of(urgency),
        NotificationSkipReason reason => Of(reason),
        DeliveryStatus status => Of(status),
        SubscriptionRevokeReason reason => Of(reason),
        NotificationActionKind action => Of(action),
        _ => throw new ArgumentException($"{typeof(TEnum).Name} has no notification codes.", nameof(value)),
    };
}
