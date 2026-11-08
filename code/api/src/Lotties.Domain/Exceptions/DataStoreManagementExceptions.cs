namespace Lotties.Domain.Exceptions;

/// <summary>
/// The baby's records are in a store another account owns (a co-owner's): only the account that owns a store manages it (403;
/// docs/design/47-bring-your-own-database.md D1).
/// </summary>
public sealed class DataStoreNotOwnedException : DomainException
{
    public DataStoreNotOwnedException()
        : base("store_not_owned", "Only the account that set up this database can change it.")
    {
    }
}

/// <summary>There is no saved database to test or move to yet: save the connection details first (409).</summary>
public sealed class DataStoreNotConfiguredException : DomainException
{
    public DataStoreNotConfiguredException()
        : base("store_not_configured", "No database is set up yet. Save the connection details first.")
    {
    }
}

/// <summary>
/// The database still holds a baby's records (the baby points at it): it can only be removed after the records were moved back to
/// Lotties (409).
/// </summary>
public sealed class DataStoreInUseException : DomainException
{
    public DataStoreInUseException()
        : base("store_in_use", "This database still holds a baby's records. Move them back to Lotties first.")
    {
    }
}

/// <summary>
/// New connection details for a database that holds a baby's records open another database (an empty one, one set up for another
/// store, or one Lotties cannot recognize): refused before anything is created there, and the saved details stay as they were (409).
/// To really switch databases the records go back to Lotties hosting first (docs/BYO-DATABASE.md).
/// </summary>
public sealed class StoreNotSameDatabaseException : DomainException
{
    public StoreNotSameDatabaseException()
        : base("store_not_same_database", "These details open a different database from the one that holds this baby's records.")
    {
    }
}

/// <summary>
/// The person has not given the optional <c>byo_database</c> consent (docs/design/47-bring-your-own-database.md section 10), which
/// connecting a database of her own and moving records into it require (403).
/// </summary>
public sealed class ByoDatabaseConsentRequiredException : DomainException
{
    public ByoDatabaseConsentRequiredException()
        : base("byo_consent_required", "Using your own database needs your consent first.")
    {
    }
}
