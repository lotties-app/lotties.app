namespace Lotties.Domain.Stores;

/// <summary>
/// The write block of an account deletion (docs/design/47-bring-your-own-database.md section 9, task T10): while the account that
/// alone keeps a baby is being deleted, the baby's row carries <c>babies.account_deletion_started_at</c>. Saves of the baby's records
/// are refused with the retriable <c>503 store_account_deleting</c> (reads go on) and no move of the baby may start, so nothing
/// reaches the family's own database between its wipe and the erasure of Lotties' side. A block older than <see cref="MaxAge"/> is
/// stale (the process that set it stopped without clearing it) and is ignored, so a baby is never blocked for good.
/// </summary>
public static class AccountDeletionBlock
{
    /// <summary>How long a block holds: far longer than a deletion takes (a 30 s wipe per store, the drain, one transaction).</summary>
    public static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(10);

    /// <summary>A block set before this instant is stale at <paramref name="now"/>.</summary>
    public static DateTimeOffset StaleBefore(DateTimeOffset now) => (now - MaxAge).ToUniversalTime();

    /// <summary>Whether a block set at <paramref name="startedAt"/> still holds at <paramref name="now"/>.</summary>
    public static bool IsActive(DateTimeOffset? startedAt, DateTimeOffset now) => startedAt is { } at && at > StaleBefore(now);
}

/// <summary>Why the saves of a baby's records are refused right now, if they are.</summary>
public enum StoreWriteBlock
{
    None,

    /// <summary>A move of the baby's records copies or verifies (<c>503 store_moving</c>, task T7).</summary>
    Moving,

    /// <summary>The account that alone keeps the baby is being deleted (<c>503 store_account_deleting</c>, task T10).</summary>
    AccountDeleting,
}

/// <summary>What happened to a save of a move row that may start or resume a copy.</summary>
public enum DataStoreMoveSave
{
    Saved,

    /// <summary>A concurrent writer changed or added the row first; nothing was saved.</summary>
    Conflict,

    /// <summary>The baby is being deleted with its account (<see cref="AccountDeletionBlock"/>); nothing was saved.</summary>
    AccountDeleting,
}
