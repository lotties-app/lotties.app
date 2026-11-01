using Lotties.Application.Babies;
using Lotties.Application.Prescriptions;
using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Catalog;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Medications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Proposals;

/// <summary>
/// Prescription proposals of one baby (docs/design/16-doctor-access.md section 10.1). Callers have already authorized the
/// current user for the baby (reads: any member, filtered by <see cref="ProposalVisibility"/>; upsert and withdraw: the
/// Doctor; accept and decline: Owner or Parent).
/// </summary>
public interface IPrescriptionProposalService
{
    /// <summary>The baby's proposals the caller sees, changed at or after <paramref name="since"/> (all when <c>null</c>), by (updatedAt, id).</summary>
    Task<IReadOnlyList<ProposalResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>One proposal; <see cref="ProposalNotFoundException"/> when unknown, of another baby or not visible to the caller.</summary>
    Task<ProposalResponse> GetAsync(Guid babyId, Guid proposalId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent upsert by client id (see <see cref="PrescriptionProposal.DecideUpsert"/>); the caller becomes the author of a new proposal.</summary>
    Task<UpsertProposalResult> UpsertAsync(Guid babyId, Guid proposalId, UpsertProposalRequest request, CancellationToken cancellationToken = default);

    /// <summary>The author withdraws her pending proposal; anything else is a no-op (see <see cref="PrescriptionProposal.Withdraw"/>).</summary>
    Task WithdrawAsync(Guid babyId, Guid proposalId, CancellationToken cancellationToken = default);

    /// <summary>Accepts in one transaction (see <see cref="ProposalAcceptance"/>); a replay returns the stored outcome.</summary>
    Task<ProposalDecisionResponse> AcceptAsync(Guid babyId, Guid proposalId, AcceptProposalRequest request, CancellationToken cancellationToken = default);

    /// <summary>Declines with an optional reason; a replay returns the stored outcome.</summary>
    Task<ProposalDecisionResponse> DeclineAsync(Guid babyId, Guid proposalId, DeclineProposalRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as notes: the server <c>updatedAt</c> is the delta cursor, the doctor's <c>updatedAt</c> (stored as
/// <c>clientUpdatedAt</c>) decides conflicts between her edits, an unchanged replay changes nothing, concurrent creates
/// of one id resolve to one row. A decision is a server event (it stamps the server time on both).
/// </remarks>
internal sealed class PrescriptionProposalService : IPrescriptionProposalService
{
    private readonly IPrescriptionProposalRepository _proposals;
    private readonly IPrescriptionRepository _prescriptions;
    private readonly IMedicationRepository _medications;
    private readonly ICatalogRepository _catalog;
    private readonly IPersonDirectory _people;
    private readonly IBabyAccessService _access;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<PrescriptionProposalService> _logger;

    public PrescriptionProposalService(
        IPrescriptionProposalRepository proposals,
        IPrescriptionRepository prescriptions,
        IMedicationRepository medications,
        ICatalogRepository catalog,
        IPersonDirectory people,
        IBabyAccessService access,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<PrescriptionProposalService> logger)
    {
        _proposals = proposals ?? throw new ArgumentNullException(nameof(proposals));
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _medications = medications ?? throw new ArgumentNullException(nameof(medications));
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _people = people ?? throw new ArgumentNullException(nameof(people));
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<ProposalResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var reader = await ReaderAsync(babyId, cancellationToken);
        var visible = await _proposals.ListChangesVisibleToAsync(babyId, reader.UserId, reader.Role, since, cancellationToken);
        return await DescribeAsync(visible, cancellationToken);
    }

    public async Task<ProposalResponse> GetAsync(Guid babyId, Guid proposalId, CancellationToken cancellationToken = default)
    {
        var proposal = await FindVisibleAsync(babyId, proposalId, cancellationToken);
        return await DescribeAsync(proposal, cancellationToken);
    }

    public async Task<UpsertProposalResult> UpsertAsync(Guid babyId, Guid proposalId, UpsertProposalRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureClientId(proposalId, "proposalId");
        var terms = (ProposalTerms)request;
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var existing = await _proposals.FindAsync(proposalId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, proposalId, user.Id, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, user.Id, existing, terms, request.UpdatedAt, cancellationToken);
    }

    public async Task WithdrawAsync(Guid babyId, Guid proposalId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var existing = await _proposals.FindAsync(proposalId, cancellationToken);
        if (existing is null || !existing.Withdraw(babyId, user.Id, _timeProvider.GetUtcNow()))
        {
            _logger.LogDebug("Withdraw of proposal {ProposalId} for baby {BabyId} is a no-op", proposalId, babyId);
            return;
        }

        await _proposals.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Withdrew proposal {ProposalId} of baby {BabyId}", proposalId, babyId);
    }

    public async Task<ProposalDecisionResponse> AcceptAsync(Guid babyId, Guid proposalId, AcceptProposalRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var proposal = await FindVisibleAsync(babyId, proposalId, cancellationToken);
        return proposal.DecideAccept() == ProposalDecisionOutcome.AlreadyDecided
            ? await DecisionOfAsync(proposal, cancellationToken)
            : await ApplyAcceptAsync(proposal, request, cancellationToken);
    }

    public async Task<ProposalDecisionResponse> DeclineAsync(Guid babyId, Guid proposalId, DeclineProposalRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var proposal = await FindVisibleAsync(babyId, proposalId, cancellationToken);
        if (proposal.DecideDecline() == ProposalDecisionOutcome.Apply)
        {
            var user = await _currentUser.GetUserAsync(cancellationToken);
            proposal.Decline(user.Id, request.Reason, _timeProvider.GetUtcNow());
            await _proposals.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Proposal {ProposalId} of baby {BabyId} declined by {UserId}", proposalId, babyId, user.Id);
        }

        return await DecisionOfAsync(proposal, cancellationToken);
    }

    private async Task<UpsertProposalResult> CreateAsync(Guid babyId, Guid proposalId, Guid authorUserId, ProposalTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        await EnsureReferencesAsync(babyId, terms, previous: null, cancellationToken);
        var created = PrescriptionProposal.Create(proposalId, babyId, terms, authorUserId, _timeProvider.GetUtcNow(), clientUpdatedAt);
        if (await _proposals.TryAddAsync(created, cancellationToken))
        {
            _logger.LogInformation("Created proposal {ProposalId} for baby {BabyId}", proposalId, babyId);
            return new UpsertProposalResult(await DescribeAsync(created, cancellationToken), Created: true);
        }

        _logger.LogInformation("Proposal {ProposalId} was created concurrently; applying the request as an edit", proposalId);
        var winner = await _proposals.FindAsync(proposalId, cancellationToken)
            ?? throw new InvalidOperationException($"Proposal {proposalId} was reported as existing but could not be loaded.");
        return await UpdateAsync(babyId, authorUserId, winner, terms, clientUpdatedAt, cancellationToken);
    }

    private async Task<UpsertProposalResult> UpdateAsync(Guid babyId, Guid userId, PrescriptionProposal existing, ProposalTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        if (existing.DecideUpsert(babyId, userId, terms, clientUpdatedAt, now) == ProposalUpsertDecision.Apply)
        {
            await EnsureReferencesAsync(babyId, terms, existing.Terms, cancellationToken);
            existing.Edit(terms, now, clientUpdatedAt);
            await _proposals.SaveChangesAsync(cancellationToken);
        }

        return new UpsertProposalResult(await DescribeAsync(existing, cancellationToken), Created: false);
    }

    private async Task<ProposalDecisionResponse> ApplyAcceptAsync(PrescriptionProposal proposal, AcceptProposalRequest request, CancellationToken cancellationToken)
    {
        await EnsurePrescriptionIdFreeAsync(request.PrescriptionId, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var medication = await ResolveMedicationAsync(proposal, now, cancellationToken);
        var replaced = await FindReplacedAsync(proposal, cancellationToken);
        var input = new ProposalAcceptanceInput(
            proposal,
            medication.Existing?.Id ?? medication.Added!.Id,
            await DoctorNameAsync(proposal.AuthorUserId, cancellationToken),
            replaced,
            await CompetingAsync(proposal, replaced, cancellationToken),
            request.PrescriptionId,
            user.Id,
            request.AcceptedOn ?? DateOnly.FromDateTime(now.UtcDateTime));
        var prescription = ProposalAcceptance.Accept(input, now);
        await _proposals.SaveAcceptanceAsync(prescription, medication.Added, cancellationToken);
        _logger.LogInformation(
            "Proposal {ProposalId} of baby {BabyId} accepted by {UserId} as prescription {PrescriptionId} (replaced {ReplacedId})",
            proposal.Id,
            proposal.BabyId,
            user.Id,
            prescription.Id,
            replaced?.Id);
        return new ProposalDecisionResponse(await DescribeAsync(proposal, cancellationToken), await DescribePrescriptionAsync(prescription, cancellationToken));
    }

    private async Task<ResolvedMedication> ResolveMedicationAsync(PrescriptionProposal proposal, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var reference = proposal.Terms.Medication;
        var existing = ProposalMedications.FindExisting(reference, await _medications.ListForBabyAsync(proposal.BabyId, cancellationToken));
        return existing is not null
            ? new ResolvedMedication(existing, null)
            : new ResolvedMedication(null, ProposalMedications.CreateFor(proposal.Id, proposal.BabyId, reference, await LinkableProductIdAsync(reference.ProductId, cancellationToken), now));
    }

    /// <summary>The product a new medication links to: the proposal's, or the one it was merged into; none when it is gone.</summary>
    private async Task<Guid?> LinkableProductIdAsync(Guid? productId, CancellationToken cancellationToken)
    {
        var product = productId is { } id ? await _catalog.FindProductAsync(id, cancellationToken) : null;
        return product?.MergedIntoId ?? product?.Id;
    }

    private async Task<Prescription?> FindReplacedAsync(PrescriptionProposal proposal, CancellationToken cancellationToken)
    {
        var replaced = proposal.ReplacesPrescriptionId is { } id ? await _prescriptions.FindAsync(id, cancellationToken) : null;
        return replaced is { IsDeleted: false } && replaced.BabyId == proposal.BabyId ? replaced : null;
    }

    private async Task<IReadOnlyList<PrescriptionProposal>> CompetingAsync(PrescriptionProposal proposal, Prescription? replaced, CancellationToken cancellationToken) =>
        replaced is null ? [] : await _proposals.ListPendingReplacingAsync(proposal.BabyId, replaced.Id, cancellationToken);

    /// <summary>The author's name as the family sees her now (the professional name); at most the prescriber length.</summary>
    private async Task<string> DoctorNameAsync(Guid authorUserId, CancellationToken cancellationToken)
    {
        var people = await _people.DescribeAsync([authorUserId], cancellationToken);
        var name = people.GetValueOrDefault(authorUserId)?.DisplayName?.Trim() is { Length: > 0 } known ? known : "Doctor";
        return name.Length > PrescriptionTerms.PrescriberMaxLength ? name[..PrescriptionTerms.PrescriberMaxLength].TrimEnd() : name;
    }

    private async Task EnsurePrescriptionIdFreeAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        EnsureClientId(prescriptionId, "prescriptionId");
        if (await _prescriptions.FindAsync(prescriptionId, cancellationToken) is not null)
        {
            throw new DomainValidationException("prescriptionId", "The prescription id is already used; generate a new one.");
        }
    }

    /// <summary>
    /// The references of new or changed terms: the medication must be in the baby's list, the product linkable (exists,
    /// not merged) and the replaced prescription a live prescription of the baby. Unchanged references are not checked
    /// again, so replaying an edit never fails because something changed meanwhile.
    /// </summary>
    private async Task EnsureReferencesAsync(Guid babyId, ProposalTerms terms, ProposalTerms? previous, CancellationToken cancellationToken)
    {
        await EnsureMedicationAsync(babyId, terms.Medication.MedicationId, previous?.Medication.MedicationId, cancellationToken);
        await EnsureProductAsync(terms.Medication.ProductId, previous?.Medication.ProductId, cancellationToken);
        await EnsureReplacedAsync(babyId, terms.ReplacesPrescriptionId, previous?.ReplacesPrescriptionId, cancellationToken);
    }

    private async Task EnsureMedicationAsync(Guid babyId, Guid? medicationId, Guid? previous, CancellationToken cancellationToken)
    {
        if (medicationId is not { } id || id == previous)
        {
            return;
        }

        var medication = await _medications.FindAsync(id, cancellationToken);
        if (medication?.BabyId != babyId)
        {
            throw new PrescriptionMedicationNotFoundException(id, babyId);
        }
    }

    private async Task EnsureProductAsync(Guid? productId, Guid? previous, CancellationToken cancellationToken)
    {
        if (productId is not { } id || id == previous)
        {
            return;
        }

        var product = await _catalog.FindProductAsync(id, cancellationToken) ?? throw InvalidProductLinkException.NotFound(id);
        if (product.MergedIntoId is { } target)
        {
            throw InvalidProductLinkException.Merged(id, target);
        }
    }

    private async Task EnsureReplacedAsync(Guid babyId, Guid? prescriptionId, Guid? previous, CancellationToken cancellationToken)
    {
        if (prescriptionId is not { } id || id == previous)
        {
            return;
        }

        var prescription = await _prescriptions.FindAsync(id, cancellationToken);
        if (prescription is not { IsDeleted: false } || prescription.BabyId != babyId)
        {
            throw new ReplacedPrescriptionNotFoundException(id, babyId);
        }
    }

    private async Task<PrescriptionProposal> FindVisibleAsync(Guid babyId, Guid proposalId, CancellationToken cancellationToken)
    {
        var reader = await ReaderAsync(babyId, cancellationToken);
        var proposal = await _proposals.FindAsync(proposalId, cancellationToken);
        return proposal is not null && proposal.BabyId == babyId && proposal.IsVisibleTo(reader.UserId, reader.Role)
            ? proposal
            : throw new ProposalNotFoundException(babyId, proposalId);
    }

    private async Task<Reader> ReaderAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var role = await _access.FindRoleAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        return new Reader(user.Id, role);
    }

    private async Task<ProposalDecisionResponse> DecisionOfAsync(PrescriptionProposal proposal, CancellationToken cancellationToken)
    {
        var prescription = proposal.AcceptedPrescriptionId is { } id ? await _prescriptions.FindAsync(id, cancellationToken) : null;
        return new ProposalDecisionResponse(
            await DescribeAsync(proposal, cancellationToken),
            prescription is null ? null : await DescribePrescriptionAsync(prescription, cancellationToken));
    }

    private async Task<PrescriptionResponse> DescribePrescriptionAsync(Prescription prescription, CancellationToken cancellationToken)
    {
        var doctors = await _people.DescribeAsync(prescription.PrescribedByUserId is { } id ? [id] : [], cancellationToken);
        return PrescriptionResponse.For(prescription, doctors);
    }

    private async Task<ProposalResponse> DescribeAsync(PrescriptionProposal proposal, CancellationToken cancellationToken) =>
        (await DescribeAsync([proposal], cancellationToken))[0];

    private async Task<IReadOnlyList<ProposalResponse>> DescribeAsync(IReadOnlyList<PrescriptionProposal> proposals, CancellationToken cancellationToken)
    {
        var authors = await _people.DescribeAsync(proposals.Select(proposal => proposal.AuthorUserId).ToArray(), cancellationToken);
        return proposals.Select(proposal => ProposalResponse.For(proposal, authors.GetValueOrDefault(proposal.AuthorUserId))).ToArray();
    }

    private static void EnsureClientId(Guid id, string field)
    {
        if (id == Guid.Empty)
        {
            throw new DomainValidationException(field, $"The {field} must be a non-empty GUID generated by the client.");
        }
    }

    private sealed record Reader(Guid UserId, BabyRole Role);

    /// <summary>The baby's medication an accept uses: an existing one, or the one it adds.</summary>
    private sealed record ResolvedMedication(Medication? Existing, Medication? Added);
}
