using Lotties.Application.Notifications;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Visibility is part of every list query (<see cref="ProposalVisibility.AudienceOf"/>: all, the reader's own, or none),
/// so a proposal never leaves the database for a member who may not see it. A concurrent create of one id loses on the
/// primary key; a lost decision race (the <c>xmin</c> row version, or the new prescription's or medication's key) is a
/// <see cref="ConcurrentModificationException"/> and the accept saves nothing (one <c>SaveChanges</c>, one transaction).
/// </remarks>
internal sealed class EfPrescriptionProposalRepository(
    LottiesDbContext context,
    UniqueViolations uniqueViolations,
    ILogger<EfPrescriptionProposalRepository> logger) : IPrescriptionProposalRepository
{
    private const string Resource = "proposal";

    public Task<PrescriptionProposal?> FindAsync(Guid proposalId, CancellationToken cancellationToken = default) =>
        context.PrescriptionProposals.SingleOrDefaultAsync(proposal => proposal.Id == proposalId, cancellationToken);

    public async Task<IReadOnlyList<PrescriptionProposal>> ListChangesVisibleToAsync(Guid babyId, Guid readerUserId, BabyRole readerRole, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var audience = ProposalVisibility.AudienceOf(readerRole);
        if (audience == ProposalAudience.None)
        {
            return [];
        }

        var ofBaby = context.PrescriptionProposals.AsNoTracking().Where(proposal => proposal.BabyId == babyId);
        var visible = audience == ProposalAudience.Own ? ofBaby.Where(proposal => proposal.AuthorUserId == readerUserId) : ofBaby;
        var changed = since is { } from ? visible.Where(proposal => proposal.UpdatedAt >= from.ToUniversalTime()) : visible;
        return await changed.OrderBy(proposal => proposal.UpdatedAt).ThenBy(proposal => proposal.Id).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PrescriptionProposal>> ListPendingByAuthorAsync(Guid babyId, Guid authorUserId, CancellationToken cancellationToken = default) =>
        await context.PrescriptionProposals
            .Where(proposal => proposal.BabyId == babyId && proposal.AuthorUserId == authorUserId && proposal.Status == ProposalStatus.Pending)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<PrescriptionProposal>> ListPendingReplacingAsync(Guid babyId, Guid prescriptionId, CancellationToken cancellationToken = default) =>
        await context.PrescriptionProposals
            .Where(proposal => proposal.BabyId == babyId && proposal.ReplacesPrescriptionId == prescriptionId && proposal.Status == ProposalStatus.Pending)
            .ToListAsync(cancellationToken);

    public Task<bool> TryAddAsync(PrescriptionProposal proposal, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, proposal, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => SaveOrConflictAsync(cancellationToken);

    public Task SaveAcceptanceAsync(Prescription prescription, Medication? addedMedication, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(prescription);
        if (addedMedication is not null)
        {
            context.Medications.Add(addedMedication);
        }

        context.Prescriptions.Add(prescription);
        return SaveOrConflictAsync(cancellationToken);
    }

    private async Task SaveOrConflictAsync(CancellationToken cancellationToken)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            context.ChangeTracker.Clear();
            throw new ConcurrentModificationException(Resource, exception);
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.ChangeTracker.Clear();
            throw new ConcurrentModificationException(Resource, exception);
        }
        catch (DbUpdateException exception)
        {
            logger.LogError(exception, "Saving prescription proposals failed with a database error that is not a race");
            context.ChangeTracker.Clear();
            throw;
        }
    }
}

/// <remarks>A concurrent first read of one note by one member loses on the primary key (<see cref="UniqueInserts"/>).</remarks>
internal sealed class EfNoteReadRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : INoteReadRepository
{
    public Task<NoteRead?> FindAsync(Guid noteId, Guid userId, CancellationToken cancellationToken = default) =>
        context.NoteReads.AsNoTracking().SingleOrDefaultAsync(read => read.NoteId == noteId && read.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<NoteRead>> ListChangesAsync(Guid babyId, Guid userId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var mine = context.NoteReads.AsNoTracking().Where(read => read.BabyId == babyId && read.UserId == userId);
        var changed = since is { } from ? mine.Where(read => read.ReadAt >= from.ToUniversalTime()) : mine;
        return await changed.OrderBy(read => read.ReadAt).ThenBy(read => read.NoteId).ToListAsync(cancellationToken);
    }

    public Task<bool> TryAddAsync(NoteRead read, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, read, cancellationToken);
}

/// <remarks>Two small queries per baby, run only when an Owner or Parent of the baby wants the push.</remarks>
internal sealed class EfDoctorSuggestionRepository(LottiesDbContext context) : IDoctorSuggestionRepository
{
    public async Task<IReadOnlyList<DoctorSuggestion>> ListSinceAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default)
    {
        var from = since.ToUniversalTime();
        var proposals = await context.PrescriptionProposals
            .AsNoTracking()
            .Where(proposal => proposal.BabyId == babyId && proposal.Status == ProposalStatus.Pending && proposal.CreatedAt >= from)
            .Select(proposal => new { proposal.Id, proposal.AuthorUserId, proposal.CreatedAt })
            .ToListAsync(cancellationToken);
        var notes = await context.BabyNotes
            .AsNoTracking()
            .Where(note => note.BabyId == babyId
                && note.Kind == NoteKind.Recommendation
                && note.Visibility == NoteVisibility.Shared
                && note.DeletedAt == null
                && note.CreatedAt >= from)
            .Select(note => new { note.Id, note.AuthorUserId, note.CreatedAt })
            .ToListAsync(cancellationToken);
        IReadOnlyCollection<Guid> noteIds = notes.Select(note => note.Id).ToArray();
        var reads = noteIds.Count == 0
            ? []
            : await context.NoteReads.AsNoTracking().Where(read => noteIds.Contains(read.NoteId)).Select(read => new { read.NoteId, read.UserId }).ToListAsync(cancellationToken);
        var readers = reads.ToLookup(read => read.NoteId, read => read.UserId);
        return proposals
            .Select(proposal => new DoctorSuggestion(proposal.Id, DoctorSuggestionSource.Proposal, proposal.AuthorUserId, proposal.CreatedAt))
            .Concat(notes.Select(note => new DoctorSuggestion(note.Id, DoctorSuggestionSource.Recommendation, note.AuthorUserId, note.CreatedAt, readers[note.Id].ToArray())))
            .OrderBy(suggestion => suggestion.CreatedAt)
            .ToArray();
    }
}
