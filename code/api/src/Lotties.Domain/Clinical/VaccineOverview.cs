using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Clinical;

/// <summary>A scheduled dose that is due or overdue: what to give and since when (<see cref="DueOn"/>, a local date).</summary>
public sealed record DueDose(string DoseId, string VaccineKey, LocalizedText VaccineNames, LocalizedText DoseLabel, DoseState State, DateOnly DueOn);

/// <summary>
/// Where the schedule stands for a baby on one day, from the status engine (<see cref="VaccineStatusCalculator"/>): how many
/// doses are given, due, overdue and upcoming, and the due and overdue ones. Doses that do not apply or expired are not counted.
/// </summary>
public sealed record VaccineOverview(int Given, int Due, int Overdue, int Upcoming, IReadOnlyList<DueDose> DueDoses)
{
    /// <summary>Doses due or overdue.</summary>
    public int DueOrOverdue => Due + Overdue;

    /// <summary>Counts the doses of <paramref name="status"/> and lists the due ones (earliest due date first, then schedule order).</summary>
    public static VaccineOverview Of(VaccineStatusResult status, VaccineSchedule schedule)
    {
        ArgumentNullException.ThrowIfNull(status);
        ArgumentNullException.ThrowIfNull(schedule);
        return new VaccineOverview(
            CountOf(status, DoseState.Given),
            CountOf(status, DoseState.Due),
            CountOf(status, DoseState.Overdue),
            CountOf(status, DoseState.Upcoming),
            status.Doses
                .Where(dose => dose.State is DoseState.Due or DoseState.Overdue && dose.DueOn is not null)
                .Select(dose => DueDoseOf(dose, schedule))
                .OfType<DueDose>()
                .OrderBy(dose => dose.DueOn)
                .ToArray());
    }

    private static int CountOf(VaccineStatusResult status, DoseState state) => status.Doses.Count(dose => dose.State == state);

    private static DueDose? DueDoseOf(DoseStatus status, VaccineSchedule schedule) =>
        schedule.FindDose(status.DoseId) is { } scheduled && schedule.FindVaccine(scheduled.VaccineKey) is { } vaccine
            ? new DueDose(scheduled.DoseId, scheduled.VaccineKey, vaccine.Names, scheduled.Label, status.State, status.DueOn!.Value)
            : null;
}
