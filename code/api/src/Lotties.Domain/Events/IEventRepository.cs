namespace Lotties.Domain.Events;

/// <summary>Persistence for <see cref="Event"/>. Every read includes soft-deleted events unless stated otherwise.</summary>
public interface IEventRepository
{
    /// <summary>The event with <paramref name="eventId"/> whatever baby it belongs to, deleted or not; tracked for changes.</summary>
    Task<Event?> FindAsync(Guid eventId, CancellationToken cancellationToken = default);

    /// <summary>The event of <paramref name="babyId"/> with <paramref name="eventId"/>, deleted or not; tracked for changes.</summary>
    Task<Event?> FindForBabyAsync(Guid babyId, Guid eventId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves a new event. Returns <c>false</c>, leaving nothing tracked, when an event with the same id was saved
    /// first (a concurrent upsert of the same client id).
    /// </summary>
    Task<bool> TryAddAsync(Event created, CancellationToken cancellationToken = default);

    /// <summary>Saves changes made to events returned by this repository.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Up to <paramref name="take"/> events of <paramref name="babyId"/>, soft-deleted included, ordered by
    /// <c>(UpdatedAt, Id)</c> ascending and strictly after <paramref name="after"/> (from the start when <c>null</c>).
    /// </summary>
    Task<IReadOnlyList<Event>> ListChangesAsync(Guid babyId, EventSyncCursor? after, int take, CancellationToken cancellationToken = default);
}
