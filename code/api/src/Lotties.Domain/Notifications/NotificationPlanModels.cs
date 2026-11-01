using Lotties.Domain.Babies;
using Lotties.Domain.Predictions;
using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// A member who may get reminders for the planned baby, with everything the planner needs about them.
/// <see cref="UtcOffset"/> is their time zone's offset at the tick instant; <c>null</c> (no zone stored yet) skips them.
/// </summary>
public sealed record NotificationRecipient(
    Guid UserId,
    BabyRole Role,
    ReminderPreferences Preferences,
    QuietHours QuietHours,
    bool QuietIncludesMedicine,
    bool ShowNames,
    TimeSpan? UtcOffset)
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
            : new NotificationRecipient(userId, role, preferences, settings.QuietHours, settings.QuietIncludesMedicine, settings.ShowNames, settings.TimeZone.OffsetAt(now));
}

/// <summary>
/// The baby's computed state seen with one UTC offset: <see cref="MedicationStatusCalculator.Calculate"/> and
/// <see cref="PredictionEngine.Predict"/> run with that offset (recipients in different zones see different local days).
/// </summary>
public sealed record NotificationBabyState(TimeSpan UtcOffset, IReadOnlyList<MedicationStatus> Medications, PredictionSet? Predictions);

/// <summary>Names for recipients with "show names" on: the baby's and each catalog medication's by id.</summary>
public sealed record NotificationNameSource(string BabyName, IReadOnlyDictionary<Guid, string> MedicationNamesById);

/// <summary>A dedupe key already claimed for a user (on any of their subscriptions).</summary>
public sealed record DeliveredNotification(Guid UserId, NotificationKey DedupeKey);

/// <summary>Everything <see cref="NotificationPlanner.Plan"/> needs for one baby at one tick.</summary>
/// <param name="Actions">The recipients' snoozes and dismissals for this baby.</param>
/// <param name="Names">Loaded only when a recipient has show-names on.</param>
/// <param name="PredictionOptions">The options the predictions were made with (day phase, sleep type); default <see cref="PredictionOptions.Default"/>.</param>
public sealed record NotificationPlanInput(
    DateTimeOffset Now,
    Guid BabyId,
    IReadOnlyList<NotificationRecipient> Recipients,
    IReadOnlyList<NotificationBabyState> States,
    IReadOnlyList<NotificationAction> Actions,
    IReadOnlyCollection<DeliveredNotification> Delivered,
    NotificationNameSource? Names = null,
    PredictionOptions? PredictionOptions = null);

/// <summary>Names shown on the lock screen (only with show-names on), each trimmed to <see cref="MaxLength"/> characters. Never a dose amount.</summary>
public sealed record NotificationNames
{
    public const int MaxLength = 40;

    private NotificationNames(string baby, string? medication)
    {
        Baby = baby;
        Medication = medication;
    }

    public string Baby { get; }

    public string? Medication { get; }

    public static NotificationNames Create(string baby, string? medication) => new(Shorten(baby) ?? string.Empty, Shorten(medication));

    private static string? Shorten(string? value)
    {
        var trimmed = value?.Trim();
        return trimmed is { Length: > MaxLength } ? trimmed[..MaxLength].TrimEnd() : trimmed;
    }
}

/// <summary>What the payload carries besides kind and ids of the delivery: the baby, the prescription (doses), the time shown and optional names.</summary>
/// <param name="At">The time the text shows: the dose slot, or the nap window's earliest start.</param>
public sealed record NotificationContent(Guid? BabyId, Guid? PrescriptionId, DateTimeOffset At, NotificationNames? Names);

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
