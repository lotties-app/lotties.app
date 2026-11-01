using Lotties.Domain.Backups;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Lotties.Infrastructure.Persistence;

/// <remarks>
/// One explicit database transaction on the request's context. The repositories save through the same context, so
/// everything the services write while it is open is part of it; <c>EfFormulaRepository.InTransactionAsync</c> joins an
/// open transaction instead of starting a nested one. Rolling back also clears the change tracker.
/// </remarks>
internal sealed class EfBackupSession(LottiesDbContext context) : IBackupSession, IAsyncDisposable
{
    private IDbContextTransaction? _transaction;

    public async Task BeginAsync(CancellationToken cancellationToken = default)
    {
        if (_transaction is not null)
        {
            throw new InvalidOperationException("A backup session is already open.");
        }

        _transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    }

    public async Task CommitAsync(CancellationToken cancellationToken = default)
    {
        var transaction = _transaction ?? throw new InvalidOperationException("No backup session is open.");
        await transaction.CommitAsync(cancellationToken);
        await transaction.DisposeAsync();
        _transaction = null;
        context.ChangeTracker.Clear();
    }

    public async Task RollbackAsync(CancellationToken cancellationToken = default)
    {
        if (_transaction is { } transaction)
        {
            _transaction = null;
            await transaction.RollbackAsync(cancellationToken);
            await transaction.DisposeAsync();
        }

        context.ChangeTracker.Clear();
    }

    public void ReleaseTrackedEntities() => context.ChangeTracker.Clear();

    public async ValueTask DisposeAsync()
    {
        if (_transaction is { } transaction)
        {
            _transaction = null;
            await transaction.DisposeAsync();
        }
    }
}
