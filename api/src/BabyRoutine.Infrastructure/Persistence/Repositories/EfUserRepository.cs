using BabyRoutine.Domain.Users;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety relies on the unique index on <c>users (issuer, subject)</c>: when a concurrent request inserted the
/// same identity first, the insert fails with a unique violation, the rejected entity is detached and the winning row
/// is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfUserRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations, ILogger<EfUserRepository> logger) : IUserRepository
{
    public Task<User?> FindByIdentityAsync(string issuer, string subject, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(issuer);
        ArgumentException.ThrowIfNullOrWhiteSpace(subject);
        return context.Users.SingleOrDefaultAsync(user => user.Issuer == issuer && user.Subject == subject, cancellationToken);
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
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            return await FindWinnerAfterConflictAsync(user, cancellationToken)
                ?? throw new InvalidOperationException($"Saving user {user.Id} hit a unique violation but no user with the same issuer and subject exists.", exception);
        }
        catch (DbUpdateException exception)
        {
            context.Entry(user).State = EntityState.Detached;
            logger.LogError(exception, "Saving new user {UserId} failed with a database error that is not a unique violation", user.Id);
            throw;
        }
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private Task<User?> FindWinnerAfterConflictAsync(User rejected, CancellationToken cancellationToken)
    {
        context.Entry(rejected).State = EntityState.Detached;
        return FindByIdentityAsync(rejected.Issuer, rejected.Subject, cancellationToken);
    }
}
