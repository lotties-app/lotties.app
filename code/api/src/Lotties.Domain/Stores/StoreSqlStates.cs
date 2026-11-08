namespace Lotties.Domain.Stores;

/// <summary>
/// The Postgres SQLSTATE codes a family's store can answer with, mapped to a <see cref="StoreFailureClass"/>
/// (docs/design/47-bring-your-own-database.md section 5, task T8). Pure: the caller reads the code from the driver's error and
/// never passes its message on. A code that is not a store failure (a unique violation, a bad value) has no class: the caller
/// leaves that error to the code that handles it today.
/// </summary>
public static class StoreSqlStates
{
    /// <summary>The class of <paramref name="sqlState"/>, or <c>null</c> when it is not a failure of the store itself.</summary>
    public static StoreFailureClass? Classify(string? sqlState) => sqlState switch
    {
        null or "" => null,
        "28P01" or "28000" or "42501" => StoreFailureClass.CredentialsRejected,
        "53300" => StoreFailureClass.RateLimited,
        "3D000" => StoreFailureClass.Unavailable,
        "53100" or "25006" => StoreFailureClass.QuotaFull,
        "57014" or "25P03" or "55P03" => StoreFailureClass.Timeout,
        "42P01" or "42703" or "3F000" => StoreFailureClass.SchemaConflict,
        _ => ByClass(sqlState),
    };

    /// <summary>
    /// The two-character SQLSTATE class: connection exceptions (<c>08</c>), insufficient resources (<c>53</c>, other than the codes
    /// above), operator intervention (<c>57</c>: shutdown, cannot connect now), system errors (<c>58</c>) and internal errors
    /// (<c>XX</c>) mean the store cannot serve now.
    /// </summary>
    private static StoreFailureClass? ByClass(string sqlState) => sqlState.Length < 2 ? null : sqlState[..2] switch
    {
        "08" or "53" or "57" or "58" or "XX" => StoreFailureClass.Unavailable,
        _ => null,
    };
}
