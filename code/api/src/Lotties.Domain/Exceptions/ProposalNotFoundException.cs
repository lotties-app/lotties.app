namespace Lotties.Domain.Exceptions;

/// <summary>
/// No prescription proposal with the id exists for the baby, or the caller may not see it (a Caregiver, a Viewer or another
/// doctor): the same answer as an unknown id, so its existence is never revealed.
/// </summary>
public sealed class ProposalNotFoundException : DomainException
{
    public ProposalNotFoundException(Guid babyId, Guid proposalId)
        : base("proposal_not_found", $"Prescription proposal {proposalId} was not found for baby {babyId}.")
    {
        BabyId = babyId;
        ProposalId = proposalId;
    }

    public Guid BabyId { get; }

    public Guid ProposalId { get; }
}
