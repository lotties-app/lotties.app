using Lotties.Domain.Rest;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>The primary keys (<c>user_id</c>; <c>user_id</c> + <c>night</c>) decide two concurrent first PUTs.</remarks>
internal sealed class EfUserRestRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IUserRestRepository
{
    public Task<UserRestSettings?> FindSettingsAsync(Guid userId, CancellationToken cancellationToken = default) =>
        context.UserRestSettings.SingleOrDefaultAsync(settings => settings.UserId == userId, cancellationToken);

    public Task<bool> TryAddSettingsAsync(UserRestSettings settings, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, settings, cancellationToken);

    public Task<UserRestMorning?> FindMorningAsync(Guid userId, DateOnly night, CancellationToken cancellationToken = default) =>
        context.UserRestMornings.SingleOrDefaultAsync(morning => morning.UserId == userId && morning.Night == night, cancellationToken);

    public Task<bool> TryAddMorningAsync(UserRestMorning morning, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, morning, cancellationToken);

    public async Task DeleteAllAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        await context.UserRestMornings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await context.UserRestSettings.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
