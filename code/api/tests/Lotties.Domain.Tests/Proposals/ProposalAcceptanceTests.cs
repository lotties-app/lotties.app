using Lotties.Domain.Medications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using static Lotties.Domain.Tests.Proposals.ProposalFixtures;

namespace Lotties.Domain.Tests.Proposals;

/// <summary>Accepting a proposal and the provenance it leaves on the prescription (docs/design/16-doctor-access.md sections 10.1 and 10.2).</summary>
public sealed class ProposalAcceptanceTests
{
    private static readonly DateOnly AcceptDay = new(2026, 10, 22);

    private static ProposalAcceptanceInput Input(PrescriptionProposal proposal, Prescription? replaced = null, IReadOnlyList<PrescriptionProposal>? competing = null) =>
        new(proposal, Guid.NewGuid(), "Ana Souza", replaced, competing ?? [], Guid.NewGuid(), ParentId, AcceptDay);

    private static Prescription ParentEntered(DateOnly? start = null, DateOnly? end = null) =>
        Prescription.Create(
            Guid.NewGuid(),
            BabyId,
            PrescriptionTerms.Create(Guid.NewGuid(), PrescriptionStatus.Active, DoseRule.Create(1, "ml", false, null), TwiceADay(), null, start ?? new DateOnly(2026, 10, 1), end, null, null),
            ParentId,
            Now.AddDays(-30));

    private static Prescription DoctorSourced() => ProposalAcceptance.Accept(Input(Pending()), Now);

    [Fact]
    public void Accept_CreatesAnActivePrescriptionWithProvenanceAndMarksTheProposalAccepted()
    {
        var proposal = Pending(Terms(productId: Guid.NewGuid()));
        var input = Input(proposal);

        var prescription = ProposalAcceptance.Accept(input, Now.AddMinutes(30));

        Assert.Equal((input.PrescriptionId, BabyId, input.MedicationId, PrescriptionStatus.Active), (prescription.Id, prescription.BabyId, prescription.MedicationId, prescription.Status));
        Assert.Equal((proposal.Dose, proposal.Schedule, proposal.StartDate, proposal.EndDate, proposal.Instructions), (prescription.Dose, prescription.Schedule, prescription.StartDate, prescription.EndDate, prescription.Instructions));
        Assert.NotSame(proposal.Dose, prescription.Dose);
        Assert.Equal(("Ana Souza", "Ana Souza", DoctorId, proposal.Id, false), (prescription.Prescriber, prescription.PrescribedByName, prescription.PrescribedByUserId!.Value, prescription.ProposalId!.Value, prescription.ChangedByParent));
        Assert.Equal(ParentId, prescription.CreatedBy);
        Assert.Equal(("Paracetamol", proposal.ProductId, 2m, "drops", "Give with milk."), (prescription.OriginalSnapshot!.MedicationName, prescription.OriginalSnapshot.ProductId, prescription.OriginalSnapshot.DoseAmount, prescription.OriginalSnapshot.DoseUnit, prescription.OriginalSnapshot.Instructions));
        Assert.Equal(new[] { "08:00", "20:00" }, prescription.OriginalSnapshot.TimesOfDay);
        Assert.Equal((ProposalStatus.Accepted, prescription.Id, ParentId, Now.AddMinutes(30)), (proposal.Status, proposal.AcceptedPrescriptionId!.Value, proposal.DecidedBy!.Value, proposal.DecidedAt!.Value));
    }

    [Fact]
    public void Accept_NotPending_Throws()
    {
        var proposal = Pending();
        proposal.Decline(ParentId, null, Now);

        Assert.Throws<Exceptions.ProposalNotPendingException>(() => ProposalAcceptance.Accept(Input(proposal), Now));
    }

    [Fact]
    public void Accept_AChange_EndsTheReplacedPrescriptionOnTheAcceptDayAndSupersedesTheOtherChanges()
    {
        var replaced = ParentEntered();
        var proposal = Pending(Terms(replaces: replaced.Id));
        var competing = Pending(Terms(replaces: replaced.Id, amount: 4));

        ProposalAcceptance.Accept(Input(proposal, replaced, [proposal, competing]), Now);

        Assert.Equal((PrescriptionStatus.Stopped, AcceptDay, false, false), (replaced.Status, replaced.EndDate!.Value, replaced.IsDeleted, replaced.ChangedByParent));
        Assert.Equal((ProposalStatus.Accepted, ProposalStatus.Superseded), (proposal.Status, competing.Status));
    }

    [Fact]
    public void EndForReplacement_KeepsTheEndWithinTheCourse()
    {
        var notStarted = ParentEntered(start: AcceptDay.AddDays(3));
        var endedEarlier = ParentEntered(end: AcceptDay.AddDays(-2));
        var deleted = ParentEntered();
        deleted.SoftDelete(Now);

        notStarted.EndForReplacement(AcceptDay, Now);
        endedEarlier.EndForReplacement(AcceptDay, Now);
        var changedDeleted = deleted.EndForReplacement(AcceptDay, Now);

        Assert.Equal(AcceptDay.AddDays(3), notStarted.EndDate);
        Assert.Equal(AcceptDay.AddDays(-2), endedEarlier.EndDate);
        Assert.False(changedDeleted);
        Assert.Equal(PrescriptionStatus.Active, deleted.Status);
    }

    [Fact]
    public void Edit_DoctorSourcedContentChange_MarksChangedByParentForGood()
    {
        var prescription = DoctorSourced();
        var original = prescription.OriginalSnapshot;
        var changed = PrescriptionTerms.Create(prescription.MedicationId, PrescriptionStatus.Active, DoseRule.Create(3, "drops", false, null), prescription.Schedule, null, prescription.StartDate, prescription.EndDate, prescription.Prescriber, prescription.Instructions);

        prescription.Edit(changed, Now.AddHours(1));
        prescription.Edit(PrescriptionTerms.Create(prescription.MedicationId, PrescriptionStatus.Active, DoseRule.Create(2, "drops", false, null), prescription.Schedule, null, prescription.StartDate, prescription.EndDate, prescription.Prescriber, prescription.Instructions), Now.AddHours(2));

        Assert.True(prescription.ChangedByParent);
        Assert.Same(original, prescription.OriginalSnapshot);
    }

    [Fact]
    public void Edit_DoctorSourcedStopOnly_IsNotAChange()
    {
        var prescription = DoctorSourced();
        var stopped = PrescriptionTerms.Create(prescription.MedicationId, PrescriptionStatus.Stopped, prescription.Dose, prescription.Schedule, null, prescription.StartDate, prescription.EndDate, prescription.Prescriber, prescription.Instructions);

        prescription.Edit(stopped, Now.AddHours(1));

        Assert.Equal((PrescriptionStatus.Stopped, false), (prescription.Status, prescription.ChangedByParent));
    }

    [Fact]
    public void Edit_ParentEntered_IsNeverMarked()
    {
        var prescription = ParentEntered();
        var changed = PrescriptionTerms.Create(prescription.MedicationId, PrescriptionStatus.Active, DoseRule.Create(3, "ml", false, null), prescription.Schedule, null, prescription.StartDate, null, null, null);

        prescription.Edit(changed, Now);

        Assert.False(prescription.ChangedByParent);
        Assert.Null(prescription.ProposalId);
    }

    [Fact]
    public void FindExisting_PicksTheMedicationThenTheProductThenTheName()
    {
        var productId = Guid.NewGuid();
        var picked = Medication.Create(Guid.NewGuid(), BabyId, "Tylenol baby", null, null, false, Now);
        var linked = Medication.Create(Guid.NewGuid(), BabyId, "My drops", null, null, false, Now, productId);
        var named = Medication.Create(Guid.NewGuid(), BabyId, " paracetamol ", null, null, false, Now);
        var list = new[] { picked, linked, named };

        Assert.Same(picked, ProposalMedications.FindExisting(MedicationReference.Create(picked.Id, productId, "Paracetamol"), list));
        Assert.Same(linked, ProposalMedications.FindExisting(MedicationReference.Create(Guid.NewGuid(), productId, "Paracetamol"), list));
        Assert.Same(named, ProposalMedications.FindExisting(MedicationReference.Create(null, null, "PARACETAMOL"), list));
        Assert.Null(ProposalMedications.FindExisting(MedicationReference.Create(null, null, "Simethicone"), list));
    }

    [Fact]
    public void CreateFor_DerivesTheIdFromTheProposalAndLinksTheProduct()
    {
        var proposalId = Guid.NewGuid();
        var productId = Guid.NewGuid();

        var first = ProposalMedications.CreateFor(proposalId, BabyId, MedicationReference.Create(null, productId, "Luftal"), productId, Now);
        var replay = ProposalMedications.CreateFor(proposalId, BabyId, MedicationReference.Create(null, productId, "Luftal"), productId, Now);

        Assert.Equal(first.Id, replay.Id);
        Assert.Equal(("Luftal", productId, BabyId), (first.Name, first.ProductId!.Value, first.BabyId));
    }
}
