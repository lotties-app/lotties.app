using Lotties.Domain.Common;
using Lotties.Domain.Medications;

namespace Lotties.Domain.Proposals;

/// <summary>
/// The medication a prescription proposal is for, as the doctor picked it: a medication of the baby's list
/// (<see cref="MedicationId"/>), a product of the shared catalog (<see cref="ProductId"/>) or only a name. The doctor
/// never adds to the baby's list: the medication is resolved when a parent accepts (<see cref="ProposalMedications"/>).
/// <see cref="Name"/> is always kept (what the family reads): required, trimmed, at most
/// <see cref="Medication.NameMaxLength"/> characters, no NUL. An empty id counts as none.
/// </summary>
public sealed record MedicationReference
{
    public const string NameField = "medicationName";

    private MedicationReference(Guid? medicationId, Guid? productId, string name)
    {
        MedicationId = medicationId;
        ProductId = productId;
        Name = name;
    }

    public Guid? MedicationId { get; }

    public Guid? ProductId { get; }

    public string Name { get; }

    public static MedicationReference Create(Guid? medicationId, Guid? productId, string? name) =>
        new(NonEmpty(medicationId), NonEmpty(productId), Text.Required(name, NameField, Medication.NameMaxLength));

    private static Guid? NonEmpty(Guid? id) => id == Guid.Empty ? null : id;
}
