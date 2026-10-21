using BabyRoutine.Domain.Common;

namespace BabyRoutine.Domain.Notifications;

/// <summary>The full state of a user's notification settings, as sent by <c>PUT /push/settings</c>.</summary>
/// <param name="QuietIncludesMedicine">Also silence medicine reminders in quiet hours (default off: they are still delivered).</param>
/// <param name="ShowNames">Show baby and medicine names on notifications (default off: generic lock-screen text).</param>
public sealed record NotificationSettingsTerms(
    NotificationTimeZone TimeZone,
    QuietHours QuietHours,
    bool QuietIncludesMedicine,
    bool ShowNames);

/// <summary>
/// A user's notification settings (one per user, created on the first PUT; before that the defaults apply and the
/// user has no time zone, so the scheduler skips them).
/// </summary>
public sealed class UserNotificationSettings
{
    private UserNotificationSettings()
    {
    }

    private UserNotificationSettings(Guid userId)
    {
        UserId = userId;
    }

    public Guid UserId { get; private set; }

    public NotificationTimeZone TimeZone { get; private set; }

    public bool QuietHoursEnabled { get; private set; }

    public TimeOnly QuietStart { get; private set; }

    public TimeOnly QuietEnd { get; private set; }

    public bool QuietIncludesMedicine { get; private set; }

    public bool ShowNames { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public QuietHours QuietHours => QuietHours.Create(QuietHoursEnabled, QuietStart, QuietEnd);

    public NotificationSettingsTerms Terms => new(TimeZone, QuietHours, QuietIncludesMedicine, ShowNames);

    public static UserNotificationSettings Create(Guid userId, NotificationSettingsTerms terms, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var settings = new UserNotificationSettings(Ids.Required(userId, nameof(userId)));
        settings.Apply(terms, now);
        return settings;
    }

    /// <summary>Replaces the full state; equal terms change nothing (not even <see cref="UpdatedAt"/>).</summary>
    public void Change(NotificationSettingsTerms terms, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (terms == Terms)
        {
            return;
        }

        Apply(terms, now);
    }

    private void Apply(NotificationSettingsTerms terms, DateTimeOffset now)
    {
        TimeZone = terms.TimeZone;
        QuietHoursEnabled = terms.QuietHours.Enabled;
        QuietStart = terms.QuietHours.Start;
        QuietEnd = terms.QuietHours.End;
        QuietIncludesMedicine = terms.QuietIncludesMedicine;
        ShowNames = terms.ShowNames;
        UpdatedAt = UtcTime.Normalize(now);
    }
}
