using System.Globalization;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Push;

/// <summary><c>GET /push/config</c>: whether push is on and the key browsers subscribe with.</summary>
public sealed record PushConfigResponse
{
    public bool Enabled { get; init; }

    public string? PublicKey { get; init; }
}

/// <summary>The <c>keys</c> of a browser <c>PushSubscription.toJSON()</c>.</summary>
public sealed record PushSubscriptionKeysRequest
{
    public string? P256dh { get; init; }

    public string? Auth { get; init; }
}

/// <summary>Body of <c>POST /push/subscriptions</c>: <c>PushSubscription.toJSON()</c> plus locale and device label.</summary>
public sealed record SubscribePushRequest
{
    private const string ExpirationField = "expirationTime";

    public string? Endpoint { get; init; }

    /// <summary>Milliseconds since the Unix epoch, as browsers report it, or <c>null</c>.</summary>
    public double? ExpirationTime { get; init; }

    public PushSubscriptionKeysRequest? Keys { get; init; }

    public string? Locale { get; init; }

    public string? DeviceLabel { get; init; }

    /// <summary>The expiration instant; 400 <c>validation_failed</c> when it is not a representable time.</summary>
    public DateTimeOffset? ExpiresAt() =>
        ExpirationTime is not { } milliseconds ? null : FromUnixMilliseconds(milliseconds);

    private static DateTimeOffset FromUnixMilliseconds(double milliseconds)
    {
        var rounded = Math.Round(milliseconds);
        var valid = double.IsFinite(rounded) && rounded >= 0 && rounded <= DateTimeOffset.MaxValue.ToUnixTimeMilliseconds();
        return valid
            ? DateTimeOffset.FromUnixTimeMilliseconds((long)rounded)
            : throw new DomainValidationException(ExpirationField, $"{ExpirationField} must be milliseconds since the Unix epoch.");
    }
}

/// <summary>Body of <c>POST /push/subscriptions/revoke</c>; the endpoint travels in the body so it never appears in a URL.</summary>
public sealed record RevokePushSubscriptionRequest
{
    public string? Endpoint { get; init; }
}

/// <summary>One of the caller's devices. Endpoints and keys are never returned.</summary>
public sealed record PushSubscriptionResponse
{
    public Guid Id { get; init; }

    public string? DeviceLabel { get; init; }

    public string Locale { get; init; } = string.Empty;

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset LastSeenAt { get; init; }

    public DateTimeOffset? LastSuccessAt { get; init; }

    public static implicit operator PushSubscriptionResponse(PushSubscription subscription)
    {
        ArgumentNullException.ThrowIfNull(subscription);
        return new PushSubscriptionResponse
        {
            Id = subscription.Id,
            DeviceLabel = subscription.DeviceLabel,
            Locale = subscription.Locale.Value,
            CreatedAt = subscription.CreatedAt,
            LastSeenAt = subscription.LastSeenAt,
            LastSuccessAt = subscription.LastSuccessAt,
        };
    }
}

/// <summary>The outcome of a subscribe: the device as stored, and whether this request created it.</summary>
public sealed record SubscribePushResult(PushSubscriptionResponse Subscription, bool Created);

/// <summary>Quiet hours on the wire: times as <c>HH:mm</c> in the user's time zone.</summary>
public sealed record QuietHoursDto
{
    private const string TimeFormat = "HH:mm";

    public bool Enabled { get; init; }

    public string? Start { get; init; }

    public string? End { get; init; }

    public static implicit operator QuietHoursDto(QuietHours quietHours) => new()
    {
        Enabled = quietHours.Enabled,
        Start = quietHours.Start.ToString(TimeFormat, CultureInfo.InvariantCulture),
        End = quietHours.End.ToString(TimeFormat, CultureInfo.InvariantCulture),
    };

    public static explicit operator QuietHours(QuietHoursDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return QuietHours.Create(dto.Enabled, TimeOf(dto.Start, "quietHours.start"), TimeOf(dto.End, "quietHours.end"));
    }

    private static TimeOnly TimeOf(string? value, string field) =>
        TimeOnly.TryParseExact(value, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
            ? time
            : throw new DomainValidationException(field, $"{field} must be a time as HH:mm.");
}

/// <summary><c>GET</c>/<c>PUT /push/settings</c>: the full state of the caller's notification settings.</summary>
public sealed record NotificationSettingsDto
{
    /// <summary>IANA time zone id; <c>null</c> before the first PUT (required on PUT).</summary>
    public string? TimeZone { get; init; }

    public QuietHoursDto? QuietHours { get; init; }

    public bool QuietIncludesMedicine { get; init; }

    public bool ShowNames { get; init; }

    /// <summary>The defaults returned before the first PUT: no time zone, quiet hours 22:00-07:00 on, names off.</summary>
    public static NotificationSettingsDto Defaults { get; } = new()
    {
        TimeZone = null,
        QuietHours = Domain.Notifications.QuietHours.Default,
        QuietIncludesMedicine = false,
        ShowNames = false,
    };

    public static implicit operator NotificationSettingsDto(UserNotificationSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new NotificationSettingsDto
        {
            TimeZone = settings.TimeZone.Value,
            QuietHours = settings.QuietHours,
            QuietIncludesMedicine = settings.QuietIncludesMedicine,
            ShowNames = settings.ShowNames,
        };
    }

    public static explicit operator NotificationSettingsTerms(NotificationSettingsDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return new NotificationSettingsTerms(
            NotificationTimeZone.From(dto.TimeZone),
            (Domain.Notifications.QuietHours)(dto.QuietHours ?? throw new DomainValidationException("quietHours", "quietHours is required.")),
            dto.QuietIncludesMedicine,
            dto.ShowNames);
    }
}

/// <summary>A member's reminder preferences for one baby; <see cref="CanReceive"/> is false for Viewers.</summary>
public sealed record BabyNotificationPreferencesResponse
{
    public Guid BabyId { get; init; }

    public bool CanReceive { get; init; }

    public bool DoseDue { get; init; }

    public int DoseLeadMinutes { get; init; }

    public bool NapWindow { get; init; }

    public int NapLeadMinutes { get; init; }

    /// <summary>The belly pain pattern heads-up (<c>belly_pain_pattern</c>) is on.</summary>
    public bool BellyPainPattern { get; init; }

    /// <summary>The overtired heads-up (<c>overtired_warning</c>) is on.</summary>
    public bool OvertiredWarning { get; init; }

    /// <summary>The fussy pattern heads-up (<c>fussy_pattern</c>) is on.</summary>
    public bool FussyPattern { get; init; }

    /// <summary>The wet diaper heads-up (<c>diaper_wet_headsup</c>) is on.</summary>
    public bool DiaperWetHeadsUp { get; init; }

    /// <summary>The dirty diaper heads-up (<c>diaper_dirty_headsup</c>) is on.</summary>
    public bool DiaperDirtyHeadsUp { get; init; }

    /// <summary>The appointment reminders (<c>appointment_reminder</c>) are on (the default for members who can receive).</summary>
    public bool AppointmentReminders { get; init; }

    /// <summary>The doctor suggestions (<c>doctor_suggestion</c>) are on (off by default; only Owners and Parents receive them).</summary>
    public bool DoctorSuggestions { get; init; }

    /// <summary>The vaccine reminders (<c>vaccine_due</c>) are on (off by default; only Owners and Parents receive them).</summary>
    public bool VaccineReminders { get; init; }

    /// <summary>The cry monitor alerts (<c>cry_detected</c>) are on (off by default).</summary>
    public bool CryDetected { get; init; }

    public static BabyNotificationPreferencesResponse For(Guid babyId, bool canReceive, ReminderPreferences preferences) => new()
    {
        BabyId = babyId,
        CanReceive = canReceive,
        DoseDue = preferences.DoseDue,
        DoseLeadMinutes = preferences.DoseLeadMinutes,
        NapWindow = preferences.NapWindow,
        NapLeadMinutes = preferences.NapLeadMinutes,
        BellyPainPattern = preferences.BellyPainPattern,
        OvertiredWarning = preferences.OvertiredWarning,
        FussyPattern = preferences.FussyPattern,
        DiaperWetHeadsUp = preferences.DiaperWetHeadsUp,
        DiaperDirtyHeadsUp = preferences.DiaperDirtyHeadsUp,
        AppointmentReminders = preferences.AppointmentReminders,
        DoctorSuggestions = preferences.DoctorSuggestions,
        VaccineReminders = preferences.VaccineReminders,
        CryDetected = preferences.CryDetected,
    };
}

/// <summary>
/// Body of <c>PUT /babies/{babyId}/notification-preferences</c>: a merge. Every field is optional; a field that is
/// absent (or <c>null</c>) keeps the stored value (the default before the first PUT), so a client that does not know a
/// newer kind never turns it off.
/// </summary>
public sealed record PutBabyNotificationPreferencesRequest
{
    public bool? DoseDue { get; init; }

    public int? DoseLeadMinutes { get; init; }

    public bool? NapWindow { get; init; }

    public int? NapLeadMinutes { get; init; }

    public bool? BellyPainPattern { get; init; }

    public bool? OvertiredWarning { get; init; }

    public bool? FussyPattern { get; init; }

    public bool? DiaperWetHeadsUp { get; init; }

    public bool? DiaperDirtyHeadsUp { get; init; }

    public bool? AppointmentReminders { get; init; }

    public bool? DoctorSuggestions { get; init; }

    public bool? VaccineReminders { get; init; }

    public bool? CryDetected { get; init; }

    public static explicit operator ReminderPreferencesChange(PutBabyNotificationPreferencesRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return new ReminderPreferencesChange(
            request.DoseDue,
            request.DoseLeadMinutes,
            request.NapWindow,
            request.NapLeadMinutes,
            request.BellyPainPattern,
            request.OvertiredWarning,
            request.FussyPattern,
            request.DiaperWetHeadsUp,
            request.DiaperDirtyHeadsUp,
            request.AppointmentReminders,
            request.DoctorSuggestions,
            request.VaccineReminders,
            request.CryDetected);
    }
}

/// <summary>Body of <c>POST /push/test</c>: this device's endpoint, or none for all the caller's devices.</summary>
public sealed record PushTestRequest
{
    public string? Endpoint { get; init; }
}

/// <summary>One device's test result: <c>sent</c>, <c>gone</c> or <c>failed</c>.</summary>
public sealed record PushTestResult(Guid SubscriptionId, string Status);

public sealed record PushTestResponse(IReadOnlyList<PushTestResult> Results);

/// <summary>Body of <c>POST /push/deliveries/{deliveryId}/actions</c>: <c>snooze</c> or <c>dismiss</c> with the delivery's action token.</summary>
public sealed record NotificationActionRequest
{
    public string? Action { get; init; }

    public string? Token { get; init; }
}
