using System.Security.Cryptography;
using System.Text;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The move protocol (docs/design/47-bring-your-own-database.md section 6, task T7) with fakes and a clock the test moves: the pointer
/// switches last and only after the copy matched its source; a difference copies once more, a second one fails; any failure before
/// the switch leaves the baby on the source and removes what reached the target; a stopped worker's move is resumed by the sweep and
/// given up after the last attempt; a worker that lost the lease stops without touching anything; the old copy is deleted only after
/// the undo window.
/// </summary>
public sealed class DataStoreMoveRunnerTests
{
    private const string Holder = "worker-test";

    private static readonly Guid BabyId = Guid.Parse("b0000000-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnStoreId = Guid.Parse("5a000000-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnerId = Guid.Parse("0a000000-0000-4000-8000-0000000000a1");
    private static readonly DataStoreKey Own = DataStoreKey.External(OwnStoreId);
    private static readonly DateTimeOffset Start = new(2026, 11, 8, 9, 0, 0, TimeSpan.Zero);

    private readonly MovableClock _clock = new(Start);
    private readonly StoreMoveOptions _options = new() { DrainSeconds = 0, UndoWindowDays = 7, LeaseSeconds = 120, MaxAttempts = 2, BatchSize = 2 };
    private readonly FakeMoveRows _moves = new();
    private readonly FakeStoreRows _stores = new();
    private readonly FakeCopier _copier = new();

    public DataStoreMoveRunnerTests()
    {
        _copier.Rows[DataStoreKey.BuiltIn] = ["event:1", "event:2", "note:1"];
        _copier.Rows[Own] = [];
    }

    [Fact]
    public async Task RunStarted_MoveIn_CopiesVerifiesThenSwitchesThePointerAndKeepsTheOldCopy()
    {
        StartMove(DataStoreMoveDirection.In);

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal((Own, 1), (_stores.Assignment.Store, _stores.Assignment.Epoch));
        Assert.Equal(DataStoreMoveState.Moved, _moves.Move!.State);
        Assert.Equal(Start.AddDays(7), _moves.Move.OldCopyDeleteAfter);
        Assert.Equal(_copier.Rows[DataStoreKey.BuiltIn], _copier.Rows[Own]);
        Assert.Equal(3, _copier.Rows[DataStoreKey.BuiltIn].Count);
        Assert.Equal((3, (int?)3), (_moves.Move.RecordsCopied, _moves.Move.RecordsTotal));
        Assert.True(_copier.SwitchedAfterVerify(_stores));
    }

    [Fact]
    public async Task RunStarted_MoveIn_CopiesOnlyTheOwnersPrivateNotes_MoveOutCopiesEverything()
    {
        StartMove(DataStoreMoveDirection.In);
        await Runner().RunStartedAsync(BabyId);
        var into = _copier.Plans.Last();

        _clock.Advance(TimeSpan.FromDays(1));
        StartMove(DataStoreMoveDirection.Out);
        await Runner().RunStartedAsync(BabyId);
        var back = _copier.Plans.Last();

        Assert.Equal((DataStoreKey.BuiltIn, Own, (Guid?)OwnerId), (into.Source, into.Target, into.PrivateNotesOnlyOf));
        Assert.Equal((Own, DataStoreKey.BuiltIn, (Guid?)null), (back.Source, back.Target, back.PrivateNotesOnlyOf));
        Assert.Equal((DataStoreKey.BuiltIn, 2), (_stores.Assignment.Store, _stores.Assignment.Epoch));
        Assert.Equal(2, _options.BatchSize);
        Assert.All(_copier.Plans, plan => Assert.Equal(_options.BatchSize, plan.BatchSize));
    }

    [Fact]
    public async Task RunStarted_AWriteSlipsInDuringTheFirstCopy_CopiesAgainAndSwitches()
    {
        StartMove(DataStoreMoveDirection.In);
        _copier.AfterCopy = count => { if (count == 1) _copier.Rows[DataStoreKey.BuiltIn].Add("event:late"); };

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal(2, _copier.Copies);
        Assert.Contains("event:late", _copier.Rows[Own]);
        Assert.Equal(Own, _stores.Assignment.Store);
    }

    [Fact]
    public async Task RunStarted_ChecksumDiffersTwice_FailsLeavesTheBabyOnTheSourceAndEmptiesTheTarget()
    {
        StartMove(DataStoreMoveDirection.In);
        _copier.AfterCopy = _ => _copier.Rows[Own].Add("garbage");

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal((DataStoreKey.BuiltIn, 0), (_stores.Assignment.Store, _stores.Assignment.Epoch));
        Assert.Equal((DataStoreMoveState.Failed, "store_move_verify_failed", false), (_moves.Move!.State, _moves.Move.FailureCode, _moves.Move.LeftoversPending));
        Assert.Empty(_copier.Rows[Own]);
        Assert.Equal(3, _copier.Rows[DataStoreKey.BuiltIn].Count);
        Assert.False(_moves.Move.BlocksWrites(_clock.GetUtcNow()));
    }

    [Fact]
    public async Task RunStarted_TargetGoesDownMidCopy_FailsWithTheStoreCodeAndSchedulesTheLeftoversWhenTheyCannotBeDeleted()
    {
        StartMove(DataStoreMoveDirection.In);
        _copier.CopyFault = new StorePausedOrUnreachableException();
        _copier.WipeFault = new StorePausedOrUnreachableException();

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
        Assert.Equal((DataStoreMoveState.Failed, "store_paused_or_unreachable", true), (_moves.Move!.State, _moves.Move.FailureCode, _moves.Move.LeftoversPending));
        Assert.Equal(DataStoreMoveWork.RemoveLeftovers, _moves.Move.DueWork(_clock.GetUtcNow(), _options.MaxAttempts));

        _copier.WipeFault = null;
        await Runner().ProcessDueAsync(BabyId);

        Assert.False(_moves.Move.LeftoversPending);
        Assert.Empty(_copier.Rows[Own]);
    }

    [Fact]
    public async Task RunStarted_UnexpectedError_IsStoreMoveFailed()
    {
        StartMove(DataStoreMoveDirection.In);
        _copier.CopyFault = new InvalidOperationException("boom");

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal("store_move_failed", _moves.Move!.FailureCode);
        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
    }

    [Fact]
    public async Task RunStarted_Interrupted_LeavesTheBabyOnTheSource_TheSweepResumesAfterTheLeaseAndSwitches()
    {
        StartMove(DataStoreMoveDirection.In);
        using var stop = new CancellationTokenSource();
        _copier.AfterCopy = _ => stop.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Runner().RunStartedAsync(BabyId, stop.Token));

        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
        Assert.True(_moves.Move!.IsInProgress);
        _copier.AfterCopy = null;
        await Runner().ProcessDueAsync(BabyId);
        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);

        _clock.Advance(_options.Lease);
        await Runner(holder: "another-worker").ProcessDueAsync(BabyId);

        Assert.Equal((Own, DataStoreMoveState.Moved, 2), (_stores.Assignment.Store, _moves.Move.State, _moves.Move.Attempt));
        Assert.Equal(_copier.Rows[DataStoreKey.BuiltIn], _copier.Rows[Own]);
    }

    [Fact]
    public async Task ProcessDue_StoppedMoveOfABabyWhoseAccountIsBeingDeleted_IsNotResumed()
    {
        StartMove(DataStoreMoveDirection.In);
        using var stop = new CancellationTokenSource();
        _copier.AfterCopy = _ => stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Runner().RunStartedAsync(BabyId, stop.Token));
        _copier.AfterCopy = null;
        _clock.Advance(_options.Lease);
        _moves.Deleting = true;

        await Runner(holder: "another-worker").ProcessDueAsync(BabyId);

        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
        Assert.NotEqual(DataStoreMoveState.Moved, _moves.Move!.State);
    }

    [Fact]
    public async Task ProcessDue_StoppedOnTheLastAttempt_GivesUpAndEmptiesTheTarget()
    {
        StartMove(DataStoreMoveDirection.In);
        _moves.Move!.TryClaim(DataStoreMoveWork.Copy, Holder, _clock.GetUtcNow() + _options.Lease, _options.Lease);
        _copier.Rows[Own].Add("event:1");
        _clock.Advance(_options.Lease * 3);

        await Runner().ProcessDueAsync(BabyId);

        Assert.Equal((DataStoreMoveState.Failed, "store_move_abandoned"), (_moves.Move.State, _moves.Move.FailureCode));
        Assert.Empty(_copier.Rows[Own]);
        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
    }

    [Fact]
    public async Task RunStarted_LeaseLostWhileCopying_StopsWithoutFailingOrSwitching()
    {
        StartMove(DataStoreMoveDirection.In);
        _moves.RefuseSaveNumber = 2;

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
        Assert.Equal(DataStoreMoveState.Copying, _moves.Stored.State);
        Assert.Equal(0, _copier.Wipes);
    }

    [Fact]
    public async Task RunStarted_HeldByAnotherWorker_DoesNothing()
    {
        StartMove(DataStoreMoveDirection.In, holder: "someone-else");

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal(0, _copier.Copies);
        Assert.Equal(DataStoreMoveState.Copying, _moves.Move!.State);
    }

    [Fact]
    public async Task RunStarted_BabyNotOnTheMovesSource_FailsWithConflictAndNeverTouchesTheLiveStore()
    {
        StartMove(DataStoreMoveDirection.Out);

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal((DataStoreMoveState.Failed, "store_move_conflict", false), (_moves.Move!.State, _moves.Move.FailureCode, _moves.Move.LeftoversPending));
        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
        Assert.Equal((0, 0, 3), (_copier.Copies, _copier.Wipes, _copier.Rows[DataStoreKey.BuiltIn].Count));
    }

    [Fact]
    public async Task RunStarted_OwnStoreRemoved_FailsWithStoreNotConfigured()
    {
        StartMove(DataStoreMoveDirection.In);
        _stores.Store = null;

        await Runner().RunStartedAsync(BabyId);

        Assert.Equal("store_not_configured", _moves.Move!.FailureCode);
        Assert.Equal(DataStoreKey.BuiltIn, _stores.Assignment.Store);
    }

    [Fact]
    public async Task ProcessDue_OldCopy_KeptDuringTheUndoWindowThenDeleted()
    {
        StartMove(DataStoreMoveDirection.In);
        await Runner().RunStartedAsync(BabyId);

        _clock.Advance(TimeSpan.FromDays(7) - TimeSpan.FromSeconds(1));
        await Runner().ProcessDueAsync(BabyId);
        Assert.Equal(3, _copier.Rows[DataStoreKey.BuiltIn].Count);

        _clock.Advance(TimeSpan.FromSeconds(1));
        await Runner().ProcessDueAsync(BabyId);

        Assert.Empty(_copier.Rows[DataStoreKey.BuiltIn]);
        Assert.Equal(3, _copier.Rows[Own].Count);
        Assert.Equal((DataStoreMoveState.Completed, _clock.GetUtcNow()), (_moves.Move!.State, _moves.Move.OldCopyDeletedAt));
    }

    [Fact]
    public async Task ProcessDue_OldCopyStoreDown_TriesAgainAfterTheRetryDelay()
    {
        StartMove(DataStoreMoveDirection.In);
        await Runner().RunStartedAsync(BabyId);
        _clock.Advance(TimeSpan.FromDays(7));
        _copier.WipeFault = new StoreTimeoutException();

        await Runner().ProcessDueAsync(BabyId);

        Assert.Equal(DataStoreMoveState.Moved, _moves.Move!.State);
        Assert.Equal(_clock.GetUtcNow() + _options.CleanupRetry, _moves.Move.NextCleanupAt);
        Assert.Equal(3, _copier.Rows[DataStoreKey.BuiltIn].Count);
    }

    [Fact]
    public async Task ProcessDue_OldCopyInARemovedStore_CompletesWithoutDeleting()
    {
        _copier.Rows[Own] = ["event:1"];
        _copier.Rows[DataStoreKey.BuiltIn] = [];
        _stores.Assignment.MoveTo(Own);
        StartMove(DataStoreMoveDirection.Out);
        await Runner().RunStartedAsync(BabyId);
        _stores.Store = null;
        _clock.Advance(TimeSpan.FromDays(7));

        await Runner().ProcessDueAsync(BabyId);

        Assert.Equal((DataStoreMoveState.Completed, (DateTimeOffset?)null), (_moves.Move!.State, _moves.Move.OldCopyDeletedAt));
        Assert.Equal(["event:1"], _copier.Rows[Own]);
    }

    private DataStoreMoveRunner Runner(string holder = Holder) =>
        new(_moves, _stores, _copier, new StoreMoveWorkerId(holder), _options, _clock, NullLogger<DataStoreMoveRunner>.Instance);

    private void StartMove(DataStoreMoveDirection direction, string holder = Holder)
    {
        if (_moves.Move is { } existing)
        {
            existing.Restart(direction, OwnStoreId, holder, _clock.GetUtcNow(), _options.Lease);
            return;
        }

        _moves.Move = DataStoreMove.Start(BabyId, direction, OwnStoreId, holder, _clock.GetUtcNow(), _options.Lease);
    }

    private sealed class MovableClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }

    /// <summary>One move row; the save number <see cref="RefuseSaveNumber"/> is refused (a concurrent writer took the row).</summary>
    private sealed class FakeMoveRows : IDataStoreMoveRepository
    {
        private int _saves;

        public DataStoreMove? Move { get; set; }

        /// <summary>The state last saved.</summary>
        public DataStoreMove Stored => Move!;

        public int RefuseSaveNumber { get; set; }

        public Task<DataStoreMove?> FindAsync(Guid babyId, CancellationToken cancellationToken = default) => Task.FromResult(Move);

        public Task<StoreWriteBlock> WriteBlockAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default) =>
            Task.FromResult(Move?.BlocksWrites(now) == true ? StoreWriteBlock.Moving : StoreWriteBlock.None);

        public Task<IReadOnlyList<Guid>> ListDueAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<Guid>>(Move is null ? [] : [Move.BabyId]);

        public void Add(DataStoreMove move) => Move = move;

        public Task<bool> TrySaveAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(++_saves != RefuseSaveNumber);

        /// <summary>The baby's account is being deleted: a claim is refused (task T10).</summary>
        public bool Deleting { get; set; }

        public async Task<DataStoreMoveSave> TrySaveUnlessDeletingAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default) =>
            Deleting ? DataStoreMoveSave.AccountDeleting : await TrySaveAsync(cancellationToken) ? DataStoreMoveSave.Saved : DataStoreMoveSave.Conflict;
    }

    /// <summary>The baby's pointer and the owner's store row.</summary>
    private sealed class FakeStoreRows : IDataStoreRepository
    {
        public BabyStoreAssignment Assignment { get; } = BabyStoreAssignment.ForNewBaby(BabyId);

        public DataStore? Store { get; set; } = DataStore.Create(OwnStoreId, OwnerId, Start);

        public Task<DataStore?> FindByOwnerAsync(Guid ownerUserId, CancellationToken cancellationToken = default) => Task.FromResult(Store);

        public Task<DataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Store?.Id == storeId ? Store : null);

        public Task<Guid?> StoreOfBabyAsync(Guid babyId, CancellationToken cancellationToken = default) => Task.FromResult(Assignment.DataStoreId);

        public Task<BabyStoreAssignment?> FindAssignmentAsync(Guid babyId, CancellationToken cancellationToken = default) =>
            Task.FromResult<BabyStoreAssignment?>(Assignment);

        public Task<bool> IsInUseAsync(Guid storeId, CancellationToken cancellationToken = default) => Task.FromResult(Assignment.DataStoreId == storeId);

        public Task<bool> TryAddAsync(DataStore store, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public void Remove(DataStore store) => Store = null;

        public Task SaveChangesAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    /// <summary>Stores as lists of row names; the digest is the count and a hash of the sorted rows.</summary>
    private sealed class FakeCopier : IStoreRecordCopier
    {
        private readonly List<string> _events = [];

        public Dictionary<DataStoreKey, List<string>> Rows { get; } = [];

        public List<StoreCopyPlan> Plans { get; } = [];

        public Action<int>? AfterCopy { get; set; }

        public Exception? CopyFault { get; set; }

        public Exception? WipeFault { get; set; }

        public int Copies { get; private set; }

        public int Wipes { get; private set; }

        public async Task CopyAsync(StoreCopyPlan plan, Func<StoreCopyProgress, CancellationToken, Task> onBatch, CancellationToken cancellationToken = default)
        {
            Plans.Add(plan);
            Copies++;
            _events.Add("copy");
            var source = Rows[plan.Source].ToList();
            Rows[plan.Target].Clear();
            await onBatch(new StoreCopyProgress(0, source.Count), cancellationToken);
            if (CopyFault is { } fault)
            {
                Rows[plan.Target].Add(source[0]);
                throw fault;
            }

            Rows[plan.Target].AddRange(source);
            await onBatch(new StoreCopyProgress(source.Count, source.Count), cancellationToken);
            AfterCopy?.Invoke(Copies);
            cancellationToken.ThrowIfCancellationRequested();
        }

        public Task<StoreDigest> DigestAsync(StoreCopyPlan plan, StoreCopySide side, CancellationToken cancellationToken = default)
        {
            _events.Add("digest");
            var rows = Rows[side == StoreCopySide.Source ? plan.Source : plan.Target].Order(StringComparer.Ordinal).ToArray();
            var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', rows))));
            return Task.FromResult(new StoreDigest([new StoreTableDigest("rows", rows.Length, checksum)]));
        }

        public Task WipeAsync(Guid babyId, DataStoreKey store, CancellationToken cancellationToken = default)
        {
            Wipes++;
            if (WipeFault is { } fault)
            {
                return Task.FromException(fault);
            }

            Rows[store].Clear();
            return Task.CompletedTask;
        }

        /// <summary>The pointer moved and the last thing the copier did before it was comparing digests.</summary>
        public bool SwitchedAfterVerify(FakeStoreRows stores) => stores.Assignment.Epoch > 0 && _events[^1] == "digest";
    }
}
