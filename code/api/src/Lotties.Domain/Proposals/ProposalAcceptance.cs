using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Proposals;

/// <summary>Everything an accept needs, loaded by the use case (docs/design/16-doctor-access.md section 10.1).</summary>
/// <param name="Proposal">The pending proposal (tracked).</param>
/// <param name="MedicationId">The resolved medication of the baby's list (<see cref="ProposalMedications"/>).</param>
/// <param name="DoctorName">The author's display name now (the provenance snapshot; the prescriber).</param>
/// <param name="Replaced">The prescription the proposal changes, when it is still there (tracked).</param>
/// <param name="CompetingProposals">The other pending proposals that change the same prescription (tracked).</param>
/// <param name="PrescriptionId">The client-generated id of the new prescription.</param>
/// <param name="AcceptedBy">The Owner or Parent who accepts.</param>
/// <param name="AcceptedOn">The accept day (the client's local date): the replaced prescription's last day.</param>
public sealed record ProposalAcceptanceInput(
    PrescriptionProposal Proposal,
    Guid MedicationId,
    string DoctorName,
    Prescription? Replaced,
    IReadOnlyList<PrescriptionProposal> CompetingProposals,
    Guid PrescriptionId,
    Guid AcceptedBy,
    DateOnly AcceptedOn);

/// <summary>
/// Accepting a proposal, pure: creates the prescription from the proposal's terms with its provenance, marks the
/// proposal accepted, ends the prescription it replaces (stopped, last day = the accept day; never deleted) and
/// supersedes the other pending proposals that change that prescription. The caller saves everything in one
/// transaction.
/// </summary>
public static class ProposalAcceptance
{
    public static Prescription Accept(ProposalAcceptanceInput input, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(input);
        var proposal = input.Proposal;
        var terms = proposal.Terms;
        var prescription = Prescription.CreateFromProposal(
            input.PrescriptionId,
            proposal.BabyId,
            terms.ToPrescriptionTerms(input.MedicationId, input.DoctorName),
            new PrescriptionProvenance(proposal.AuthorUserId, input.DoctorName, proposal.Id, terms.ToSnapshot()),
            input.AcceptedBy,
            now);
        proposal.Accept(input.AcceptedBy, prescription.Id, now);
        input.Replaced?.EndForReplacement(input.AcceptedOn, now);
        SupersedeCompeting(input.CompetingProposals, proposal.Id, now);
        return prescription;
    }

    private static void SupersedeCompeting(IReadOnlyList<PrescriptionProposal> competing, Guid acceptedId, DateTimeOffset now) =>
        competing.Where(other => other.Id != acceptedId).ToList().ForEach(other => other.Supersede(now));
}
