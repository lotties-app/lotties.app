using Lotties.Application.Vaccinations;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Clinical;

/// <summary>
/// Where the vaccine schedule stands for a baby on a local date: the status engine run over the shipped schedule, the baby's
/// vaccine profile and birth date and its records that are not deleted (what the vaccine reminders plan from).
/// </summary>
internal sealed class VaccineOverviewReader(IVaccinationRepository vaccinations, IVaccineScheduleProvider schedule)
{
    public async Task<VaccineOverview> ReadAsync(Baby baby, DateOnly today, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(baby);
        var records = await vaccinations.ListActiveAsync(baby.Id, cancellationToken);
        var status = VaccineStatusCalculator.Calculate(
            new VaccineStatusInput(schedule.Schedule, baby.VaccineProfile, baby.BirthDate, records.Select(record => record.ToRecord()).ToArray(), today));
        return VaccineOverview.Of(status, schedule.Schedule);
    }
}
