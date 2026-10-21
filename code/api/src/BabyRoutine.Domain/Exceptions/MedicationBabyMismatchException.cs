namespace BabyRoutine.Domain.Exceptions;

/// <summary>An upsert addressed an existing medication through a baby it does not belong to.</summary>
public sealed class MedicationBabyMismatchException : DomainException
{
    public MedicationBabyMismatchException(Guid medicationId, Guid requestedBabyId)
        : base("medication_baby_mismatch", $"Medication {medicationId} does not belong to baby {requestedBabyId}; a medication cannot change baby.")
    {
        MedicationId = medicationId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid MedicationId { get; }

    public Guid RequestedBabyId { get; }
}
