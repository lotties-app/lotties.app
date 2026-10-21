using BabyRoutine.Domain.Common;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// One member's reminder preferences for one baby (stored only once the member changes anything; otherwise
/// <see cref="ReminderPreferences.Default"/>). Only Owners and Parents may store them (<see cref="NotificationRules.CanReceive"/>,
/// enforced by the baby role policy); the row goes away with the membership.
/// </summary>
public sealed class BabyNotificationPreferences
{
    private BabyNotificationPreferences()
    {
    }

    private BabyNotificationPreferences(Guid babyId, Guid userId)
    {
        BabyId = babyId;
        UserId = userId;
    }

    public Guid BabyId { get; private set; }

    public Guid UserId { get; private set; }

    public bool DoseDue { get; private set; }

    public short DoseLeadMinutes { get; private set; }

    public bool NapWindow { get; private set; }

    public short NapLeadMinutes { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public ReminderPreferences Preferences => ReminderPreferences.Create(DoseDue, DoseLeadMinutes, NapWindow, NapLeadMinutes);

    public static BabyNotificationPreferences Create(Guid babyId, Guid userId, ReminderPreferences preferences, DateTimeOffset now)
    {
        var stored = new BabyNotificationPreferences(Ids.Required(babyId, nameof(babyId)), Ids.Required(userId, nameof(userId)));
        stored.Apply(preferences, now);
        return stored;
    }

    /// <summary>Replaces the full state; equal preferences change nothing (not even <see cref="UpdatedAt"/>).</summary>
    public void Change(ReminderPreferences preferences, DateTimeOffset now)
    {
        if (preferences == Preferences)
        {
            return;
        }

        Apply(preferences, now);
    }

    private void Apply(ReminderPreferences preferences, DateTimeOffset now)
    {
        DoseDue = preferences.DoseDue;
        DoseLeadMinutes = (short)preferences.DoseLeadMinutes;
        NapWindow = preferences.NapWindow;
        NapLeadMinutes = (short)preferences.NapLeadMinutes;
        UpdatedAt = UtcTime.Normalize(now);
    }
}
