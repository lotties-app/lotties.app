using Lotties.Domain.Babies;
using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Proposals;

/// <summary>
/// A prescription a doctor suggests for a baby (docs/design/16-doctor-access.md section 10.1). Never active: nothing
/// reminds, computes or shows it as a medicine until an Owner or Parent accepts it, which creates a
/// <see cref="Prescription"/> from it (<see cref="ProposalAcceptance"/>). While <see cref="ProposalStatus.Pending"/> only
/// its author edits or withdraws it; once decided it is immutable. The id is client generated; sync follows the events
/// contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor, <see cref="ClientUpdatedAt"/> (the
/// doctor's edit time, bounded to the server clock + 5 min) decides conflicts between her edits.
/// </summary>
public sealed class PrescriptionProposal
{
    public const int DeclineReasonMaxLength = 500;
    public const string DeclineReasonField = "reason";

    private PrescriptionProposal()
    {
    }

    private PrescriptionProposal(Guid id, Guid babyId, Guid authorUserId, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
    {
        Id = id;
        BabyId = babyId;
        AuthorUserId = authorUserId;
        Status = ProposalStatus.Pending;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
        ClientUpdatedAt = clientUpdatedAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    /// <summary>The doctor who wrote it.</summary>
    public Guid AuthorUserId { get; private set; }

    public Guid? MedicationId { get; private set; }

    public Guid? ProductId { get; private set; }

    public string MedicationName { get; private set; } = string.Empty;

    public DoseRule Dose { get; private set; } = null!;

    public PrescriptionSchedule Schedule { get; private set; } = null!;

    public IntervalGroup? IntervalGroup { get; private set; }

    public DateOnly StartDate { get; private set; }

    public DateOnly? EndDate { get; private set; }

    public string? Instructions { get; private set; }

    public Guid? ReplacesPrescriptionId { get; private set; }

    public ProposalStatus Status { get; private set; }

    /// <summary>The parent's optional words when declining (the doctor reads them).</summary>
    public string? DeclineReason { get; private set; }

    public ProposalCancelReason? CancelReason { get; private set; }

    /// <summary>Who decided: the parent who accepted or declined, the doctor who withdrew, the Owner who removed her.</summary>
    public Guid? DecidedBy { get; private set; }

    public DateTimeOffset? DecidedAt { get; private set; }

    /// <summary>The prescription created when a parent accepted.</summary>
    public Guid? AcceptedPrescriptionId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public bool IsPending => Status == ProposalStatus.Pending;

    public string StatusCode => ProposalCodes.Of(Status);

    public ProposalTerms Terms => ProposalTerms.Create(
        MedicationReference.Create(MedicationId, ProductId, MedicationName),
        Dose,
        Schedule,
        IntervalGroup,
        StartDate,
        EndDate,
        Instructions,
        ReplacesPrescriptionId);

    public static PrescriptionProposal Create(Guid id, Guid babyId, ProposalTerms terms, Guid authorUserId, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var proposal = new PrescriptionProposal(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(authorUserId, nameof(authorUserId)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        proposal.Apply(terms);
        return proposal;
    }

    /// <summary>Whether a member with <paramref name="role"/> sees this proposal (<see cref="ProposalVisibility"/>).</summary>
    public bool IsVisibleTo(Guid userId, BabyRole role) => ProposalVisibility.Sees(role, userId, AuthorUserId);

    /// <summary>
    /// Decides how the doctor <paramref name="userId"/>'s upsert applies, before any change: a proposal never moves to
    /// another baby (<see cref="ProposalBabyMismatchException"/>); another doctor's proposal is not revealed
    /// (<see cref="ProposalNotFoundException"/>); a decided one is immutable (<see cref="ProposalDecidedException"/>,
    /// except an unchanged replay); a write whose bounded client time is strictly older than <see cref="ClientUpdatedAt"/> loses.
    /// </summary>
    public ProposalUpsertDecision DecideUpsert(Guid babyId, Guid userId, ProposalTerms terms, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        EnsureBelongsTo(babyId);
        EnsureAuthor(userId);
        return this switch
        {
            { IsPending: false } when terms == Terms => ProposalUpsertDecision.IgnoreDecided,
            { IsPending: false } => throw new ProposalDecidedException(Id, StatusCode),
            _ when clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt => ProposalUpsertDecision.IgnoreStale,
            _ => ProposalUpsertDecision.Apply,
        };
    }

    /// <summary>
    /// Applies the doctor's full terms to the pending proposal. Equal terms change nothing (not even the timestamps);
    /// otherwise <see cref="UpdatedAt"/> becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/> the bounded client time.
    /// </summary>
    public void Edit(ProposalTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        EnsureNotDecided();
        if (terms == Terms)
        {
            return;
        }

        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = ClientEditTime.Bound(clientUpdatedAt, now);
    }

    /// <summary>
    /// The author withdraws her pending proposal (<see cref="ProposalStatus.Cancelled"/>, <see cref="ProposalCancelReason.Withdrawn"/>).
    /// Another baby's, another doctor's or a decided proposal is a no-op (<c>false</c>): a withdraw never reveals or reverts anything.
    /// </summary>
    public bool Withdraw(Guid babyId, Guid userId, DateTimeOffset now)
    {
        if (BabyId != babyId || AuthorUserId != userId || !IsPending)
        {
            return false;
        }

        Cancel(ProposalCancelReason.Withdrawn, userId, now);
        return true;
    }

    /// <summary>Cancels the pending proposal because its author no longer has Doctor access to the baby; a decided one is kept as it is.</summary>
    public bool CancelForAccessRemoved(Guid? decidedBy, DateTimeOffset now)
    {
        if (!IsPending)
        {
            return false;
        }

        Cancel(ProposalCancelReason.AccessRemoved, decidedBy, now);
        return true;
    }

    /// <summary>
    /// Whether a parent's accept applies: a pending proposal is accepted, an accepted one is a replay
    /// (<see cref="ProposalDecisionOutcome.AlreadyDecided"/>), anything else is <see cref="ProposalNotPendingException"/>.
    /// </summary>
    public ProposalDecisionOutcome DecideAccept() => Status switch
    {
        ProposalStatus.Pending => ProposalDecisionOutcome.Apply,
        ProposalStatus.Accepted => ProposalDecisionOutcome.AlreadyDecided,
        _ => throw new ProposalNotPendingException(Id, StatusCode),
    };

    /// <summary>Whether a parent's decline applies: pending is declined, declined is a replay, anything else <see cref="ProposalNotPendingException"/>.</summary>
    public ProposalDecisionOutcome DecideDecline() => Status switch
    {
        ProposalStatus.Pending => ProposalDecisionOutcome.Apply,
        ProposalStatus.Declined => ProposalDecisionOutcome.AlreadyDecided,
        _ => throw new ProposalNotPendingException(Id, StatusCode),
    };

    /// <summary>Marks the pending proposal accepted by <paramref name="decidedBy"/>, with the prescription created from it.</summary>
    public void Accept(Guid decidedBy, Guid prescriptionId, DateTimeOffset now)
    {
        EnsurePending();
        AcceptedPrescriptionId = Ids.Required(prescriptionId, nameof(prescriptionId));
        Decide(ProposalStatus.Accepted, decidedBy, now);
    }

    /// <summary>Marks the pending proposal declined by <paramref name="decidedBy"/>, with an optional reason (trimmed, at most 500, no NUL).</summary>
    public void Decline(Guid decidedBy, string? reason, DateTimeOffset now)
    {
        EnsurePending();
        DeclineReason = Text.Optional(reason, DeclineReasonField, DeclineReasonMaxLength);
        Decide(ProposalStatus.Declined, decidedBy, now);
    }

    /// <summary>Another accepted proposal ended the prescription this one also replaces; a decided one is kept as it is.</summary>
    public bool Supersede(DateTimeOffset now)
    {
        if (!IsPending)
        {
            return false;
        }

        Decide(ProposalStatus.Superseded, null, now);
        return true;
    }

    private void Cancel(ProposalCancelReason reason, Guid? decidedBy, DateTimeOffset now)
    {
        CancelReason = reason;
        Decide(ProposalStatus.Cancelled, decidedBy, now);
    }

    private void Decide(ProposalStatus status, Guid? decidedBy, DateTimeOffset now)
    {
        var at = UtcTime.Normalize(now);
        Status = status;
        DecidedBy = decidedBy;
        DecidedAt = at;
        UpdatedAt = at;
        ClientUpdatedAt = at;
    }

    private void EnsureBelongsTo(Guid babyId)
    {
        if (BabyId != babyId)
        {
            throw new ProposalBabyMismatchException(Id, babyId);
        }
    }

    private void EnsureAuthor(Guid userId)
    {
        if (AuthorUserId != userId)
        {
            throw new ProposalNotFoundException(BabyId, Id);
        }
    }

    private void EnsureNotDecided()
    {
        if (!IsPending)
        {
            throw new ProposalDecidedException(Id, StatusCode);
        }
    }

    private void EnsurePending()
    {
        if (!IsPending)
        {
            throw new ProposalNotPendingException(Id, StatusCode);
        }
    }

    private void Apply(ProposalTerms terms)
    {
        MedicationId = terms.Medication.MedicationId;
        ProductId = terms.Medication.ProductId;
        MedicationName = terms.Medication.Name;
        Dose = terms.Dose;
        Schedule = terms.Schedule;
        IntervalGroup = terms.IntervalGroup;
        StartDate = terms.StartDate;
        EndDate = terms.EndDate;
        Instructions = terms.Instructions;
        ReplacesPrescriptionId = terms.ReplacesPrescriptionId;
    }
}
