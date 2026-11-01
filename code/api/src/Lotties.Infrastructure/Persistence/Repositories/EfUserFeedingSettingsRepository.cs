using Lotties.Domain.FeedingPreferences;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>The primary key on <c>user_id</c> decides two concurrent first PUTs (<see cref="TryAddAsync"/>).</remarks>
internal sealed class EfUserFeedingSettingsRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IUserFeedingSettingsRepository
{
    public Task<UserFeedingSettings?> FindAsync(Guid userId, CancellationToken cancellationToken = default) =>
        context.UserFeedingSettings.SingleOrDefaultAsync(settings => settings.UserId == userId, cancellationToken);

    public Task<bool> TryAddAsync(UserFeedingSettings settings, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, settings, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
