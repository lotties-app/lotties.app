namespace Lotties.Domain.Prescriptions;

/// <summary>The state of one chosen part of the day on one routine day.</summary>
public enum DayPartState
{
    /// <summary>The window has not started.</summary>
    Upcoming,

    /// <summary>The window is open and no dose was logged in it yet.</summary>
    Due,

    /// <summary>A dose of the medication was logged inside the window.</summary>
    Given,

    /// <summary>The window ended without a dose. Informative only: nothing is sent or done about it.</summary>
    Missed,
}

/// <summary>
/// What a client asks before logging a dose of a part-of-the-day prescription now (never a block: "Log anyway" records
/// <c>override</c>, like an early dose).
/// </summary>
public enum DayPartGuard
{
    /// <summary>Nothing to ask: the current part is chosen and has no dose yet, or the course is not in progress.</summary>
    None,

    /// <summary>The current part of the day already has a dose.</summary>
    AlreadyGiven,

    /// <summary>Now is in none of the chosen parts (e.g. a morning prescription in the afternoon).</summary>
    OutsideParts,
}

/// <summary>
/// One chosen part on one routine day: its window, its state, the first dose logged in it (<see cref="GivenAt"/>) and
/// how many, and the reminder instant when the prescription has a reminder for this part.
/// </summary>
public sealed record DayPartSlot(DayPartWindow Window, DayPartState State, DateTimeOffset? GivenAt, int DoseCount, DateTimeOffset? ReminderAt)
{
    public DayPart Part => Window.Part;
}

/// <summary>
/// The part-of-the-day side of a prescription's status at one instant (see <see cref="MedicationStatusCalculator"/>).
/// <see cref="Parts"/>: the chosen parts of the current routine day <see cref="Day"/> (empty outside the course; a part
/// that ended before the prescription was created and has no dose is left out). <see cref="Current"/>: the chosen part
/// whose window contains now. <see cref="Next"/>: the earliest chosen part that is due now or starts later (today's or
/// the next routine day's, inside the course).
/// </summary>
public sealed record DayPartsStatus(DateOnly Day, IReadOnlyList<DayPartSlot> Parts, DayPartSlot? Current, DayPartSlot? Next, DayPartGuard Guard)
{
    /// <summary>How many of today's parts have a dose ("1 of 2 today").</summary>
    public int GivenCount => Parts.Count(slot => slot.State == DayPartState.Given);
}

/// <summary>Slot states of prescriptions given by part of the day (see <see cref="MedicationStatusCalculator"/>).</summary>
internal static class DayPartSlots
{
    public static DayPartsStatus Evaluate(Prescription prescription, DayPartSet parts, IReadOnlyList<MedicationDose> ownDoses, LocalClock clock)
    {
        var day = DayPartWindows.Of(clock.Now, clock.Offset).Day;
        var reminders = prescription.Schedule.DayPartReminders;
        var today = SlotsOn(day, prescription, parts, reminders, ownDoses, clock);
        var current = today.FirstOrDefault(slot => slot.Window.Contains(clock.Now));
        var upcoming = today.Concat(SlotsOn(day.AddDays(1), prescription, parts, reminders, ownDoses, clock));
        return new DayPartsStatus(
            day,
            today.Where(slot => IsShown(slot, prescription)).ToArray(),
            current,
            upcoming.FirstOrDefault(slot => slot.State is DayPartState.Due or DayPartState.Upcoming),
            GuardOf(prescription.CoversDay(day), current));
    }

    private static IReadOnlyList<DayPartSlot> SlotsOn(DateOnly day, Prescription prescription, DayPartSet parts, DayPartReminders? reminders, IReadOnlyList<MedicationDose> doses, LocalClock clock) =>
        prescription.CoversDay(day)
            ? parts.Values.Select(part => SlotOf(DayPartWindows.WindowOf(day, part, clock.Offset), reminders, doses, clock)).ToArray()
            : [];

    private static DayPartSlot SlotOf(DayPartWindow window, DayPartReminders? reminders, IReadOnlyList<MedicationDose> doses, LocalClock clock)
    {
        var inside = doses.Select(dose => dose.GivenAt).Where(window.Contains).Order().ToArray();
        var reminderAt = reminders?.TimeOf(window.Part) is { } time ? DayPartWindows.InstantIn(window.Day, window.Part, time, clock.Offset) : (DateTimeOffset?)null;
        return new DayPartSlot(window, StateOf(window, inside.Length > 0, clock.Now), inside.Length > 0 ? inside[0] : null, inside.Length, reminderAt);
    }

    private static DayPartState StateOf(DayPartWindow window, bool given, DateTimeOffset now) =>
        given ? DayPartState.Given
        : window.End <= now ? DayPartState.Missed
        : window.Start > now ? DayPartState.Upcoming
        : DayPartState.Due;

    private static bool IsShown(DayPartSlot slot, Prescription prescription) =>
        slot.State != DayPartState.Missed || slot.Window.End > prescription.CreatedAt;

    private static DayPartGuard GuardOf(bool inCourse, DayPartSlot? current) =>
        !inCourse ? DayPartGuard.None
        : current is null ? DayPartGuard.OutsideParts
        : current.State == DayPartState.Given ? DayPartGuard.AlreadyGiven
        : DayPartGuard.None;
}
