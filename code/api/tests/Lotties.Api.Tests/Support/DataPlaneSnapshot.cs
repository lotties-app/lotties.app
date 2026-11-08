using System.Globalization;
using System.Reflection;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Every row one baby has in the 12 data tables of a store (<see cref="DataPlane.EntityTypes"/>), as text: each row is every mapped
/// column of the entity and of its owned parts (dose, schedule, dosage), as the database stores it, joined in name order; rows are
/// sorted, tables are keyed by name. Two snapshots are equal when the two stores hold the same records, value for value: what a store
/// move must leave behind (task T7).
/// </summary>
internal static class DataPlaneSnapshot
{
    private const string BabyIdProperty = "BabyId";

    public static async Task<SortedDictionary<string, List<string>>> TakeAsync(DbContext context, Guid babyId)
    {
        var tables = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var type in DataPlane.EntityTypes)
        {
            var rows = await RowsAsync(context, type);
            tables[context.Model.FindEntityType(type)!.GetTableName()!] = rows
                .Select(row => context.Entry(row))
                .Where(entry => Equals(entry.Property(BabyIdProperty).CurrentValue, babyId))
                .Select(Canonical)
                .Order(StringComparer.Ordinal)
                .ToList();
        }

        return tables;
    }

    /// <summary>The number of rows of every table.</summary>
    public static int Count(SortedDictionary<string, List<string>> snapshot) => snapshot.Values.Sum(rows => rows.Count);

    private static Task<List<object>> RowsAsync(DbContext context, Type type) =>
        (Task<List<object>>)typeof(DataPlaneSnapshot).GetMethod(nameof(RowsOfAsync), BindingFlags.NonPublic | BindingFlags.Static)!
            .MakeGenericMethod(type)
            .Invoke(null, [context])!;

    private static async Task<List<object>> RowsOfAsync<TEntity>(DbContext context)
        where TEntity : class =>
        [.. await context.Set<TEntity>().IgnoreQueryFilters().AsTracking().ToListAsync()];

    private static string Canonical(EntityEntry entry) => string.Join(" | ", Values(entry).Order(StringComparer.Ordinal));

    private static IEnumerable<string> Values(EntityEntry entry) =>
        entry.Properties.Select(property => $"{property.Metadata.Name}={Stored(property)}")
            .Concat(entry.References
                .Where(reference => reference.Metadata.TargetEntityType.IsOwned() && reference.TargetEntry is not null)
                .SelectMany(reference => Values(reference.TargetEntry!).Select(value => $"{reference.Metadata.Name}.{value}")));

    private static string Stored(PropertyEntry property)
    {
        var converter = property.Metadata.GetTypeMapping().Converter;
        var value = property.CurrentValue is { } current && converter is not null ? converter.ConvertToProvider(current) : property.CurrentValue;
        return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "null";
    }
}
