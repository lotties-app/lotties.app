namespace Lotties.Domain.Notifications;

/// <summary>What a push notification is about. Codes (<see cref="NotificationCodes"/>) are stored, sent and used as i18n keys.</summary>
public enum NotificationKind
{
    /// <summary>A scheduled medicine dose slot is due and not logged yet (<c>dose_due</c>).</summary>
    DoseDue,

    /// <summary>The estimated nap window opens (<c>nap_window</c>).</summary>
    NapWindow,

    /// <summary>A test sent on demand from Settings (<c>test</c>).</summary>
    Test,

    /// <summary>Belly pain often shows up around this time of day; a good moment for a belly massage (<c>belly_pain_pattern</c>).</summary>
    BellyPainPattern,

    /// <summary>The baby has been awake nearly as long as her usual longest comfortable stretch (<c>overtired_warning</c>).</summary>
    OvertiredWarning,

    /// <summary>Fussiness often starts around this time of day; a calm routine may help (<c>fussy_pattern</c>).</summary>
    FussyPattern,

    /// <summary>A wet diaper is usually due soon, from the gaps between wet diapers (<c>diaper_wet_headsup</c>).</summary>
    DiaperWetHeadsUp,

    /// <summary>A dirty diaper may be coming, after a feed or from the gaps between dirty diapers (<c>diaper_dirty_headsup</c>).</summary>
    DiaperDirtyHeadsUp,

    /// <summary>An upcoming appointment of the baby starts in a week, a day, 2 hours or 30 minutes (<c>appointment_reminder</c>).</summary>
    AppointmentReminder,

    /// <summary>The baby's doctor sent a prescription proposal or a recommendation (<c>doctor_suggestion</c>; Owners and Parents only).</summary>
    DoctorSuggestion,
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

    /// <summary>Another diaper heads-up reached the recipient less than an hour ago (both diaper kinds count).</summary>
    Spacing,

    /// <summary>The recipient already got the most diaper heads-ups of this kind for the baby today (local day).</summary>
    DailyCap,
}

/// <summary>Stable lower snake case codes of the notification enums.</summary>
public static class NotificationCodes
{
    public static string Of(NotificationKind kind) => kind switch
    {
        NotificationKind.DoseDue => "dose_due",
        NotificationKind.NapWindow => "nap_window",
        NotificationKind.Test => "test",
        NotificationKind.BellyPainPattern => "belly_pain_pattern",
        NotificationKind.OvertiredWarning => "overtired_warning",
        NotificationKind.FussyPattern => "fussy_pattern",
        NotificationKind.DiaperWetHeadsUp => "diaper_wet_headsup",
        NotificationKind.DiaperDirtyHeadsUp => "diaper_dirty_headsup",
        NotificationKind.AppointmentReminder => "appointment_reminder",
        NotificationKind.DoctorSuggestion => "doctor_suggestion",
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
        NotificationSkipReason.Spacing => "spacing",
        NotificationSkipReason.DailyCap => "daily_cap",
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
