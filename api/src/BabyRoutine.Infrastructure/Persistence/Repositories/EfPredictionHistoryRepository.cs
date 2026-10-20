using BabyRoutine.Domain.Predictions;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// The event query filters on <c>(baby_id, started_at)</c>, served by the index of the same name; soft-deleted events
/// are excluded by the global query filter. Only the type key and the two timestamps are read.
/// </remarks>
internal sealed class EfPredictionHistoryRepository(BabyRoutineDbContext context) : IPredictionHistoryRepository
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
            .Join(context.EventTypes, item => item.TypeId, type => type.Id, (item, type) => new { type.Key, item.StartedAt, item.EndedAt })
            .ToListAsync(cancellationToken);
        return rows.Select(row => new ObservedEvent(row.Key, row.StartedAt, row.EndedAt)).ToArray();
    }
}
