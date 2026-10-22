using Lotties.Domain.Common;
using Lotties.Domain.Medications;

namespace Lotties.Domain.Proposals;

/// <summary>
/// Which medication of the baby's list an accepted proposal is for (docs/design/16-doctor-access.md section 10.1): the
/// one the doctor picked when it is still there; else the baby's medication linked to the same catalog product; else one
/// with the same name (trimmed, case-insensitive); else a new medication named as the proposal, linked to the product,
/// whose id is derived from the proposal so a replayed accept never adds a second one.
/// </summary>
public static class ProposalMedications
{
    private static readonly Guid IdNamespace = new("0b8f5f0e-5c3e-4f62-9a57-3d6f2c1e8a41");

    /// <summary>The baby's existing medication for <paramref name="reference"/>, or <c>null</c> when a new one is needed.</summary>
    public static Medication? FindExisting(MedicationReference reference, IReadOnlyList<Medication> babyMedications)
    {
        ArgumentNullException.ThrowIfNull(reference);
        ArgumentNullException.ThrowIfNull(babyMedications);
        return babyMedications.FirstOrDefault(medication => medication.Id == reference.MedicationId)
            ?? babyMedications.FirstOrDefault(medication => reference.ProductId is not null && medication.ProductId == reference.ProductId)
            ?? babyMedications.FirstOrDefault(medication => SameName(medication.Name, reference.Name));
    }

    /// <summary>
    /// The medication to add for <paramref name="reference"/>, linked to <paramref name="linkableProductId"/> (the product,
    /// or the one it was merged into; <c>null</c> when it is gone).
    /// </summary>
    public static Medication CreateFor(Guid proposalId, Guid babyId, MedicationReference reference, Guid? linkableProductId, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reference);
        return Medication.Create(IdFor(proposalId), babyId, reference.Name, defaultDosage: null, notes: null, isUsual: false, now, linkableProductId);
    }

    /// <summary>The id of the medication added when the proposal <paramref name="proposalId"/> is accepted.</summary>
    public static Guid IdFor(Guid proposalId) => DeterministicGuid.Create(IdNamespace, $"proposal-medication|{proposalId:N}");

    private static bool SameName(string left, string right) =>
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
}
