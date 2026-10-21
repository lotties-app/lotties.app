using BabyRoutine.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety relies on the unique index on <c>users.subject</c>: when a concurrent request inserted the same
/// subject first, the insert fails, the rejected entity is detached and the winning row is returned.
/// </remarks>
internal sealed class EfUserRepository(BabyRoutineDbContext context) : IUserRepository
{
    public Task<User?> FindBySubjectAsync(string subject, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(subject);
        return context.Users.SingleOrDefaultAsync(user => user.Subject == subject, cancellationToken);
    }

    public async Task<IReadOnlyList<User>> FindByIdsAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        return await context.Users.AsNoTracking().Where(user => userIds.Contains(user.Id)).ToListAsync(cancellationToken);
    }

    public async Task<User> AddOrGetExistingAsync(User user, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(user);
        try
        {
            context.Users.Add(user);
            await context.SaveChangesAsync(cancellationToken);
            return user;
        }
        catch (DbUpdateException exception)
        {
            return await FindWinnerAfterConflictAsync(user, cancellationToken)
                ?? throw new InvalidOperationException($"Saving user {user.Id} failed and no user with the same subject exists.", exception);
        }
    }

    private Task<User?> FindWinnerAfterConflictAsync(User rejected, CancellationToken cancellationToken)
    {
        context.Entry(rejected).State = EntityState.Detached;
        return FindBySubjectAsync(rejected.Subject, cancellationToken);
    }
}
