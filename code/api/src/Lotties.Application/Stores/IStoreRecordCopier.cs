using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// What one move copies (task T7): the baby, the two stores (named explicitly, never the baby's current one by default) and, for a
/// copy into the owner's own database, the only author whose private notes may go there (design 24's file rule: another person's
/// private note never reaches the owner's hands).
/// </summary>
public sealed record StoreCopyPlan(Guid BabyId, DataStoreKey Source, DataStoreKey Target, Guid? PrivateNotesOnlyOf, int BatchSize);

/// <summary>Which side of a <see cref="StoreCopyPlan"/> a digest reads.</summary>
public enum StoreCopySide
{
    /// <summary>The source, with the plan's filter (what should reach the target).</summary>
    Source,

    /// <summary>The target, everything it holds for the baby.</summary>
    Target,
}

/// <summary>How far a copy is: rows written to the target and rows the source holds.</summary>
public sealed record StoreCopyProgress(int Copied, int Total);

/// <summary>
/// The copy engine of a move between two data stores (docs/design/47-bring-your-own-database.md section 6, task T7): the 12 data
/// tables of one baby, read from the source and written to the target in batches with their ids, authors and times unchanged (a
/// store move is the same baby in another database, not an import). Stores are opened through the routing (feature flag, circuit
/// breaker and, for an external store, the migrator's ready check); store failures surface as their <c>store_*</c> exceptions, a
/// row the target refuses as <c>store_move_conflict</c>. Nothing here logs a record, an id or a value.
/// </summary>
public interface IStoreRecordCopier
{
    /// <summary>
    /// Empties the target's rows of the baby, then copies the source's rows (references first). Restarting it is always clean.
    /// <paramref name="onBatch"/> is called after the count and after each committed batch.
    /// </summary>
    Task CopyAsync(StoreCopyPlan plan, Func<StoreCopyProgress, CancellationToken, Task> onBatch, CancellationToken cancellationToken = default);

    /// <summary>Counts and checksums of one side, table by table (<see cref="StoreDigest"/>).</summary>
    Task<StoreDigest> DigestAsync(StoreCopyPlan plan, StoreCopySide side, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes every row of the baby's 12 data tables in <paramref name="store"/>: an old copy after the undo window, a failed move's
    /// leftovers, and (task T10) the data-plane half of erasing a baby in any store. The caller makes sure the baby does not point at
    /// <paramref name="store"/>.
    /// </summary>
    Task WipeAsync(Guid babyId, DataStoreKey store, CancellationToken cancellationToken = default);
}
