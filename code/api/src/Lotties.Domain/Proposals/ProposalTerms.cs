using Lotties.Domain.Common;
using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Proposals;

/// <summary>
/// The full editable state of a prescription proposal: the medication the doctor picked and the prescription she
/// suggests, built from the very Domain types of a prescription (<see cref="DoseRule"/> with its per-kg, rounding and
/// counted-unit rules, <see cref="PrescriptionSchedule"/> with every schedule shape, <see cref="Prescriptions.IntervalGroup"/>,
/// the course dates of <see cref="PrescriptionTerms"/> and instructions up to
/// <see cref="PrescriptionTerms.InstructionsMaxLength"/>), plus the prescription it proposes to change, if any. There is no
/// prescriber: the author is the prescriber. Compared by value (an idempotent replay changes nothing).
/// </summary>
public sealed record ProposalTerms
{
    private ProposalTerms(
        MedicationReference medication,
        DoseRule dose,
        PrescriptionSchedule schedule,
        IntervalGroup? intervalGroup,
        DateOnly startDate,
        DateOnly? endDate,
        string? instructions,
        Guid? replacesPrescriptionId)
    {
        Medication = medication;
        Dose = dose;
        Schedule = schedule;
        IntervalGroup = intervalGroup;
        StartDate = startDate;
        EndDate = endDate;
        Instructions = instructions;
        ReplacesPrescriptionId = replacesPrescriptionId;
    }

    public MedicationReference Medication { get; }

    public DoseRule Dose { get; }

    public PrescriptionSchedule Schedule { get; }

    public IntervalGroup? IntervalGroup { get; }

    public DateOnly StartDate { get; }

    public DateOnly? EndDate { get; }

    public string? Instructions { get; }

    /// <summary>The prescription this proposal changes; accepting it ends that one.</summary>
    public Guid? ReplacesPrescriptionId { get; }

    /// <summary>Validates with the prescription rules; throws <see cref="Exceptions.DomainValidationException"/> naming the field.</summary>
    public static ProposalTerms Create(
        MedicationReference medication,
        DoseRule dose,
        PrescriptionSchedule schedule,
        IntervalGroup? intervalGroup,
        DateOnly startDate,
        DateOnly? endDate,
        string? instructions,
        Guid? replacesPrescriptionId)
    {
        ArgumentNullException.ThrowIfNull(medication);
        ArgumentNullException.ThrowIfNull(dose);
        ArgumentNullException.ThrowIfNull(schedule);
        PrescriptionTerms.EnsureCourseDates(startDate, endDate);
        return new ProposalTerms(
            medication,
            dose,
            schedule,
            intervalGroup,
            startDate,
            endDate,
            Text.Optional(instructions, "instructions", PrescriptionTerms.InstructionsMaxLength),
            replacesPrescriptionId == Guid.Empty ? null : replacesPrescriptionId);
    }

    /// <summary>
    /// The prescription these terms become for <paramref name="medicationId"/>: active, prescribed by
    /// <paramref name="prescriber"/>. The dose and the schedule are new instances with the same values (an owned value
    /// belongs to one row; the proposal keeps its own).
    /// </summary>
    public PrescriptionTerms ToPrescriptionTerms(Guid medicationId, string? prescriber) =>
        PrescriptionTerms.Create(medicationId, PrescriptionStatus.Active, CopyOf(Dose), CopyOf(Schedule), IntervalGroup, StartDate, EndDate, prescriber, Instructions);

    /// <summary>What the doctor sent, kept on the accepted prescription.</summary>
    public PrescriptionSnapshot ToSnapshot() =>
        PrescriptionSnapshot.Of(Medication.Name, Medication.ProductId, Dose, Schedule, IntervalGroup, StartDate, EndDate, Instructions);

    private static DoseRule CopyOf(DoseRule dose) => DoseRule.Create(dose.Amount, dose.Unit, dose.PerKg, dose.RoundingStep);

    private static PrescriptionSchedule CopyOf(PrescriptionSchedule schedule) =>
        PrescriptionSchedule.Create(
            schedule.Kind,
            schedule.TimesOfDay,
            schedule.EveryMinutes,
            schedule.MinIntervalMinutes,
            schedule.MaxDosesPer24h,
            schedule.Indication,
            schedule.DayParts,
            schedule.DayPartReminders);
}
