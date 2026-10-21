using BabyRoutine.Domain.Predictions;
using BabyRoutine.Domain.Prescriptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// Decides which reminders are due for one baby at one tick (docs/design/09-push-notifications.md sections 2 and 3).
/// Pure: no I/O, no clock; the caller passes the outputs of <see cref="MedicationStatusCalculator"/> and
/// <see cref="PredictionEngine"/> per recipient offset, the recipients' settings, their snoozes and the keys already claimed.
/// <list type="bullet">
/// <item>Recipients: Owners and Parents with a time zone; Viewers never. Each kind only when the recipient turned it on.</item>
/// <item><c>dose_due</c>: active scheduled prescriptions whose course has started and not ended (never as-needed).
/// Candidate slots are the open overdue slot and the next scheduled slot, each on its own. Due time
/// <c>T = max(slot, availableAt)</c>; <c>T</c> later than slot + 90 min, or the 24 h limit reached, holds it back.
/// Sent from <c>T - lead</c> for 30 minutes; delivered in quiet hours unless the recipient silences medicine too.
/// Key <c>dose:{rx}:{slot}</c>, time to live 90 min, urgency high. A logged dose closes the slot (it is no longer a candidate).</item>
/// <item><c>nap_window</c>: the sleep prediction when the baby is awake, its basis is the awake window, confidence is
/// medium or high and the window's earliest start is in the day phase. Sent from <c>earliest - lead</c> for 15 minutes
/// while now is before the latest start; dropped in quiet hours. Key <c>nap:{baby}:{anchor}</c>, time to live
/// <c>latest - now</c> capped at 60 min, urgency normal.</item>
/// <item>Each key is planned once per user. A snooze re-sends the still open item at the snooze end with key
/// <c>{base}:s{n}</c> (same stale cutoff and quiet hours); a dismissal stops it for that user only.</item>
/// </list>
/// </summary>
public static class NotificationPlanner
{
    public static NotificationPlan Plan(NotificationPlanInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var context = new PlanContext(input);
        var outcomes = input.Recipients
            .Where(CanBePlanned)
            .SelectMany(recipient => RemindersFor(recipient, context))
            .Select(reminder => Decide(reminder, context))
            .OfType<ReminderOutcome>()
            .ToArray();
        return new NotificationPlan(
            outcomes.Select(outcome => outcome.Planned).OfType<PlannedNotification>().OrderBy(planned => planned.UserId).ThenBy(planned => planned.DedupeKey.Value, StringComparer.Ordinal).ToArray(),
            outcomes.Select(outcome => outcome.Skipped).OfType<SkippedNotification>().OrderBy(skipped => skipped.UserId).ThenBy(skipped => skipped.DedupeKey.Value, StringComparer.Ordinal).ToArray());
    }

    /// <summary>A test notification for <paramref name="userId"/>: key <c>test:{deliveryId}</c>, 5 minutes to live, ignores quiet hours.</summary>
    public static PlannedNotification PlanTest(Guid userId, Guid deliveryId, DateTimeOffset now)
    {
        var key = NotificationKey.ForTest(deliveryId);
        return new PlannedNotification(userId, NotificationKind.Test, null, key, key, now, NotificationRules.TestTimeToLive, NotificationUrgency.Normal, new NotificationContent(null, null, now, null));
    }

    private static bool CanBePlanned(NotificationRecipient recipient) =>
        NotificationRules.CanReceive(recipient.Role) && recipient.UtcOffset is not null && recipient.Preferences.WantsAny;

    private static IEnumerable<Reminder> RemindersFor(NotificationRecipient recipient, PlanContext context) =>
        context.StateAt(recipient.UtcOffset!.Value) is { } state
            ? DoseReminders(recipient, state, context).Concat(NapReminders(recipient, state, context))
            : [];

    private static IEnumerable<Reminder> DoseReminders(NotificationRecipient recipient, NotificationBabyState state, PlanContext context) =>
        recipient.Preferences.DoseDue
            ? state.Medications.Where(IsRemindable).SelectMany(status => OpenSlotsOf(status).Select(slot => DoseReminder(recipient, status, slot, context)))
            : [];

    private static bool IsRemindable(MedicationStatus status) =>
        status.Prescription.IsActive
        && status.Prescription.Schedule.Kind == PrescriptionKind.Scheduled
        && status.CourseStarted
        && !status.CourseEnded;

    private static IEnumerable<DateTimeOffset> OpenSlotsOf(MedicationStatus status) =>
        new[] { status.OverdueSlotAt, status.NextScheduledAt }.OfType<DateTimeOffset>().Distinct();

    private static Reminder DoseReminder(NotificationRecipient recipient, MedicationStatus status, DateTimeOffset slot, PlanContext context)
    {
        var dueAt = status.AvailableAt is { } available && available > slot ? available : slot;
        var heldBy = status.LimitReached
            ? NotificationSkipReason.Limit
            : dueAt > slot + NotificationRules.SlotMatchWindow ? NotificationSkipReason.Unavailable : (NotificationSkipReason?)null;
        return new Reminder(
            recipient,
            NotificationKind.DoseDue,
            NotificationKey.ForDose(status.Prescription.Id, slot),
            (heldBy is null ? dueAt : slot) - recipient.Preferences.DoseLead,
            new NotificationContent(context.BabyId, status.Prescription.Id, slot, context.NamesFor(recipient, status.Prescription.MedicationId)),
            NotificationRules.DoseTimeToLive,
            NotificationUrgency.High,
            NotificationRules.DoseStaleCutoff,
            DeliveredInQuietHours: !recipient.QuietIncludesMedicine,
            heldBy);
    }

    private static IEnumerable<Reminder> NapReminders(NotificationRecipient recipient, NotificationBabyState state, PlanContext context)
    {
        var window = recipient.Preferences.NapWindow ? context.NapWindowIn(state) : null;
        return window is null || context.Now >= window.NextStart.Latest ? [] : [NapReminder(recipient, window, context)];
    }

    private static Reminder NapReminder(NotificationRecipient recipient, Prediction sleep, PlanContext context)
    {
        var untilLatest = sleep.NextStart.Latest - context.Now;
        return new Reminder(
            recipient,
            NotificationKind.NapWindow,
            NotificationKey.ForNap(context.BabyId, sleep.AnchorAt),
            sleep.NextStart.Earliest - recipient.Preferences.NapLead,
            new NotificationContent(context.BabyId, null, sleep.NextStart.Earliest, context.NamesFor(recipient, medicationId: null)),
            untilLatest < NotificationRules.NapMaxTimeToLive ? untilLatest : NotificationRules.NapMaxTimeToLive,
            NotificationUrgency.Normal,
            NotificationRules.NapStaleCutoff,
            DeliveredInQuietHours: false,
            HeldBy: null);
    }

    private static ReminderOutcome? Decide(Reminder reminder, PlanContext context)
    {
        var attempt = AttemptOf(reminder, context.ActionOf(reminder.Recipient.UserId, reminder.BaseKey));
        if (context.WasDelivered(reminder.Recipient.UserId, attempt.Key))
        {
            return null;
        }

        if (attempt.SendAt > context.Now)
        {
            return attempt.IsSnooze && !attempt.Dismissed ? ReminderOutcome.Skip(reminder, attempt, NotificationSkipReason.Snoozed) : null;
        }

        return HoldReason(reminder, attempt, context) is { } reason
            ? ReminderOutcome.Skip(reminder, attempt, reason)
            : ReminderOutcome.Plan(reminder, attempt);
    }

    /// <summary>What to send for this user: the base key at its send time, or the latest snooze re-send at the snooze end.</summary>
    private static Attempt AttemptOf(Reminder reminder, NotificationAction? action) =>
        action is { SnoozeResendKey: { } resendKey, SnoozedUntil: { } snoozedUntil }
            ? new Attempt(resendKey, snoozedUntil, IsSnooze: true, action.Action == NotificationActionKind.Dismissed)
            : new Attempt(reminder.BaseKey, reminder.SendAt, IsSnooze: false, action?.Action == NotificationActionKind.Dismissed);

    private static NotificationSkipReason? HoldReason(Reminder reminder, Attempt attempt, PlanContext context) =>
        context.Now - attempt.SendAt > reminder.StaleCutoff ? NotificationSkipReason.Stale
        : attempt.Dismissed ? NotificationSkipReason.Dismissed
        : reminder.HeldBy is { } held ? held
        : !reminder.DeliveredInQuietHours && reminder.Recipient.QuietHours.Contains(context.Now, reminder.Recipient.UtcOffset!.Value) ? NotificationSkipReason.QuietHours
        : null;

    /// <summary>One candidate reminder of one kind for one recipient, before snoozes, dismissals and claims are applied.</summary>
    private sealed record Reminder(
        NotificationRecipient Recipient,
        NotificationKind Kind,
        NotificationKey BaseKey,
        DateTimeOffset SendAt,
        NotificationContent Content,
        TimeSpan TimeToLive,
        NotificationUrgency Urgency,
        TimeSpan StaleCutoff,
        bool DeliveredInQuietHours,
        NotificationSkipReason? HeldBy);

    private sealed record Attempt(NotificationKey Key, DateTimeOffset SendAt, bool IsSnooze, bool Dismissed);

    private sealed record ReminderOutcome(PlannedNotification? Planned, SkippedNotification? Skipped)
    {
        public static ReminderOutcome Plan(Reminder reminder, Attempt attempt) => new(
            new PlannedNotification(
                reminder.Recipient.UserId,
                reminder.Kind,
                reminder.Content.BabyId,
                reminder.BaseKey,
                attempt.Key,
                attempt.SendAt,
                reminder.TimeToLive,
                reminder.Urgency,
                reminder.Content),
            null);

        public static ReminderOutcome Skip(Reminder reminder, Attempt attempt, NotificationSkipReason reason) =>
            new(null, new SkippedNotification(reminder.Recipient.UserId, reminder.Kind, attempt.Key, reason));
    }

    /// <summary>Lookups over the input, built once per pass.</summary>
    private sealed class PlanContext
    {
        private readonly IReadOnlyDictionary<TimeSpan, NotificationBabyState> _states;
        private readonly IReadOnlyDictionary<(Guid UserId, string BaseKey), NotificationAction> _actions;
        private readonly IReadOnlySet<(Guid UserId, string Key)> _delivered;
        private readonly NotificationNameSource? _names;
        private readonly PredictionOptions _options;

        public PlanContext(NotificationPlanInput input)
        {
            Now = input.Now;
            BabyId = input.BabyId;
            _states = input.States.GroupBy(state => state.UtcOffset).ToDictionary(group => group.Key, group => group.First());
            _actions = input.Actions
                .Where(action => action.BabyId == input.BabyId)
                .GroupBy(action => (action.UserId, action.BaseKey.Value))
                .ToDictionary(group => group.Key, group => group.OrderByDescending(action => action.UpdatedAt).First());
            _delivered = input.Delivered.Select(delivered => (delivered.UserId, delivered.DedupeKey.Value)).ToHashSet();
            _names = input.Names;
            _options = input.PredictionOptions ?? PredictionOptions.Default;
        }

        public DateTimeOffset Now { get; }

        public Guid BabyId { get; }

        public NotificationBabyState? StateAt(TimeSpan utcOffset) => _states.GetValueOrDefault(utcOffset);

        public NotificationAction? ActionOf(Guid userId, NotificationKey baseKey) => _actions.GetValueOrDefault((userId, baseKey.Value));

        public bool WasDelivered(Guid userId, NotificationKey key) => _delivered.Contains((userId, key.Value));

        public NotificationNames? NamesFor(NotificationRecipient recipient, Guid? medicationId) =>
            recipient.ShowNames && _names is { } names
                ? NotificationNames.Create(names.BabyName, medicationId is { } id ? names.MedicationNamesById.GetValueOrDefault(id) : null)
                : null;

        /// <summary>The sleep prediction when it is an awake-window nap estimate worth a reminder (see <see cref="NotificationPlanner"/>).</summary>
        public Prediction? NapWindowIn(NotificationBabyState state) =>
            state.Predictions?.Predictions.FirstOrDefault(prediction =>
                prediction.TypeKey == _options.AwakeWindowTypeKey
                && prediction.Reason.Basis == PredictionBasis.AwakeWindow
                && !prediction.Reason.AssumesEventInProgressEnds
                && prediction.Confidence is PredictionConfidence.Medium or PredictionConfidence.High
                && DayPhases.Of(prediction.NextStart.Earliest, state.UtcOffset, _options) == DayPhase.Day);
    }
}
