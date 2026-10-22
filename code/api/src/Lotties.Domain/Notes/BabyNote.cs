using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notes;

/// <summary>
/// A note a member wrote about a baby (v1: a Doctor; docs/design/16-doctor-access.md). The id is client generated; sync
/// follows the events contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor,
/// <see cref="ClientUpdatedAt"/> (client edit time, bounded to the server clock + 5 min) decides conflicts, and a delete
/// is soft (<see cref="DeletedAt"/>, always wins). Visibility is enforced on every read (<see cref="IsVisibleTo"/>): a
/// private note exists only for its author, and only the author edits or deletes a note.
/// </summary>
public sealed class BabyNote
{
    private BabyNote()
    {
    }

    private BabyNote(Guid id, Guid babyId, Guid authorUserId, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
    {
        Id = id;
        BabyId = babyId;
        AuthorUserId = authorUserId;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
        ClientUpdatedAt = clientUpdatedAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public Guid AuthorUserId { get; private set; }

    public NoteKind Kind { get; private set; }

    public NoteVisibility Visibility { get; private set; }

    public string Body { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public NoteTerms Terms => NoteTerms.Create(Kind, Visibility, Body);

    public static BabyNote Create(Guid id, Guid babyId, NoteTerms terms, Guid authorUserId, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var note = new BabyNote(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(authorUserId, nameof(authorUserId)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        note.Apply(terms);
        return note;
    }

    /// <summary>Whether <paramref name="userId"/> may see the note at all: shared notes everyone, private notes their author.</summary>
    public bool IsVisibleTo(Guid userId) => Visibility == NoteVisibility.Shared || AuthorUserId == userId;

    /// <summary>
    /// Decides how a client upsert by <paramref name="userId"/> applies, before any change: a note never moves to another
    /// baby (<see cref="NoteBabyMismatchException"/>); a private note of someone else is not revealed
    /// (<see cref="NoteNotFoundException"/>); only the author writes (<see cref="NoteNotOwnedException"/>); a deleted note
    /// stays deleted; a write whose bounded client time is strictly older than <see cref="ClientUpdatedAt"/> loses.
    /// </summary>
    public NoteUpsertDecision DecideUpsert(Guid babyId, Guid userId, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        EnsureBelongsTo(babyId);
        EnsureWritableBy(userId);
        return this switch
        {
            { IsDeleted: true } => NoteUpsertDecision.IgnoreDeleted,
            _ when clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt => NoteUpsertDecision.IgnoreStale,
            _ => NoteUpsertDecision.Apply,
        };
    }

    /// <summary>
    /// Whether a delete by <paramref name="userId"/> through <paramref name="babyId"/> applies: another baby's note or a
    /// private note of someone else is a no-op (<c>false</c>, nothing revealed); a shared note of someone else throws
    /// <see cref="NoteNotOwnedException"/>.
    /// </summary>
    public bool DecideDelete(Guid babyId, Guid userId)
    {
        if (BabyId != babyId || !IsVisibleTo(userId))
        {
            return false;
        }

        EnsureWritableBy(userId);
        return true;
    }

    /// <summary>
    /// Applies the full terms. Equal terms change nothing (not even the timestamps); otherwise <see cref="UpdatedAt"/>
    /// becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/> the bounded client time. A shared note never
    /// becomes private (<see cref="NoteAlreadySharedException"/>); a private one may be shared.
    /// </summary>
    public void Edit(NoteTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (IsDeleted || terms == Terms)
        {
            return;
        }

        EnsureNotWithdrawn(terms.Visibility);
        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = ClientEditTime.Bound(clientUpdatedAt, now);
    }

    /// <summary>Soft delete; always wins and is idempotent. Stamps <see cref="DeletedAt"/>, <see cref="UpdatedAt"/> and <see cref="ClientUpdatedAt"/> with <paramref name="now"/>.</summary>
    public void SoftDelete(DateTimeOffset now)
    {
        if (IsDeleted)
        {
            return;
        }

        var deletedAt = UtcTime.Normalize(now);
        DeletedAt = deletedAt;
        UpdatedAt = deletedAt;
        ClientUpdatedAt = deletedAt;
    }

    private void EnsureBelongsTo(Guid babyId)
    {
        if (BabyId != babyId)
        {
            throw new NoteBabyMismatchException(Id, babyId);
        }
    }

    private void EnsureWritableBy(Guid userId)
    {
        if (!IsVisibleTo(userId))
        {
            throw new NoteNotFoundException(BabyId, Id);
        }

        if (AuthorUserId != userId)
        {
            throw new NoteNotOwnedException(Id, userId);
        }
    }

    private void EnsureNotWithdrawn(NoteVisibility visibility)
    {
        if (Visibility == NoteVisibility.Shared && visibility == NoteVisibility.Private)
        {
            throw new NoteAlreadySharedException(Id);
        }
    }

    private void Apply(NoteTerms terms)
    {
        Kind = terms.Kind;
        Visibility = terms.Visibility;
        Body = terms.Body;
    }
}

/// <summary>How a client upsert applies to an existing note (see <see cref="BabyNote.DecideUpsert"/>).</summary>
public enum NoteUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The note changed after the client's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,

    /// <summary>The note is soft deleted; it stays deleted and the deleted copy is returned.</summary>
    IgnoreDeleted,
}
