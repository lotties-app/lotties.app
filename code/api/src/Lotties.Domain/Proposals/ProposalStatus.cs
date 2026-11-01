namespace Lotties.Domain.Proposals;

/// <summary>
/// Where a prescription proposal stands. Only <see cref="Pending"/> changes; every other status is final (a decided
/// proposal is immutable, docs/design/16-doctor-access.md section 10.1).
/// </summary>
public enum ProposalStatus
{
    /// <summary>Sent by the doctor, waiting for an Owner or Parent; never active.</summary>
    Pending,

    /// <summary>A parent accepted it: a prescription was created from it.</summary>
    Accepted,

    /// <summary>A parent declined it (optionally with a reason the doctor sees).</summary>
    Declined,

    /// <summary>The doctor withdrew it, or her access to the baby ended (<see cref="ProposalCancelReason"/>).</summary>
    Cancelled,

    /// <summary>Another accepted proposal changed the same prescription first.</summary>
    Superseded,
}

/// <summary>Why a proposal was cancelled.</summary>
public enum ProposalCancelReason
{
    /// <summary>The doctor withdrew it.</summary>
    Withdrawn,

    /// <summary>The doctor was removed from the baby, left it or no longer has the Doctor role.</summary>
    AccessRemoved,
}

/// <summary>How a doctor's upsert applies to an existing proposal (see <see cref="PrescriptionProposal.DecideUpsert"/>).</summary>
public enum ProposalUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The proposal changed after the doctor's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,

    /// <summary>The proposal is decided and the terms are the same (a replay); the stored copy is returned.</summary>
    IgnoreDecided,
}

/// <summary>How a parent's accept or decline applies (see <see cref="PrescriptionProposal.DecideAccept"/> and <see cref="PrescriptionProposal.DecideDecline"/>).</summary>
public enum ProposalDecisionOutcome
{
    /// <summary>The proposal is pending: apply the decision.</summary>
    Apply,

    /// <summary>The proposal already has this decision (a replay): return the stored outcome.</summary>
    AlreadyDecided,
}

/// <summary>Stable lower snake case codes of the proposal enums (stored and sent).</summary>
public static class ProposalCodes
{
    public static string Of(ProposalStatus status) => status switch
    {
        ProposalStatus.Pending => "pending",
        ProposalStatus.Accepted => "accepted",
        ProposalStatus.Declined => "declined",
        ProposalStatus.Cancelled => "cancelled",
        ProposalStatus.Superseded => "superseded",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown proposal status."),
    };

    public static string Of(ProposalCancelReason reason) => reason switch
    {
        ProposalCancelReason.Withdrawn => "withdrawn",
        ProposalCancelReason.AccessRemoved => "access_removed",
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, "Unknown cancel reason."),
    };

    /// <summary>The status whose code is <paramref name="code"/> (storage reads).</summary>
    public static ProposalStatus StatusOf(string code) => Parse(code, Enum.GetValues<ProposalStatus>(), Of);

    /// <summary>The cancel reason whose code is <paramref name="code"/> (storage reads).</summary>
    public static ProposalCancelReason CancelReasonOf(string code) => Parse(code, Enum.GetValues<ProposalCancelReason>(), Of);

    private static TEnum Parse<TEnum>(string code, IReadOnlyList<TEnum> values, Func<TEnum, string> codeOf)
        where TEnum : struct, Enum
    {
        var matches = values.Where(value => codeOf(value) == code).ToArray();
        return matches.Length == 1 ? matches[0] : throw new ArgumentOutOfRangeException(nameof(code), code, $"Unknown {typeof(TEnum).Name} code.");
    }
}
