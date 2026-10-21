namespace BabyRoutine.Domain.Exceptions;

/// <summary>A prescription referenced a medication that is not in the baby's catalog.</summary>
public sealed class PrescriptionMedicationNotFoundException : DomainException
{
    public PrescriptionMedicationNotFoundException(Guid medicationId, Guid babyId)
        : base("prescription_medication_not_found", $"Medication {medicationId} is not in the catalog of baby {babyId}.")
    {
        MedicationId = medicationId;
        BabyId = babyId;
    }

    public Guid MedicationId { get; }

    public Guid BabyId { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["medicationId"] = MedicationId };
}
