namespace Lotties.Domain.Notes;

/// <summary>
/// Persistence for <see cref="BabyNote"/>. Every list read takes the reader's user id and returns only the notes visible
/// to her (shared ones and her own private ones), soft-deleted included so clients learn deletions.
/// </summary>
public interface INoteRepository
{
    /// <summary>The note with <paramref name="noteId"/> whatever baby or author it belongs to; tracked. Callers check visibility.</summary>
    Task<BabyNote?> FindAsync(Guid noteId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The baby's notes visible to <paramref name="readerUserId"/> changed at or after <paramref name="since"/> (all when
    /// <c>null</c>), soft-deleted included, by (UpdatedAt, Id); not tracked.
    /// </summary>
    Task<IReadOnlyList<BabyNote>> ListChangesVisibleToAsync(Guid babyId, Guid readerUserId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>How many shared, non-deleted notes <paramref name="authorUserId"/> wrote about the baby (the doctor's dashboard).</summary>
    Task<int> CountSharedByAuthorAsync(Guid babyId, Guid authorUserId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new note. Returns <c>false</c>, leaving nothing tracked, when the id was saved first (concurrent upsert).</summary>
    Task<bool> TryAddAsync(BabyNote note, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
