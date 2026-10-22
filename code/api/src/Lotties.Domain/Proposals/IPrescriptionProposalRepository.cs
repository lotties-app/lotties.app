using Lotties.Domain.Babies;

namespace Lotties.Domain.Proposals;

/// <summary>Persistence for <see cref="PrescriptionProposal"/>. Every list applies <see cref="ProposalVisibility"/> in the query.</summary>
public interface IPrescriptionProposalRepository
{
    /// <summary>The proposal with the id, whatever its baby (tracked).</summary>
    Task<PrescriptionProposal?> FindAsync(Guid proposalId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The baby's proposals a member with <paramref name="readerRole"/> sees (<see cref="ProposalVisibility.AudienceOf"/>),
    /// changed at or after <paramref name="since"/> (all when <c>null</c>), by (updatedAt, id); not tracked.
    /// </summary>
    Task<IReadOnlyList<PrescriptionProposal>> ListChangesVisibleToAsync(Guid babyId, Guid readerUserId, BabyRole readerRole, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>The pending proposals of <paramref name="authorUserId"/> for the baby (tracked).</summary>
    Task<IReadOnlyList<PrescriptionProposal>> ListPendingByAuthorAsync(Guid babyId, Guid authorUserId, CancellationToken cancellationToken = default);

    /// <summary>The pending proposals of the baby that change <paramref name="prescriptionId"/> (tracked).</summary>
    Task<IReadOnlyList<PrescriptionProposal>> ListPendingReplacingAsync(Guid babyId, Guid prescriptionId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new proposal. Returns <c>false</c>, leaving nothing tracked, when a concurrent create of the same id won.</summary>
    Task<bool> TryAddAsync(PrescriptionProposal proposal, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves every tracked change (an edit, a withdraw, a decline). A lost race on the row version is
    /// <see cref="Exceptions.ConcurrentModificationException"/>.
    /// </summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves an accept in one transaction: the new <paramref name="prescription"/>, the medication it added to the baby's
    /// list (if any) and every tracked change (the proposal, the replaced prescription, the superseded proposals). A lost
    /// race (row version or key) is <see cref="Exceptions.ConcurrentModificationException"/> and nothing is saved.
    /// </summary>
    Task SaveAcceptanceAsync(Prescriptions.Prescription prescription, Medications.Medication? addedMedication, CancellationToken cancellationToken = default);
}
