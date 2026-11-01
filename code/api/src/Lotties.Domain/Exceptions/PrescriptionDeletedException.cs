namespace Lotties.Domain.Exceptions;

/// <summary>A change was attempted on a soft-deleted prescription.</summary>
public sealed class PrescriptionDeletedException : DomainException
{
    public PrescriptionDeletedException(Guid prescriptionId)
        : base("prescription_deleted", $"Prescription {prescriptionId} is deleted and cannot be changed.")
    {
        PrescriptionId = prescriptionId;
    }

    public Guid PrescriptionId { get; }
}
