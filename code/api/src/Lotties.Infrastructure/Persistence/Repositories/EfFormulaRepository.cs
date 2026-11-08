using Lotties.Domain.Exceptions;
using Lotties.Domain.Formulas;
using Lotties.Infrastructure.Persistence.Errors;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety relies on two unique indexes: the primary key (a concurrent create of the same id) and the partial index
/// of the current formula (two formulas of one baby made current at the same moment). Either violation is a
/// <see cref="ConcurrentModificationException"/> (409, retryable); any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfFormulaRepository(StoreScope stores, UniqueViolations uniqueViolations, ILogger<EfFormulaRepository> logger) : IFormulaRepository
{
    private const string Resource = "formula";

    public Task<Formula?> FindAsync(Guid formulaId, CancellationToken cancellationToken = default) =>
        stores.Current.Formulas.SingleOrDefaultAsync(formula => formula.Id == formulaId, cancellationToken);

    public async Task<IReadOnlyList<Formula>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var query = stores.ContextFor(babyId).Formulas.AsNoTracking().Where(formula => formula.BabyId == babyId);
        var changed = since is { } from ? query.Where(formula => formula.UpdatedAt >= from.ToUniversalTime()) : query;
        return await changed.OrderBy(formula => formula.UpdatedAt).ThenBy(formula => formula.Id).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Formula>> ListCurrentAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        await stores.ContextFor(babyId).Formulas.Where(formula => formula.BabyId == babyId && formula.IsCurrent).ToListAsync(cancellationToken);

    public async Task InTransactionAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        var context = stores.Current;
        if (context.Database.CurrentTransaction is not null)
        {
            // A backup import runs every write inside one transaction of its own; it commits or rolls back all of them.
            await work(cancellationToken);
            return;
        }

        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await work(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            context.ChangeTracker.Clear();
            throw;
        }
    }

    public Task AddAsync(Formula formula, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(formula);
        stores.ContextFor(formula.BabyId).Formulas.Add(formula);
        return SaveChangesAsync(cancellationToken);
    }

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await stores.Current.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            throw new ConcurrentModificationException(Resource, exception);
        }
        catch (DbUpdateException exception)
        {
            logger.LogError(exception, "Saving formulas failed with a database error that is not a unique violation");
            throw;
        }
    }
}
