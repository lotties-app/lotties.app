using BabyRoutine.Application.Notifications;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>The primary key <c>(user_id, base_key)</c> decides two concurrent first actions on a reminder (<see cref="TryAddAsync"/>).</remarks>
internal sealed class EfNotificationActionRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations) : INotificationActionRepository
{
    public Task<NotificationAction?> FindAsync(Guid userId, NotificationKey baseKey, CancellationToken cancellationToken = default) =>
        context.NotificationActions.SingleOrDefaultAsync(action => action.UserId == userId && action.BaseKey == baseKey, cancellationToken);

    public async Task<IReadOnlyList<NotificationAction>> ListForBabyAsync(Guid babyId, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        return await context.NotificationActions
            .AsNoTracking()
            .Where(action => userIds.Contains(action.UserId) && action.BabyId == babyId)
            .ToListAsync(cancellationToken);
    }

    public Task<bool> TryAddAsync(NotificationAction action, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, action, cancellationToken);

    public Task<int> DeleteUpdatedBeforeAsync(DateTimeOffset updatedBefore, CancellationToken cancellationToken = default) =>
        context.NotificationActions
            .Where(action => action.UpdatedAt < updatedBefore)
            .ExecuteDeleteAsync(cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
