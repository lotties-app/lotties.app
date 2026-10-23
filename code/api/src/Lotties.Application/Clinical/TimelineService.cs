using Lotties.Application.Babies;
using Lotties.Application.Events;
using Lotties.Domain.Clinical;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Clinical;

/// <summary>The day-by-day timeline of a baby's events. Callers have already authorized the current user (BabyRead and, for a Doctor, the daily log scope).</summary>
public interface ITimelineService
{
    /// <summary>
    /// The baby's non-deleted events overlapping [<paramref name="from"/>, <paramref name="to"/>) by start then id, at most
    /// <see cref="TimelineRange.MaxEvents"/>, as the caller's <see cref="Domain.Babies.SectionView"/> reads them (a Doctor
    /// without medications gets no medication doses, without formulas no formula on a bottle). Throws
    /// <see cref="DomainValidationException"/> (fields <c>from</c>, <c>to</c>) when a bound is missing, the range is empty or
    /// longer than <see cref="TimelineRange.MaxSpan"/>.
    /// </summary>
    Task<IReadOnlyList<EventResponse>> ListAsync(Guid babyId, DateTimeOffset? from, DateTimeOffset? to, CancellationToken cancellationToken = default);
}

internal sealed class TimelineService(IClinicalEventRepository events, IBabyAccessService access) : ITimelineService
{
    public async Task<IReadOnlyList<EventResponse>> ListAsync(Guid babyId, DateTimeOffset? from, DateTimeOffset? to, CancellationToken cancellationToken = default)
    {
        var range = TimelineRange.Create(from, to);
        var view = await access.ViewOfCallerAsync(babyId, cancellationToken);
        var overlapping = await events.ListOverlappingAsync(babyId, range.From, range.To, TimelineRange.MaxEvents, view.HiddenEventTypeIds, cancellationToken);
        return overlapping.Select(item => EventResponse.In(item, view)).ToArray();
    }
}
