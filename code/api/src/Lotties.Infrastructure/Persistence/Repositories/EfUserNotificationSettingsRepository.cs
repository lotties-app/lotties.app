using Lotties.Application.Notifications;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>The primary key on <c>user_id</c> decides two concurrent first PUTs (<see cref="TryAddAsync"/>).</remarks>
internal sealed class EfUserNotificationSettingsRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IUserNotificationSettingsRepository
{
    public Task<UserNotificationSettings?> FindAsync(Guid userId, CancellationToken cancellationToken = default) =>
        context.UserNotificationSettings.SingleOrDefaultAsync(settings => settings.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<UserNotificationSettings>> ListForUsersAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        return await context.UserNotificationSettings
            .AsNoTracking()
            .Where(settings => userIds.Contains(settings.UserId))
            .ToListAsync(cancellationToken);
    }

    public Task<bool> TryAddAsync(UserNotificationSettings settings, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, settings, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
