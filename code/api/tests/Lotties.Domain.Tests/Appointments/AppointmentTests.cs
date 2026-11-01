using Lotties.Domain.Appointments;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Appointments;

/// <summary>The appointment entity, its terms, the reminder offsets and the status rules.</summary>
public sealed class AppointmentTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = TestClock.Now;

    private static AppointmentTerms Terms(
        string? title = "Pediatrician",
        DateTimeOffset? startsAt = null,
        AppointmentStatus status = AppointmentStatus.Upcoming,
        int? duration = 30,
        AppointmentReminders? reminders = null,
        string? outcome = null) =>
        AppointmentTerms.Create(title, AppointmentType.Consultation, startsAt ?? Now.AddDays(3), duration, " Clinic ", "Dr. Ana", null, outcome, status, reminders ?? AppointmentReminders.Default);

    private static Appointment NewAppointment(AppointmentTerms? terms = null, Guid? babyId = null, DateTimeOffset? clientUpdatedAt = null) =>
        Appointment.Create(Guid.NewGuid(), babyId ?? BabyId, terms ?? Terms(), UserId, Now, clientUpdatedAt);

    [Fact]
    public void Create_TrimsTextKeepsTheTermsAndStampsBothTimes()
    {
        var appointment = Appointment.Create(Guid.NewGuid(), BabyId, Terms(title: "  Vaccines 2 months "), UserId, Now);

        Assert.Equal(("Vaccines 2 months", "Clinic", "Dr. Ana", AppointmentStatus.Upcoming), (appointment.Title, appointment.Location, appointment.DoctorName, appointment.Status));
        Assert.Equal([1440, 120], appointment.Reminders.Minutes);
        Assert.Equal((Now, Now), (appointment.UpdatedAt, appointment.ClientUpdatedAt));
    }

    [Theory]
    [InlineData(null, "title")]
    [InlineData("   ", "title")]
    [InlineData("123456789012345678901234567890123456789012345678901234567890123456789012345678901", "title")]
    [InlineData("Ti\u0000tle", "title")]
    public void TermsCreate_InvalidTitle_ThrowsForTheField(string? title, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => Terms(title: title));

        Assert.Equal(field, exception.Field);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(481)]
    public void TermsCreate_DurationOutOfRange_ThrowsForDurationMinutes(int minutes)
    {
        Assert.Equal("durationMinutes", Assert.Throws<DomainValidationException>(() => Terms(duration: minutes)).Field);
    }

    [Fact]
    public void TermsCreate_TooLongTextOrDatesOutOfRange_ThrowForTheField()
    {
        var location = Assert.Throws<DomainValidationException>(() =>
            AppointmentTerms.Create("Visit", AppointmentType.Other, Now, null, new string('x', 201), null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.None));
        var doctor = Assert.Throws<DomainValidationException>(() =>
            AppointmentTerms.Create("Visit", AppointmentType.Other, Now, null, null, new string('x', 81), null, null, AppointmentStatus.Upcoming, AppointmentReminders.None));
        var outcome = Assert.Throws<DomainValidationException>(() => Terms(outcome: new string('x', 2001)));
        var early = Assert.Throws<DomainValidationException>(() => Terms(startsAt: new DateTimeOffset(1999, 12, 31, 23, 0, 0, TimeSpan.Zero)));
        var late = Assert.Throws<DomainValidationException>(() => Terms(startsAt: new DateTimeOffset(2101, 1, 1, 0, 0, 0, TimeSpan.Zero)));

        Assert.Equal(["location", "doctorName", "outcome", "startsAt", "startsAt"], new[] { location, doctor, outcome, early, late }.Select(exception => exception.Field));
    }

    [Fact]
    public void TermsCreate_UnknownTypeOrStatus_ThrowsForTheField()
    {
        var type = Assert.Throws<DomainValidationException>(() =>
            AppointmentTerms.Create("Visit", (AppointmentType)42, Now, null, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.None));
        var status = Assert.Throws<DomainValidationException>(() =>
            AppointmentTerms.Create("Visit", AppointmentType.Exam, Now, null, null, null, null, null, (AppointmentStatus)7, AppointmentReminders.None));

        Assert.Equal(("type", "status"), (type.Field, status.Field));
    }

    [Fact]
    public void TermsCreate_StartInAnotherOffset_IsStoredAsTheSameUtcInstant()
    {
        var terms = Terms(startsAt: new DateTimeOffset(2026, 1, 13, 15, 30, 0, TimeSpan.FromHours(-3)));

        Assert.Equal((new DateTimeOffset(2026, 1, 13, 18, 30, 0, TimeSpan.Zero), TimeSpan.Zero), (terms.StartsAt, terms.StartsAt.Offset));
    }

    [Fact]
    public void Reminders_AbsentIsOneDayAndTwoHours_EmptyIsNone_AndTheyAreStoredLargestFirst()
    {
        var sorted = AppointmentReminders.From([30, 10080, 120]);

        Assert.Equal([1440, 120], AppointmentReminders.From(null).Minutes);
        Assert.Empty(AppointmentReminders.From([]).Minutes);
        Assert.Equal([10080, 120, 30], sorted.Minutes);
        Assert.Equal("10080,120,30", sorted.ToStorage());
        Assert.Equal(sorted, AppointmentReminders.FromStorage("10080,120,30"));
        Assert.Equal(AppointmentReminders.None, AppointmentReminders.FromStorage(string.Empty));
    }

    [Theory]
    [InlineData(60)]
    [InlineData(0)]
    [InlineData(-30)]
    public void Reminders_UnknownOffset_ThrowsForTheField(int offset)
    {
        Assert.Equal("reminderOffsetsMinutes", Assert.Throws<DomainValidationException>(() => AppointmentReminders.From([1440, offset])).Field);
    }

    [Fact]
    public void Reminders_RepeatedOffset_ThrowsForTheField()
    {
        Assert.Equal("reminderOffsetsMinutes", Assert.Throws<DomainValidationException>(() => AppointmentReminders.From([120, 120])).Field);
    }

    [Fact]
    public void Create_PastStart_IsAllowedForAVisitLoggedAfterTheFact()
    {
        var appointment = NewAppointment(Terms(startsAt: Now.AddDays(-2), status: AppointmentStatus.Done, outcome: "All good"));

        Assert.Equal((AppointmentStatus.Done, "All good"), (appointment.Status, appointment.Outcome));
    }

    [Fact]
    public void Create_DoneBeforeTheStart_IsRefused()
    {
        var exception = Assert.Throws<AppointmentNotStartedException>(() => NewAppointment(Terms(startsAt: Now.AddHours(1), status: AppointmentStatus.Done)));

        Assert.Equal("appointment_not_started", exception.Code);
        Assert.Equal("status", exception.Details["field"]);
    }

    [Theory]
    [InlineData(5, true)]
    [InlineData(6, false)]
    public void Edit_DoneJustBeforeTheStart_IsAllowedWithinTheClockSkew(int minutesAhead, bool allowed)
    {
        var appointment = NewAppointment(Terms(startsAt: Now.AddMinutes(minutesAhead)));

        var exception = Record.Exception(() => appointment.Edit(Terms(startsAt: Now.AddMinutes(minutesAhead), status: AppointmentStatus.Done), Now));

        Assert.Equal(allowed, exception is null);
    }

    [Fact]
    public void Edit_StatusTransitions_UpcomingDoneUpcomingCancelledUpcoming()
    {
        var start = Now.AddHours(-1);
        var appointment = NewAppointment(Terms(startsAt: start));

        var seen = new List<AppointmentStatus>();
        foreach (var status in new[] { AppointmentStatus.Done, AppointmentStatus.Upcoming, AppointmentStatus.Cancelled, AppointmentStatus.Upcoming })
        {
            appointment.Edit(Terms(startsAt: start, status: status), Now);
            seen.Add(appointment.Status);
        }

        Assert.Equal([AppointmentStatus.Done, AppointmentStatus.Upcoming, AppointmentStatus.Cancelled, AppointmentStatus.Upcoming], seen);
    }

    [Fact]
    public void Edit_MovingADoneVisitIntoTheFuture_IsRefusedAndChangesNothing()
    {
        var appointment = NewAppointment(Terms(startsAt: Now.AddHours(-1), status: AppointmentStatus.Done));

        Assert.Throws<AppointmentNotStartedException>(() => appointment.Edit(Terms(startsAt: Now.AddDays(1), status: AppointmentStatus.Done), Now.AddMinutes(1)));

        Assert.Equal((Now.AddHours(-1), Now), (appointment.StartsAt, appointment.UpdatedAt));
    }

    [Fact]
    public void Edit_SameTerms_ChangesNothingAndAChangeStampsBothTimes()
    {
        var appointment = NewAppointment(clientUpdatedAt: Now.AddMinutes(-30));
        var later = Now.AddMinutes(10);

        appointment.Edit(Terms(), later, later);
        var unchanged = (appointment.UpdatedAt, appointment.ClientUpdatedAt);
        appointment.Edit(Terms(title: "Pediatrician (3 months)"), later, later.AddMinutes(-1));

        Assert.Equal((Now, Now.AddMinutes(-30)), unchanged);
        Assert.Equal(("Pediatrician (3 months)", later, later.AddMinutes(-1)), (appointment.Title, appointment.UpdatedAt, appointment.ClientUpdatedAt));
    }

    [Fact]
    public void DecideUpsert_AnotherBaby_Throws()
    {
        Assert.Throws<AppointmentBabyMismatchException>(() => NewAppointment().DecideUpsert(Guid.NewGuid(), null, Now));
    }

    [Fact]
    public void DecideUpsert_OlderClientTime_IsStaleAndEqualOrNewerApplies()
    {
        var appointment = NewAppointment(clientUpdatedAt: Now.AddMinutes(-10));

        Assert.Equal(AppointmentUpsertDecision.IgnoreStale, appointment.DecideUpsert(BabyId, Now.AddMinutes(-11), Now));
        Assert.Equal(AppointmentUpsertDecision.Apply, appointment.DecideUpsert(BabyId, Now.AddMinutes(-10), Now));
        Assert.Equal(AppointmentUpsertDecision.Apply, appointment.DecideUpsert(BabyId, null, Now));
    }

    [Fact]
    public void IsRemindableAt_OnlyUpcomingAndNotStarted()
    {
        var upcoming = NewAppointment(Terms(startsAt: Now.AddHours(2)));
        var cancelled = NewAppointment(Terms(startsAt: Now.AddHours(2), status: AppointmentStatus.Cancelled));

        Assert.True(upcoming.IsRemindableAt(Now));
        Assert.False(upcoming.IsRemindableAt(Now.AddHours(2)));
        Assert.False(cancelled.IsRemindableAt(Now));
    }
}
