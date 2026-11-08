using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>Which way a baby's records move (docs/design/47-bring-your-own-database.md section 6).</summary>
public enum DataStoreMoveDirection
{
    /// <summary>From Lotties' database into the family's own database (<c>move-in</c>).</summary>
    In,

    /// <summary>From the family's own database back to Lotties' database (<c>move-out</c>).</summary>
    Out,
}

/// <summary>Where a move stands. Stored by name in <c>data_store_moves.state</c>.</summary>
public enum DataStoreMoveState
{
    /// <summary>The records are being copied to the target; writes for the baby are refused (<c>store_moving</c>), reads use the source.</summary>
    Copying,

    /// <summary>Source and target are being compared table by table; writes are still refused.</summary>
    Verifying,

    /// <summary>The baby points at the target; the old copy in the source is kept until <see cref="DataStoreMove.OldCopyDeleteAfter"/> (the undo window).</summary>
    Moved,

    /// <summary>Moved, and the old copy was deleted (or could no longer be reached).</summary>
    Completed,

    /// <summary>Stopped before the switch: the baby stayed on the source; what reached the target is removed.</summary>
    Failed,
}

/// <summary>What a background run of the move worker has to do for one baby's move now.</summary>
public enum DataStoreMoveWork
{
    None,

    /// <summary>Copy, verify and switch (a move just started by this worker, or one whose worker stopped and whose lease expired).</summary>
    Copy,

    /// <summary>A move whose worker stopped too many times: it fails and the baby stays on the source.</summary>
    GiveUp,

    /// <summary>The undo window is over: delete the old copy in the source store.</summary>
    RemoveOldCopy,

    /// <summary>A failed move left records in the target: delete them.</summary>
    RemoveLeftovers,
}

/// <summary>
/// The move of one baby's records between Lotties' database and the family's own database (control table <c>data_store_moves</c>,
/// one row per baby: the latest move; docs/design/47-bring-your-own-database.md section 6, task T7). The protocol: the move starts
/// (<see cref="Start"/>) and blocks the baby's writes while it copies and verifies; the baby's store pointer switches only after
/// the copy matched the source (<see cref="Complete"/>), so any failure before that leaves the baby where it was
/// (<see cref="Fail"/>). After the switch the old copy is kept for the undo window, then deleted by the worker. A lease
/// (<see cref="LeaseHolder"/>, <see cref="LeaseUntil"/>) says which worker owns the row's current work: copying, or deleting an old
/// copy or leftovers; a worker that stops lets the lease expire, and another worker resumes from the start (the copy first empties
/// the target, so a restart is clean). The MVP moves only between the built-in store and the owner's one store (D11), so one side
/// is always the built-in store. Nothing here holds a record, a host or a credential.
/// </summary>
public sealed class DataStoreMove
{
    /// <summary>Longest worker id (machine, process and a random suffix).</summary>
    public const int HolderMaxLength = 64;

    /// <summary>Longest failure code (a <c>store_*</c> code).</summary>
    public const int FailureCodeMaxLength = 48;

    private DataStoreMove()
    {
    }

    public Guid BabyId { get; private set; }

    public DataStoreMoveDirection Direction { get; private set; }

    /// <summary>The store the records come from; <c>null</c> for the built-in store. Not a foreign key: the store row may go later.</summary>
    public Guid? SourceStoreId { get; private set; }

    /// <summary>The store the records go to; <c>null</c> for the built-in store.</summary>
    public Guid? TargetStoreId { get; private set; }

    public DataStoreMoveState State { get; private set; }

    /// <summary>How many times a worker started the copy of this move (1 for the first run).</summary>
    public int Attempt { get; private set; }

    /// <summary>The worker that owns the row's current work, while <see cref="LeaseUntil"/> is in the future.</summary>
    public string? LeaseHolder { get; private set; }

    public DateTimeOffset? LeaseUntil { get; private set; }

    /// <summary>Records written to the target so far by the current copy.</summary>
    public int RecordsCopied { get; private set; }

    /// <summary>Records the source holds for the baby, once counted.</summary>
    public int? RecordsTotal { get; private set; }

    public DateTimeOffset StartedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>When the baby's pointer switched to the target.</summary>
    public DateTimeOffset? MovedAt { get; private set; }

    /// <summary>The end of the undo window: the old copy in the source is deleted after it.</summary>
    public DateTimeOffset? OldCopyDeleteAfter { get; private set; }

    /// <summary>When the old copy was deleted; <c>null</c> for a completed move whose old copy could not be reached any more.</summary>
    public DateTimeOffset? OldCopyDeletedAt { get; private set; }

    /// <summary>A failed move whose partial copy in the target is still to be deleted.</summary>
    public bool LeftoversPending { get; private set; }

    /// <summary>When the worker next deletes the old copy (after the undo window) or a failed move's leftovers; <c>null</c> when nothing is due.</summary>
    public DateTimeOffset? NextCleanupAt { get; private set; }

    /// <summary>Why the move failed (a <c>store_*</c> code), else <c>null</c>.</summary>
    public string? FailureCode { get; private set; }

    public DataStoreKey Source => DataStoreKey.Of(SourceStoreId);

    public DataStoreKey Target => DataStoreKey.Of(TargetStoreId);

    /// <summary>Copying or verifying.</summary>
    public bool IsInProgress => State is DataStoreMoveState.Copying or DataStoreMoveState.Verifying;

    /// <summary>
    /// A new move of <paramref name="babyId"/> between the built-in store and the owner's store <paramref name="ownStoreId"/>, held by
    /// <paramref name="holder"/> for <paramref name="lease"/>: it blocks the baby's writes from now on.
    /// </summary>
    public static DataStoreMove Start(Guid babyId, DataStoreMoveDirection direction, Guid ownStoreId, string holder, DateTimeOffset now, TimeSpan lease)
    {
        var move = new DataStoreMove { BabyId = Ids.Required(babyId, nameof(babyId)) };
        move.Begin(direction, ownStoreId, holder, now, lease);
        return move;
    }

    /// <summary>
    /// Starts a new move on a baby whose row holds an earlier one. Refused (<see cref="DataStoreMoveInProgressException"/>) while a
    /// worker holds the row: a move still copying, or an old copy or leftovers being deleted. An earlier move that is in its undo
    /// window, completed, failed or abandoned by its worker is replaced: its old copy or leftovers are always in the new move's
    /// target (one side is the built-in store, the other the owner's store), which the new copy empties first.
    /// </summary>
    public void Restart(DataStoreMoveDirection direction, Guid ownStoreId, string holder, DateTimeOffset now, TimeSpan lease)
    {
        if (IsLeased(now))
        {
            throw new DataStoreMoveInProgressException();
        }

        Begin(direction, ownStoreId, holder, now, lease);
    }

    /// <summary>Whether the baby's writes are refused now: a move copying or verifying whose worker still holds the lease.</summary>
    public bool BlocksWrites(DateTimeOffset now) => IsInProgress && IsLeased(now);

    /// <summary>Whether a worker holds the row now.</summary>
    public bool IsLeased(DateTimeOffset now) => LeaseUntil is { } until && until > now;

    /// <summary>Whether <paramref name="holder"/> holds the row now.</summary>
    public bool IsHeldBy(string holder, DateTimeOffset now) => IsLeased(now) && LeaseHolder == holder;

    /// <summary>
    /// The work a sweep of the worker finds due now: a move whose worker stopped (lease expired) is resumed, or given up after
    /// <paramref name="maxAttempts"/> runs; an old copy whose undo window is over and the leftovers of a failed move are deleted.
    /// Nothing while another worker holds the row.
    /// </summary>
    public DataStoreMoveWork DueWork(DateTimeOffset now, int maxAttempts) => this switch
    {
        _ when IsLeased(now) => DataStoreMoveWork.None,
        { IsInProgress: true } => Attempt >= maxAttempts ? DataStoreMoveWork.GiveUp : DataStoreMoveWork.Copy,
        { NextCleanupAt: { } at } when at > now => DataStoreMoveWork.None,
        { State: DataStoreMoveState.Moved, NextCleanupAt: not null } => DataStoreMoveWork.RemoveOldCopy,
        { State: DataStoreMoveState.Failed, LeftoversPending: true } => DataStoreMoveWork.RemoveLeftovers,
        _ => DataStoreMoveWork.None,
    };

    /// <summary>
    /// Takes the row for <paramref name="work"/> when no other worker holds it; a resumed copy counts one more attempt and starts
    /// from the beginning. Returns whether it took it (save it right away: the row's version decides a race between workers).
    /// </summary>
    public bool TryClaim(DataStoreMoveWork work, string holder, DateTimeOffset now, TimeSpan lease)
    {
        if (IsLeased(now) && LeaseHolder != holder)
        {
            return false;
        }

        Take(holder, now, lease);
        if (work == DataStoreMoveWork.Copy && IsInProgress)
        {
            Attempt = checked(Attempt + 1);
            State = DataStoreMoveState.Copying;
            RecordsCopied = 0;
        }

        return true;
    }

    /// <summary>Extends the lease of <paramref name="holder"/>; <see cref="DataStoreMoveLeaseLostException"/> when another worker took the row.</summary>
    public void RenewLease(string holder, DateTimeOffset now, TimeSpan lease)
    {
        EnsureHeldBy(holder, now);
        Take(holder, now, lease);
    }

    /// <summary>Records the copy's progress (and renews the lease).</summary>
    public void RecordProgress(string holder, int copied, int total, DateTimeOffset now, TimeSpan lease)
    {
        EnsureState(DataStoreMoveState.Copying);
        RenewLease(holder, now, lease);
        RecordsCopied = Math.Max(0, copied);
        RecordsTotal = Math.Max(0, total);
    }

    /// <summary>The copy is done; the comparison of source and target starts.</summary>
    public void BeginVerify(string holder, DateTimeOffset now, TimeSpan lease)
    {
        EnsureState(DataStoreMoveState.Copying);
        RenewLease(holder, now, lease);
        State = DataStoreMoveState.Verifying;
    }

    /// <summary>The comparison found a difference: copy again (once; a second difference fails the move).</summary>
    public void CopyAgain(string holder, DateTimeOffset now, TimeSpan lease)
    {
        EnsureState(DataStoreMoveState.Verifying);
        RenewLease(holder, now, lease);
        State = DataStoreMoveState.Copying;
        RecordsCopied = 0;
    }

    /// <summary>
    /// The pointer switched to the target (saved in the same transaction): the move is done, the lease is released, and the old copy
    /// in the source is kept until <paramref name="now"/> + <paramref name="undoWindow"/>.
    /// </summary>
    public void Complete(string holder, DateTimeOffset now, TimeSpan undoWindow)
    {
        EnsureState(DataStoreMoveState.Verifying);
        EnsureHeldBy(holder, now);
        ArgumentOutOfRangeException.ThrowIfLessThan(undoWindow, TimeSpan.Zero);
        var at = UtcTime.Normalize(now);
        State = DataStoreMoveState.Moved;
        MovedAt = at;
        OldCopyDeleteAfter = UtcTime.Normalize(at + undoWindow);
        NextCleanupAt = OldCopyDeleteAfter;
        FailureCode = null;
        Release(at);
    }

    /// <summary>
    /// The move stopped before the switch with <paramref name="failureCode"/>: the baby stays on the source, the lease is released;
    /// <paramref name="leftoversPending"/> says whether the target still holds part of the copy (the worker deletes it later).
    /// </summary>
    public void Fail(string failureCode, bool leftoversPending, DateTimeOffset now)
    {
        if (!IsInProgress)
        {
            throw new DataStoreMoveStateException(State, DataStoreMoveState.Failed);
        }

        var at = UtcTime.Normalize(now);
        FailureCode = Text.Required(failureCode, nameof(failureCode), FailureCodeMaxLength);
        State = DataStoreMoveState.Failed;
        LeftoversPending = leftoversPending;
        NextCleanupAt = leftoversPending ? at : null;
        Release(at);
    }

    /// <summary>The leftovers of a failed move were deleted.</summary>
    public void LeftoversRemoved(DateTimeOffset now)
    {
        EnsureState(DataStoreMoveState.Failed);
        LeftoversPending = false;
        NextCleanupAt = null;
        Release(UtcTime.Normalize(now));
    }

    /// <summary>
    /// The old copy was deleted (<paramref name="deleted"/>), or can no longer be reached (its store was disconnected): the move is
    /// completed either way and the lease released.
    /// </summary>
    public void OldCopyRemoved(bool deleted, DateTimeOffset now)
    {
        EnsureState(DataStoreMoveState.Moved);
        var at = UtcTime.Normalize(now);
        State = DataStoreMoveState.Completed;
        OldCopyDeletedAt = deleted ? at : null;
        NextCleanupAt = null;
        Release(at);
    }

    /// <summary>
    /// Deleting the old copy or the leftovers failed (the store is down or paused): the row is released and the worker tries again at
    /// <paramref name="retryAt"/>. The undo window shown to the owner does not change.
    /// </summary>
    public void PostponeCleanup(DateTimeOffset retryAt, DateTimeOffset now)
    {
        if (NextCleanupAt is null)
        {
            throw new DataStoreMoveStateException(State, State);
        }

        NextCleanupAt = UtcTime.Normalize(retryAt);
        Release(UtcTime.Normalize(now));
    }

    private void Begin(DataStoreMoveDirection direction, Guid ownStoreId, string holder, DateTimeOffset now, TimeSpan lease)
    {
        var own = Ids.Required(ownStoreId, nameof(ownStoreId));
        var at = UtcTime.Normalize(now);
        Direction = direction;
        (SourceStoreId, TargetStoreId) = direction == DataStoreMoveDirection.In ? ((Guid?)null, (Guid?)own) : (own, null);
        State = DataStoreMoveState.Copying;
        Attempt = 1;
        RecordsCopied = 0;
        RecordsTotal = null;
        StartedAt = at;
        MovedAt = null;
        OldCopyDeleteAfter = null;
        OldCopyDeletedAt = null;
        LeftoversPending = false;
        NextCleanupAt = null;
        FailureCode = null;
        Take(holder, at, lease);
    }

    private void Take(string holder, DateTimeOffset now, TimeSpan lease)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(lease, TimeSpan.Zero);
        LeaseHolder = Text.Required(holder, nameof(holder), HolderMaxLength);
        UpdatedAt = UtcTime.Normalize(now);
        LeaseUntil = UtcTime.Normalize(now + lease);
    }

    private void Release(DateTimeOffset now)
    {
        LeaseHolder = null;
        LeaseUntil = null;
        UpdatedAt = now;
    }

    private void EnsureHeldBy(string holder, DateTimeOffset now)
    {
        if (!IsHeldBy(holder, now))
        {
            throw new DataStoreMoveLeaseLostException();
        }
    }

    private void EnsureState(DataStoreMoveState expected)
    {
        if (State != expected)
        {
            throw new DataStoreMoveStateException(State, expected);
        }
    }
}
