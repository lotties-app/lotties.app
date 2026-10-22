using Lotties.Domain.Appointments;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Notifications;

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
/// <item><c>dose_due</c> for part-of-the-day prescriptions with reminders (off by default, per prescription): each chosen
/// part that is due (window open, no dose yet) and has a reminder time <c>R</c>. Due time <c>T = max(R, availableAt)</c>;
/// <c>T</c> at or after the window's end, or the 24 h limit reached, holds it back. Sent from <c>T - lead</c> (never before
/// the window opens) with the same stale cutoff, quiet hours, time to live and urgency as slots. Key <c>dose:{rx}:{R}</c>:
/// one per prescription, part and local date. A dose in the window closes it.</item>
/// <item><c>nap_window</c>: the sleep prediction when the baby is awake, its basis is the awake window, confidence is
/// medium or high and the window's earliest start is in the day phase. Sent from <c>earliest - lead</c> for 15 minutes
/// while now is before the latest start; dropped in quiet hours. Key <c>nap:{baby}:{anchor}</c>, time to live
/// <c>latest - now</c> capped at 60 min, urgency normal.</item>
/// <item><c>belly_pain_pattern</c>: the baby's belly pain pattern read in the recipient's time zone
/// (<see cref="BellyPainPatterns"/>). One per local day: the window starting on that date, sent from
/// <c>window start - 30 min</c> for 30 minutes while now is before the window's end, unless a belly pain or belly massage
/// was logged from <c>window start - 45 min</c> on; dropped in quiet hours. Key <c>belly:{baby}:{local date}</c>, time to
/// live until 15 minutes after the window ends, urgency normal. Not a medicine: quiet hours always apply.</item>
/// <item><c>fussy_pattern</c>: the same rules over the baby's fussy pattern (<see cref="FussyPatterns"/>): a fussy spell
/// logged from <c>window start - 45 min</c> on handles the day. Key <c>fussy:{baby}:{local date}</c>.</item>
/// <item><c>overtired_warning</c>: the baby's wake window read in the recipient's time zone (<see cref="WakeWindows"/>)
/// while she is awake (no sleep running, no night waking since). One per awake stretch: sent from
/// <c>awake since + limit - 15 min</c> for 15 minutes while now is before <c>limit + 30 min</c>; a sleep that starts
/// ends the stretch, so nothing more is sent for it. Dropped in quiet hours. Key <c>overtired:{baby}:{awake since}</c>,
/// time to live until 30 minutes after the limit, urgency normal.</item>
/// <item><c>diaper_wet_headsup</c>: the next wet diaper (<see cref="DiaperPredictions"/>, anchored at the latest one). Sent from
/// <c>expected - 10 min</c> for 15 minutes while now is before <c>expected + 30 min</c>; a new wet diaper is a new anchor,
/// so the old heads-up is no longer planned. Key <c>wet:{baby}:{anchor}</c>, time to live until 30 minutes after the
/// expected time, urgency normal, dropped in quiet hours.</item>
/// <item><c>diaper_dirty_headsup</c>: the next dirty diaper (<see cref="DiaperPrediction.DirtyExpectation"/>): after the
/// latest feed (sent at <c>feed end + lower lag</c>) when that signal applies, else from the gaps (sent at
/// <c>expected - 5 min</c>). Same stale cutoff, expiry, quiet hours and urgency; key <c>dirty:{baby}:{anchor}</c> (the
/// feed end or the latest dirty diaper).</item>
/// <item>Diaper caps per recipient and baby: at most 3 heads-ups of a kind per local day (counting the ones sent or
/// being sent) and never two of either kind within 60 minutes (also within one tick: the earlier one wins, wet first).</item>
/// <item><c>appointment_reminder</c> (on by default): for every upcoming appointment that has not started and each of its
/// offsets (1 week, 1 day, 2 hours, 30 minutes), sent at <c>start - offset</c>; inside the recipient's quiet hours it is
/// delayed to their end (read in the recipient's zone) when that is still before the start, else skipped; an offset whose
/// send time was already past when the appointment was last changed is skipped. Of the offsets due at a tick only the
/// latest goes (the earlier unsent ones are superseded). Key <c>appt:{appointment}:{start utc yyyyMMddHHmm}:{offset}</c>
/// (moving the start plans new reminders), stale cutoff 30 minutes, time to live until the start, urgency normal. Done
/// and cancelled appointments never remind.</item>
/// <item><c>doctor_suggestion</c> (off by default; Owners and Parents only, never the Doctor, a Caregiver or a Viewer, never
/// the author): for every pending prescription proposal and every shared recommendation that is not deleted, created less
/// than 24 hours ago and not yet opened by the recipient (a recommendation). Sent from its creation; inside quiet hours it
/// waits for their end (quiet hours always apply; stale cutoff 24 hours). Key <c>proposal:{id}</c> or
/// <c>recommendation:{id}</c>, time to live until 24 hours after the creation, urgency normal.</item>
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
        var outcomes = OneDiaperHeadsUpPerTick(input.Recipients
            .Where(CanBePlanned)
            .SelectMany(recipient => RemindersFor(recipient, context))
            .Select(reminder => Decide(reminder, context))
            .OfType<ReminderOutcome>()
            .ToArray());
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
        StateReminders(recipient, context)
            .Concat(PatternReminders(recipient, PatternKind.BellyPain, context))
            .Concat(PatternReminders(recipient, PatternKind.Fussy, context))
            .Concat(OvertiredReminders(recipient, context))
            .Concat(DiaperReminders(recipient, context))
            .Concat(AppointmentRemindersFor(recipient, context))
            .Concat(DoctorSuggestionReminders(recipient, context));

    private static IEnumerable<Reminder> StateReminders(NotificationRecipient recipient, PlanContext context) =>
        context.StateAt(recipient.UtcOffset!.Value) is { } state
            ? DoseReminders(recipient, state, context).Concat(NapReminders(recipient, state, context))
            : [];

    private static IEnumerable<Reminder> DoseReminders(NotificationRecipient recipient, NotificationBabyState state, PlanContext context) =>
        recipient.Preferences.DoseDue
            ? state.Medications.Where(IsRemindable).SelectMany(status => RemindersOf(recipient, status, context))
            : [];

    private static IEnumerable<Reminder> RemindersOf(NotificationRecipient recipient, MedicationStatus status, PlanContext context) =>
        OpenSlotsOf(status).Select(slot => DoseReminder(recipient, status, slot, context))
            .Concat(DuePartsWithReminder(status).Select(slot => DayPartReminder(recipient, status, slot, context)));

    private static bool IsRemindable(MedicationStatus status) =>
        status.Prescription.IsActive
        && status.Prescription.Schedule.Kind == PrescriptionKind.Scheduled
        && status.CourseStarted
        && !status.CourseEnded;

    private static IEnumerable<DateTimeOffset> OpenSlotsOf(MedicationStatus status) =>
        new[] { status.OverdueSlotAt, status.NextScheduledAt }.OfType<DateTimeOffset>().Distinct();

    private static IEnumerable<DayPartSlot> DuePartsWithReminder(MedicationStatus status) =>
        status.DayParts?.Parts.Where(slot => slot.State == DayPartState.Due && slot.ReminderAt is not null) ?? [];

    private static Reminder DayPartReminder(NotificationRecipient recipient, MedicationStatus status, DayPartSlot slot, PlanContext context)
    {
        var remindAt = slot.ReminderAt!.Value;
        var dueAt = status.AvailableAt is { } available && available > remindAt ? available : remindAt;
        var heldBy = status.LimitReached
            ? NotificationSkipReason.Limit
            : dueAt >= slot.Window.End ? NotificationSkipReason.Unavailable : (NotificationSkipReason?)null;
        var sendAt = (heldBy is null ? dueAt : remindAt) - recipient.Preferences.DoseLead;
        return new Reminder(
            recipient,
            NotificationKind.DoseDue,
            NotificationKey.ForDose(status.Prescription.Id, remindAt),
            sendAt > slot.Window.Start ? sendAt : slot.Window.Start,
            new NotificationContent(context.BabyId, status.Prescription.Id, remindAt, context.NamesFor(recipient, status.Prescription.MedicationId)),
            NotificationRules.DoseTimeToLive,
            NotificationUrgency.High,
            NotificationRules.DoseStaleCutoff,
            DeliveredInQuietHours: !recipient.QuietIncludesMedicine,
            heldBy);
    }

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

    private static IEnumerable<Reminder> PatternReminders(NotificationRecipient recipient, PatternKind kind, PlanContext context) =>
        kind.Wants(recipient.Preferences) && context.PatternIn(kind, recipient.TimeZone) is { Pattern: { } pattern } state
            ? OpenPatternWindows(pattern, state.LastLoggedAt, kind, recipient.UtcOffset!.Value, context).Select(window => PatternReminder(recipient, kind, window, context))
            : [];

    /// <summary>The windows starting yesterday, today and tomorrow (local) that have not ended and were not handled.</summary>
    private static IEnumerable<PatternWindowAt> OpenPatternWindows(TimeOfDayPattern pattern, DateTimeOffset? lastLoggedAt, PatternKind kind, TimeSpan utcOffset, PlanContext context)
    {
        var today = DateOnly.FromDateTime(context.Now.ToOffset(utcOffset).DateTime);
        return new[] { today.AddDays(-1), today, today.AddDays(1) }
            .Select(date => PatternWindowAt.On(pattern, date, utcOffset))
            .Where(window => context.Now < window.End && !kind.IsHandled(window.Start, lastLoggedAt));
    }

    private static Reminder PatternReminder(NotificationRecipient recipient, PatternKind kind, PatternWindowAt window, PlanContext context) =>
        new(
            recipient,
            kind.Kind,
            kind.KeyFor(context.BabyId, window.Date),
            window.Start - kind.Lead,
            new NotificationContent(context.BabyId, null, window.Start, context.NamesFor(recipient, medicationId: null)),
            window.End + kind.ExpiryAfterWindow - context.Now,
            NotificationUrgency.Normal,
            kind.StaleCutoff,
            DeliveredInQuietHours: false,
            HeldBy: null);

    private static IEnumerable<Reminder> OvertiredReminders(NotificationRecipient recipient, PlanContext context) =>
        recipient.Preferences.OvertiredWarning
        && context.WakeWindowIn(recipient.TimeZone) is { Window: { AwakeSince: { } since, LimitAt: { } limitAt } }
        && context.Now < limitAt + NotificationRules.OvertiredExpiryAfterLimit
            ? [OvertiredReminder(recipient, since, limitAt, context)]
            : [];

    private static Reminder OvertiredReminder(NotificationRecipient recipient, DateTimeOffset awakeSince, DateTimeOffset limitAt, PlanContext context) =>
        new(
            recipient,
            NotificationKind.OvertiredWarning,
            NotificationKey.ForOvertired(context.BabyId, awakeSince),
            limitAt - NotificationRules.OvertiredLead,
            new NotificationContent(context.BabyId, null, limitAt, context.NamesFor(recipient, medicationId: null)),
            limitAt + NotificationRules.OvertiredExpiryAfterLimit - context.Now,
            NotificationUrgency.Normal,
            NotificationRules.OvertiredStaleCutoff,
            DeliveredInQuietHours: false,
            HeldBy: null);

    private static IEnumerable<Reminder> DiaperReminders(NotificationRecipient recipient, PlanContext context) =>
        context.Diapers is { } diapers
            ? new[] { WetReminder(recipient, diapers, context), DirtyReminder(recipient, diapers, context) }.OfType<Reminder>()
            : [];

    private static Reminder? WetReminder(NotificationRecipient recipient, DiaperPrediction diapers, PlanContext context) =>
        recipient.Preferences.DiaperWetHeadsUp && diapers.WetExpectation() is { } expected && IsDiaperOpen(expected, context)
            ? DiaperReminder(recipient, NotificationKind.DiaperWetHeadsUp, NotificationKey.ForDiaperWet(context.BabyId, expected.AnchorAt), expected.Window.Expected - NotificationRules.DiaperWetLead, expected, context)
            : null;

    private static Reminder? DirtyReminder(NotificationRecipient recipient, DiaperPrediction diapers, PlanContext context) =>
        recipient.Preferences.DiaperDirtyHeadsUp && diapers.DirtyExpectation(context.Now) is { } expected && IsDiaperOpen(expected, context)
            ? DiaperReminder(recipient, NotificationKind.DiaperDirtyHeadsUp, NotificationKey.ForDiaperDirty(context.BabyId, expected.AnchorAt), DirtySendAt(expected), expected, context)
            : null;

    /// <summary>After a feed the heads-up goes at the lower lag; from the gaps a little before the expected time.</summary>
    private static DateTimeOffset DirtySendAt(DiaperExpectation expected) =>
        expected.Signal == DiaperSignal.DirtyAfterFeed ? expected.Window.Earliest : expected.Window.Expected - NotificationRules.DiaperDirtyGapLead;

    private static bool IsDiaperOpen(DiaperExpectation expected, PlanContext context) =>
        context.Now < expected.Window.Expected + NotificationRules.DiaperExpiryAfterExpected;

    private static Reminder DiaperReminder(NotificationRecipient recipient, NotificationKind kind, NotificationKey key, DateTimeOffset sendAt, DiaperExpectation expected, PlanContext context) =>
        new(
            recipient,
            kind,
            key,
            sendAt,
            new NotificationContent(context.BabyId, null, expected.Window.Expected, context.NamesFor(recipient, medicationId: null)),
            expected.Window.Expected + NotificationRules.DiaperExpiryAfterExpected - context.Now,
            NotificationUrgency.Normal,
            NotificationRules.DiaperStaleCutoff,
            DeliveredInQuietHours: false,
            context.DiaperHoldFor(recipient, kind));

    private static bool IsDiaperKind(NotificationKind kind) => kind is NotificationKind.DiaperWetHeadsUp or NotificationKind.DiaperDirtyHeadsUp;

    private static IEnumerable<Reminder> AppointmentRemindersFor(NotificationRecipient recipient, PlanContext context) =>
        recipient.Preferences.AppointmentReminders
            ? context.Appointments.Where(appointment => appointment.IsRemindableAt(context.Now)).Select(appointment => LatestDueAppointmentReminder(recipient, appointment, context)).OfType<Reminder>()
            : [];

    /// <summary>
    /// The reminder of <paramref name="appointment"/> to consider now: of its offsets that are due (send time reached),
    /// the latest one; an earlier offset that is still unsent is superseded by it (one notification per appointment, the
    /// nearest wording). <c>null</c> while none is due.
    /// </summary>
    private static Reminder? LatestDueAppointmentReminder(NotificationRecipient recipient, Appointment appointment, PlanContext context) =>
        AppointmentSendTimes(recipient, appointment)
            .Where(planned => planned.SendAt <= context.Now)
            .OrderByDescending(planned => planned.SendAt)
            .ThenBy(planned => planned.OffsetMinutes)
            .Select(planned => AppointmentReminder(recipient, appointment, planned, context))
            .FirstOrDefault();

    /// <summary>
    /// Each offset's send time: <c>start - offset</c>, moved to the end of the recipient's quiet hours when it falls inside
    /// them. Dropped when that is not before the start (a reminder never arrives at or after the visit) or when it was
    /// already past when the appointment was last changed (created, moved, restored): no late reminder for a time that is gone.
    /// </summary>
    private static IEnumerable<AppointmentSendTime> AppointmentSendTimes(NotificationRecipient recipient, Appointment appointment)
    {
        var clock = recipient.Clock();
        return appointment.Reminders.Minutes
            .Select(offset => new AppointmentSendTime(offset, recipient.QuietHours.EndOfQuietPeriod(appointment.StartsAt.AddMinutes(-offset), clock)))
            .Where(planned => planned.SendAt < appointment.StartsAt && planned.SendAt >= appointment.UpdatedAt);
    }

    private static Reminder AppointmentReminder(NotificationRecipient recipient, Appointment appointment, AppointmentSendTime planned, PlanContext context) =>
        new(
            recipient,
            NotificationKind.AppointmentReminder,
            NotificationKey.ForAppointment(appointment.Id, appointment.StartsAt, planned.OffsetMinutes),
            planned.SendAt,
            new NotificationContent(context.BabyId, null, appointment.StartsAt, context.NamesFor(recipient, medicationId: null), appointment.Id, planned.OffsetMinutes),
            appointment.StartsAt - context.Now,
            NotificationUrgency.Normal,
            NotificationRules.AppointmentStaleCutoff,
            DeliveredInQuietHours: true,
            HeldBy: null);

    private static IEnumerable<Reminder> DoctorSuggestionReminders(NotificationRecipient recipient, PlanContext context) =>
        recipient.Preferences.DoctorSuggestions && NotificationRules.CanReceiveDoctorSuggestions(recipient.Role)
            ? context.DoctorSuggestions.Where(suggestion => suggestion.IsOpenFor(recipient.UserId, context.Now)).Select(suggestion => DoctorSuggestionReminder(recipient, suggestion, context))
            : [];

    /// <summary>
    /// Sent at the creation (a <see cref="NotificationDelivery"/> then expires exactly 24 hours after it); inside quiet
    /// hours it is held and goes on the first tick after them while the suggestion is still new.
    /// </summary>
    private static Reminder DoctorSuggestionReminder(NotificationRecipient recipient, DoctorSuggestion suggestion, PlanContext context) =>
        new(
            recipient,
            NotificationKind.DoctorSuggestion,
            NotificationKey.ForDoctorSuggestion(suggestion.Source, suggestion.Id),
            suggestion.CreatedAt,
            NotificationContent.ForDoctorSuggestion(context.BabyId, suggestion.Source, suggestion.Id, suggestion.CreatedAt, context.NamesFor(recipient, medicationId: null)),
            NotificationRules.DoctorSuggestionLifetime,
            NotificationUrgency.Normal,
            NotificationRules.DoctorSuggestionLifetime,
            DeliveredInQuietHours: false,
            HeldBy: null);

    /// <summary>
    /// At most one diaper heads-up per recipient in a tick (the spacing rule also holds within a tick): the earliest due
    /// wins, wet before dirty on a tie; the other is skipped as <see cref="NotificationSkipReason.Spacing"/>.
    /// </summary>
    private static IReadOnlyList<ReminderOutcome> OneDiaperHeadsUpPerTick(IReadOnlyList<ReminderOutcome> outcomes)
    {
        var kept = outcomes
            .Where(outcome => outcome.Planned is { } planned && IsDiaperKind(planned.Kind))
            .GroupBy(outcome => outcome.Planned!.UserId)
            .Select(group => group.OrderBy(outcome => outcome.Planned!.DueAt).ThenBy(outcome => outcome.Planned!.Kind).First())
            .ToHashSet();
        return outcomes
            .Select(outcome => outcome.Planned is { } planned && IsDiaperKind(planned.Kind) && !kept.Contains(outcome) ? ReminderOutcome.Spaced(planned) : outcome)
            .ToArray();
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

    /// <summary>When the reminder <see cref="OffsetMinutes"/> before an appointment goes (quiet hours applied).</summary>
    private sealed record AppointmentSendTime(int OffsetMinutes, DateTimeOffset SendAt);

    /// <summary>One occurrence of a usual pattern window, placed with the recipient's offset at the tick.</summary>
    private sealed record PatternWindowAt(DateOnly Date, DateTimeOffset Start, DateTimeOffset End)
    {
        public static PatternWindowAt On(TimeOfDayPattern pattern, DateOnly date, TimeSpan utcOffset)
        {
            var local = pattern.WindowStartingOn(date);
            return new PatternWindowAt(date, new DateTimeOffset(local.Start, utcOffset), new DateTimeOffset(local.End, utcOffset));
        }
    }

    /// <summary>The fixed parts of a recurring-pattern reminder kind (belly pain, fussy).</summary>
    private sealed record PatternKind(
        NotificationKind Kind,
        Func<ReminderPreferences, bool> Wants,
        Func<Guid, DateOnly, NotificationKey> KeyFor,
        Func<DateTimeOffset, DateTimeOffset?, bool> IsHandled,
        TimeSpan Lead,
        TimeSpan StaleCutoff,
        TimeSpan ExpiryAfterWindow)
    {
        public static PatternKind BellyPain { get; } = new(
            NotificationKind.BellyPainPattern,
            preferences => preferences.BellyPainPattern,
            NotificationKey.ForBellyPain,
            BellyPainPatterns.IsHandled,
            NotificationRules.BellyPainLead,
            NotificationRules.BellyPainStaleCutoff,
            NotificationRules.BellyPainExpiryAfterWindow);

        public static PatternKind Fussy { get; } = new(
            NotificationKind.FussyPattern,
            preferences => preferences.FussyPattern,
            NotificationKey.ForFussy,
            FussyPatterns.IsHandled,
            NotificationRules.FussyPatternLead,
            NotificationRules.FussyPatternStaleCutoff,
            NotificationRules.FussyPatternExpiryAfterWindow);
    }

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

        /// <summary>A planned diaper heads-up held back because another one goes in the same tick.</summary>
        public static ReminderOutcome Spaced(PlannedNotification planned) =>
            new(null, new SkippedNotification(planned.UserId, planned.Kind, planned.DedupeKey, NotificationSkipReason.Spacing));
    }

    /// <summary>Lookups over the input, built once per pass.</summary>
    private sealed class PlanContext
    {
        private readonly IReadOnlyDictionary<TimeSpan, NotificationBabyState> _states;
        private readonly IReadOnlyDictionary<(Guid UserId, string BaseKey), NotificationAction> _actions;
        private readonly IReadOnlySet<(Guid UserId, string Key)> _delivered;
        private readonly NotificationNameSource? _names;
        private readonly PredictionOptions _options;
        private readonly IReadOnlyDictionary<string, TimeOfDayPatternState> _bellyPain;
        private readonly IReadOnlyDictionary<string, TimeOfDayPatternState> _fussy;
        private readonly IReadOnlyDictionary<string, WakeWindowState> _wakeWindows;
        private readonly ILookup<Guid, SentHeadsUp> _sentHeadsUps;

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
            _bellyPain = ByZone(input.BellyPainPatterns, state => state.TimeZone);
            _fussy = ByZone(input.FussyPatterns, state => state.TimeZone);
            _wakeWindows = ByZone(input.WakeWindows, state => state.TimeZone);
            Diapers = input.Diapers;
            Appointments = (input.Appointments ?? []).Where(appointment => appointment.BabyId == input.BabyId).ToArray();
            DoctorSuggestions = input.DoctorSuggestions ?? [];
            _sentHeadsUps = (input.SentHeadsUps ?? [])
                .Where(sent => sent.BabyId == input.BabyId)
                .DistinctBy(sent => (sent.UserId, sent.DedupeKey.Value))
                .ToLookup(sent => sent.UserId);
        }

        public DateTimeOffset Now { get; }

        public Guid BabyId { get; }

        public DiaperPrediction? Diapers { get; }

        /// <summary>The baby's appointments as loaded (upcoming within the reminder horizon).</summary>
        public IReadOnlyList<Appointment> Appointments { get; }

        /// <summary>The baby's doctor suggestions as loaded (the last 24 hours).</summary>
        public IReadOnlyList<DoctorSuggestion> DoctorSuggestions { get; }

        public NotificationBabyState? StateAt(TimeSpan utcOffset) => _states.GetValueOrDefault(utcOffset);

        public NotificationAction? ActionOf(Guid userId, NotificationKey baseKey) => _actions.GetValueOrDefault((userId, baseKey.Value));

        public bool WasDelivered(Guid userId, NotificationKey key) => _delivered.Contains((userId, key.Value));

        public TimeOfDayPatternState? PatternIn(PatternKind kind, NotificationTimeZone? zone) =>
            zone is { Value: { } id } ? (kind == PatternKind.Fussy ? _fussy : _bellyPain).GetValueOrDefault(id) : null;

        /// <summary>
        /// Why a diaper heads-up of <paramref name="kind"/> is held back for <paramref name="recipient"/>: another diaper
        /// heads-up less than an hour ago, or the kind's daily cap reached on the recipient's local day; else <c>null</c>.
        /// </summary>
        public NotificationSkipReason? DiaperHoldFor(NotificationRecipient recipient, NotificationKind kind)
        {
            var sent = _sentHeadsUps[recipient.UserId].ToArray();
            var today = LocalDateOf(recipient, Now);
            return sent.Any(headsUp => Now - headsUp.At < NotificationRules.DiaperSpacing) ? NotificationSkipReason.Spacing
                : sent.Count(headsUp => headsUp.Kind == kind && LocalDateOf(recipient, headsUp.At) == today) >= NotificationRules.DiaperDailyCap ? NotificationSkipReason.DailyCap
                : null;
        }

        private static DateOnly LocalDateOf(NotificationRecipient recipient, DateTimeOffset instant) =>
            recipient.TimeZone is { Value: not null } zone
                ? zone.Clock().DateOf(instant)
                : DateOnly.FromDateTime(instant.ToOffset(recipient.UtcOffset ?? TimeSpan.Zero).DateTime);

        public WakeWindowState? WakeWindowIn(NotificationTimeZone? zone) =>
            zone is { Value: { } id } ? _wakeWindows.GetValueOrDefault(id) : null;

        public NotificationNames? NamesFor(NotificationRecipient recipient, Guid? medicationId) =>
            recipient.ShowNames && _names is { } names
                ? NotificationNames.Create(names.BabyName, medicationId is { } id ? names.MedicationNamesById.GetValueOrDefault(id) : null)
                : null;

        private static IReadOnlyDictionary<string, TState> ByZone<TState>(IReadOnlyList<TState>? states, Func<TState, NotificationTimeZone> zoneOf) =>
            (states ?? [])
                .Where(state => zoneOf(state).Value is not null)
                .GroupBy(state => zoneOf(state).Value)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

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
