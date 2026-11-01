namespace Lotties.Domain.Exceptions;

/// <summary>A prescription proposal names a prescription to change that is not a (non-deleted) prescription of the baby.</summary>
public sealed class ReplacedPrescriptionNotFoundException : DomainException
{
    public ReplacedPrescriptionNotFoundException(Guid prescriptionId, Guid babyId)
        : base("replaced_prescription_not_found", $"Prescription {prescriptionId} is not a prescription of baby {babyId}.")
    {
        PrescriptionId = prescriptionId;
        BabyId = babyId;
    }

    public Guid PrescriptionId { get; }

    public Guid BabyId { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["replacesPrescriptionId"] = PrescriptionId };
}
