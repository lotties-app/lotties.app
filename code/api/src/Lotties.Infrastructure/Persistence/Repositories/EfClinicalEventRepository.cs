using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// The event queries filter on <c>(baby_id, started_at)</c>, served by the index of the same name; soft-deleted events
/// are excluded by the global query filter. The type keys are resolved first (the built-in types and the baby's own are a
/// few rows) so the event queries filter on plain type ids. The ids are a <see cref="List{T}"/>, not an array: newer C#
/// compilers bind <c>array.Contains(x)</c> in a query to <c>MemoryExtensions.Contains(ReadOnlySpan)</c>, which EF Core 8 cannot translate.
/// </remarks>
internal sealed class EfClinicalEventRepository(LottiesDbContext context) : IClinicalEventRepository
{
    public async Task<IReadOnlyList<TypedEvent>> ListByTypesAsync(
        Guid babyId,
        IReadOnlyCollection<string> typeKeys,
        DateTimeOffset startedFrom,
        DateTimeOffset startedBefore,
        CancellationToken cancellationToken = default)
    {
        var keys = await KeysByTypeIdAsync(babyId, typeKeys, cancellationToken);
        var typeIds = keys.Keys.ToList();
        var from = startedFrom.ToUniversalTime();
        var before = startedBefore.ToUniversalTime();
        var found = await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && typeIds.Contains(item.TypeId) && item.StartedAt >= from && item.StartedAt < before)
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.Id)
            .ToListAsync(cancellationToken);
        return Typed(found, keys);
    }

    public async Task<IReadOnlyList<TypedEvent>> ListNewestByTypesAsync(
        Guid babyId,
        IReadOnlyCollection<string> typeKeys,
        DateTimeOffset startedFrom,
        DateTimeOffset startedBefore,
        int take,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(take);
        var keys = await KeysByTypeIdAsync(babyId, typeKeys, cancellationToken);
        var typeIds = keys.Keys.ToList();
        var from = startedFrom.ToUniversalTime();
        var before = startedBefore.ToUniversalTime();
        var found = await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && typeIds.Contains(item.TypeId) && item.StartedAt >= from && item.StartedAt < before)
            .OrderByDescending(item => item.StartedAt)
            .ThenBy(item => item.Id)
            .Take(take)
            .ToListAsync(cancellationToken);
        return Typed(found, keys);
    }

    public async Task<IReadOnlyList<Event>> ListOverlappingAsync(
        Guid babyId,
        DateTimeOffset from,
        DateTimeOffset to,
        int take,
        IReadOnlyCollection<Guid> hiddenTypeIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(take);
        ArgumentNullException.ThrowIfNull(hiddenTypeIds);
        var start = from.ToUniversalTime();
        var end = to.ToUniversalTime();
        var hidden = hiddenTypeIds.ToList();
        return await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && item.StartedAt < end && (item.EndedAt == null || item.EndedAt > start || item.StartedAt >= start))
            .Where(item => !hidden.Contains(item.TypeId))
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.Id)
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    public async Task<DateTimeOffset?> FindLatestStartAsync(Guid babyId, DateTimeOffset notAfter, IReadOnlyCollection<Guid> hiddenTypeIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(hiddenTypeIds);
        var limit = notAfter.ToUniversalTime();
        var hidden = hiddenTypeIds.ToList();
        return await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && item.StartedAt <= limit && !hidden.Contains(item.TypeId))
            .OrderByDescending(item => item.StartedAt)
            .Select(item => (DateTimeOffset?)item.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>The type ids usable by the baby (built-in templates and its own types) whose key is one of <paramref name="typeKeys"/>, with that key.</summary>
    private async Task<IReadOnlyDictionary<Guid, EventTypeKey>> KeysByTypeIdAsync(Guid babyId, IReadOnlyCollection<string> typeKeys, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(typeKeys);
        var types = await context.EventTypes
            .AsNoTracking()
            .Where(type => type.BabyId == null || type.BabyId == babyId)
            .Select(type => new { type.Id, type.Key })
            .ToListAsync(cancellationToken);
        return types.Where(type => typeKeys.Contains(type.Key.Value)).ToDictionary(type => type.Id, type => type.Key);
    }

    private static IReadOnlyList<TypedEvent> Typed(IReadOnlyList<Event> events, IReadOnlyDictionary<Guid, EventTypeKey> keys) =>
        events.Select(item => new TypedEvent(keys[item.TypeId], item)).ToArray();
}
