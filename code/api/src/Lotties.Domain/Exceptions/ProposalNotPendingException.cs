namespace Lotties.Domain.Exceptions;

/// <summary>A parent accepted or declined a prescription proposal that is no longer pending (declined, withdrawn, replaced, or accepted when declining).</summary>
public sealed class ProposalNotPendingException : DomainException
{
    public ProposalNotPendingException(Guid proposalId, string status)
        : base("proposal_not_pending", $"Prescription proposal {proposalId} is {status}, not pending.")
    {
        ProposalId = proposalId;
        Status = status;
    }

    public Guid ProposalId { get; }

    /// <summary>The proposal's status code.</summary>
    public string Status { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["proposalStatus"] = Status };
}
