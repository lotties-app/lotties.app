using Lotties.Domain.Events;
using Lotties.Domain.Predictions;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// The event query filters on <c>(baby_id, started_at)</c>, served by the index of the same name; soft-deleted events
/// are excluded by the global query filter. Only the type key, the two timestamps and the payload are read; the
/// payload's <c>kind</c> (sleep sessions, see <see cref="SleepKinds"/>), <c>paused_seconds</c> (effective durations) and
/// the diaper <c>content</c> (<see cref="DiaperContents"/>) are extracted in memory (<see cref="EventPayloadFacts"/>)
/// so the query stays provider-neutral.
/// </remarks>
internal sealed class EfPredictionHistoryRepository(LottiesDbContext context) : IPredictionHistoryRepository
{
    public async Task<PredictionHistory?> LoadAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default)
    {
        var birthDate = await context.Babies
            .AsNoTracking()
            .Where(baby => baby.Id == babyId)
            .Select(baby => (DateOnly?)baby.BirthDate)
            .SingleOrDefaultAsync(cancellationToken);
        return birthDate is null
            ? null
            : new PredictionHistory(birthDate.Value, await LoadEventsAsync(babyId, since.ToUniversalTime(), cancellationToken));
    }

    private async Task<IReadOnlyList<ObservedEvent>> LoadEventsAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken)
    {
        var rows = await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && item.StartedAt >= since)
            .Join(context.EventTypes, item => item.TypeId, type => type.Id, (item, type) => new { type.Key, item.StartedAt, item.EndedAt, item.Payload })
            .ToListAsync(cancellationToken);
        return rows.Select(row => Observed(row.Key, row.StartedAt, row.EndedAt, EventPayloadFacts.Read(row.Payload))).ToArray();
    }

    private static ObservedEvent Observed(Domain.EventTypes.EventTypeKey key, DateTimeOffset startedAt, DateTimeOffset? endedAt, EventPayloadFacts facts) =>
        new(key, startedAt, endedAt, facts.Kind, facts.Paused, facts.Content);
}
