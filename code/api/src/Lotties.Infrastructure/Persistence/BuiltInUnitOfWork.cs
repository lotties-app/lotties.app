using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// The control context and the built-in store's data context of one scope (<see cref="LottiesDbContext"/> for the control plane,
/// the <see cref="StoreScope"/>'s built-in <see cref="LottiesDataDbContext"/> for the data plane). The built-in data context is
/// opened on the control context's connection, so a write that spans both planes stays in one database transaction, as it was
/// when one context held every table.
/// </summary>
/// <remarks>
/// Cross-plane writes found when the model was split (docs/design/47-bring-your-own-database.md section 12, task T1): a member
/// change that ends a doctor's access cancels her pending proposals in the same save (<c>MemberService</c> through
/// <c>EfBabyRepository.SaveChangesAsync</c>, <see cref="SaveBothAsync"/>), and a backup restore creates the baby and imports its
/// records in one transaction (<see cref="EfBackupSession"/>, <see cref="BeginAsync"/>). A store outside the Lotties database
/// cannot join such a transaction, so both refuse a baby on an external store (task T2) instead of saving half: an external
/// store's changes are never saved here, and a shared transaction needs every baby of the scope on the built-in store.
/// </remarks>
internal sealed class BuiltInUnitOfWork(LottiesDbContext control, StoreScope stores)
{
    /// <summary>
    /// Saves the control context and the built-in data context's pending changes atomically: one transaction when both have
    /// changes, a plain save of the control context otherwise (the same statements as before the split). Inside a transaction
    /// opened by <see cref="BeginAsync"/> both contexts simply save into it.
    /// </summary>
    public async Task SaveBothAsync(CancellationToken cancellationToken)
    {
        stores.EnsureNoExternalChanges();
        if (stores.CreatedBuiltInContext is not { } data || !data.ChangeTracker.HasChanges())
        {
            await control.SaveChangesAsync(cancellationToken);
            return;
        }

        if (control.Database.CurrentTransaction is not null)
        {
            await control.SaveChangesAsync(cancellationToken);
            await data.SaveChangesAsync(cancellationToken);
            return;
        }

        await SaveBothInOneTransactionAsync(data, cancellationToken);
    }

    /// <summary>
    /// Begins one transaction on the shared connection that the control context and the built-in data context use until it is
    /// committed, rolled back or disposed. The scope must hold its babies on the built-in store only.
    /// </summary>
    public Task<SharedTransaction> BeginAsync(CancellationToken cancellationToken) =>
        BeginWithAsync(stores.BuiltInContextForTransaction(), cancellationToken);

    /// <summary>Forgets every tracked entity of both planes.</summary>
    public void ClearTracked()
    {
        control.ChangeTracker.Clear();
        stores.ClearTracked();
    }

    private async Task<SharedTransaction> BeginWithAsync(LottiesDataDbContext data, CancellationToken cancellationToken)
    {
        var transaction = await control.Database.BeginTransactionAsync(cancellationToken);
        await data.Database.UseTransactionAsync(transaction.GetDbTransaction(), cancellationToken);
        return new SharedTransaction(transaction, data);
    }

    /// <remarks>
    /// Changes are accepted only after the commit, so a failed save leaves both change trackers as a failed single save did
    /// (nothing marked as saved). Control first: the data rows point at control rows in the built-in database.
    /// </remarks>
    private async Task SaveBothInOneTransactionAsync(LottiesDataDbContext data, CancellationToken cancellationToken)
    {
        await using var transaction = await BeginWithAsync(data, cancellationToken);
        await control.SaveChangesAsync(acceptAllChangesOnSuccess: false, cancellationToken);
        await data.SaveChangesAsync(acceptAllChangesOnSuccess: false, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        control.ChangeTracker.AcceptAllChanges();
        data.ChangeTracker.AcceptAllChanges();
    }
}

/// <summary>A transaction of the control context that the data context joined; disposing it releases the data context too.</summary>
internal sealed class SharedTransaction(IDbContextTransaction transaction, LottiesDataDbContext data) : IAsyncDisposable
{
    private bool _released;

    public Task CommitAsync(CancellationToken cancellationToken) => transaction.CommitAsync(cancellationToken);

    public Task RollbackAsync(CancellationToken cancellationToken) => transaction.RollbackAsync(cancellationToken);

    public async ValueTask DisposeAsync()
    {
        if (_released)
        {
            return;
        }

        _released = true;
        await data.Database.UseTransactionAsync(null);
        await transaction.DisposeAsync();
    }
}
