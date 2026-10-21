using BabyRoutine.Domain.Prescriptions;

namespace BabyRoutine.Domain.Tests.Prescriptions;

/// <summary>Builders for prescriptions and doses; every prescription belongs to <see cref="BabyId"/>.</summary>
internal static class PrescriptionFixtures
{
    public static readonly Guid BabyId = Guid.NewGuid();
    public static readonly Guid UserId = Guid.NewGuid();
    public static readonly DoseRule TwoDrops = DoseRule.Create(2, "drops", perKg: false, roundingStep: null);

    public static PrescriptionTerms Terms(
        Guid medicationId,
        PrescriptionSchedule schedule,
        DoseRule? dose = null,
        string? group = null,
        DateOnly? start = null,
        DateOnly? end = null,
        PrescriptionStatus status = PrescriptionStatus.Active) =>
        PrescriptionTerms.Create(medicationId, status, dose ?? TwoDrops, schedule, IntervalGroup.FromOptional(group), start ?? new DateOnly(2026, 1, 1), end, null, null);

    public static Prescription Create(PrescriptionTerms terms, DateTimeOffset? createdAt = null) =>
        Prescription.Create(Guid.NewGuid(), BabyId, terms, UserId, createdAt ?? new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));

    public static Prescription AsNeeded(Guid medicationId, int minIntervalMinutes, int? maxDoses = null, string? group = null, DoseRule? dose = null, DateOnly? start = null, DateOnly? end = null) =>
        Create(Terms(medicationId, PrescriptionSchedule.Create(PrescriptionKind.AsNeeded, null, null, minIntervalMinutes, maxDoses, null), dose, group, start, end));

    public static Prescription AtTimes(Guid medicationId, string[] times, string? group = null, DateOnly? start = null, DateOnly? end = null, DateTimeOffset? createdAt = null) =>
        Create(Terms(medicationId, PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(times), null, null, null, null), null, group, start, end), createdAt);

    public static Prescription Every(Guid medicationId, int everyMinutes) =>
        Create(Terms(medicationId, PrescriptionSchedule.Create(PrescriptionKind.Scheduled, null, everyMinutes, null, null, null)));

    public static MedicationDose Dose(DateTimeOffset givenAt, Guid medicationId, Guid? prescriptionId = null) => new(givenAt, medicationId, prescriptionId, Override: false);

    /// <summary>A local wall-clock time with the given UTC offset (minutes).</summary>
    public static DateTimeOffset Local(int year, int month, int day, int hour, int minute, int offsetMinutes) =>
        new(year, month, day, hour, minute, 0, TimeSpan.FromMinutes(offsetMinutes));

    public static IReadOnlyList<MedicationStatus> Calculate(IReadOnlyList<Prescription> prescriptions, IReadOnlyList<MedicationDose> doses, DateTimeOffset now, int offsetMinutes = 0, BodyWeight? weight = null) =>
        MedicationStatusCalculator.Calculate(new MedicationStatusInput(prescriptions, doses, now, TimeSpan.FromMinutes(offsetMinutes), weight));
}
