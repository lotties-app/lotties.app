using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace BabyRoutine.Api.Tests.Support;

/// <summary>
/// Test-only adjustments of the production model for SQLite:
/// <list type="bullet">
/// <item>every <see cref="DateTimeOffset"/> is stored as UTC ticks. The SQLite provider cannot compare or order
/// <see cref="DateTimeOffset"/> columns (PostgreSQL <c>timestamptz</c> can), and the events delta filters and orders by
/// <c>UpdatedAt</c>. The domain normalizes every timestamp to UTC, so ticks round-trip losslessly and order the same way;</item>
/// <item>the PostgreSQL <c>xmin</c> row versions become a plain integer concurrency token written as 0 on insert and
/// never changed by the application. Updates still check it (<c>WHERE xmin = @original</c>), so a test emulates a
/// concurrent writer by bumping the column with <see cref="ConcurrentWrites.BumpRowVersion"/>.</item>
/// </list>
/// </summary>
internal sealed class SqliteModelCustomizer(ModelCustomizerDependencies dependencies) : ModelCustomizer(dependencies)
{
    private static readonly ValueConverter<DateTimeOffset, long> UtcTicks =
        new(value => value.UtcTicks, ticks => new DateTimeOffset(ticks, TimeSpan.Zero));

    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);
        var properties = modelBuilder.Model.GetEntityTypes().SelectMany(entityType => entityType.GetProperties()).ToArray();
        foreach (var property in properties.Where(IsTimestamp))
        {
            property.SetValueConverter(UtcTicks);
        }

        foreach (var property in properties.Where(IsRowVersion))
        {
            property.ValueGenerated = ValueGenerated.Never;
            property.SetColumnType("INTEGER");
            property.SetDefaultValue(0u);
        }
    }

    private static bool IsTimestamp(IMutableProperty property) =>
        property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?);

    private static bool IsRowVersion(IMutableProperty property) =>
        property.IsConcurrencyToken && property.ClrType == typeof(uint);
}
