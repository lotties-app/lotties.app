namespace Lotties.Domain.Stores;

/// <summary>
/// Why a baby's data store could not serve a request (docs/design/47-bring-your-own-database.md section 5, task T8). Coarse on
/// purpose: a class tells the app what to show and the owner what to fix, never the driver's text, a host, a user or an address.
/// Every class is a retriable <c>503</c> for API clients (the outbox keeps the change); the wire code is <see cref="StoreFailureCodes.Of"/>.
/// </summary>
public enum StoreFailureClass
{
    /// <summary>The store cannot be used right now (connection lost, server shutting down or starting, flag off, no descriptor).</summary>
    Unavailable,

    /// <summary>The store did not answer in time (connect timeout, command timeout, statement or lock timeout).</summary>
    Timeout,

    /// <summary>The store refused the credentials or the role lost its rights (the owner must reconnect).</summary>
    CredentialsRejected,

    /// <summary>Nothing answers at the address (refused, unreachable, unknown host): often a free database paused for inactivity.</summary>
    PausedOrUnreachable,

    /// <summary>The store is full or read-only (disk full, provider storage cap): writes fail, reads may still work.</summary>
    QuotaFull,

    /// <summary>The store refused a new connection because it has too many (its own or the role's connection limit).</summary>
    RateLimited,

    /// <summary>The store's certificate could not be verified for its host name.</summary>
    TlsFailed,

    /// <summary>The store holds a newer data schema than this API knows.</summary>
    SchemaAhead,

    /// <summary>The store holds something Lotties did not create or expect (another store's schema, a missing table).</summary>
    SchemaConflict,

    /// <summary>The store's app role can do more than read and write the data tables.</summary>
    RoleTooPowerful,

    /// <summary>The store is being migrated by another request or instance.</summary>
    Migrating,

    /// <summary>Applying the data schema to the store failed and rolled back.</summary>
    MigrationFailed,
}

/// <summary>The stable wire codes of <see cref="StoreFailureClass"/> and which classes count as connection failures.</summary>
public static class StoreFailureCodes
{
    /// <summary>The <c>code</c> of the problem response (and of the domain exception) for <paramref name="failure"/>.</summary>
    public static string Of(StoreFailureClass failure) => failure switch
    {
        StoreFailureClass.Unavailable => "store_unavailable",
        StoreFailureClass.Timeout => "store_timeout",
        StoreFailureClass.CredentialsRejected => "store_credentials_rejected",
        StoreFailureClass.PausedOrUnreachable => "store_paused_or_unreachable",
        StoreFailureClass.QuotaFull => "store_quota_full",
        StoreFailureClass.RateLimited => "store_rate_limited",
        StoreFailureClass.TlsFailed => "store_tls_failed",
        StoreFailureClass.SchemaAhead => "store_schema_ahead",
        StoreFailureClass.SchemaConflict => "store_schema_conflict",
        StoreFailureClass.RoleTooPowerful => "store_role_too_powerful",
        StoreFailureClass.Migrating => "store_migrating",
        StoreFailureClass.MigrationFailed => "store_migration_failed",
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, null),
    };

    /// <summary>
    /// Whether a failure of this class counts towards opening the store's circuit breaker: the classes that say the store cannot be
    /// reached or used at all. A full store still serves reads, a schema or role problem is the migrator's (it has its own backoff),
    /// and a store being migrated is busy, not failing.
    /// </summary>
    public static bool CountsAsConnectionFailure(StoreFailureClass failure) => failure is
        StoreFailureClass.Unavailable
        or StoreFailureClass.Timeout
        or StoreFailureClass.CredentialsRejected
        or StoreFailureClass.PausedOrUnreachable
        or StoreFailureClass.RateLimited
        or StoreFailureClass.TlsFailed;
}
