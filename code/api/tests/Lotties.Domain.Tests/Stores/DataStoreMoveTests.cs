using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

/// <summary>
/// The move of a baby's records between Lotties' database and the family's own (docs/design/47-bring-your-own-database.md section 6,
/// task T7): the state machine, the worker's lease, the write block, the undo window and the cleanup schedule, with a fixed clock.
/// </summary>
public sealed class DataStoreMoveTests
{
    private const string Worker = "worker-a";
    private const string Other = "worker-b";

    private static readonly Guid BabyId = Guid.Parse("b0000000-0000-4000-8000-000000000001");
    private static readonly Guid OwnStore = Guid.Parse("5a000000-0000-4000-8000-000000000001");
    private static readonly DateTimeOffset Start = new(2026, 11, 8, 10, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan Window = TimeSpan.FromDays(7);

    [Fact]
    public void Start_In_CopiesFromTheBuiltInStoreToTheOwnStoreAndBlocksWrites()
    {
        var move = DataStoreMove.Start(BabyId, DataStoreMoveDirection.In, OwnStore, Worker, Start, Lease);

        Assert.Equal((DataStoreKey.BuiltIn, DataStoreKey.External(OwnStore)), (move.Source, move.Target));
        Assert.Equal((DataStoreMoveState.Copying, 1, Worker), (move.State, move.Attempt, move.LeaseHolder));
        Assert.True(move.BlocksWrites(Start));
        Assert.True(move.BlocksWrites(Start + Lease - TimeSpan.FromSeconds(1)));
        Assert.False(move.BlocksWrites(Start + Lease));
    }

    [Fact]
    public void Start_Out_CopiesFromTheOwnStoreToTheBuiltInStore()
    {
        var move = DataStoreMove.Start(BabyId, DataStoreMoveDirection.Out, OwnStore, Worker, Start, Lease);

        Assert.Equal((DataStoreKey.External(OwnStore), DataStoreKey.BuiltIn), (move.Source, move.Target));
    }

    [Fact]
    public void Start_EmptyIdsOrNoLease_Throw()
    {
        Assert.Throws<ArgumentException>(() => DataStoreMove.Start(Guid.Empty, DataStoreMoveDirection.In, OwnStore, Worker, Start, Lease));
        Assert.Throws<ArgumentException>(() => DataStoreMove.Start(BabyId, DataStoreMoveDirection.In, Guid.Empty, Worker, Start, Lease));
        Assert.Throws<ArgumentOutOfRangeException>(() => DataStoreMove.Start(BabyId, DataStoreMoveDirection.In, OwnStore, Worker, Start, TimeSpan.Zero));
    }

    [Fact]
    public void HappyPath_CopyVerifyComplete_KeepsTheOldCopyForTheUndoWindowAndStopsBlocking()
    {
        var move = Started();
        var now = Start.AddSeconds(30);

        move.RecordProgress(Worker, 500, 1200, now, Lease);
        move.BeginVerify(Worker, now, Lease);
        move.Complete(Worker, now, Window);

        Assert.Equal((DataStoreMoveState.Moved, now, now + Window), (move.State, move.MovedAt, move.OldCopyDeleteAfter));
        Assert.Equal((500, (int?)1200), (move.RecordsCopied, move.RecordsTotal));
        Assert.Null(move.LeaseHolder);
        Assert.False(move.BlocksWrites(now));
        Assert.Equal(DataStoreMoveWork.None, move.DueWork(now + Window - TimeSpan.FromSeconds(1), 3));
        Assert.Equal(DataStoreMoveWork.RemoveOldCopy, move.DueWork(now + Window, 3));
    }

    [Fact]
    public void CopyAgain_AfterAFirstDifference_GoesBackToCopyingAndResetsTheProgress()
    {
        var move = Started();
        move.RecordProgress(Worker, 10, 10, Start, Lease);
        move.BeginVerify(Worker, Start, Lease);

        move.CopyAgain(Worker, Start, Lease);

        Assert.Equal((DataStoreMoveState.Copying, 0), (move.State, move.RecordsCopied));
    }

    [Fact]
    public void Steps_OutOfOrder_ThrowTheStateError()
    {
        var move = Started();

        Assert.Throws<DataStoreMoveStateException>(() => move.Complete(Worker, Start, Window));
        Assert.Throws<DataStoreMoveStateException>(() => move.CopyAgain(Worker, Start, Lease));
        Assert.Throws<DataStoreMoveStateException>(() => move.OldCopyRemoved(true, Start));
        Assert.Throws<DataStoreMoveStateException>(() => move.LeftoversRemoved(Start));
    }

    [Fact]
    public void Renew_ByAWorkerThatLostTheLease_ThrowsLeaseLost()
    {
        var move = Started();

        Assert.Throws<DataStoreMoveLeaseLostException>(() => move.RenewLease(Other, Start, Lease));
        Assert.Throws<DataStoreMoveLeaseLostException>(() => move.RecordProgress(Worker, 1, 1, Start + Lease, Lease));
    }

    [Fact]
    public void Fail_BeforeTheSwitch_StopsBlockingAndSchedulesTheLeftovers()
    {
        var move = Started();

        move.Fail("store_move_verify_failed", leftoversPending: true, Start);

        Assert.Equal((DataStoreMoveState.Failed, "store_move_verify_failed", true), (move.State, move.FailureCode, move.LeftoversPending));
        Assert.False(move.BlocksWrites(Start));
        Assert.Equal(DataStoreMoveWork.RemoveLeftovers, move.DueWork(Start, 3));
    }

    [Fact]
    public void Fail_WithoutLeftovers_HasNothingDue()
    {
        var move = Started();

        move.Fail("store_unavailable", leftoversPending: false, Start);

        Assert.Equal(DataStoreMoveWork.None, move.DueWork(Start.AddDays(30), 3));
        Assert.Throws<DataStoreMoveStateException>(() => move.Fail("store_unavailable", false, Start));
    }

    [Fact]
    public void DueWork_StoppedWorker_ResumesUntilTheLastAttemptThenGivesUp()
    {
        var move = Started();
        var expired = Start + Lease;

        Assert.Equal(DataStoreMoveWork.None, move.DueWork(Start, 3));
        Assert.Equal(DataStoreMoveWork.Copy, move.DueWork(expired, 3));
        Assert.True(move.TryClaim(DataStoreMoveWork.Copy, Other, expired, Lease));
        Assert.Equal((2, Other, DataStoreMoveState.Copying), (move.Attempt, move.LeaseHolder, move.State));
        Assert.Equal(DataStoreMoveWork.GiveUp, move.DueWork(expired + Lease, 2));
    }

    [Fact]
    public void TryClaim_HeldByAnotherWorker_IsRefused()
    {
        var move = Started();

        Assert.False(move.TryClaim(DataStoreMoveWork.Copy, Other, Start, Lease));
        Assert.Equal((1, Worker), (move.Attempt, move.LeaseHolder));
    }

    [Fact]
    public void Resume_FromVerifying_StartsTheCopyOver()
    {
        var move = Started();
        move.RecordProgress(Worker, 7, 7, Start, Lease);
        move.BeginVerify(Worker, Start, Lease);

        Assert.True(move.TryClaim(DataStoreMoveWork.Copy, Other, Start + Lease, Lease));

        Assert.Equal((DataStoreMoveState.Copying, 0), (move.State, move.RecordsCopied));
    }

    [Fact]
    public void Restart_WhileAWorkerHoldsTheRow_IsRefused()
    {
        var move = Started();

        Assert.Throws<DataStoreMoveInProgressException>(() => move.Restart(DataStoreMoveDirection.In, OwnStore, Other, Start, Lease));
    }

    [Fact]
    public void Restart_DuringTheUndoWindow_StartsTheOppositeMoveAndForgetsTheOldCopy()
    {
        var move = Moved();
        var later = Start.AddDays(2);

        move.Restart(DataStoreMoveDirection.Out, OwnStore, Worker, later, Lease);

        Assert.Equal((DataStoreKey.External(OwnStore), DataStoreKey.BuiltIn), (move.Source, move.Target));
        Assert.Equal((DataStoreMoveState.Copying, 1), (move.State, move.Attempt));
        Assert.Null(move.OldCopyDeleteAfter);
        Assert.Null(move.NextCleanupAt);
        Assert.True(move.BlocksWrites(later));
    }

    [Fact]
    public void Restart_OfAStoppedMove_IsAllowedOnceTheLeaseRanOut()
    {
        var move = Started();

        move.Restart(DataStoreMoveDirection.In, OwnStore, Other, Start + Lease, Lease);

        Assert.Equal((Other, 1), (move.LeaseHolder, move.Attempt));
    }

    [Fact]
    public void OldCopy_Deleted_CompletesTheMove()
    {
        var move = Moved();
        var due = Start + Window;
        Assert.True(move.TryClaim(DataStoreMoveWork.RemoveOldCopy, Worker, due, Lease));

        move.OldCopyRemoved(deleted: true, due);

        Assert.Equal((DataStoreMoveState.Completed, due), (move.State, move.OldCopyDeletedAt));
        Assert.Equal(DataStoreMoveWork.None, move.DueWork(due.AddDays(1), 3));
    }

    [Fact]
    public void OldCopy_Unreachable_CompletesWithoutADeletionTime()
    {
        var move = Moved();

        move.OldCopyRemoved(deleted: false, Start + Window);

        Assert.Equal((DataStoreMoveState.Completed, (DateTimeOffset?)null), (move.State, move.OldCopyDeletedAt));
    }

    [Fact]
    public void PostponeCleanup_FailedDelete_TriesAgainLaterAndKeepsThePromisedDate()
    {
        var move = Moved();
        var due = Start + Window;
        Assert.True(move.TryClaim(DataStoreMoveWork.RemoveOldCopy, Worker, due, Lease));

        move.PostponeCleanup(due.AddHours(1), due);

        Assert.Equal((due, due.AddHours(1)), (move.OldCopyDeleteAfter!.Value, move.NextCleanupAt!.Value));
        Assert.Null(move.LeaseHolder);
        Assert.Equal(DataStoreMoveWork.None, move.DueWork(due.AddMinutes(59), 3));
        Assert.Equal(DataStoreMoveWork.RemoveOldCopy, move.DueWork(due.AddHours(1), 3));
    }

    [Fact]
    public void LeftoversRemoved_ClearsTheCleanup()
    {
        var move = Started();
        move.Fail("store_move_conflict", leftoversPending: true, Start);

        move.LeftoversRemoved(Start.AddMinutes(1));

        Assert.False(move.LeftoversPending);
        Assert.Equal(DataStoreMoveWork.None, move.DueWork(Start.AddDays(1), 3));
    }

    [Fact]
    public void StoreDigest_SameTablesCountsAndChecksums_Match()
    {
        var source = new StoreDigest([new("events", 2, "aa"), new("baby_notes", 1, "bb")]);
        var same = new StoreDigest([new("events", 2, "aa"), new("baby_notes", 1, "bb")]);
        var differs = new StoreDigest([new("events", 2, "ab"), new("baby_notes", 1, "bb")]);
        var shorter = new StoreDigest([new("events", 2, "aa")]);

        Assert.True(source.Matches(same));
        Assert.False(source.Matches(differs));
        Assert.False(source.Matches(shorter));
        Assert.Equal(["events"], source.DifferingTables(differs));
        Assert.Equal(["baby_notes"], source.DifferingTables(shorter));
        Assert.Equal(3, source.RecordCount);
    }

    private static DataStoreMove Started() => DataStoreMove.Start(BabyId, DataStoreMoveDirection.In, OwnStore, Worker, Start, Lease);

    private static DataStoreMove Moved()
    {
        var move = Started();
        move.BeginVerify(Worker, Start, Lease);
        move.Complete(Worker, Start, Window);
        return move;
    }
}
