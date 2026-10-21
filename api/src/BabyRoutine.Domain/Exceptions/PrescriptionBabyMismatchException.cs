namespace BabyRoutine.Domain.Exceptions;

/// <summary>An upsert addressed an existing prescription through a baby it does not belong to.</summary>
public sealed class PrescriptionBabyMismatchException : DomainException
{
    public PrescriptionBabyMismatchException(Guid prescriptionId, Guid requestedBabyId)
        : base("prescription_baby_mismatch", $"Prescription {prescriptionId} does not belong to baby {requestedBabyId}; a prescription cannot change baby.")
    {
        PrescriptionId = prescriptionId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid PrescriptionId { get; }

    public Guid RequestedBabyId { get; }
}
