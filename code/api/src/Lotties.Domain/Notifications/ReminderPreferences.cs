using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// One member's reminder choices for one baby: which kinds are on and how early each is sent. Everything is off by
/// default except the appointment reminders (on: the family created the appointment on purpose; the device opt-in is
/// still needed); dose lead 0, 5 or 15 minutes (default 0); nap lead 0, 10 or 20 minutes (default 10); the belly pain and
/// fussy pattern heads-ups have no lead choice (30 minutes before the usual window), nor has the overtired heads-up
/// (15 minutes before the usual longest awake stretch ends) or the diaper heads-ups (10 minutes before a wet diaper,
/// 5 minutes before a dirty one or at the usual lag after a feed); appointment reminders use each appointment's own offsets.
/// The doctor suggestions (<c>doctor_suggestion</c>, off by default) go when the doctor sends something, to Owners and
/// Parents only (<see cref="NotificationRules.CanReceiveDoctorSuggestions"/>). The vaccine reminders (<c>vaccine_due</c>, off
/// by default) go on the day a dose becomes due according to the schedule and once more 14 days later, to Owners and Parents
/// only (<see cref="NotificationRules.CanReceiveVaccineReminders"/>).
/// </summary>
public readonly record struct ReminderPreferences
{
    public static readonly IReadOnlyList<int> DoseLeadOptions = [0, 5, 15];
    public static readonly IReadOnlyList<int> NapLeadOptions = [0, 10, 20];

    private ReminderPreferences(
        bool doseDue,
        int doseLeadMinutes,
        bool napWindow,
        int napLeadMinutes,
        bool bellyPainPattern,
        bool overtiredWarning,
        bool fussyPattern,
        bool diaperWetHeadsUp,
        bool diaperDirtyHeadsUp,
        bool appointmentReminders,
        bool doctorSuggestions,
        bool vaccineReminders)
    {
        DoseDue = doseDue;
        DoseLeadMinutes = doseLeadMinutes;
        NapWindow = napWindow;
        NapLeadMinutes = napLeadMinutes;
        BellyPainPattern = bellyPainPattern;
        OvertiredWarning = overtiredWarning;
        FussyPattern = fussyPattern;
        DiaperWetHeadsUp = diaperWetHeadsUp;
        DiaperDirtyHeadsUp = diaperDirtyHeadsUp;
        AppointmentReminders = appointmentReminders;
        DoctorSuggestions = doctorSuggestions;
        VaccineReminders = vaccineReminders;
    }

    /// <summary>What a member who never changed anything has: everything off except the appointment reminders.</summary>
    public static ReminderPreferences Default { get; } = new(false, 0, false, 10, false, false, false, false, false, true, false, false);

    /// <summary>Everything off (what a member who cannot receive baby reminders, a Viewer, is shown).</summary>
    public static ReminderPreferences None { get; } = new(false, 0, false, 10, false, false, false, false, false, false, false, false);

    public bool DoseDue { get; }

    public int DoseLeadMinutes { get; }

    public bool NapWindow { get; }

    public int NapLeadMinutes { get; }

    /// <summary>The belly pain pattern heads-up (<c>belly_pain_pattern</c>) is on.</summary>
    public bool BellyPainPattern { get; }

    /// <summary>The overtired heads-up (<c>overtired_warning</c>) is on.</summary>
    public bool OvertiredWarning { get; }

    /// <summary>The fussy pattern heads-up (<c>fussy_pattern</c>) is on.</summary>
    public bool FussyPattern { get; }

    /// <summary>The wet diaper heads-up (<c>diaper_wet_headsup</c>) is on.</summary>
    public bool DiaperWetHeadsUp { get; }

    /// <summary>The dirty diaper heads-up (<c>diaper_dirty_headsup</c>) is on.</summary>
    public bool DiaperDirtyHeadsUp { get; }

    /// <summary>The appointment reminders (<c>appointment_reminder</c>) are on; on by default.</summary>
    public bool AppointmentReminders { get; }

    /// <summary>The doctor suggestions (<c>doctor_suggestion</c>) are on; off by default.</summary>
    public bool DoctorSuggestions { get; }

    /// <summary>The vaccine reminders (<c>vaccine_due</c>) are on; off by default.</summary>
    public bool VaccineReminders { get; }

    public TimeSpan DoseLead => TimeSpan.FromMinutes(DoseLeadMinutes);

    public TimeSpan NapLead => TimeSpan.FromMinutes(NapLeadMinutes);

    /// <summary>Whether any reminder kind is on (the baby is a scheduler candidate for this member).</summary>
    public bool WantsAny => DoseDue || WantsEventHistory || AppointmentReminders || DoctorSuggestions || VaccineReminders;

    /// <summary>Whether a kind read from the baby's events (nap window, a pattern or a diaper heads-up) is on: the scheduler loads the event history.</summary>
    public bool WantsEventHistory => NapWindow || BellyPainPattern || OvertiredWarning || FussyPattern || WantsDiapers;

    /// <summary>Whether a diaper heads-up (wet or dirty) is on.</summary>
    public bool WantsDiapers => DiaperWetHeadsUp || DiaperDirtyHeadsUp;

    public static ReminderPreferences Create(
        bool doseDue,
        int doseLeadMinutes,
        bool napWindow,
        int napLeadMinutes,
        bool bellyPainPattern = false,
        bool overtiredWarning = false,
        bool fussyPattern = false,
        bool diaperWetHeadsUp = false,
        bool diaperDirtyHeadsUp = false,
        bool appointmentReminders = true,
        bool doctorSuggestions = false,
        bool vaccineReminders = false) =>
        new(
            doseDue,
            Allowed(doseLeadMinutes, DoseLeadOptions, "doseLeadMinutes"),
            napWindow,
            Allowed(napLeadMinutes, NapLeadOptions, "napLeadMinutes"),
            bellyPainPattern,
            overtiredWarning,
            fussyPattern,
            diaperWetHeadsUp,
            diaperDirtyHeadsUp,
            appointmentReminders,
            doctorSuggestions,
            vaccineReminders);

    /// <summary>
    /// These preferences with the values <paramref name="change"/> names; the ones it leaves out stay as they are, so a
    /// client that does not know a newer kind never turns it off.
    /// </summary>
    public ReminderPreferences With(ReminderPreferencesChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        return Create(
            change.DoseDue ?? DoseDue,
            change.DoseLeadMinutes ?? DoseLeadMinutes,
            change.NapWindow ?? NapWindow,
            change.NapLeadMinutes ?? NapLeadMinutes,
            change.BellyPainPattern ?? BellyPainPattern,
            change.OvertiredWarning ?? OvertiredWarning,
            change.FussyPattern ?? FussyPattern,
            change.DiaperWetHeadsUp ?? DiaperWetHeadsUp,
            change.DiaperDirtyHeadsUp ?? DiaperDirtyHeadsUp,
            change.AppointmentReminders ?? AppointmentReminders,
            change.DoctorSuggestions ?? DoctorSuggestions,
            change.VaccineReminders ?? VaccineReminders);
    }

    private static int Allowed(int minutes, IReadOnlyList<int> options, string field) =>
        options.Contains(minutes)
            ? minutes
            : throw new DomainValidationException(field, $"{field} must be one of {string.Join(", ", options)}.");
}

/// <summary>A partial change of <see cref="ReminderPreferences"/>: <c>null</c> keeps the stored value.</summary>
public sealed record ReminderPreferencesChange(
    bool? DoseDue = null,
    int? DoseLeadMinutes = null,
    bool? NapWindow = null,
    int? NapLeadMinutes = null,
    bool? BellyPainPattern = null,
    bool? OvertiredWarning = null,
    bool? FussyPattern = null,
    bool? DiaperWetHeadsUp = null,
    bool? DiaperDirtyHeadsUp = null,
    bool? AppointmentReminders = null,
    bool? DoctorSuggestions = null,
    bool? VaccineReminders = null);
