using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Notifications;

/// <summary>
/// A member who may get reminders for the planned baby, with everything the planner needs about them.
/// <see cref="UtcOffset"/> is their time zone's offset at the tick instant; <c>null</c> (no zone stored yet) skips them.
/// <see cref="TimeZone"/> is the zone itself (the recurring patterns and the wake window are read in it); <c>null</c> = no
/// belly pain, fussy or overtired heads-up.
/// </summary>
public sealed record NotificationRecipient(
    Guid UserId,
    BabyRole Role,
    ReminderPreferences Preferences,
    QuietHours QuietHours,
    bool QuietIncludesMedicine,
    bool ShowNames,
    TimeSpan? UtcOffset,
    NotificationTimeZone? TimeZone = null)
{
    /// <summary>A recipient from the stored rows; <paramref name="settings"/> <c>null</c> means defaults and no time zone.</summary>
    public static NotificationRecipient From(
        Guid userId,
        BabyRole role,
        ReminderPreferences preferences,
        UserNotificationSettings? settings,
        DateTimeOffset now) =>
        settings is null
            ? new NotificationRecipient(userId, role, preferences, QuietHours.Default, false, false, null)
            : new NotificationRecipient(userId, role, preferences, settings.QuietHours, settings.QuietIncludesMedicine, settings.ShowNames, settings.TimeZone.OffsetAt(now), settings.TimeZone);

    /// <summary>The recipient's wall clock: the time zone when known (daylight saving per instant), else the offset at the tick.</summary>
    public Patterns.LocalClock Clock() =>
        TimeZone is { Value: not null } zone ? zone.Clock() : Patterns.LocalClock.WithOffset(UtcOffset ?? TimeSpan.Zero);
}

/// <summary>
/// The baby's computed state seen with one UTC offset: <see cref="MedicationStatusCalculator.Calculate"/> and
/// <see cref="PredictionEngine.Predict"/> run with that offset (recipients in different zones see different local days).
/// </summary>
public sealed record NotificationBabyState(TimeSpan UtcOffset, IReadOnlyList<MedicationStatus> Medications, PredictionSet? Predictions);

/// <summary>
/// One recurring pattern of the baby read in one time zone (<see cref="BellyPainPatterns.Detect"/> or
/// <see cref="FussyPatterns.Detect"/>; <c>null</c> = no pattern) and the start of the latest event that handles a window
/// (<see cref="BellyPainPatterns.LastLoggedAt"/>: belly pain or massage; <see cref="FussyPatterns.LastLoggedAt"/>: a fussy spell).
/// </summary>
public sealed record TimeOfDayPatternState(NotificationTimeZone TimeZone, TimeOfDayPattern? Pattern, DateTimeOffset? LastLoggedAt);

/// <summary>The baby's wake window read in one time zone (<see cref="WakeWindows.Measure"/>; <c>null</c> = too few stretches).</summary>
public sealed record WakeWindowState(NotificationTimeZone TimeZone, WakeWindow? Window);

/// <summary>Names for recipients with "show names" on: the baby's and each catalog medication's by id.</summary>
public sealed record NotificationNameSource(string BabyName, IReadOnlyDictionary<Guid, string> MedicationNamesById);

/// <summary>A dedupe key already claimed for a user (on any of their subscriptions).</summary>
public sealed record DeliveredNotification(Guid UserId, NotificationKey DedupeKey);

/// <summary>
/// A heads-up that counts toward the diaper caps (docs/design/09-push-notifications.md section 2.8): claimed for the user
/// and sent or still being sent (failed, expired, gone and cancelled ones do not count), at <see cref="At"/> (when the push
/// service accepted it, else when it was due). One per dedupe key, whatever the number of devices.
/// </summary>
public sealed record SentHeadsUp(Guid UserId, Guid BabyId, NotificationKind Kind, NotificationKey DedupeKey, DateTimeOffset At);

/// <summary>Where a doctor suggestion comes from.</summary>
public enum DoctorSuggestionSource
{
    /// <summary>A prescription proposal (pending).</summary>
    Proposal,

    /// <summary>A shared note of kind recommendation.</summary>
    Recommendation,
}

/// <summary>
/// Something the baby's doctor sent that may be announced (<c>doctor_suggestion</c>): a pending prescription proposal or a
/// shared recommendation that is not deleted, created at <see cref="CreatedAt"/> by <see cref="AuthorUserId"/>;
/// <see cref="ReadBy"/> = the members who already opened the recommendation.
/// </summary>
public sealed record DoctorSuggestion(Guid Id, DoctorSuggestionSource Source, Guid AuthorUserId, DateTimeOffset CreatedAt, IReadOnlyCollection<Guid>? ReadBy = null)
{
    /// <summary>Whether it is still worth announcing to <paramref name="userId"/> at <paramref name="now"/>: new, not hers, not read by her.</summary>
    public bool IsOpenFor(Guid userId, DateTimeOffset now) =>
        AuthorUserId != userId
        && now < CreatedAt + NotificationRules.DoctorSuggestionLifetime
        && !(ReadBy?.Contains(userId) ?? false);
}

/// <summary>Everything <see cref="NotificationPlanner.Plan"/> needs for one baby at one tick.</summary>
/// <param name="Actions">The recipients' snoozes and dismissals for this baby.</param>
/// <param name="Names">Loaded only when a recipient has show-names on.</param>
/// <param name="PredictionOptions">The options the predictions were made with (day phase, sleep type); default <see cref="PredictionOptions.Default"/>.</param>
/// <param name="BellyPainPatterns">The belly pain pattern per time zone of the recipients who want the heads-up (loaded only for them).</param>
/// <param name="FussyPatterns">The fussy pattern per time zone of the recipients who want the heads-up (loaded only for them).</param>
/// <param name="WakeWindows">The wake window per time zone of the recipients who want the overtired heads-up (loaded only for them).</param>
/// <param name="Diapers">The baby's diaper predictions (loaded only when a recipient wants a diaper heads-up; elapsed time, no zone).</param>
/// <param name="SentHeadsUps">The diaper heads-ups of the last day that count toward the daily cap and the spacing (any baby; filtered here).</param>
/// <param name="Appointments">The baby's upcoming appointments within the reminder horizon (loaded only when a recipient wants appointment reminders).</param>
/// <param name="DoctorSuggestions">The baby's doctor suggestions of the last 24 hours (loaded only when a recipient wants them).</param>
/// <param name="Vaccines">The baby's schedule, profile and records (loaded only when an Owner or Parent wants vaccine reminders).</param>
public sealed record NotificationPlanInput(
    DateTimeOffset Now,
    Guid BabyId,
    IReadOnlyList<NotificationRecipient> Recipients,
    IReadOnlyList<NotificationBabyState> States,
    IReadOnlyList<NotificationAction> Actions,
    IReadOnlyCollection<DeliveredNotification> Delivered,
    NotificationNameSource? Names = null,
    PredictionOptions? PredictionOptions = null,
    IReadOnlyList<TimeOfDayPatternState>? BellyPainPatterns = null,
    IReadOnlyList<TimeOfDayPatternState>? FussyPatterns = null,
    IReadOnlyList<WakeWindowState>? WakeWindows = null,
    DiaperPrediction? Diapers = null,
    IReadOnlyCollection<SentHeadsUp>? SentHeadsUps = null,
    IReadOnlyList<Appointment>? Appointments = null,
    IReadOnlyList<DoctorSuggestion>? DoctorSuggestions = null,
    VaccinePlanState? Vaccines = null);

/// <summary>
/// What the vaccine reminders need about one baby: the schedule, the baby's vaccine profile and birth date, and the
/// records that are not deleted. The statuses are computed per recipient, on the recipient's local date.
/// </summary>
public sealed record VaccinePlanState(VaccineSchedule Schedule, VaccineProfile Profile, DateOnly BirthDate, IReadOnlyList<VaccinationRecord> Records);

/// <summary>
/// Names shown on the lock screen (only with show-names on), each trimmed to <see cref="MaxLength"/> characters. Never a
/// dose amount. A vaccine name is kept per language (the payload picks the device's) without its parenthetical detail.
/// </summary>
public sealed record NotificationNames
{
    public const int MaxLength = 40;

    private NotificationNames(string baby, string? medication, LocalizedText? vaccine)
    {
        Baby = baby;
        Medication = medication;
        Vaccine = vaccine;
    }

    public string Baby { get; }

    public string? Medication { get; }

    /// <summary>The vaccine's short name per language (<c>Pentavalente</c>, not <c>Pentavalente (DTP + Hib ...)</c>).</summary>
    public LocalizedText? Vaccine { get; }

    public static NotificationNames Create(string baby, string? medication, LocalizedText? vaccine = null) =>
        new(Shorten(baby) ?? string.Empty, Shorten(medication), vaccine is null ? null : new LocalizedText(vaccine.Values.ToDictionary(pair => pair.Key, pair => Shorten(ShortVaccineName(pair.Value)) ?? string.Empty, StringComparer.Ordinal)));

    /// <summary>The name before a parenthetical detail: <c>Pentavalente (DTP + Hib ...)</c> is <c>Pentavalente</c>.</summary>
    private static string ShortVaccineName(string name)
    {
        var detail = name.IndexOf(" (", StringComparison.Ordinal);
        return detail > 0 ? name[..detail] : name;
    }

    private static string? Shorten(string? value)
    {
        var trimmed = value?.Trim();
        return trimmed is { Length: > MaxLength } ? trimmed[..MaxLength].TrimEnd() : trimmed;
    }
}

/// <summary>
/// What the payload carries besides kind and ids of the delivery: the baby, the prescription (doses), the time shown,
/// optional names and, for appointment reminders, the appointment and the reminder offset (never its title, doctor or notes);
/// for doctor suggestions the proposal or the note (never a medicine name, a dose or the note text).
/// </summary>
/// <param name="At">
/// The time the text shows: the dose slot, the nap window's earliest start, the start of the usual belly pain or fussy
/// window, the instant the current awake stretch reaches the usual limit, when the wet or dirty diaper is expected,
/// when the appointment starts, or when the doctor sent the suggestion.
/// </param>
/// <param name="ReminderOffsetMinutes">How long before the start the appointment reminder was meant to go (10080, 1440, 120 or 30).</param>
/// <param name="ProposalId">The prescription proposal a doctor suggestion announces.</param>
/// <param name="NoteId">The recommendation note a doctor suggestion announces.</param>
/// <param name="VaccineDoseId">The scheduled dose a vaccine reminder is about (a schedule dose id, never a record).</param>
public sealed record NotificationContent(
    Guid? BabyId,
    Guid? PrescriptionId,
    DateTimeOffset At,
    NotificationNames? Names,
    Guid? AppointmentId = null,
    int? ReminderOffsetMinutes = null,
    Guid? ProposalId = null,
    Guid? NoteId = null,
    string? VaccineDoseId = null)
{
    /// <summary>The content of a doctor suggestion: the baby, when it was sent, the proposal or the note.</summary>
    public static NotificationContent ForDoctorSuggestion(Guid? babyId, DoctorSuggestionSource source, Guid id, DateTimeOffset at, NotificationNames? names) =>
        new(
            babyId,
            null,
            at,
            names,
            ProposalId: source == DoctorSuggestionSource.Proposal ? id : null,
            NoteId: source == DoctorSuggestionSource.Recommendation ? id : null);
}

/// <summary>
/// One notification to claim for every active subscription of <see cref="UserId"/>. <see cref="DueAt"/> is when it
/// became due to send (send time or snooze end); a delivery expires at <see cref="DueAt"/> + <see cref="TimeToLive"/>.
/// </summary>
public sealed record PlannedNotification(
    Guid UserId,
    NotificationKind Kind,
    Guid? BabyId,
    NotificationKey BaseKey,
    NotificationKey DedupeKey,
    DateTimeOffset DueAt,
    TimeSpan TimeToLive,
    NotificationUrgency Urgency,
    NotificationContent Content)
{
    /// <summary>A snooze re-send (the device should re-alert while replacing the earlier notification).</summary>
    public bool IsResend => DedupeKey.IsSnoozeResend;
}

/// <summary>A reminder that was due for <see cref="UserId"/> in this tick but is held back.</summary>
public sealed record SkippedNotification(Guid UserId, NotificationKind Kind, NotificationKey DedupeKey, NotificationSkipReason Reason);

/// <summary>
/// The result of one planning pass. <see cref="Skipped"/> lists every due reminder held back in this pass; it is
/// recomputed on every tick, so the same item can appear on consecutive ticks.
/// </summary>
public sealed record NotificationPlan(IReadOnlyList<PlannedNotification> Notifications, IReadOnlyList<SkippedNotification> Skipped);
