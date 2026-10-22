namespace Lotties.Domain.Formulas;

/// <summary>
/// Persistence for <see cref="Formula"/>. Formulas are never deleted (archived instead); reads include archived ones.
/// A save that a unique index refuses (the same id created concurrently, or another formula of the baby made current
/// at the same moment) throws <see cref="Exceptions.ConcurrentModificationException"/>.
/// </summary>
public interface IFormulaRepository
{
    /// <summary>The formula with <paramref name="formulaId"/> whatever baby it belongs to; tracked.</summary>
    Task<Formula?> FindAsync(Guid formulaId, CancellationToken cancellationToken = default);

    /// <summary>The baby's formulas changed at or after <paramref name="since"/> (all when <c>null</c>), by (UpdatedAt, Id); not tracked.</summary>
    Task<IReadOnlyList<Formula>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>The baby's current formulas (at most one); tracked.</summary>
    Task<IReadOnlyList<Formula>> ListCurrentAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs <paramref name="work"/> in one database transaction: its saves commit together or not at all. When it
    /// throws, the transaction is rolled back, nothing stays tracked and the exception propagates.
    /// </summary>
    Task InTransactionAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken = default);

    /// <summary>Saves a new formula.</summary>
    Task AddAsync(Formula formula, CancellationToken cancellationToken = default);

    /// <summary>Saves the tracked changes.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
