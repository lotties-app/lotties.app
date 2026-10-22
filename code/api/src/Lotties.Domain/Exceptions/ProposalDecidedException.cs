namespace Lotties.Domain.Exceptions;

/// <summary>
/// The doctor changed a prescription proposal the parents already decided (or that was withdrawn or replaced): a decided
/// proposal is immutable; a change is a new proposal.
/// </summary>
public sealed class ProposalDecidedException : DomainException
{
    public ProposalDecidedException(Guid proposalId, string status)
        : base("proposal_decided", $"Prescription proposal {proposalId} is {status} and can no longer change.")
    {
        ProposalId = proposalId;
        Status = status;
    }

    public Guid ProposalId { get; }

    /// <summary>The proposal's status code (<c>accepted</c>, <c>declined</c>, <c>cancelled</c> or <c>superseded</c>).</summary>
    public string Status { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["proposalStatus"] = Status };
}
