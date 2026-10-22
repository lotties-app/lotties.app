using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Prescriptions;

public sealed class DayPartWindowsTests
{
    [Fact]
    public void Windows_CoverTheWholeDayWithoutGaps()
    {
        var ends = DayPartWindows.All.Select(DayPartWindows.EndOf).ToArray();
        var nextStarts = DayPartWindows.All.Skip(1).Append(DayPart.Morning).Select(DayPartWindows.StartOf).ToArray();

        Assert.Equal(nextStarts, ends);
        Assert.Equal(["05:00-12:00", "12:00-18:00", "18:00-22:00", "22:00-05:00"], DayPartWindows.All.Select(DayPartWindows.WindowText));
    }

    [Fact]
    public void DefaultReminders_LieInsideTheirWindows()
    {
        Assert.All(DayPartWindows.All, part => Assert.Equal(part, DayPartWindows.PartAt(DayPartWindows.DefaultReminderOf(part))));
    }

    [Theory]
    [InlineData("morning", DayPart.Morning)]
    [InlineData("night", DayPart.Night)]
    public void TryParse_KnownCode_ReturnsThePart(string code, DayPart expected)
    {
        Assert.True(DayPartWindows.TryParse(code, out var part));
        Assert.Equal(expected, part);
        Assert.Equal(code, DayPartWindows.CodeOf(part));
    }

    [Theory]
    [InlineData("Morning")]
    [InlineData("dawn")]
    [InlineData("")]
    [InlineData(null)]
    public void TryParse_UnknownCode_IsFalse(string? code)
    {
        Assert.False(DayPartWindows.TryParse(code, out _));
    }

    [Fact]
    public void Of_SameWallClockAcrossDaylightSavingTime_IsTheSamePart()
    {
        var zone = NotificationTimeZone.From("America/New_York");
        var beforeChange = new DateTimeOffset(2026, 3, 7, 13, 30, 0, TimeSpan.Zero);
        var afterChange = new DateTimeOffset(2026, 3, 8, 12, 30, 0, TimeSpan.Zero);

        var before = DayPartWindows.Of(beforeChange, zone.OffsetAt(beforeChange));
        var after = DayPartWindows.Of(afterChange, zone.OffsetAt(afterChange));

        Assert.Equal(new DayPartOfDay(new DateOnly(2026, 3, 7), DayPart.Morning), before);
        Assert.Equal(new DayPartOfDay(new DateOnly(2026, 3, 8), DayPart.Morning), after);
    }

    [Fact]
    public void InstantIn_NightTimeAfterMidnight_FallsOnTheNextDate()
    {
        var instant = DayPartWindows.InstantIn(new DateOnly(2026, 3, 2), DayPart.Night, new TimeOnly(1, 30), TimeSpan.FromHours(-3));

        Assert.Equal(new DateTimeOffset(2026, 3, 3, 1, 30, 0, TimeSpan.FromHours(-3)), instant);
    }
}

public sealed class DayPartScheduleTests
{
    private static readonly Guid MedicationA = Guid.NewGuid();

    [Fact]
    public void DayPartSet_Parse_KeepsTheOrderOfTheDay()
    {
        var parts = DayPartSet.Parse(["night", "morning"]);

        Assert.Equal([DayPart.Morning, DayPart.Night], parts.Values);
        Assert.Equal(["morning", "night"], parts.ToCodes());
        Assert.Equal(DayPartSet.Parse(["morning", "night"]), parts);
    }

    [Theory]
    [InlineData("")]
    [InlineData("morning,morning")]
    [InlineData("dawn")]
    [InlineData("Morning")]
    public void DayPartSet_Parse_Invalid_ThrowsForDayParts(string codes)
    {
        var list = codes.Length == 0 ? [] : codes.Split(',');

        var exception = Assert.Throws<DomainValidationException>(() => DayPartSet.Parse(list));

        Assert.Equal("dayParts", exception.Field);
    }

    [Theory]
    [InlineData("morning", "05:00")]
    [InlineData("morning", "11:59")]
    [InlineData("evening", "21:59")]
    [InlineData("night", "22:00")]
    [InlineData("night", "01:30")]
    [InlineData("night", "04:59")]
    public void DayPartReminder_InsideTheWindow_IsKept(string part, string time)
    {
        var reminder = DayPartReminder.Parse(part, time);

        Assert.Equal(time, reminder.TimeText);
    }

    [Theory]
    [InlineData("morning", "12:00")]
    [InlineData("morning", "04:59")]
    [InlineData("night", "21:00")]
    [InlineData("night", "05:00")]
    [InlineData("night", "8h")]
    [InlineData("dawn", "08:00")]
    public void DayPartReminder_OutsideTheWindowOrMalformed_ThrowsForReminders(string part, string time)
    {
        var exception = Assert.Throws<DomainValidationException>(() => DayPartReminder.Parse(part, time));

        Assert.Equal("dayPartReminders", exception.Field);
    }

    [Fact]
    public void DayPartReminders_SamePartTwice_Throws()
    {
        var exception = Assert.Throws<DomainValidationException>(() => DayPartReminders.Create([DayPartReminder.Parse("morning", "08:00"), DayPartReminder.Parse("morning", "09:00")]));

        Assert.Equal("dayPartReminders", exception.Field);
    }

    [Fact]
    public void Create_ScheduledByParts_HasNoOwnIntervalAndKeepsTheReminders()
    {
        var schedule = PartsSchedule(["morning", "night"], "night=22:30");

        Assert.Equal((PrescriptionKind.Scheduled, (TimeSpan?)null), (schedule.Kind, schedule.OwnInterval));
        Assert.Equal(new TimeOnly(22, 30), schedule.DayPartReminders!.TimeOf(DayPart.Night));
        Assert.Null(schedule.DayPartReminders.TimeOf(DayPart.Morning));
    }

    [Fact]
    public void Create_PartsAndTimesOfDay_ThrowsForExactlyOneShape()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00"]), null, null, null, null, DayPartSet.Parse(["morning"])));

        Assert.Equal("timesOfDay", exception.Field);
    }

    [Fact]
    public void Create_RemindersWithoutParts_ThrowsForReminders()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00"]), null, null, null, null, null, DayPartReminders.FromStorage("morning=08:00")));

        Assert.Equal("dayPartReminders", exception.Field);
    }

    [Fact]
    public void Create_ReminderForAPartNotChosen_ThrowsForReminders()
    {
        var exception = Assert.Throws<DomainValidationException>(() => PartsSchedule(["morning"], "night=22:00"));

        Assert.Equal("dayPartReminders", exception.Field);
    }

    [Fact]
    public void Create_AsNeededWithParts_ThrowsForDayParts()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, 240, null, null, DayPartSet.Parse(["morning"])));

        Assert.Equal("dayParts", exception.Field);
    }

    [Fact]
    public void Terms_SamePartsAndReminders_AreEqualSoAReplayChangesNothing()
    {
        var first = Terms(MedicationA, PartsSchedule(["night", "morning"], "night=22:00,morning=08:00"));
        var second = Terms(MedicationA, PartsSchedule(["morning", "night"], "morning=08:00,night=22:00"));

        Assert.Equal(first, second);
        Assert.NotEqual(first, Terms(MedicationA, PartsSchedule(["morning", "night"], "morning=08:00,night=23:00")));
    }
}

public sealed class DayPartStatusTests
{
    private const int SaoPaulo = -180;
    private static readonly Guid MedicationA = Guid.NewGuid();
    private static readonly Guid MedicationB = Guid.NewGuid();

    [Fact]
    public void Calculate_ByParts_HasNoSlotTimesSoNoClockReminder()
    {
        var status = Calculate([ByParts(MedicationA, ["morning"])], [], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo).Single();

        Assert.Equal(((DateTimeOffset?)null, (TimeSpan?)null, (DateTimeOffset?)null), (status.NextScheduledAt, status.OverdueBy, status.OverdueSlotAt));
        Assert.True(status.AvailableNow);
    }

    [Fact]
    public void Calculate_OtherSchedules_HaveNoDayParts()
    {
        var statuses = Calculate([AtTimes(MedicationA, ["08:00"]), AsNeeded(MedicationB, 240)], [], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo);

        Assert.All(statuses, status => Assert.Null(status.DayParts));
    }

    [Fact]
    public void Calculate_GuardAgainstDoubleDose_AlreadyGivenOnlyInsideThatPart()
    {
        var prescription = ByParts(MedicationA, ["morning", "evening"]);
        var dose = Dose(Local(2026, 3, 2, 8, 12, SaoPaulo), MedicationA, prescription.Id);

        var morning = Calculate([prescription], [dose], Local(2026, 3, 2, 11, 0, SaoPaulo), SaoPaulo).Single().DayParts!;
        var evening = Calculate([prescription], [dose], Local(2026, 3, 2, 19, 0, SaoPaulo), SaoPaulo).Single().DayParts!;

        Assert.Equal(DayPartGuard.AlreadyGiven, morning.Guard);
        Assert.Equal((DayPartGuard.None, DayPart.Evening, DayPartState.Due), (evening.Guard, evening.Current!.Part, evening.Current.State));
    }

    [Fact]
    public void Calculate_GroupMemberInterval_StillAppliesToADayPartPrescription()
    {
        var byParts = ByParts(MedicationA, ["morning"], group: "colic");
        var asNeeded = AsNeeded(MedicationB, 480, group: "colic");

        var status = Calculate([byParts, asNeeded], [Dose(Local(2026, 3, 2, 6, 0, SaoPaulo), MedicationB)], Local(2026, 3, 2, 9, 0, SaoPaulo), SaoPaulo)
            .Single(candidate => candidate.Prescription.Id == byParts.Id);

        Assert.Equal((false, Local(2026, 3, 2, 14, 0, SaoPaulo)), (status.AvailableNow, status.AvailableAt));
        Assert.Equal(DayPartState.Due, status.DayParts!.Current!.State);
    }
}
