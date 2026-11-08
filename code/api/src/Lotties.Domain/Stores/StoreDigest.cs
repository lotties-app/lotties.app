namespace Lotties.Domain.Stores;

/// <summary>
/// One data table of one baby as the move verification sees it (docs/design/47-bring-your-own-database.md section 6, task T7): the
/// number of rows and a SHA-256 (hex) over every row's key and change stamp (<c>updated_at</c> where the table has one, the deletion
/// time where it has one, else the creation time), in key order. Holds no record content and no id.
/// </summary>
public sealed record StoreTableDigest(string Table, int Count, string Checksum);

/// <summary>
/// A baby's records in one store, table by table in the copy order (task T7). A copy is verified when the source's digest, taken after
/// the copy, equals the target's: same tables, same counts, same checksums.
/// </summary>
public sealed record StoreDigest(IReadOnlyList<StoreTableDigest> Tables)
{
    /// <summary>All rows of all tables.</summary>
    public int RecordCount => Tables.Sum(table => table.Count);

    /// <summary>Whether <paramref name="other"/> holds the same rows (counts and checksums) in every table.</summary>
    public bool Matches(StoreDigest other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return Tables.Count == other.Tables.Count && Tables.Zip(other.Tables).All(pair => pair.First == pair.Second);
    }

    /// <summary>The tables whose count or checksum differ (names only, for the log).</summary>
    public IReadOnlyList<string> DifferingTables(StoreDigest other)
    {
        ArgumentNullException.ThrowIfNull(other);
        var theirs = other.Tables.ToDictionary(table => table.Table, StringComparer.Ordinal);
        return Tables.Where(table => !theirs.TryGetValue(table.Table, out var match) || match != table).Select(table => table.Table).ToArray();
    }
}
