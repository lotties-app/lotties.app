namespace Lotties.Domain.Exceptions;

/// <summary>
/// A data-plane read or write ran without a store bound for the baby (docs/design/47-bring-your-own-database.md section 3.6):
/// no scope was set for the request or job, or the scope was set for another baby. Data access fails closed: it never falls
/// back to the built-in store. A programming error (500): the entry point must bind the baby after authorizing it.
/// </summary>
public sealed class StoreScopeMissingException : DomainException
{
    public StoreScopeMissingException(Guid? babyId)
        : base("store_scope_missing", babyId is { } id
            ? $"No data store is bound to this request for baby {id}."
            : "No data store is bound to this request.")
    {
        BabyId = babyId;
    }

    /// <summary>The baby the data access was for, when the call named one.</summary>
    public Guid? BabyId { get; }
}

/// <summary>
/// A data-plane call that names no baby (by record id, or a plain save) ran while the scope holds babies of more than one store,
/// so the store it meant cannot be told (500, a programming error; the call must name the baby).
/// </summary>
public sealed class StoreScopeAmbiguousException : DomainException
{
    public StoreScopeAmbiguousException()
        : base("store_scope_ambiguous", "This request holds babies of more than one data store; the data access must name the baby.")
    {
    }
}

/// <summary>
/// The baby's records are in a data store this server cannot use right now (503, retriable: the client keeps the change queued):
/// the connection was lost, the server is shutting down or starting, the store's circuit breaker is open, the feature flag is off
/// or the store has no descriptor (docs/design/47-bring-your-own-database.md, tasks T5 and T8). The request never falls back to
/// the built-in store.
/// </summary>
public sealed class StoreUnavailableException(TimeSpan? retryAfter = null)
    : StoreFailureException(Stores.StoreFailureClass.Unavailable, "The database that holds this baby's records is not reachable right now. Try again later.", retryAfter)
{
}
