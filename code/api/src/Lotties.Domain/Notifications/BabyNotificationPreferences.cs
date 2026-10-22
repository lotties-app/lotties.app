using Lotties.Domain.Common;

namespace Lotties.Domain.Notifications;

/// <summary>
/// One member's reminder preferences for one baby (stored only once the member changes anything; otherwise
/// <see cref="ReminderPreferences.Default"/>). Only Owners, Parents and Caregivers may store them, each only their own (<see cref="NotificationRules.CanReceive"/>,
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

    public bool BellyPainPattern { get; private set; }

    public bool OvertiredWarning { get; private set; }

    public bool FussyPattern { get; private set; }

    public bool DiaperWetHeadsUp { get; private set; }

    public bool DiaperDirtyHeadsUp { get; private set; }

    /// <summary>On unless the member turned it off (rows stored before the column existed are on: database default true).</summary>
    public bool AppointmentReminders { get; private set; } = true;

    /// <summary>The doctor suggestions are on (off by default; rows stored before the column existed are off).</summary>
    public bool DoctorSuggestions { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public ReminderPreferences Preferences =>
        ReminderPreferences.Create(DoseDue, DoseLeadMinutes, NapWindow, NapLeadMinutes, BellyPainPattern, OvertiredWarning, FussyPattern, DiaperWetHeadsUp, DiaperDirtyHeadsUp, AppointmentReminders, DoctorSuggestions);

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
        BellyPainPattern = preferences.BellyPainPattern;
        OvertiredWarning = preferences.OvertiredWarning;
        FussyPattern = preferences.FussyPattern;
        DiaperWetHeadsUp = preferences.DiaperWetHeadsUp;
        DiaperDirtyHeadsUp = preferences.DiaperDirtyHeadsUp;
        AppointmentReminders = preferences.AppointmentReminders;
        DoctorSuggestions = preferences.DoctorSuggestions;
        UpdatedAt = UtcTime.Normalize(now);
    }
}
