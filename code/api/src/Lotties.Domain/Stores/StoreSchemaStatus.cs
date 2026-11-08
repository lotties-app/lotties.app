namespace Lotties.Domain.Stores;

/// <summary>Where a store's schema stands against the data migrations this API knows.</summary>
public enum StoreSchemaPosition
{
    /// <summary>Every known migration is applied and nothing else: the store can serve.</summary>
    UpToDate,

    /// <summary>Some known migrations are not applied yet: the migrator applies them.</summary>
    Behind,

    /// <summary>The store holds a migration this API does not know (a newer release migrated it): refused, never served.</summary>
    Ahead,
}

/// <summary>
/// Compares the data migrations applied in a store with the ones this API ships (docs/design/47-bring-your-own-database.md
/// section 4, "Version compatibility"). Pure: migration ids only, no I/O. An applied id this API does not know makes the store
/// <see cref="StoreSchemaPosition.Ahead"/> whatever else is missing, because code must never serve a schema it does not know.
/// </summary>
public sealed record StoreSchemaStatus
{
    private StoreSchemaStatus(StoreSchemaPosition position, IReadOnlyList<string> pending, IReadOnlyList<string> unknown, string? latestApplied)
    {
        Position = position;
        Pending = pending;
        Unknown = unknown;
        LatestApplied = latestApplied;
    }

    public StoreSchemaPosition Position { get; }

    /// <summary>Known migrations not applied yet, in order.</summary>
    public IReadOnlyList<string> Pending { get; }

    /// <summary>Applied migrations this API does not know, in order.</summary>
    public IReadOnlyList<string> Unknown { get; }

    /// <summary>The latest applied migration id (ordinal order, as EF orders them), or <c>null</c> for an empty store.</summary>
    public string? LatestApplied { get; }

    /// <summary>Compares <paramref name="applied"/> (from the store's history table) with <paramref name="known"/> (this API's chain).</summary>
    public static StoreSchemaStatus Compare(IEnumerable<string> applied, IEnumerable<string> known)
    {
        ArgumentNullException.ThrowIfNull(applied);
        ArgumentNullException.ThrowIfNull(known);
        var appliedSet = applied.ToHashSet(StringComparer.Ordinal);
        var knownSet = known.ToHashSet(StringComparer.Ordinal);
        var pending = knownSet.Except(appliedSet).Order(StringComparer.Ordinal).ToArray();
        var unknown = appliedSet.Except(knownSet).Order(StringComparer.Ordinal).ToArray();
        var latest = appliedSet.Order(StringComparer.Ordinal).LastOrDefault();
        return new StoreSchemaStatus(PositionOf(pending, unknown), pending, unknown, latest);
    }

    private static StoreSchemaPosition PositionOf(string[] pending, string[] unknown) =>
        (unknown.Length, pending.Length) switch
        {
            ( > 0, _) => StoreSchemaPosition.Ahead,
            (_, > 0) => StoreSchemaPosition.Behind,
            _ => StoreSchemaPosition.UpToDate,
        };
}
