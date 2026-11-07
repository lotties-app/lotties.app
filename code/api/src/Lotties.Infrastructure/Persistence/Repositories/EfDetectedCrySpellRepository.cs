using Lotties.Application.Notifications;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// The fussy spells of the window are read by type and time in SQL; the monitor's marks live in the JSON payload and are
/// read in memory (<see cref="CryDetection"/>), so the query translates the same on PostgreSQL and SQLite. A baby has a
/// handful of fussy spells in that window.
/// </remarks>
internal sealed class EfDetectedCrySpellRepository(LottiesDataDbContext context) : IDetectedCrySpellRepository
{
    public async Task<IReadOnlyList<DetectedCrySpell>> ListAsync(Guid babyId, DateTimeOffset since, DateTimeOffset lookBackFrom, CancellationToken cancellationToken = default)
    {
        var from = since.ToUniversalTime();
        var lookBack = lookBackFrom.ToUniversalTime();
        var spells = await context.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId
                && item.TypeId == BuiltInEventTypes.FussyId
                && item.DeletedAt == null
                && item.StartedAt >= lookBack
                && (item.StartedAt >= from || item.EndedAt == null || item.EndedAt >= from))
            .OrderBy(item => item.StartedAt)
            .ThenBy(item => item.Id)
            .ToListAsync(cancellationToken);
        return spells
            .Where(item => CryDetection.Read(item.Payload).IsOpenDetection)
            .Select(item => new DetectedCrySpell(item.Id, item.StartedAt, item.EndedAt))
            .ToArray();
    }
}
