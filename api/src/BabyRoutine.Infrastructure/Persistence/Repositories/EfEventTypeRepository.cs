using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

internal sealed class EfEventTypeRepository(BabyRoutineDbContext context) : IEventTypeRepository
{
    public Task<EventType?> FindAsync(Guid eventTypeId, CancellationToken cancellationToken = default) =>
        context.EventTypes.AsNoTracking().SingleOrDefaultAsync(eventType => eventType.Id == eventTypeId, cancellationToken);
}
