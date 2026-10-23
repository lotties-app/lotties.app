namespace Lotties.Domain.Backups;

/// <summary>
/// The unit of work of a backup import: everything the import writes through the normal services happens inside one
/// database transaction, which a preview rolls back and an import commits. Not reentrant: one session at a time.
/// </summary>
public interface IBackupSession
{
    /// <summary>Starts the transaction. Repositories that open their own transaction join it instead of nesting.</summary>
    Task BeginAsync(CancellationToken cancellationToken = default);

    /// <summary>Commits everything written since <see cref="BeginAsync"/>.</summary>
    Task CommitAsync(CancellationToken cancellationToken = default);

    /// <summary>Discards everything written since <see cref="BeginAsync"/> and the tracked entities. Safe to call twice.</summary>
    Task RollbackAsync(CancellationToken cancellationToken = default);

    /// <summary>Forgets the entities loaded so far (their changes are saved), so a long import does not slow down record by record.</summary>
    void ReleaseTrackedEntities();
}
