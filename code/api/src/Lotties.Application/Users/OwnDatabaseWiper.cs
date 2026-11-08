using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Users;

/// <summary>Which babies' records in the user's own database account deletion deleted, and which it could not reach.</summary>
public sealed record OwnDatabaseWipeResult(IReadOnlyList<Guid> Wiped, IReadOnlyList<Guid> NotWiped)
{
    /// <summary>The user did not ask for it: her database is left as it is.</summary>
    public static OwnDatabaseWipeResult NotRequested { get; } = new([], []);
}

/// <summary>
/// The data-plane half of account deletion for a family's own database (docs/design/47-bring-your-own-database.md section 9, task T10):
/// deletes each erased baby's rows from the 12 data tables of the user's store with <see cref="IStoreRecordCopier.WipeAsync"/>, which
/// opens the store through the routing (feature flag, circuit breaker, migrator) like every other access. Each store gets at most
/// <see cref="StoreTimeout"/>; a store that fails, is slow or whose breaker is open stops there, and the babies not reached yet are
/// reported as not wiped so the deletion of Lotties' side goes on and the app can tell the user. Nothing is logged but counts and
/// the exception type: no baby, store, host, database name or credential.
/// </summary>
internal sealed class OwnDatabaseWiper(IStoreRecordCopier copier, ILogger<OwnDatabaseWiper> logger)
{
    /// <summary>The longest one store may take, connecting included, before its remaining babies are reported as not wiped.</summary>
    public static readonly TimeSpan StoreTimeout = TimeSpan.FromSeconds(30);

    public async Task<OwnDatabaseWipeResult> WipeAsync(IReadOnlyList<OwnStoreCopy> copies, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(copies);
        var notWiped = new HashSet<Guid>();
        foreach (var store in copies.GroupBy(copy => copy.StoreId))
        {
            notWiped.UnionWith(await WipeStoreAsync(store.Key, [.. store.Select(copy => copy.BabyId)], cancellationToken));
        }

        var babies = copies.Select(copy => copy.BabyId).Distinct().ToList();
        var result = new OwnDatabaseWipeResult([.. babies.Where(baby => !notWiped.Contains(baby))], [.. babies.Where(notWiped.Contains)]);
        logger.LogInformation("Own database on account deletion: {Wiped} babies wiped, {NotWiped} not wiped", result.Wiped.Count, result.NotWiped.Count);
        return result;
    }

    /// <summary>Wipes the babies in order; returns those not wiped when the store failed or ran out of time.</summary>
    private async Task<IReadOnlyList<Guid>> WipeStoreAsync(Guid storeId, IReadOnlyList<Guid> babyIds, CancellationToken cancellationToken)
    {
        var pending = new Queue<Guid>(babyIds);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(StoreTimeout);
        try
        {
            await WipeEachAsync(pending, DataStoreKey.External(storeId), timeout.Token);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Deleting a deleted account's records in her own database failed ({ExceptionType}); Lotties' side is erased anyway", exception.GetType().Name);
        }

        return [.. pending];
    }

    private async Task WipeEachAsync(Queue<Guid> pending, DataStoreKey store, CancellationToken cancellationToken)
    {
        while (pending.TryPeek(out var babyId))
        {
            await copier.WipeAsync(babyId, store, cancellationToken);
            pending.Dequeue();
        }
    }
}
