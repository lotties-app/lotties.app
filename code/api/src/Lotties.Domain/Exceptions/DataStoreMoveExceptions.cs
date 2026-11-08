using Lotties.Domain.Stores;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// The baby's records are being moved to another database right now (docs/design/47-bring-your-own-database.md section 6, task T7):
/// writes are refused until the move ends, reads keep working. A retriable <c>503 store_moving</c> with <c>Retry-After</c>, so a client
/// keeps the change in its outbox and sends it again (to the new database once the move is done); the API's default wait for this class
/// is <c>StoreFailureResponses.MovingRetry</c>.
/// </summary>
public sealed class StoreMovingException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.Moving, "This baby's records are being moved to another database. Changes are saved again in a moment.", retryAfter)
{
}

/// <summary>A move of this baby's records is already running (409): wait for it to end.</summary>
public sealed class DataStoreMoveInProgressException : DomainException
{
    public DataStoreMoveInProgressException()
        : base("store_move_in_progress", "This baby's records are already being moved. Wait until the move ends.")
    {
    }
}

/// <summary>Nothing to move (409): the baby's records are already in the database the move would copy them to.</summary>
public sealed class DataStoreMoveNotNeededException : DomainException
{
    public DataStoreMoveNotNeededException()
        : base("store_move_not_needed", "This baby's records are already in that database.")
    {
    }
}

/// <summary>The copy did not match its source after a second try; the baby stays where it was.</summary>
public sealed class DataStoreMoveVerificationFailedException : DomainException
{
    public DataStoreMoveVerificationFailedException()
        : base("store_move_verify_failed", "The copy did not match the original records.")
    {
    }
}

/// <summary>
/// The target refused a record of the copy: its id is taken by another baby's record there, or it points at something the target
/// does not have (an account, a catalog product). The baby stays where it was. Never carries the record or its id.
/// </summary>
public sealed class DataStoreMoveConflictException : DomainException
{
    public DataStoreMoveConflictException()
        : base("store_move_conflict", "The target database refused part of the copy.")
    {
    }
}

/// <summary>Another worker took the move over (its lease ran out here): this worker stops without changing anything else.</summary>
public sealed class DataStoreMoveLeaseLostException : DomainException
{
    public DataStoreMoveLeaseLostException()
        : base("store_move_lease_lost", "Another worker took over this move.")
    {
    }
}

/// <summary>A programming error: a move was asked for a step its state does not allow (500).</summary>
public sealed class DataStoreMoveStateException(DataStoreMoveState current, DataStoreMoveState requested)
    : DomainException("store_move_state", $"A move in state {current} cannot go to {requested}.")
{
}

/// <summary>Failure codes a move records that are not exceptions of their own.</summary>
public static class DataStoreMoveFailureCodes
{
    /// <summary>The move's workers stopped too many times (restarts, crashes) before it finished.</summary>
    public const string Abandoned = "store_move_abandoned";

    /// <summary>An unexpected error; the log line names its type only.</summary>
    public const string Failed = "store_move_failed";

    /// <summary>The owner's store row is gone (removed) while the move waited.</summary>
    public const string StoreRemoved = "store_not_configured";
}
