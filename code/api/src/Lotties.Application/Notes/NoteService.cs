using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notes;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Notes;

/// <summary>
/// Note use cases of one baby, for offline sync (docs/design/16-doctor-access.md). Callers have already authorized the
/// current user for the baby (reads: any member; writes: a role that writes notes). Every read is filtered by
/// visibility for the current user: a private note exists only for its author.
/// </summary>
public interface INoteService
{
    /// <summary>The baby's notes visible to the caller changed at or after <paramref name="since"/> (all when <c>null</c>), deleted included, by (updatedAt, id).</summary>
    Task<IReadOnlyList<NoteResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>One note, deleted included; <see cref="NoteNotFoundException"/> when unknown, of another baby or private to someone else.</summary>
    Task<NoteResponse> GetAsync(Guid babyId, Guid noteId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent upsert by client id (see <see cref="BabyNote.DecideUpsert"/>); the caller becomes the author of a new note.</summary>
    Task<UpsertNoteResult> UpsertAsync(Guid babyId, Guid noteId, UpsertNoteRequest request, CancellationToken cancellationToken = default);

    /// <summary>Soft delete by the author (see <see cref="BabyNote.DecideDelete"/>); unknown ids are a no-op.</summary>
    Task DeleteAsync(Guid babyId, Guid noteId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records that the caller opened the note (idempotent: the first read is kept); <see cref="NoteNotFoundException"/>
    /// when unknown, of another baby or private to someone else (docs/design/16-doctor-access.md section 10.3).
    /// </summary>
    Task<NoteReadResponse> MarkReadAsync(Guid babyId, Guid noteId, CancellationToken cancellationToken = default);

    /// <summary>The caller's reads of the baby's notes at or after <paramref name="since"/> (all when <c>null</c>), by (readAt, noteId).</summary>
    Task<IReadOnlyList<NoteReadResponse>> ListReadsAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as formulas and prescriptions: the server <c>updatedAt</c> is the delta cursor, the client
/// <c>updatedAt</c> (stored as <c>clientUpdatedAt</c>) decides conflicts, an unchanged replay changes nothing, a delete
/// always wins, and concurrent creates of one id resolve to one row (the loser applies its request as an edit).
/// </remarks>
internal sealed class NoteService : INoteService
{
    private readonly INoteRepository _notes;
    private readonly INoteReadRepository _reads;
    private readonly IPersonDirectory _people;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<NoteService> _logger;

    public NoteService(INoteRepository notes, INoteReadRepository reads, IPersonDirectory people, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<NoteService> logger)
    {
        _notes = notes ?? throw new ArgumentNullException(nameof(notes));
        _reads = reads ?? throw new ArgumentNullException(nameof(reads));
        _people = people ?? throw new ArgumentNullException(nameof(people));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<NoteResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var visible = await _notes.ListChangesVisibleToAsync(babyId, user.Id, since, cancellationToken);
        return await DescribeAsync(visible, cancellationToken);
    }

    public async Task<NoteResponse> GetAsync(Guid babyId, Guid noteId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var note = await FindVisibleAsync(babyId, noteId, user.Id, cancellationToken);
        return await DescribeAsync(note, cancellationToken);
    }

    public async Task<NoteReadResponse> MarkReadAsync(Guid babyId, Guid noteId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var note = await FindVisibleAsync(babyId, noteId, user.Id, cancellationToken);
        if (await _reads.FindAsync(noteId, user.Id, cancellationToken) is { } known)
        {
            return known;
        }

        var read = NoteRead.Of(note, user.Id, _timeProvider.GetUtcNow());
        if (await _reads.TryAddAsync(read, cancellationToken))
        {
            _logger.LogInformation("User {UserId} read note {NoteId} of baby {BabyId}", user.Id, noteId, babyId);
            return read;
        }

        return await _reads.FindAsync(noteId, user.Id, cancellationToken)
            ?? throw new InvalidOperationException($"The read of note {noteId} was reported as existing but could not be loaded.");
    }

    public async Task<IReadOnlyList<NoteReadResponse>> ListReadsAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var reads = await _reads.ListChangesAsync(babyId, user.Id, since, cancellationToken);
        return reads.Select(read => (NoteReadResponse)read).ToArray();
    }

    private async Task<BabyNote> FindVisibleAsync(Guid babyId, Guid noteId, Guid userId, CancellationToken cancellationToken)
    {
        var note = await _notes.FindAsync(noteId, cancellationToken);
        return note is not null && note.BabyId == babyId && note.IsVisibleTo(userId)
            ? note
            : throw new NoteNotFoundException(babyId, noteId);
    }

    public async Task<UpsertNoteResult> UpsertAsync(Guid babyId, Guid noteId, UpsertNoteRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureNoteId(noteId);
        var terms = (NoteTerms)request;
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var existing = await _notes.FindAsync(noteId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, noteId, user.Id, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, user.Id, existing, terms, request.UpdatedAt, cancellationToken);
    }

    public async Task DeleteAsync(Guid babyId, Guid noteId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var existing = await _notes.FindAsync(noteId, cancellationToken);
        if (existing is null || !existing.DecideDelete(babyId, user.Id))
        {
            _logger.LogDebug("Delete of note {NoteId} for baby {BabyId} is a no-op", noteId, babyId);
            return;
        }

        existing.SoftDelete(_timeProvider.GetUtcNow());
        await _notes.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Deleted note {NoteId} of baby {BabyId}", noteId, babyId);
    }

    private async Task<UpsertNoteResult> CreateAsync(Guid babyId, Guid noteId, Guid authorUserId, NoteTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var created = BabyNote.Create(noteId, babyId, terms, authorUserId, _timeProvider.GetUtcNow(), clientUpdatedAt);
        if (await _notes.TryAddAsync(created, cancellationToken))
        {
            _logger.LogInformation("Created {Visibility} note {NoteId} for baby {BabyId}", terms.Visibility, noteId, babyId);
            return new UpsertNoteResult(await DescribeAsync(created, cancellationToken), Created: true);
        }

        _logger.LogInformation("Note {NoteId} was created concurrently; applying the request as an edit", noteId);
        var winner = await _notes.FindAsync(noteId, cancellationToken)
            ?? throw new InvalidOperationException($"Note {noteId} was reported as existing but could not be loaded.");
        return await UpdateAsync(babyId, authorUserId, winner, terms, clientUpdatedAt, cancellationToken);
    }

    private async Task<UpsertNoteResult> UpdateAsync(Guid babyId, Guid userId, BabyNote existing, NoteTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var decision = existing.DecideUpsert(babyId, userId, clientUpdatedAt, _timeProvider.GetUtcNow());
        if (decision == NoteUpsertDecision.Apply)
        {
            existing.Edit(terms, _timeProvider.GetUtcNow(), clientUpdatedAt);
            await _notes.SaveChangesAsync(cancellationToken);
        }

        return new UpsertNoteResult(await DescribeAsync(existing, cancellationToken), Created: false);
    }

    private async Task<NoteResponse> DescribeAsync(BabyNote note, CancellationToken cancellationToken) =>
        (await DescribeAsync([note], cancellationToken))[0];

    private async Task<IReadOnlyList<NoteResponse>> DescribeAsync(IReadOnlyList<BabyNote> notes, CancellationToken cancellationToken)
    {
        var authors = await _people.DescribeAsync(notes.Select(note => note.AuthorUserId).ToArray(), cancellationToken);
        return notes.Select(note => NoteResponse.For(note, authors.GetValueOrDefault(note.AuthorUserId))).ToArray();
    }

    private static void EnsureNoteId(Guid noteId)
    {
        if (noteId == Guid.Empty)
        {
            throw new DomainValidationException("noteId", "The note id must be a non-empty GUID generated by the client.");
        }
    }
}
