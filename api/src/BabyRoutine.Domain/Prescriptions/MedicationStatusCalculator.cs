namespace BabyRoutine.Domain.Prescriptions;

/// <summary>
/// Inputs of <see cref="MedicationStatusCalculator.Calculate"/>: the baby's prescriptions (only active, non-deleted
/// ones are reported), the doses logged in the last <see cref="MedicationStatusCalculator.HistoryLookBack"/>, the
/// current instant, the family's UTC offset (local times of day and local "today"; a fixed offset, so a DST change
/// inside the window is not modelled) and the latest weight.
/// </summary>
public sealed record MedicationStatusInput(
    IReadOnlyList<Prescription> Prescriptions,
    IReadOnlyList<MedicationDose> Doses,
    DateTimeOffset Now,
    TimeSpan UtcOffset,
    BodyWeight? LatestWeight);

/// <summary>
/// The computed state of one active prescription (see <see cref="MedicationStatusCalculator"/> for the rules).
/// <see cref="OverdueBy"/> and <see cref="NextScheduledAt"/> are <c>null</c> for as-needed prescriptions.
/// </summary>
public sealed record MedicationStatus(
    Prescription Prescription,
    bool CourseStarted,
    bool CourseEnded,
    bool AvailableNow,
    DateTimeOffset? AvailableAt,
    DateTimeOffset? NextScheduledAt,
    TimeSpan? OverdueBy,
    DateTimeOffset? LastDoseAt,
    int DosesLast24h,
    bool LimitReached,
    SuggestedDose? SuggestedDose,
    IReadOnlyList<Guid> GroupMemberIds);

/// <summary>
/// Pure status of a baby's active prescriptions, mirrored by the web client offline. It never blocks anything: it
/// reports when the doctor's rule (entered by the parent) allows the next dose; logging earlier is the parent's
/// decision (recorded as <c>override</c>).
/// <list type="bullet">
/// <item>Doses of a prescription: payload entries naming it, or naming its medication. Own doses (for scheduled slots)
/// exclude entries that name another prescription.</item>
/// <item>Interval clock: the latest dose of the prescription's medication or of any other active member of its interval
/// group. The wait is the prescription's own interval (as-needed minimum interval, or the scheduled "every N minutes"
/// period); a member without one (times of day) uses the smallest interval of the other members. <c>availableAt</c> =
/// clock + wait.</item>
/// <item>Max per 24h (as-needed): doses of the medication in (now - 24h, now]; at the limit, <c>limitReached</c> and
/// <c>availableAt</c> is at least the time the oldest counted dose leaves the window.</item>
/// <item><c>availableNow</c>: the course covers local today and <c>availableAt</c> is absent or not after now.</item>
/// <item>Times of day: slots of local yesterday, today and tomorrow inside the course dates; each slot takes the nearest
/// unused own dose within ±90 minutes (so a dose at 00:30 can satisfy yesterday's 23:30). <c>nextScheduledAt</c> = the
/// earliest open slot after now; <c>overdueBy</c> = now minus the latest open slot at or before now that is today's or
/// at most 90 minutes old (slots before the prescription was created are never overdue).</item>
/// <item>Every N minutes: <c>nextScheduledAt</c> = last dose + N (none before the first dose), overdue when past.</item>
/// <item><c>suggestedDose</c>: <see cref="DoseRule.SuggestFor"/> with the latest weight (stale after 30 days).</item>
/// </list>
/// </summary>
public static class MedicationStatusCalculator
{
    public static readonly TimeSpan SlotMatchWindow = TimeSpan.FromMinutes(90);
    public static readonly TimeSpan DailyWindow = TimeSpan.FromHours(24);

    /// <summary>How far back doses are needed: the longest interval (7 days), the daily window and one day of slots.</summary>
    public static readonly TimeSpan HistoryLookBack = TimeSpan.FromMinutes(PrescriptionSchedule.MaxIntervalLimitMinutes) + DailyWindow + TimeSpan.FromDays(1);

    public static readonly TimeSpan MaxUtcOffset = TimeSpan.FromHours(14);

    public static IReadOnlyList<MedicationStatus> Calculate(MedicationStatusInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(input.UtcOffset.Duration(), MaxUtcOffset, nameof(input));
        var clock = new LocalClock(input.Now, input.UtcOffset);
        var active = input.Prescriptions.Where(prescription => prescription.IsActive).OrderBy(prescription => prescription.StartDate).ThenBy(prescription => prescription.Id).ToArray();
        return active.Select(prescription => StatusOf(prescription, active, input, clock)).ToArray();
    }

    private static MedicationStatus StatusOf(Prescription prescription, IReadOnlyList<Prescription> active, MedicationStatusInput input, LocalClock clock)
    {
        var members = active.Where(other => other.Id != prescription.Id && prescription.SharesIntervalGroupWith(other)).ToArray();
        var medicationDoses = MedicationDosesOf(prescription, input.Doses);
        var clockDoses = members.SelectMany(member => MedicationDosesOf(member, input.Doses)).Concat(medicationDoses).ToArray();
        var lastDoseAt = Latest(medicationDoses);
        var recent = DosesInDailyWindow(medicationDoses, clock.Now);
        var limitUntil = LimitUntil(prescription.Schedule.MaxDosesPer24h, recent);
        var availableAt = Later(Latest(clockDoses) + EffectiveInterval(prescription, members), limitUntil);
        var inCourse = prescription.CoversDay(clock.Today);
        var schedule = ScheduleOf(prescription, OwnDosesOf(prescription, input.Doses), lastDoseAt, clock, inCourse);
        return new MedicationStatus(
            prescription,
            prescription.HasStartedOn(clock.Today),
            prescription.HasEndedBefore(clock.Today),
            inCourse && (availableAt is null || availableAt <= clock.Now),
            availableAt,
            schedule.NextAt,
            schedule.OverdueBy,
            lastDoseAt,
            recent.Count,
            limitUntil is not null,
            prescription.Dose.SuggestFor(input.LatestWeight, clock.Today),
            members.Select(member => member.Id).ToArray());
    }

    private static IReadOnlyList<MedicationDose> MedicationDosesOf(Prescription prescription, IReadOnlyList<MedicationDose> doses) =>
        doses.Where(dose => dose.PrescriptionId == prescription.Id || dose.MedicationId == prescription.MedicationId).ToArray();

    private static IReadOnlyList<MedicationDose> OwnDosesOf(Prescription prescription, IReadOnlyList<MedicationDose> doses) =>
        doses.Where(dose => dose.PrescriptionId == prescription.Id || (dose.PrescriptionId is null && dose.MedicationId == prescription.MedicationId)).ToArray();

    private static IReadOnlyList<MedicationDose> DosesInDailyWindow(IReadOnlyList<MedicationDose> doses, DateTimeOffset now) =>
        doses.Where(dose => dose.GivenAt > now - DailyWindow && dose.GivenAt <= now).OrderBy(dose => dose.GivenAt).ToArray();

    private static DateTimeOffset? LimitUntil(int? maxDoses, IReadOnlyList<MedicationDose> recentAscending) =>
        maxDoses is { } max && recentAscending.Count >= max ? recentAscending[recentAscending.Count - max].GivenAt + DailyWindow : null;

    private static TimeSpan? EffectiveInterval(Prescription prescription, IReadOnlyList<Prescription> members) =>
        prescription.Schedule.OwnInterval
        ?? members.Select(member => member.Schedule.OwnInterval).OfType<TimeSpan>().Order().Cast<TimeSpan?>().FirstOrDefault();

    private static DateTimeOffset? Latest(IReadOnlyList<MedicationDose> doses) =>
        doses.Count == 0 ? null : doses.Max(dose => dose.GivenAt);

    private static DateTimeOffset? Later(DateTimeOffset? left, DateTimeOffset? right) =>
        left is null ? right : right is null ? left : (left > right ? left : right);

    private static ScheduleState ScheduleOf(Prescription prescription, IReadOnlyList<MedicationDose> ownDoses, DateTimeOffset? lastDoseAt, LocalClock clock, bool inCourse) =>
        prescription.Schedule switch
        {
            { TimesOfDay: { } times } => ScheduledSlots.Evaluate(prescription, times, ownDoses, clock),
            { EveryMinutes: { } every } when inCourse && lastDoseAt is { } last => ScheduleState.Due(last + TimeSpan.FromMinutes(every), clock.Now),
            _ => ScheduleState.None,
        };
}

/// <summary>The scheduled part of a status: the next scheduled time and how late the current dose is.</summary>
internal sealed record ScheduleState(DateTimeOffset? NextAt, TimeSpan? OverdueBy)
{
    public static ScheduleState None { get; } = new(null, null);

    public static ScheduleState Due(DateTimeOffset nextAt, DateTimeOffset now) => new(nextAt, nextAt < now ? now - nextAt : null);
}

/// <summary>The current instant seen with the family's UTC offset.</summary>
internal sealed record LocalClock(DateTimeOffset Now, TimeSpan Offset)
{
    public DateOnly Today => DateOnly.FromDateTime(Now.ToOffset(Offset).DateTime);

    public DateTimeOffset ToInstant(DateOnly day, TimeOnly time) => new DateTimeOffset(day.ToDateTime(time), Offset).ToUniversalTime();
}

/// <summary>Slot matching of prescriptions given at fixed local times of day (see <see cref="MedicationStatusCalculator"/>).</summary>
internal static class ScheduledSlots
{
    private static readonly int[] DayOffsets = [-1, 0, 1];

    public static ScheduleState Evaluate(Prescription prescription, TimesOfDay times, IReadOnlyList<MedicationDose> ownDoses, LocalClock clock)
    {
        var slots = DayOffsets
            .Select(offset => clock.Today.AddDays(offset))
            .Where(prescription.CoversDay)
            .SelectMany(day => times.Values.Select(time => new Slot(day, clock.ToInstant(day, time))))
            .OrderBy(slot => slot.At)
            .ToArray();
        var taken = TakenSlots(slots, ownDoses.Select(dose => dose.GivenAt).Order().ToArray());
        var open = slots.Where(slot => !taken.Contains(slot.At)).ToArray();
        var next = open.Where(slot => slot.At > clock.Now).Select(slot => (DateTimeOffset?)slot.At).FirstOrDefault();
        var overdue = open.Where(slot => IsOverdue(slot, prescription, clock)).Select(slot => (DateTimeOffset?)slot.At).LastOrDefault();
        return new ScheduleState(next, overdue is { } late ? clock.Now - late : null);
    }

    private static bool IsOverdue(Slot slot, Prescription prescription, LocalClock clock) =>
        slot.At <= clock.Now
        && slot.At >= prescription.CreatedAt
        && (slot.Day == clock.Today || clock.Now - slot.At <= MedicationStatusCalculator.SlotMatchWindow);

    /// <summary>Each slot, in time order, takes the nearest dose within the match window that no earlier slot took.</summary>
    private static IReadOnlySet<DateTimeOffset> TakenSlots(IReadOnlyList<Slot> slots, IReadOnlyList<DateTimeOffset> doses)
    {
        var usedDoses = new HashSet<int>();
        return slots.Where(slot => TryTakeNearestDose(slot, doses, usedDoses)).Select(slot => slot.At).ToHashSet();
    }

    private static bool TryTakeNearestDose(Slot slot, IReadOnlyList<DateTimeOffset> doses, HashSet<int> usedDoses)
    {
        var nearest = doses
            .Select((givenAt, index) => (Index: index, Gap: (givenAt - slot.At).Duration()))
            .Where(candidate => !usedDoses.Contains(candidate.Index) && candidate.Gap <= MedicationStatusCalculator.SlotMatchWindow)
            .OrderBy(candidate => candidate.Gap)
            .Select(candidate => (int?)candidate.Index)
            .FirstOrDefault();
        return nearest is { } index && usedDoses.Add(index);
    }

    private sealed record Slot(DateOnly Day, DateTimeOffset At);
}
