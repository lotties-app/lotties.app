using Lotties.Domain.Units;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>The primary key on <c>user_id</c> decides two concurrent first PUTs (<see cref="TryAddAsync"/>).</remarks>
internal sealed class EfUserUnitSettingsRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : IUserUnitSettingsRepository
{
    public Task<UserUnitSettings?> FindAsync(Guid userId, CancellationToken cancellationToken = default) =>
        context.UserUnitSettings.SingleOrDefaultAsync(settings => settings.UserId == userId, cancellationToken);

    public Task<bool> TryAddAsync(UserUnitSettings settings, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, settings, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);
}
