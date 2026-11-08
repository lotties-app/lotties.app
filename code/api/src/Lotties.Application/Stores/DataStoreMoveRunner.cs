using System.Diagnostics;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Stores;

/// <summary>
/// The worker side of a move of a baby's records between Lotties' database and the family's own (docs/design/47-bring-your-own-database.md
/// section 6, task T7). One call works on one baby in its own DI scope (its own stores, no ambient store).
/// </summary>
public interface IDataStoreMoveRunner
{
    /// <summary>Copies, verifies and switches the move this worker just started for the baby; does nothing when the move is not this worker's any more.</summary>
    Task RunStartedAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Does what is due on the baby's move (<see cref="DataStoreMove.DueWork"/>): resumes a copy whose worker stopped, gives up one
    /// that stopped too often, deletes the old copy after the undo window, deletes a failed move's leftovers.
    /// </summary>
    Task ProcessDueAsync(Guid babyId, CancellationToken cancellationToken = default);
}

/// <remarks>
/// The protocol (one recipe per work item):
/// <list type="number">
/// <item>Copy: wait <see cref="StoreMoveOptions.Drain"/> so requests that started before the writes were blocked finish; empty the
/// target's rows of the baby and copy the source's (the copier, in batches; every batch renews the lease and records progress).</item>
/// <item>Verify: the source's digest, taken after the copy, against the target's (counts and checksums per table). A difference
/// (a write that slipped in while the copy ran) copies once more; a second difference fails the move.</item>
/// <item>Switch: the baby's pointer moves to the target and its store epoch goes up, in one control-plane transaction with the move
/// row (<see cref="DataStoreMove.Complete"/>), the last step: before it the baby is on the source, after it on the target.</item>
/// <item>Any failure before the switch fails the move (the baby stays on the source) and deletes what reached the target; when that
/// delete fails too, the leftovers are deleted by a later sweep. A cancelled run (the process stopping) changes nothing: the lease
/// runs out and another run starts the copy again from the beginning.</item>
/// </list>
/// Log lines carry the direction, counts, durations, failure codes and exception types only: never a baby, record or store id, a
/// value or a message of the database.
/// </remarks>
internal sealed class DataStoreMoveRunner(
    IDataStoreMoveRepository moves,
    IDataStoreRepository stores,
    IStoreRecordCopier copier,
    StoreMoveWorkerId worker,
    StoreMoveOptions options,
    TimeProvider time,
    ILogger<DataStoreMoveRunner> logger) : IDataStoreMoveRunner
{
    /// <summary>Tries of the switch when the baby's row changed under it (a profile edit at the same moment).</summary>
    private const int SwitchTries = 3;

    private string Holder => worker.Value;

    private DateTimeOffset Now => time.GetUtcNow();

    public async Task RunStartedAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var move = await moves.FindAsync(babyId, cancellationToken);
        if (move is null || !move.IsInProgress || !move.IsHeldBy(Holder, Now))
        {
            return;
        }

        await CopyAndSwitchAsync(move, cancellationToken);
    }

    public async Task ProcessDueAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var move = await moves.FindAsync(babyId, cancellationToken);
        var work = move?.DueWork(Now, options.MaxAttempts) ?? DataStoreMoveWork.None;
        if (move is null || work == DataStoreMoveWork.None || !await ClaimAsync(move, work, cancellationToken))
        {
            return;
        }

        await (work switch
        {
            DataStoreMoveWork.Copy => CopyAndSwitchAsync(move, cancellationToken),
            DataStoreMoveWork.GiveUp => GiveUpAsync(move, cancellationToken),
            DataStoreMoveWork.RemoveOldCopy => RemoveOldCopyAsync(move, cancellationToken),
            _ => RemoveLeftoversAsync(move, cancellationToken),
        });
    }

    private async Task<bool> ClaimAsync(DataStoreMove move, DataStoreMoveWork work, CancellationToken cancellationToken) =>
        move.TryClaim(work, Holder, Now, options.Lease) && await moves.TrySaveAsync(cancellationToken);

    private async Task CopyAndSwitchAsync(DataStoreMove move, CancellationToken cancellationToken)
    {
        var clock = Stopwatch.StartNew();
        try
        {
            await Task.Delay(options.Drain, time, cancellationToken);
            await EnsureSourceIsCurrentAsync(move, cancellationToken);
            var plan = await PlanAsync(move, cancellationToken);
            var digest = await CopyVerifiedAsync(move, plan, cancellationToken);
            await SwitchAsync(move.BabyId, cancellationToken);
            logger.LogInformation(
                "Moved a baby's records ({Direction}): {RecordCount} records in {TableCount} tables, attempt {Attempt}, {Seconds:F1} s",
                move.Direction,
                digest.RecordCount,
                digest.Tables.Count,
                move.Attempt,
                clock.Elapsed.TotalSeconds);
        }
        catch (DataStoreMoveLeaseLostException)
        {
            logger.LogWarning("A move ({Direction}) was taken over by another worker; this worker stopped", move.Direction);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            await FailAsync(move.BabyId, move.Direction, exception, cancellationToken);
        }
    }

    /// <summary>
    /// The baby must still point at the move's source before anything is written (the copy first empties the target, which must never
    /// be the store the baby uses): otherwise <c>store_move_conflict</c>, and nothing is touched.
    /// </summary>
    private async Task EnsureSourceIsCurrentAsync(DataStoreMove move, CancellationToken cancellationToken)
    {
        if (!await PointsAtAsync(move.BabyId, move.Source, cancellationToken))
        {
            throw new DataStoreMoveConflictException();
        }
    }

    /// <summary>The copy plan: the owner's store must still exist; a copy into it carries only her own private notes.</summary>
    private async Task<StoreCopyPlan> PlanAsync(DataStoreMove move, CancellationToken cancellationToken)
    {
        var own = move.Direction == DataStoreMoveDirection.In ? move.Target : move.Source;
        var store = await stores.FindAsync(own.Id!.Value, cancellationToken) ?? throw new DataStoreNotConfiguredException();
        var privateNotesOnlyOf = move.Target.Kind == DataStoreKind.External ? store.OwnerUserId : (Guid?)null;
        return new StoreCopyPlan(move.BabyId, move.Source, move.Target, privateNotesOnlyOf, options.BatchSize);
    }

    private async Task<StoreDigest> CopyVerifiedAsync(DataStoreMove move, StoreCopyPlan plan, CancellationToken cancellationToken)
    {
        await CopyAsync(move, plan, cancellationToken);
        var first = await CompareAsync(move, plan, cancellationToken);
        if (first.Matched)
        {
            return first.Source;
        }

        logger.LogWarning("A move's copy differed from its source in {TableCount} tables; copying again", first.Differences);
        move.CopyAgain(Holder, Now, options.Lease);
        await SaveOrLoseAsync(cancellationToken);
        await CopyAsync(move, plan, cancellationToken);
        var second = await CompareAsync(move, plan, cancellationToken);
        return second.Matched ? second.Source : throw new DataStoreMoveVerificationFailedException();
    }

    private Task CopyAsync(DataStoreMove move, StoreCopyPlan plan, CancellationToken cancellationToken) =>
        copier.CopyAsync(plan, (progress, token) => RecordProgressAsync(move, progress, token), cancellationToken);

    private async Task RecordProgressAsync(DataStoreMove move, StoreCopyProgress progress, CancellationToken cancellationToken)
    {
        move.RecordProgress(Holder, progress.Copied, progress.Total, Now, options.Lease);
        await SaveOrLoseAsync(cancellationToken);
    }

    private async Task<Comparison> CompareAsync(DataStoreMove move, StoreCopyPlan plan, CancellationToken cancellationToken)
    {
        move.BeginVerify(Holder, Now, options.Lease);
        await SaveOrLoseAsync(cancellationToken);
        var source = await copier.DigestAsync(plan, StoreCopySide.Source, cancellationToken);
        move.RenewLease(Holder, Now, options.Lease);
        await SaveOrLoseAsync(cancellationToken);
        var target = await copier.DigestAsync(plan, StoreCopySide.Target, cancellationToken);
        return new Comparison(source, source.Matches(target), source.DifferingTables(target).Count);
    }

    /// <summary>
    /// The switch: the pointer moves from the source to the target and the epoch goes up, saved with the completed move in one
    /// transaction. Refused (<c>store_move_conflict</c>) when the pointer is no longer the source; tried again when the baby's row
    /// changed between the read and the save, as long as this worker still holds the move.
    /// </summary>
    private async Task SwitchAsync(Guid babyId, CancellationToken cancellationToken)
    {
        for (var attempt = 1; attempt <= SwitchTries; attempt++)
        {
            if (await TrySwitchAsync(babyId, cancellationToken))
            {
                return;
            }
        }

        throw new DataStoreMoveLeaseLostException();
    }

    private async Task<bool> TrySwitchAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var move = await moves.FindAsync(babyId, cancellationToken);
        if (move is not { State: DataStoreMoveState.Verifying } || !move.IsHeldBy(Holder, Now))
        {
            throw new DataStoreMoveLeaseLostException();
        }

        var assignment = await stores.FindAssignmentAsync(babyId, cancellationToken) ?? throw new DataStoreMoveConflictException();
        EnsurePointsAt(assignment, move.Source);
        assignment.MoveTo(move.Target);
        move.Complete(Holder, Now, options.UndoWindow);
        return await moves.TrySaveAsync(cancellationToken);
    }

    private static void EnsurePointsAt(BabyStoreAssignment assignment, DataStoreKey store)
    {
        if (assignment.Store != store)
        {
            throw new DataStoreMoveConflictException();
        }
    }

    /// <summary>
    /// The move failed before the switch: unless the switch did happen after all (its commit raced the error) or another worker took the
    /// move, the move is recorded as failed and what reached the target is deleted (leftovers pending when the delete failed too).
    /// </summary>
    private async Task FailAsync(Guid babyId, DataStoreMoveDirection direction, Exception exception, CancellationToken cancellationToken)
    {
        var code = FailureCodeOf(exception);
        logger.LogWarning("A move ({Direction}) failed with {Code} ({ExceptionType}); the baby stays on its store", direction, code, exception.GetType().Name);
        var move = await moves.FindAsync(babyId, cancellationToken);
        if (move is null || !move.IsInProgress || !move.IsHeldBy(Holder, Now))
        {
            return;
        }

        await FailWithLeftoversAsync(move, code, cancellationToken);
    }

    private async Task GiveUpAsync(DataStoreMove move, CancellationToken cancellationToken)
    {
        logger.LogWarning("A move ({Direction}) stopped {Attempts} times; giving it up", move.Direction, move.Attempt);
        await FailWithLeftoversAsync(move, DataStoreMoveFailureCodes.Abandoned, cancellationToken);
    }

    /// <summary>
    /// Records the failure and deletes what reached the target, never in the store the baby points at (that one holds its live records):
    /// leftovers stay pending only when the delete failed.
    /// </summary>
    private async Task FailWithLeftoversAsync(DataStoreMove move, string code, CancellationToken cancellationToken)
    {
        var targetIsLive = await PointsAtAsync(move.BabyId, move.Target, cancellationToken);
        var leftovers = !targetIsLive && !await TryWipeAsync(move.BabyId, move.Target, cancellationToken);
        move.Fail(code, leftovers, Now);
        await moves.TrySaveAsync(cancellationToken);
    }

    /// <summary>
    /// After the undo window: deletes the old copy in the source store. A store the baby points at again is never touched; a store that
    /// was disconnected (its row is gone) can no longer be reached, so the move completes without the delete (the copy is in the
    /// family's own database, under her control); a failed delete is tried again later.
    /// </summary>
    private async Task RemoveOldCopyAsync(DataStoreMove move, CancellationToken cancellationToken)
    {
        var old = move.Source;
        if (await PointsAtAsync(move.BabyId, old, cancellationToken) || !await StoreExistsAsync(old, cancellationToken))
        {
            move.OldCopyRemoved(deleted: false, Now);
        }
        else if (await TryWipeAsync(move.BabyId, old, cancellationToken))
        {
            move.OldCopyRemoved(deleted: true, Now);
            logger.LogInformation("Deleted the old copy of a moved baby's records ({Direction}) after the undo window", move.Direction);
        }
        else
        {
            move.PostponeCleanup(Now + options.CleanupRetry, Now);
        }

        await moves.TrySaveAsync(cancellationToken);
    }

    private async Task RemoveLeftoversAsync(DataStoreMove move, CancellationToken cancellationToken)
    {
        var target = move.Target;
        if (await PointsAtAsync(move.BabyId, target, cancellationToken) || !await StoreExistsAsync(target, cancellationToken))
        {
            move.LeftoversRemoved(Now);
        }
        else if (await TryWipeAsync(move.BabyId, target, cancellationToken))
        {
            move.LeftoversRemoved(Now);
        }
        else
        {
            move.PostponeCleanup(Now + options.CleanupRetry, Now);
        }

        await moves.TrySaveAsync(cancellationToken);
    }

    private async Task<bool> PointsAtAsync(Guid babyId, DataStoreKey store, CancellationToken cancellationToken) =>
        DataStoreKey.Of(await stores.StoreOfBabyAsync(babyId, cancellationToken)) == store;

    private async Task<bool> StoreExistsAsync(DataStoreKey store, CancellationToken cancellationToken) =>
        store.Id is not { } id || await stores.FindAsync(id, cancellationToken) is not null;

    private async Task<bool> TryWipeAsync(Guid babyId, DataStoreKey store, CancellationToken cancellationToken)
    {
        try
        {
            await copier.WipeAsync(babyId, store, cancellationToken);
            return true;
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Deleting a baby's copied records in a store failed ({ExceptionType}); tried again later", exception.GetType().Name);
            return false;
        }
    }

    private async Task SaveOrLoseAsync(CancellationToken cancellationToken)
    {
        if (!await moves.TrySaveAsync(cancellationToken))
        {
            throw new DataStoreMoveLeaseLostException();
        }
    }

    /// <summary>A store failure (also when wrapped by a failed save) or another domain error keeps its code; anything else is <c>store_move_failed</c>.</summary>
    private static string FailureCodeOf(Exception exception)
    {
        var domain = StoreFailureException.FindIn(exception) ?? exception as DomainException;
        return domain is not null && domain.Code.Length <= DataStoreMove.FailureCodeMaxLength ? domain.Code : DataStoreMoveFailureCodes.Failed;
    }

    private sealed record Comparison(StoreDigest Source, bool Matched, int Differences);
}
