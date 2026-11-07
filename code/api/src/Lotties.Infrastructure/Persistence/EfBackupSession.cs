using Lotties.Domain.Backups;

namespace Lotties.Infrastructure.Persistence;

/// <remarks>
/// One explicit database transaction on the request's connection, shared by the control and the data context
/// (<see cref="BuiltInUnitOfWork"/>): a restore creates the baby (control plane) and imports its records (data plane) in it.
/// The repositories save through the scope's contexts, so everything the services write while it is open is part of it;
/// <c>EfFormulaRepository.InTransactionAsync</c> joins an open transaction instead of starting a nested one. Rolling back
/// also clears both change trackers.
/// </remarks>
internal sealed class EfBackupSession(BuiltInUnitOfWork unitOfWork) : IBackupSession, IAsyncDisposable
{
    private SharedTransaction? _transaction;

    public async Task BeginAsync(CancellationToken cancellationToken = default)
    {
        if (_transaction is not null)
        {
            throw new InvalidOperationException("A backup session is already open.");
        }

        _transaction = await unitOfWork.BeginAsync(cancellationToken);
    }

    public async Task CommitAsync(CancellationToken cancellationToken = default)
    {
        var transaction = _transaction ?? throw new InvalidOperationException("No backup session is open.");
        await transaction.CommitAsync(cancellationToken);
        await transaction.DisposeAsync();
        _transaction = null;
        unitOfWork.ClearTracked();
    }

    public async Task RollbackAsync(CancellationToken cancellationToken = default)
    {
        if (_transaction is { } transaction)
        {
            _transaction = null;
            await transaction.RollbackAsync(cancellationToken);
            await transaction.DisposeAsync();
        }

        unitOfWork.ClearTracked();
    }

    public void ReleaseTrackedEntities() => unitOfWork.ClearTracked();

    public async ValueTask DisposeAsync()
    {
        if (_transaction is { } transaction)
        {
            _transaction = null;
            await transaction.DisposeAsync();
        }
    }
}
