using Lotties.Domain.Stores;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// A baby's data store could not serve the request (docs/design/47-bring-your-own-database.md section 5, task T8): always a
/// retriable <c>503</c> for API clients, with <c>Retry-After</c>; the client keeps the change in its outbox. <see cref="Failure"/> is
/// the coarse class, <see cref="DomainException.Code"/> its wire code (<see cref="StoreFailureCodes.Of"/>). The message is a fixed
/// sentence and there is never an inner exception: the driver's text can carry a host, a user or an address.
/// </summary>
public abstract class StoreFailureException : DomainException
{
    protected StoreFailureException(StoreFailureClass failure, string message, TimeSpan? retryAfter)
        : base(StoreFailureCodes.Of(failure), message)
    {
        Failure = failure;
        RetryAfter = retryAfter;
    }

    /// <summary>Why the store could not serve.</summary>
    public StoreFailureClass Failure { get; }

    /// <summary>How long until the server tries the store again (an open circuit breaker or a migrator backoff), when known.</summary>
    public TimeSpan? RetryAfter { get; }

    /// <summary>A new exception of <paramref name="failure"/>'s type (one exception object is never thrown by two requests).</summary>
    public static StoreFailureException Of(StoreFailureClass failure, TimeSpan? retryAfter = null) => failure switch
    {
        StoreFailureClass.Unavailable => new StoreUnavailableException(retryAfter),
        StoreFailureClass.Timeout => new StoreTimeoutException(retryAfter),
        StoreFailureClass.CredentialsRejected => new StoreCredentialsRejectedException(retryAfter),
        StoreFailureClass.PausedOrUnreachable => new StorePausedOrUnreachableException(retryAfter),
        StoreFailureClass.QuotaFull => new StoreQuotaFullException(retryAfter),
        StoreFailureClass.RateLimited => new StoreRateLimitedException(retryAfter),
        StoreFailureClass.TlsFailed => new StoreTlsFailedException(retryAfter),
        StoreFailureClass.SchemaAhead => new StoreSchemaAheadException(retryAfter),
        StoreFailureClass.SchemaConflict => new StoreSchemaConflictException(retryAfter),
        StoreFailureClass.RoleTooPowerful => new StoreRoleTooPowerfulException([], retryAfter),
        StoreFailureClass.Migrating => new StoreMigratingException(retryAfter),
        StoreFailureClass.MigrationFailed => new StoreMigrationFailedException(retryAfter),
        StoreFailureClass.Moving => new StoreMovingException(retryAfter),
        StoreFailureClass.AccountDeleting => new StoreAccountDeletingException(retryAfter),
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, null),
    };

    /// <summary>
    /// The store failure <paramref name="exception"/> is or wraps (EF wraps a failed save in <c>DbUpdateException</c>), else <c>null</c>.
    /// </summary>
    public static StoreFailureException? FindIn(Exception? exception) => exception switch
    {
        null => null,
        StoreFailureException failure => failure,
        _ => FindIn(exception.InnerException),
    };
}

/// <summary>The baby's store did not answer in time (503, retriable).</summary>
public sealed class StoreTimeoutException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.Timeout, "The database that holds this baby's records took too long to answer. Try again later.", retryAfter);

/// <summary>The baby's store refused Lotties' credentials (503 until the owner reconnects it).</summary>
public sealed class StoreCredentialsRejectedException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.CredentialsRejected, "The database that holds this baby's records refused the connection details. The owner must reconnect it.", retryAfter);

/// <summary>Nothing answers at the baby's store address; a free database may be paused (503, retriable).</summary>
public sealed class StorePausedOrUnreachableException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.PausedOrUnreachable, "The database that holds this baby's records is not answering. It may be paused; the owner can resume it at the provider.", retryAfter);

/// <summary>The baby's store is full or read-only (503; reads may still work).</summary>
public sealed class StoreQuotaFullException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.QuotaFull, "The database that holds this baby's records is full and cannot save changes.", retryAfter);

/// <summary>The baby's store has too many connections (503, retriable).</summary>
public sealed class StoreRateLimitedException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.RateLimited, "The database that holds this baby's records has too many connections right now. Try again in a moment.", retryAfter);

/// <summary>The baby's store certificate could not be verified for its host name (503 until it is fixed).</summary>
public sealed class StoreTlsFailedException(TimeSpan? retryAfter = null)
    : StoreFailureException(StoreFailureClass.TlsFailed, "The secure connection to the database that holds this baby's records could not be verified.", retryAfter);
