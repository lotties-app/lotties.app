using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Imports;

/// <summary>
/// Picks the <see cref="INapperCategoryMapper"/> for a Napper category. Supporting a new category is one mapper class
/// plus one entry here; rows of a category no mapper handles are skipped with <see cref="ImportSkipCodes.UnknownCategory"/>.
/// </summary>
public static class NapperEventMapper
{
    private static readonly INapperCategoryMapper[] Mappers =
    [
        new BottleMapper(),
        new NursingMapper(),
        new DiaperMapper(),
        new SleepMapper(),
        new MedicineMapper(),
    ];

    public static NapperRowOutcome Map(NapperLogRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        var mapper = Find(row.Category);
        return mapper is null
            ? NapperRowOutcome.Skipped(row, ImportSkipCodes.UnknownCategory, $"Napper category '{row.Category}' is not supported.")
            : mapper.Map(row);
    }

    /// <summary>The built-in event type rows of <paramref name="category"/> map to, or <c>null</c> when it is not supported.</summary>
    public static EventType? TypeFor(string category) => Find(category)?.Type;

    private static INapperCategoryMapper? Find(string category) => Array.Find(Mappers, mapper => mapper.CanHandle(category));
}
