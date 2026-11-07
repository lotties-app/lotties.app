using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Test-host guard of the control/data split (docs/design/47-bring-your-own-database.md, task T1): when one plane's context
/// saves while the other plane's context of the same scope has pending changes and the two do not share a transaction, those
/// changes would silently stay behind (with one context they were saved together). Such a save fails here, so a service that
/// writes both planes must go through <c>BuiltInUnitOfWork</c>.
/// </summary>
internal sealed class PlaneSaveGuard : SaveChangesInterceptor
{
    public static readonly PlaneSaveGuard Instance = new();

    private PlaneSaveGuard()
    {
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Check(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Check(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void Check(DbContext? saving)
    {
        var sibling = saving is null ? null : SiblingOf(saving);
        if (sibling is null || !sibling.ChangeTracker.HasChanges() || ShareTransaction(saving!, sibling))
        {
            return;
        }

        var pending = string.Join(", ", sibling.ChangeTracker.Entries().Where(entry => entry.State is not EntityState.Unchanged and not EntityState.Detached).Select(entry => $"{entry.Metadata.ClrType.Name} {entry.State}").Distinct());
        throw new InvalidOperationException($"{saving!.GetType().Name} saved while {sibling.GetType().Name} has unsaved changes ({pending}): a write across the control and data planes must use BuiltInUnitOfWork.");
    }

    private static DbContext? SiblingOf(DbContext saving)
    {
        var scope = saving.GetService<IDbContextOptions>().FindExtension<CoreOptionsExtension>()?.ApplicationServiceProvider;
        return saving switch
        {
            LottiesDbContext => scope?.GetService<LottiesDataDbContext>(),
            LottiesDataDbContext => scope?.GetService<LottiesDbContext>(),
            _ => null,
        };
    }

    private static bool ShareTransaction(DbContext saving, DbContext sibling) =>
        saving.Database.CurrentTransaction is { } transaction
        && ReferenceEquals(transaction.GetDbTransaction(), sibling.Database.CurrentTransaction?.GetDbTransaction());
}
