using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Prescriptions;

/// <summary>
/// The full editable state of a prescription, as entered by the parent from the doctor's prescription. Validated on
/// creation: dates 2000-01-01 to 2100-12-31 with <see cref="EndDate"/> on or after <see cref="StartDate"/>; prescriber
/// at most 100 characters, instructions at most 1000, no NUL. Compared by value (idempotent replays change nothing).
/// </summary>
public sealed record PrescriptionTerms
{
    public const int PrescriberMaxLength = 100;
    public const int InstructionsMaxLength = 1000;

    public static readonly DateOnly EarliestDate = new(2000, 1, 1);
    public static readonly DateOnly LatestDate = new(2100, 12, 31);

    private PrescriptionTerms(
        Guid medicationId,
        PrescriptionStatus status,
        DoseRule dose,
        PrescriptionSchedule schedule,
        IntervalGroup? intervalGroup,
        DateOnly startDate,
        DateOnly? endDate,
        string? prescriber,
        string? instructions)
    {
        MedicationId = medicationId;
        Status = status;
        Dose = dose;
        Schedule = schedule;
        IntervalGroup = intervalGroup;
        StartDate = startDate;
        EndDate = endDate;
        Prescriber = prescriber;
        Instructions = instructions;
    }

    public Guid MedicationId { get; }

    public PrescriptionStatus Status { get; }

    public DoseRule Dose { get; }

    public PrescriptionSchedule Schedule { get; }

    public IntervalGroup? IntervalGroup { get; }

    public DateOnly StartDate { get; }

    public DateOnly? EndDate { get; }

    public string? Prescriber { get; }

    public string? Instructions { get; }

    public static PrescriptionTerms Create(
        Guid medicationId,
        PrescriptionStatus status,
        DoseRule dose,
        PrescriptionSchedule schedule,
        IntervalGroup? intervalGroup,
        DateOnly startDate,
        DateOnly? endDate,
        string? prescriber,
        string? instructions)
    {
        ArgumentNullException.ThrowIfNull(dose);
        ArgumentNullException.ThrowIfNull(schedule);
        EnsureMedication(medicationId);
        EnsureStatus(status);
        EnsureDates(startDate, endDate);
        return new PrescriptionTerms(
            medicationId,
            status,
            dose,
            schedule,
            intervalGroup,
            startDate,
            endDate,
            Text.Optional(prescriber, "prescriber", PrescriberMaxLength),
            Text.Optional(instructions, "instructions", InstructionsMaxLength));
    }

    private static void EnsureMedication(Guid medicationId)
    {
        if (medicationId == Guid.Empty)
        {
            throw new DomainValidationException("medicationId", "medicationId is required.");
        }
    }

    private static void EnsureStatus(PrescriptionStatus status)
    {
        if (!Enum.IsDefined(status))
        {
            throw new DomainValidationException("status", "status must be active or stopped.");
        }
    }

    private static void EnsureDates(DateOnly startDate, DateOnly? endDate)
    {
        if (startDate < EarliestDate || startDate > LatestDate)
        {
            throw new DomainValidationException("startDate", $"startDate must be between {EarliestDate:yyyy-MM-dd} and {LatestDate:yyyy-MM-dd}.");
        }

        if (endDate is { } end && (end < startDate || end > LatestDate))
        {
            throw new DomainValidationException("endDate", $"endDate must be on or after startDate and at most {LatestDate:yyyy-MM-dd}.");
        }
    }
}
