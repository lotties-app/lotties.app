using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <summary>
/// Insert-or-lose: a concurrent insert of the same key fails with a unique violation, so the rejected entity is
/// detached and <c>false</c> returned. Any other database error detaches it and is rethrown.
/// </summary>
internal static class UniqueInserts
{
    public static async Task<bool> TryInsertAsync<TEntity>(
        BabyRoutineDbContext context,
        UniqueViolations uniqueViolations,
        TEntity entity,
        CancellationToken cancellationToken)
        where TEntity : class
    {
        ArgumentNullException.ThrowIfNull(entity);
        context.Add(entity);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(entity).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException)
        {
            context.Entry(entity).State = EntityState.Detached;
            throw;
        }
    }
}
