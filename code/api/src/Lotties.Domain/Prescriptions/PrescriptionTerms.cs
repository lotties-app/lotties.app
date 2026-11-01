using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Prescriptions;

/// <summary>
/// The full editable state of a prescription, as entered by the parent from the doctor's prescription. Validated on
/// creation: dates 2000-01-01 to 2100-12-31 with <see cref="EndDate"/> on or after <see cref="StartDate"/>; prescriber
/// at most 100 characters, instructions at most 2000 (widened from 1000 so an accepted doctor's proposal carries her
/// text verbatim), no NUL. Compared by value (idempotent replays change nothing).
/// </summary>
public sealed record PrescriptionTerms
{
    public const int PrescriberMaxLength = 100;
    public const int InstructionsMaxLength = 2000;

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
        EnsureCourseDates(startDate, endDate);
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

    /// <summary>
    /// Whether these terms say the same as <paramref name="other"/> apart from the active/stopped status: what a parent
    /// changes when she edits the content of a prescription (a doctor-sourced one is then marked as changed).
    /// </summary>
    public bool HasSameContentAs(PrescriptionTerms other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return WithStatus(other.Status) == other;
    }

    /// <summary>The course date rules shared by prescriptions and prescription proposals (field-named 400).</summary>
    internal static void EnsureCourseDates(DateOnly startDate, DateOnly? endDate)
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

    private PrescriptionTerms WithStatus(PrescriptionStatus status) =>
        new(MedicationId, status, Dose, Schedule, IntervalGroup, StartDate, EndDate, Prescriber, Instructions);

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
}
