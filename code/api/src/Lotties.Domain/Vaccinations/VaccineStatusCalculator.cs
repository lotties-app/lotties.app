namespace Lotties.Domain.Vaccinations;

/// <summary>
/// The status of every scheduled dose for one baby on one day (docs/design/18-vaccines.md section 3). Pure: no I/O, no
/// clock. Ages are whole days between local calendar dates, so daylight saving never moves a date. Mirrored by
/// <c>code/web/src/vaccines/vaccineStatus.ts</c>; both read the shared vectors <c>vaccineStatusVectors.json</c>.
/// <list type="number">
/// <item>Records satisfy their own dose and every dose it <c>covers</c>; records without a known dose id are ignored.</item>
/// <item>A satisfied dose is <see cref="DoseState.Given"/> (the earliest record; for a yearly dose, the latest one while
/// within <c>everyDays</c>). Given wins over every rule below.</item>
/// <item>Not applicable: another dose of the alternative group was given; the condition is not met; a private dose while
/// the profile shows the public schedule only.</item>
/// <item>The window: <c>dueOn = birth + recommended</c>, <c>earliestOn = birth + earliest</c>, both pushed to
/// <c>previous given + minimum interval</c> when the latest given previous dose was late; <c>latestOn = birth + latest</c>.</item>
/// <item><see cref="DoseState.Expired"/> after <c>latestOn</c> (or when the push leaves no valid day), then
/// <see cref="DoseState.Upcoming"/> before <c>dueOn</c>, <see cref="DoseState.Overdue"/> more than
/// <see cref="OverdueAfterDays"/> days after it, else <see cref="DoseState.Due"/>.</item>
/// <item>A yearly dose is due from its start age, then <c>everyDays</c> after the latest dose of its series (itself, its
/// group or a previous dose); it waits (upcoming without a date) while a previous dose is still pending and none was
/// given, and it is never overdue.</item>
/// </list>
/// </summary>
public static class VaccineStatusCalculator
{
    /// <summary>A due dose becomes overdue after this many days.</summary>
    public const int OverdueAfterDays = 30;

    public static VaccineStatusResult Calculate(VaccineStatusInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var context = new Context(input);
        var doses = input.Schedule.Doses.Where(dose => !dose.RecordOnly).Select(context.StatusOf).ToArray();
        return new VaccineStatusResult(context.AgeOn(input.Today), input.Profile.IsPremature, doses);
    }

    /// <summary>Lookups over the input, built once per calculation.</summary>
    private sealed class Context
    {
        private readonly VaccineStatusInput _input;
        private readonly IReadOnlyDictionary<string, IReadOnlyList<Satisfaction>> _satisfactions;
        private readonly ILookup<string, ScheduledDose> _groups;

        public Context(VaccineStatusInput input)
        {
            _input = input;
            _satisfactions = SatisfactionsOf(input.Schedule, input.Records);
            _groups = input.Schedule.Doses
                .Where(dose => !dose.RecordOnly && dose.AlternativeGroup is not null)
                .ToLookup(dose => dose.AlternativeGroup!, StringComparer.Ordinal);
        }

        private DateOnly Today => _input.Today;

        public int AgeOn(DateOnly date) => date.DayNumber - _input.BirthDate.DayNumber;

        public DoseStatus StatusOf(ScheduledDose dose) => dose.Recurrence is null ? OneOff(dose) : Recurring(dose, dose.Recurrence);

        private DoseStatus OneOff(ScheduledDose dose)
        {
            var window = WindowOf(dose);
            var status = Base(dose, window);
            return FirstOf(dose.DoseId) is { } given ? Given(status, given)
                : SiblingGiven(dose) is { } sibling ? status with { State = DoseState.NotApplicable, Reason = NotApplicableReason.Alternative, AlternativeOf = sibling }
                : NotApplicableReasonOf(dose) is { } reason ? status with { State = DoseState.NotApplicable, Reason = reason }
                : window.HasPassed(Today) ? status with { State = DoseState.Expired }
                : Today < window.DueOn ? status with { State = DoseState.Upcoming }
                : Today > window.DueOn.AddDays(OverdueAfterDays) ? status with { State = DoseState.Overdue, OverdueFrom = window.DueOn.AddDays(OverdueAfterDays + 1) }
                : status with { State = DoseState.Due };
        }

        private DoseStatus Recurring(ScheduledDose dose, DoseRecurrence recurrence)
        {
            var lastSelf = LastOf([dose.DoseId]);
            var lastSibling = LastOf(SiblingsOf(dose).Select(sibling => sibling.DoseId));
            var lastSeason = Later(lastSelf, lastSibling);
            var previous = LastOf(dose.PreviousDoseIds)?.Record.GivenOn;
            var nextDue = Max(_input.BirthDate.AddDays(recurrence.StartAgeDays), Later(lastSeason?.Record.GivenOn, previous)?.AddDays(recurrence.EveryDays));
            var window = new Window(nextDue, nextDue, LatestOn(dose));
            var status = Base(dose, window);
            var inSeason = lastSeason is not null && Today < lastSeason.Record.GivenOn.AddDays(recurrence.EveryDays);
            return inSeason && lastSeason == lastSelf ? Given(status, lastSelf!) with { DueOn = null, NextDueOn = nextDue }
                : inSeason ? status with { State = DoseState.NotApplicable, Reason = NotApplicableReason.Alternative, AlternativeOf = lastSeason!.DoseId, NextDueOn = nextDue }
                : NotApplicableReasonOf(dose) is { } reason ? status with { State = DoseState.NotApplicable, Reason = reason }
                : window.HasPassed(Today) ? status with { State = DoseState.Expired }
                : lastSeason is null && previous is null && PendingPrevious(dose) is { } waitingFor ? status with { State = DoseState.Upcoming, DueOn = null, EarliestOn = null, WaitingFor = waitingFor }
                : Today < nextDue ? status with { State = DoseState.Upcoming }
                : status with { State = DoseState.Due };
        }

        private DoseStatus Base(ScheduledDose dose, Window window) =>
            new(
                dose.DoseId,
                dose.Slot,
                DoseState.Due,
                Reason: null,
                window.DueOn,
                window.EarliestOn,
                window.LatestOn,
                OverdueFrom: null,
                RecordId: null,
                GivenOn: null,
                CoveredBy: null,
                AlternativeOf: null,
                dose.Network == VaccineNetwork.Private && _input.Profile.Coverage == VaccineCoverage.PublicAndPrivate,
                NextDueOn: null,
                WaitingFor: null);

        private static DoseStatus Given(DoseStatus status, Satisfaction given) =>
            status with { State = DoseState.Given, RecordId = given.Record.Id, GivenOn = given.Record.GivenOn, CoveredBy = given.Via };

        private NotApplicableReason? NotApplicableReasonOf(ScheduledDose dose) =>
            !VaccineConditions.IsMet(dose.Condition, _input.Profile) ? NotApplicableReason.Condition
            : dose.Network == VaccineNetwork.Private && _input.Profile.Coverage == VaccineCoverage.Public ? NotApplicableReason.Network
            : null;

        /// <summary>The window of a one-off dose, pushed by the minimum interval after the latest given previous dose.</summary>
        private Window WindowOf(ScheduledDose dose)
        {
            var previous = LastOf(dose.PreviousDoseIds)?.Record.GivenOn;
            var pushedTo = previous is { } given && dose.MinIntervalDaysFromPrevious is { } interval ? given.AddDays(interval) : (DateOnly?)null;
            return new Window(
                Max(_input.BirthDate.AddDays(dose.RecommendedAgeDays), pushedTo),
                Max(_input.BirthDate.AddDays(dose.EarliestAgeDays), pushedTo),
                LatestOn(dose));
        }

        private DateOnly? LatestOn(ScheduledDose dose) => dose.LatestAgeDays is { } latest ? _input.BirthDate.AddDays(latest) : null;

        /// <summary>The first previous dose that is still pending for this baby (upcoming, due or overdue), if any.</summary>
        private string? PendingPrevious(ScheduledDose dose) =>
            dose.PreviousDoseIds
                .Select(_input.Schedule.FindDose)
                .OfType<ScheduledDose>()
                .Where(previous => previous.Recurrence is null && OneOff(previous).State is DoseState.Upcoming or DoseState.Due or DoseState.Overdue)
                .Select(previous => previous.DoseId)
                .FirstOrDefault();

        /// <summary>The dose id of another member of the alternative group that was given (the earliest one), if any.</summary>
        private string? SiblingGiven(ScheduledDose dose) =>
            SiblingsOf(dose)
                .Select(sibling => FirstOf(sibling.DoseId))
                .OfType<Satisfaction>()
                .OrderBy(given => given.Record.GivenOn)
                .ThenBy(given => given.Order)
                .Select(given => given.DoseId)
                .FirstOrDefault();

        private IEnumerable<ScheduledDose> SiblingsOf(ScheduledDose dose) =>
            dose.AlternativeGroup is { } group ? _groups[group].Where(sibling => sibling.DoseId != dose.DoseId) : [];

        private Satisfaction? FirstOf(string doseId) =>
            _satisfactions.TryGetValue(doseId, out var found) ? found[0] : null;

        /// <summary>The latest satisfaction of any of <paramref name="doseIds"/> (by date, then record order).</summary>
        private Satisfaction? LastOf(IEnumerable<string> doseIds) =>
            doseIds
                .SelectMany(doseId => _satisfactions.TryGetValue(doseId, out var found) ? found : [])
                .OrderBy(given => given.Record.GivenOn)
                .ThenBy(given => given.Order)
                .LastOrDefault();

        private static Satisfaction? Later(Satisfaction? first, Satisfaction? second) =>
            first is null ? second
            : second is null ? first
            : second.Record.GivenOn > first.Record.GivenOn ? second
            : first;

        private static DateOnly? Later(DateOnly? first, DateOnly? second) =>
            first is null ? second : second is null ? first : first > second ? first : second;

        private static DateOnly Max(DateOnly value, DateOnly? other) => other is { } candidate && candidate > value ? candidate : value;

        /// <summary>
        /// Which records satisfy each dose id, earliest first: a record satisfies its own dose and every dose that dose
        /// covers. Records are ordered by date, then by id text (the same order on the web).
        /// </summary>
        private static IReadOnlyDictionary<string, IReadOnlyList<Satisfaction>> SatisfactionsOf(VaccineSchedule schedule, IReadOnlyList<VaccinationRecord> records)
        {
            var ordered = records
                .OrderBy(record => record.GivenOn)
                .ThenBy(record => record.Id.ToString("D"), StringComparer.Ordinal)
                .Select((record, order) => (Record: record, Order: order, Dose: schedule.FindDose(record.DoseId)))
                .Where(item => item.Dose is not null);
            return ordered
                .SelectMany(item => new[] { new Satisfaction(item.Dose!.DoseId, item.Record, null, item.Order) }
                    .Concat(item.Dose!.Covers.Select(covered => new Satisfaction(covered, item.Record, item.Dose.DoseId, item.Order))))
                .GroupBy(satisfaction => satisfaction.DoseId, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => (IReadOnlyList<Satisfaction>)group.ToArray(), StringComparer.Ordinal);
        }
    }

    /// <summary>A record satisfying <see cref="DoseId"/>; <see cref="Via"/> is the combined product's dose when a covers rule applied.</summary>
    private sealed record Satisfaction(string DoseId, VaccinationRecord Record, string? Via, int Order);

    private sealed record Window(DateOnly DueOn, DateOnly EarliestOn, DateOnly? LatestOn)
    {
        /// <summary>After the last day of the window, or the window was pushed past its end.</summary>
        public bool HasPassed(DateOnly today) => LatestOn is { } latest && (today > latest || EarliestOn > latest);
    }
}
