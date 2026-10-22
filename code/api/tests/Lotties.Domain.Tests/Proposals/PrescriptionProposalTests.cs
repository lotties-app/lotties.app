using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using static Lotties.Domain.Tests.Proposals.ProposalFixtures;

namespace Lotties.Domain.Tests.Proposals;

/// <summary>The prescription proposal lifecycle (docs/design/16-doctor-access.md section 10.1).</summary>
public sealed class PrescriptionProposalTests
{
    [Fact]
    public void Create_IsPendingWithTheTerms()
    {
        var terms = Terms(medicationId: Guid.NewGuid(), replaces: Guid.NewGuid());

        var proposal = Pending(terms);

        Assert.Equal((ProposalStatus.Pending, "pending", DoctorId), (proposal.Status, proposal.StatusCode, proposal.AuthorUserId));
        Assert.Equal(terms, proposal.Terms);
        Assert.Null(proposal.DecidedAt);
    }

    [Theory]
    [InlineData(0, "drops", false, "dose.amount")]
    [InlineData(1.5, "sprays", false, "dose.amount")]
    [InlineData(1, "sprays", true, "dose.perKg")]
    public void Terms_ImpossibleDose_IsRejectedLikeAPrescription(double amount, string unit, bool perKg, string field)
    {
        var problem = Assert.Throws<DomainValidationException>(() => Terms(amount: (decimal)amount, unit: unit, perKg: perKg));

        Assert.Equal(field, problem.Field);
    }

    [Fact]
    public void Terms_CourseEndingBeforeItStarts_IsRejected()
    {
        var problem = Assert.Throws<DomainValidationException>(() => Terms(start: new DateOnly(2026, 10, 22), end: new DateOnly(2026, 10, 21)));

        Assert.Equal("endDate", problem.Field);
    }

    [Fact]
    public void Terms_InstructionsUpTo2000AndANameAreRequiredRules()
    {
        var longest = Terms(instructions: new string('a', 2000));

        Assert.Equal(2000, longest.Instructions!.Length);
        Assert.Equal("instructions", Assert.Throws<DomainValidationException>(() => Terms(instructions: new string('a', 2001))).Field);
        Assert.Equal("medicationName", Assert.Throws<DomainValidationException>(() => Terms(name: "  ")).Field);
    }

    [Fact]
    public void Terms_EmptyIds_CountAsNone()
    {
        var terms = Terms(medicationId: Guid.Empty, productId: Guid.Empty, replaces: Guid.Empty);

        Assert.Equal(((Guid?)null, (Guid?)null, (Guid?)null), (terms.Medication.MedicationId, terms.Medication.ProductId, terms.ReplacesPrescriptionId));
    }

    [Fact]
    public void DecideUpsert_AnotherBaby_IsAMismatch()
    {
        var proposal = Pending();

        Assert.Throws<ProposalBabyMismatchException>(() => proposal.DecideUpsert(Guid.NewGuid(), DoctorId, Terms(), null, Now));
    }

    [Fact]
    public void DecideUpsert_AnotherDoctor_IsNotRevealed()
    {
        var proposal = Pending();

        Assert.Throws<ProposalNotFoundException>(() => proposal.DecideUpsert(BabyId, Guid.NewGuid(), Terms(), null, Now));
    }

    [Fact]
    public void DecideUpsert_OlderClientTime_IsStaleAndNewerApplies()
    {
        var proposal = Pending();

        Assert.Equal(ProposalUpsertDecision.IgnoreStale, proposal.DecideUpsert(BabyId, DoctorId, Terms(name: "Other"), Now.AddMinutes(-1), Now));
        Assert.Equal(ProposalUpsertDecision.Apply, proposal.DecideUpsert(BabyId, DoctorId, Terms(name: "Other"), Now.AddMinutes(1), Now.AddMinutes(1)));
    }

    [Fact]
    public void Edit_Pending_AppliesAndStampsTimes()
    {
        var proposal = Pending();
        var later = Now.AddMinutes(10);

        proposal.Edit(Terms(amount: 3), later, later);

        Assert.Equal((3m, later, later), (proposal.Dose.Amount, proposal.UpdatedAt, proposal.ClientUpdatedAt));
    }

    [Fact]
    public void Decided_IsImmutable_ButAnUnchangedReplayIsIgnored()
    {
        var proposal = Pending();
        proposal.Decline(ParentId, "Already on it", Now.AddMinutes(5));

        var replay = proposal.DecideUpsert(BabyId, DoctorId, Terms(), Now.AddMinutes(6), Now.AddMinutes(6));
        var change = Assert.Throws<ProposalDecidedException>(() => proposal.DecideUpsert(BabyId, DoctorId, Terms(amount: 3), Now.AddMinutes(6), Now.AddMinutes(6)));

        Assert.Equal(ProposalUpsertDecision.IgnoreDecided, replay);
        Assert.Equal(("proposal_decided", "declined"), (change.Code, change.Status));
        Assert.Throws<ProposalDecidedException>(() => proposal.Edit(Terms(amount: 3), Now.AddMinutes(6)));
    }

    [Fact]
    public void Withdraw_ByTheAuthor_CancelsAPendingProposal()
    {
        var proposal = Pending();

        var withdrawn = proposal.Withdraw(BabyId, DoctorId, Now.AddMinutes(1));

        Assert.True(withdrawn);
        Assert.Equal((ProposalStatus.Cancelled, ProposalCancelReason.Withdrawn, DoctorId), (proposal.Status, proposal.CancelReason!.Value, proposal.DecidedBy!.Value));
    }

    [Fact]
    public void Withdraw_AnotherDoctorAnotherBabyOrDecided_IsANoOp()
    {
        var pending = Pending();
        var accepted = Pending();
        accepted.Accept(ParentId, Guid.NewGuid(), Now);

        Assert.False(pending.Withdraw(BabyId, Guid.NewGuid(), Now));
        Assert.False(pending.Withdraw(Guid.NewGuid(), DoctorId, Now));
        Assert.False(accepted.Withdraw(BabyId, DoctorId, Now));
        Assert.Equal((ProposalStatus.Pending, ProposalStatus.Accepted), (pending.Status, accepted.Status));
    }

    [Fact]
    public void DecideAccept_PendingApplies_AcceptedIsAReplay_OthersAreNotPending()
    {
        var pending = Pending();
        var accepted = Pending();
        accepted.Accept(ParentId, Guid.NewGuid(), Now);
        var declined = Pending();
        declined.Decline(ParentId, null, Now);

        Assert.Equal(ProposalDecisionOutcome.Apply, pending.DecideAccept());
        Assert.Equal(ProposalDecisionOutcome.AlreadyDecided, accepted.DecideAccept());
        Assert.Equal("proposal_not_pending", Assert.Throws<ProposalNotPendingException>(() => declined.DecideAccept()).Code);
        Assert.Equal(ProposalDecisionOutcome.AlreadyDecided, declined.DecideDecline());
        Assert.Throws<ProposalNotPendingException>(() => accepted.DecideDecline());
    }

    [Fact]
    public void Decline_RecordsTheReasonTrimmedAndAtMost500()
    {
        var proposal = Pending();

        Assert.Equal("reason", Assert.Throws<DomainValidationException>(() => Pending().Decline(ParentId, new string('a', 501), Now)).Field);
        proposal.Decline(ParentId, "  We prefer the drops.  ", Now.AddMinutes(2));

        Assert.Equal((ProposalStatus.Declined, "We prefer the drops.", ParentId, Now.AddMinutes(2)), (proposal.Status, proposal.DeclineReason, proposal.DecidedBy!.Value, proposal.UpdatedAt));
    }

    [Fact]
    public void CancelForAccessRemoved_CancelsPendingOnlyAndKeepsDecided()
    {
        var pending = Pending();
        var accepted = Pending();
        var prescriptionId = Guid.NewGuid();
        accepted.Accept(ParentId, prescriptionId, Now);

        Assert.True(pending.CancelForAccessRemoved(ParentId, Now.AddHours(1)));
        Assert.False(accepted.CancelForAccessRemoved(ParentId, Now.AddHours(1)));
        Assert.Equal((ProposalStatus.Cancelled, ProposalCancelReason.AccessRemoved), (pending.Status, pending.CancelReason!.Value));
        Assert.Equal((ProposalStatus.Accepted, prescriptionId), (accepted.Status, accepted.AcceptedPrescriptionId!.Value));
    }

    [Theory]
    [InlineData(BabyRole.Owner, false, true)]
    [InlineData(BabyRole.Parent, false, true)]
    [InlineData(BabyRole.Doctor, true, true)]
    [InlineData(BabyRole.Doctor, false, false)]
    [InlineData(BabyRole.Caregiver, false, false)]
    [InlineData(BabyRole.Viewer, false, false)]
    public void IsVisibleTo_OwnersAndParentsAllTheAuthorHersNobodyElse(BabyRole role, bool isAuthor, bool expected)
    {
        var proposal = Pending();

        Assert.Equal(expected, proposal.IsVisibleTo(isAuthor ? DoctorId : Guid.NewGuid(), role));
    }

    [Fact]
    public void Codes_RoundTrip()
    {
        Assert.All(Enum.GetValues<ProposalStatus>(), status => Assert.Equal(status, ProposalCodes.StatusOf(ProposalCodes.Of(status))));
        Assert.Equal("access_removed", ProposalCodes.Of(ProposalCancelReason.AccessRemoved));
        Assert.Equal(ProposalCancelReason.Withdrawn, ProposalCodes.CancelReasonOf("withdrawn"));
        Assert.Throws<ArgumentOutOfRangeException>(() => ProposalCodes.StatusOf("maybe"));
    }
}
