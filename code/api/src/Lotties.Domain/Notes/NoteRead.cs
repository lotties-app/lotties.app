using Lotties.Domain.Common;

namespace Lotties.Domain.Notes;

/// <summary>
/// That a member opened a note (docs/design/16-doctor-access.md section 10.3): one row per member and note, the first
/// read kept. A shared note of kind <see cref="NoteKind.Recommendation"/> without the reader's row is unread for her
/// (<see cref="IsUnreadRecommendation"/>). <see cref="ReadAt"/> (server time) is the delta cursor of her reads.
/// </summary>
public sealed class NoteRead
{
    private NoteRead()
    {
    }

    private NoteRead(Guid noteId, Guid userId, Guid babyId, DateTimeOffset readAt)
    {
        NoteId = noteId;
        UserId = userId;
        BabyId = babyId;
        ReadAt = readAt;
    }

    public Guid NoteId { get; private set; }

    public Guid UserId { get; private set; }

    public Guid BabyId { get; private set; }

    public DateTimeOffset ReadAt { get; private set; }

    /// <summary>The read of <paramref name="note"/> by <paramref name="userId"/>, who sees it (the caller checked <see cref="BabyNote.IsVisibleTo"/>).</summary>
    public static NoteRead Of(BabyNote note, Guid userId, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(note);
        return new NoteRead(note.Id, Ids.Required(userId, nameof(userId)), note.BabyId, UtcTime.Normalize(now));
    }

    /// <summary>Whether <paramref name="note"/> counts in <paramref name="userId"/>'s recommendations inbox until she reads it.</summary>
    public static bool IsUnreadRecommendation(BabyNote note, Guid userId, bool hasRead)
    {
        ArgumentNullException.ThrowIfNull(note);
        return note is { Kind: NoteKind.Recommendation, Visibility: NoteVisibility.Shared, IsDeleted: false } && note.AuthorUserId != userId && !hasRead;
    }
}

/// <summary>Persistence for <see cref="NoteRead"/>.</summary>
public interface INoteReadRepository
{
    Task<NoteRead?> FindAsync(Guid noteId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The reads of <paramref name="userId"/> on the baby's notes at or after <paramref name="since"/> (all when <c>null</c>), by (readAt, noteId); not tracked.</summary>
    Task<IReadOnlyList<NoteRead>> ListChangesAsync(Guid babyId, Guid userId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>Saves a first read. Returns <c>false</c>, leaving nothing tracked, when a concurrent read of the same note by the same member won.</summary>
    Task<bool> TryAddAsync(NoteRead read, CancellationToken cancellationToken = default);
}
