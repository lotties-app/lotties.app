namespace Lotties.Domain.Stores;

/// <summary>
/// Where a baby's records are kept (docs/design/47-bring-your-own-database.md section 2.1): the Lotties database
/// (<see cref="BuiltIn"/>, every baby today) or a database the family brings (<see cref="External"/>).
/// </summary>
public enum DataStoreKind
{
    BuiltIn,
    External,
}
