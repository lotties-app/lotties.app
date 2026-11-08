using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Medications;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Stores.Moves;

/// <summary>
/// The copy engine of a move (docs/design/47-bring-your-own-database.md section 6, task T7; scoped, one DI scope per run). Both stores
/// are opened by name through the scope's <see cref="StoreScope.OpenStoreAsync"/>, never resolved for the baby. Rows are copied as they
/// are stored (ids, authors, server and client times, soft deletions, a doctor's provenance), page by page in key order, each page
/// in one transaction of the target; the change tracker is emptied after every page, so memory stays flat. The target refuses a row
/// whose id another baby holds there, or that points at something it lacks: that becomes <c>store_move_conflict</c>, without the
/// database's message (it can name a value). One exception to "as stored": a medication linked to a catalog product that Lotties'
/// catalog no longer has keeps its data without the link when it moves back to Lotties' database (the backup import does the same).
/// </summary>
internal sealed class StoreRecordCopier(StoreScope stores, LottiesDbContext control) : IStoreRecordCopier
{
    public async Task CopyAsync(StoreCopyPlan plan, Func<StoreCopyProgress, CancellationToken, Task> onBatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(onBatch);
        EnsureTwoStores(plan);
        var source = await stores.OpenStoreAsync(plan.Source, cancellationToken);
        var target = await stores.OpenStoreAsync(plan.Target, cancellationToken);
        var filter = new BabyRecordFilter(plan.BabyId, plan.PrivateNotesOnlyOf);
        var total = await CountAsync(source, filter, cancellationToken);
        await WipeAsync(target, plan.BabyId, cancellationToken);
        await onBatch(new StoreCopyProgress(0, total), cancellationToken);
        var copy = new Copy { Plan = plan, Source = source, Target = target, Filter = filter, Total = total, OnBatch = onBatch };
        foreach (var table in DataPlaneTables.InCopyOrder)
        {
            await CopyTableAsync(copy, table, cancellationToken);
        }
    }

    public async Task<StoreDigest> DigestAsync(StoreCopyPlan plan, StoreCopySide side, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var context = await stores.OpenStoreAsync(side == StoreCopySide.Source ? plan.Source : plan.Target, cancellationToken);
        var filter = side == StoreCopySide.Source ? new BabyRecordFilter(plan.BabyId, plan.PrivateNotesOnlyOf) : BabyRecordFilter.All(plan.BabyId);
        var tables = new List<StoreTableDigest>(DataPlaneTables.InCopyOrder.Count);
        foreach (var table in DataPlaneTables.InCopyOrder)
        {
            tables.Add(Digest(table.Name, await table.StampsAsync(context, filter, cancellationToken)));
        }

        return new StoreDigest(tables);
    }

    public async Task WipeAsync(Guid babyId, DataStoreKey store, CancellationToken cancellationToken = default) =>
        await WipeAsync(await stores.OpenStoreAsync(store, cancellationToken), babyId, cancellationToken);

    /// <summary>The digest of one table: its row count and a SHA-256 over the stamps sorted by key (the same order whatever the database's).</summary>
    internal static StoreTableDigest Digest(string table, IReadOnlyList<RowStamp> stamps)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var stamp in stamps.OrderBy(row => row.Key).ThenBy(row => row.SubKey))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(Line(stamp)));
        }

        return new StoreTableDigest(table, stamps.Count, Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
    }

    private static string Line(RowStamp stamp) =>
        string.Create(CultureInfo.InvariantCulture, $"{stamp.Key:N}|{stamp.SubKey:N}|{stamp.ChangedAt?.UtcTicks}|{stamp.DeletedAt?.UtcTicks}\n");

    private static void EnsureTwoStores(StoreCopyPlan plan)
    {
        if (plan.Source == plan.Target)
        {
            throw new ArgumentException("A move needs two different stores.", nameof(plan));
        }
    }

    private static async Task<int> CountAsync(LottiesDataDbContext context, BabyRecordFilter filter, CancellationToken cancellationToken)
    {
        var total = 0;
        foreach (var table in DataPlaneTables.InCopyOrder)
        {
            total += await table.CountAsync(context, filter, cancellationToken);
        }

        return total;
    }

    private static async Task WipeAsync(LottiesDataDbContext context, Guid babyId, CancellationToken cancellationToken)
    {
        foreach (var table in DataPlaneTables.InCopyOrder.Reverse())
        {
            await table.WipeAsync(context, babyId, cancellationToken);
        }
    }

    private async Task CopyTableAsync(Copy copy, IDataPlaneTable table, CancellationToken cancellationToken)
    {
        for (var offset = 0; ; offset += copy.Plan.BatchSize)
        {
            var page = await table.PageAsync(copy.Source, copy.Filter, offset, copy.Plan.BatchSize, cancellationToken);
            if (page.Count == 0)
            {
                return;
            }

            await InsertAsync(copy, page, cancellationToken);
            copy.Copied += page.Count;
            await copy.OnBatch(new StoreCopyProgress(copy.Copied, copy.Total), cancellationToken);
        }
    }

    private async Task InsertAsync(Copy copy, IReadOnlyList<object> page, CancellationToken cancellationToken)
    {
        try
        {
            copy.Target.AddRange(page);
            await DropUnknownProductLinksAsync(copy, page, cancellationToken);
            await copy.Target.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (StoreFailureException.FindIn(exception) is null)
        {
            throw new DataStoreMoveConflictException();
        }
        finally
        {
            copy.Target.ChangeTracker.Clear();
        }
    }

    /// <summary>Into Lotties' database only: a medication's link to a product the catalog no longer has is dropped (its foreign key would refuse it).</summary>
    private async Task DropUnknownProductLinksAsync(Copy copy, IReadOnlyList<object> page, CancellationToken cancellationToken)
    {
        if (copy.Plan.Target.Kind != DataStoreKind.BuiltIn)
        {
            return;
        }

        var linked = page.OfType<Medication>().Where(medication => medication.ProductId is not null).ToArray();
        var productIds = linked.Select(medication => medication.ProductId!.Value).Distinct().ToArray();
        if (productIds.Length == 0)
        {
            return;
        }

        var known = await control.Products.IgnoreQueryFilters().Where(product => productIds.Contains(product.Id)).Select(product => product.Id).ToListAsync(cancellationToken);
        foreach (var medication in linked.Where(medication => !known.Contains(medication.ProductId!.Value)))
        {
            copy.Target.Entry(medication).Property(item => item.ProductId).CurrentValue = null;
        }
    }

    /// <summary>The state of one copy run (the contexts are the scope's, opened by <see cref="StoreScope.OpenStoreAsync"/>).</summary>
    private sealed class Copy
    {
        public required StoreCopyPlan Plan { get; init; }

        public required LottiesDataDbContext Source { get; init; }

        public required LottiesDataDbContext Target { get; init; }

        public required BabyRecordFilter Filter { get; init; }

        public required int Total { get; init; }

        public required Func<StoreCopyProgress, CancellationToken, Task> OnBatch { get; init; }

        public int Copied { get; set; }
    }
}
