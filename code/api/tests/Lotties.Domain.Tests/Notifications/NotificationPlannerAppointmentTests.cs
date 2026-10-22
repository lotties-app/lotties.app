using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Patterns;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>The <c>appointment_reminder</c> rules of the planner (São Paulo, March 2026, quiet hours 22:00-07:00 unless stated).</summary>
public sealed class NotificationPlannerAppointmentTests
{
    private static readonly Guid UserId = Guid.NewGuid();

    /// <summary>Starts on 4 March at 15:30; created on 1 March at 09:00 with the default offsets (1 day, 2 hours).</summary>
    private static readonly DateTimeOffset Start = At(15, 30, day: 4);

    private static readonly NotificationRecipient Mom = Recipient(doseDue: false);

    private static Appointment Visit(
        DateTimeOffset? start = null,
        AppointmentStatus status = AppointmentStatus.Upcoming,
        DateTimeOffset? changedAt = null,
        params int[] offsets) =>
        Appointment.Create(
            Guid.NewGuid(),
            BabyId,
            AppointmentTerms.Create("Pediatrician", AppointmentType.Consultation, start ?? Start, 30, "Clinic", "Dr. Ana", "Bring the vaccine card", null, status, offsets.Length == 0 ? AppointmentReminders.Default : AppointmentReminders.From(offsets)),
            UserId,
            changedAt ?? At(9, 0, day: 1));

    private static NotificationPlan PlanAt(DateTimeOffset now, Appointment appointment, NotificationRecipient? recipient = null, NotificationNameSource? names = null, params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? Mom], [], delivered: delivered, names: names, appointments: [appointment]);

    private static NotificationKey KeyOf(Appointment appointment, int offset) => NotificationKey.ForAppointment(appointment.Id, appointment.StartsAt, offset);

    [Fact]
    public void Plan_OneDayBefore_PlansTheReminderKeyedByTheStartAndTheOffset()
    {
        var appointment = Visit();

        var planned = Assert.Single(PlanAt(At(15, 30, day: 3), appointment).Notifications);

        Assert.Equal($"appt:{appointment.Id:N}:202603041830:1440", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.AppointmentReminder, NotificationUrgency.Normal, At(15, 30, day: 3)), (planned.Kind, planned.Urgency, planned.DueAt));
        Assert.Equal(new NotificationContent(BabyId, null, Start, null, appointment.Id, 1440), planned.Content);
        Assert.Equal(TimeSpan.FromDays(1), planned.TimeToLive);
        Assert.Equal("appointment_reminder", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_BeforeTheSendTimeOrAlreadyClaimed_PlansNothing()
    {
        var appointment = Visit();

        var early = PlanAt(At(15, 29, day: 3), appointment);
        var claimed = PlanAt(At(15, 35, day: 3), appointment, delivered: new DeliveredNotification(MomId, KeyOf(appointment, 1440)));

        Assert.All(new[] { early, claimed }, plan => Assert.Empty(plan.Notifications));
        Assert.All(new[] { early, claimed }, plan => Assert.Empty(plan.Skipped));
    }

    [Fact]
    public void Plan_TwoHoursBefore_SendsTheSecondOffsetOnce()
    {
        var appointment = Visit();
        var sentDayBefore = new DeliveredNotification(MomId, KeyOf(appointment, 1440));

        var plan = PlanAt(At(13, 30, day: 4), appointment, delivered: sentDayBefore);
        var after = PlanAt(At(13, 31, day: 4), appointment, delivered: [sentDayBefore, new DeliveredNotification(MomId, KeyOf(appointment, 120))]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal((KeyOf(appointment, 120), 120, TimeSpan.FromHours(2)), (planned.BaseKey, planned.Content.ReminderOffsetMinutes, planned.TimeToLive));
        Assert.Empty(after.Notifications);
    }

    [Fact]
    public void Plan_AnUnsentEarlierOffset_IsSupersededByTheNearestDueOne()
    {
        var appointment = Visit(offsets: [10080, 1440, 120]);

        var plan = PlanAt(At(13, 40, day: 4), appointment);

        Assert.Equal([KeyOf(appointment, 120)], plan.Notifications.Select(planned => planned.BaseKey));
    }

    [Fact]
    public void Plan_OffsetsAlreadyPastWhenTheAppointmentWasCreated_AreSkipped()
    {
        var appointment = Visit(changedAt: At(14, 0, day: 4), offsets: [1440, 120, 30]);

        var right = PlanAt(At(14, 1, day: 4), appointment);
        var later = PlanAt(At(15, 0, day: 4), appointment);

        Assert.Empty(right.Notifications);
        Assert.Equal([KeyOf(appointment, 30)], later.Notifications.Select(planned => planned.BaseKey));
    }

    [Theory]
    [InlineData(AppointmentStatus.Cancelled)]
    [InlineData(AppointmentStatus.Done)]
    public void Plan_CancelledOrDone_NeverReminds(AppointmentStatus status)
    {
        var start = status == AppointmentStatus.Done ? At(15, 31, day: 3) : Start;
        var appointment = Visit(start: start, status: status, changedAt: At(16, 0, day: 3));

        Assert.Empty(PlanAt(At(15, 30, day: 3), appointment).Notifications);
        Assert.Empty(PlanAt(start.AddMinutes(-30), appointment).Notifications);
    }

    [Fact]
    public void Plan_InsideQuietHours_IsDelayedToTheirEnd()
    {
        var appointment = Visit(start: At(8, 0, day: 4), offsets: [120]);

        var atSendTime = PlanAt(At(6, 0, day: 4), appointment);
        var stillQuiet = PlanAt(At(6, 59, day: 4), appointment);
        var quietOver = PlanAt(At(7, 0, day: 4), appointment);

        Assert.Empty(atSendTime.Notifications);
        Assert.Empty(stillQuiet.Notifications);
        var planned = Assert.Single(quietOver.Notifications);
        Assert.Equal((KeyOf(appointment, 120), At(7, 0, day: 4), TimeSpan.FromHours(1)), (planned.BaseKey, planned.DueAt, planned.TimeToLive));
    }

    [Fact]
    public void Plan_QuietHoursEndingAfterTheStart_SkipsTheReminder()
    {
        var appointment = Visit(start: At(6, 45, day: 4), offsets: [30]);

        Assert.Empty(PlanAt(At(6, 15, day: 4), appointment).Notifications);
        Assert.Empty(PlanAt(At(6, 44, day: 4), appointment).Notifications);
    }

    [Fact]
    public void Plan_TwoOffsetsDelayedToTheSameEndOfQuietHours_SendOnlyTheNearestWording()
    {
        var appointment = Visit(start: At(7, 20, day: 4), offsets: [120, 30]);

        var plan = PlanAt(At(7, 0, day: 4), appointment);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(30, planned.Content.ReminderOffsetMinutes);
    }

    [Fact]
    public void Plan_QuietHoursOff_SendsInTheNight()
    {
        var appointment = Visit(start: At(8, 0, day: 4), offsets: [120]);
        var recipient = Recipient(doseDue: false, quietHours: QuietHours.Create(false, new TimeOnly(22, 0), new TimeOnly(7, 0)));

        Assert.Single(PlanAt(At(6, 0, day: 4), appointment, recipient).Notifications);
    }

    [Fact]
    public void Plan_StartMoved_PlansTheRemindersOfTheNewTime()
    {
        var appointment = Visit();
        var oldKey = KeyOf(appointment, 1440);
        var moved = At(10, 0, day: 5);
        appointment.Edit(
            AppointmentTerms.Create("Pediatrician", AppointmentType.Consultation, moved, 30, "Clinic", "Dr. Ana", null, null, AppointmentStatus.Upcoming, AppointmentReminders.Default),
            At(16, 0, day: 3));

        var plan = PlanAt(At(10, 0, day: 4), appointment, delivered: new DeliveredNotification(MomId, oldKey));

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(NotificationKey.ForAppointment(appointment.Id, moved, 1440), planned.BaseKey);
        Assert.NotEqual(oldKey, planned.BaseKey);
    }

    [Theory]
    [InlineData(29, true)]
    [InlineData(31, false)]
    public void Plan_StaleCutoff_IsThirtyMinutesAfterTheSendTime(int minutesLate, bool planned)
    {
        var plan = PlanAt(At(15, 30, day: 3).AddMinutes(minutesLate), Visit());

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(!planned, plan.Skipped.Any(skipped => skipped.Reason == NotificationSkipReason.Stale));
    }

    [Fact]
    public void Plan_DefaultPreferencesCaregiverOffViewerAndNoZone()
    {
        var appointment = Visit();
        var now = At(15, 30, day: 3);

        var byDefault = PlanAt(now, appointment, Recipient(doseDue: false));
        var caregiver = PlanAt(now, appointment, Recipient(role: BabyRole.Caregiver, doseDue: false));
        var off = PlanAt(now, appointment, Recipient(doseDue: false, appointmentReminders: false));
        var viewer = PlanAt(now, appointment, Recipient(role: BabyRole.Viewer, doseDue: false));
        var noZone = PlanAt(now, appointment, Recipient(doseDue: false, withoutZone: true));

        Assert.Single(byDefault.Notifications);
        Assert.Single(caregiver.Notifications);
        Assert.All(new[] { off, viewer, noZone }, plan => Assert.Empty(plan.Notifications));
        Assert.True(ReminderPreferences.Default.AppointmentReminders);
    }

    [Fact]
    public void Plan_DoctorWithTheSwitchOn_NeverGetsAnAppointmentReminder()
    {
        var doctor = Recipient(role: BabyRole.Doctor, doseDue: false, appointmentReminders: true);

        var plan = PlanAt(At(15, 30, day: 3), Visit(), doctor);

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_NamesOn_CarryTheBabyNameOnly()
    {
        var names = new NotificationNameSource("Lia", new Dictionary<Guid, string>());

        var planned = Assert.Single(PlanAt(At(15, 30, day: 3), Visit(), Recipient(doseDue: false, showNames: true), names).Notifications);

        Assert.Equal(("Lia", null), (planned.Content.Names!.Baby, planned.Content.Names.Medication));
    }

    [Fact]
    public void Plan_AppointmentOfAnotherBaby_IsIgnored()
    {
        var other = Appointment.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            AppointmentTerms.Create("Visit", AppointmentType.Other, Start, null, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.Default),
            UserId,
            At(9, 0, day: 1));

        Assert.Empty(PlanAt(At(15, 30, day: 3), other).Notifications);
    }

    [Fact]
    public void Plan_LisbonOnTheNightTheClocksGoForward_DelaysToSevenSummerTime()
    {
        var lisbon = NotificationTimeZone.From("Europe/Lisbon");
        var start = new DateTimeOffset(2026, 3, 29, 8, 0, 0, TimeSpan.FromHours(1));
        var appointment = Visit(start: start, offsets: [120]);
        var recipient = Recipient(doseDue: false, offset: TimeSpan.FromHours(1), zone: lisbon);

        var early = PlanAt(new DateTimeOffset(2026, 3, 29, 6, 59, 0, TimeSpan.FromHours(1)), appointment, recipient);
        var due = PlanAt(new DateTimeOffset(2026, 3, 29, 7, 0, 0, TimeSpan.FromHours(1)), appointment, recipient);

        Assert.Empty(early.Notifications);
        Assert.Equal(new DateTimeOffset(2026, 3, 29, 6, 0, 0, TimeSpan.Zero), Assert.Single(due.Notifications).DueAt);
    }

    [Fact]
    public void Key_Appointment_RoundTripsThroughASnoozeAndIsNotADose()
    {
        var appointment = Visit();
        var key = NotificationKey.From(KeyOf(appointment, 120).Snoozed(1).Value);

        Assert.True(key.TryGetAppointment(out var id, out var startsAt, out var offset));
        Assert.Equal((appointment.Id, Start.ToUniversalTime(), 120), (id, startsAt, offset));
        Assert.False(key.TryGetDose(out _, out _));
        Assert.False(NotificationKey.ForNap(BabyId, Start).TryGetAppointment(out _, out _, out _));
        Assert.False(NotificationKey.TryFrom($"appt:{appointment.Id:N}:202603041830:0", out _));
    }

    [Theory]
    [InlineData("America/Sao_Paulo", "2026-03-02T02:00:00Z", "2026-03-02T10:00:00Z")]
    [InlineData("America/Sao_Paulo", "2026-03-02T12:00:00Z", "2026-03-02T12:00:00Z")]
    [InlineData("Europe/Lisbon", "2026-03-29T04:00:00Z", "2026-03-29T06:00:00Z")]
    [InlineData("America/New_York", "2026-11-01T08:00:00Z", "2026-11-01T12:00:00Z")]
    [InlineData("America/New_York", "2026-03-08T05:30:00Z", "2026-03-08T11:00:00Z")]
    public void QuietHours_EndOfQuietPeriod_ReadsTheLocalClockAcrossMidnightAndDaylightSaving(string zone, string instant, string expected)
    {
        var clock = NotificationTimeZone.From(zone).Clock();

        var end = QuietHours.Default.EndOfQuietPeriod(DateTimeOffset.Parse(instant, System.Globalization.CultureInfo.InvariantCulture), clock);

        Assert.Equal(DateTimeOffset.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), end);
    }

    [Fact]
    public void QuietHours_EndOfQuietPeriod_DaytimeQuietHoursEndTheSameDay()
    {
        var quiet = QuietHours.Create(true, new TimeOnly(13, 0), new TimeOnly(15, 0));

        var end = quiet.EndOfQuietPeriod(At(14, 0), LocalClock.WithOffset(SaoPaulo));

        Assert.Equal(At(15, 0), end);
    }
}
