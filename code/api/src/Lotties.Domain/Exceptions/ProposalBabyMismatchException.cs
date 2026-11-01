namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing prescription proposal through a baby it does not belong to.</summary>
public sealed class ProposalBabyMismatchException : DomainException
{
    public ProposalBabyMismatchException(Guid proposalId, Guid requestedBabyId)
        : base("proposal_baby_mismatch", $"Prescription proposal {proposalId} does not belong to baby {requestedBabyId}; a proposal cannot change baby.")
    {
        ProposalId = proposalId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid ProposalId { get; }

    public Guid RequestedBabyId { get; }
}
