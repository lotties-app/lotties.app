using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Clinical;

/// <summary>An event with the key of its type (<c>sleep</c>, <c>feeding</c>, <c>temperature</c>, ...).</summary>
public sealed record TypedEvent(EventTypeKey TypeKey, Event Event);

/// <summary>
/// Read access to a baby's events for the doctor's views. Every read leaves out soft-deleted events and tracks nothing.
/// </summary>
public interface IClinicalEventRepository
{
    /// <summary>
    /// The baby's events of the types with these keys that started at or after <paramref name="startedFrom"/> and before
    /// <paramref name="startedBefore"/>, by start then id.
    /// </summary>
    Task<IReadOnlyList<TypedEvent>> ListByTypesAsync(
        Guid babyId,
        IReadOnlyCollection<string> typeKeys,
        DateTimeOffset startedFrom,
        DateTimeOffset startedBefore,
        CancellationToken cancellationToken = default);

    /// <summary>The newest <paramref name="take"/> of the same events, newest start first (then by id).</summary>
    Task<IReadOnlyList<TypedEvent>> ListNewestByTypesAsync(
        Guid babyId,
        IReadOnlyCollection<string> typeKeys,
        DateTimeOffset startedFrom,
        DateTimeOffset startedBefore,
        int take,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Up to <paramref name="take"/> events overlapping [<paramref name="from"/>, <paramref name="to"/>) (started before
    /// <paramref name="to"/>, and still running, ended after <paramref name="from"/> or started at or after it), by start then
    /// id, leaving out the types in <paramref name="hiddenTypeIds"/> (the caller's <c>SectionView.HiddenEventTypeIds</c>).
    /// </summary>
    Task<IReadOnlyList<Event>> ListOverlappingAsync(
        Guid babyId,
        DateTimeOffset from,
        DateTimeOffset to,
        int take,
        IReadOnlyCollection<Guid> hiddenTypeIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The start of the baby's newest event that started at or before <paramref name="notAfter"/>, leaving out the types in
    /// <paramref name="hiddenTypeIds"/>, or <c>null</c> without one.
    /// </summary>
    Task<DateTimeOffset?> FindLatestStartAsync(Guid babyId, DateTimeOffset notAfter, IReadOnlyCollection<Guid> hiddenTypeIds, CancellationToken cancellationToken = default);
}
