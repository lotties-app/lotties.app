using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace BabyRoutine.Api.Tests.Support;

/// <summary>
/// Test-only: stores every <see cref="DateTimeOffset"/> as UTC ticks in SQLite. The SQLite provider cannot compare or
/// order <see cref="DateTimeOffset"/> columns (PostgreSQL <c>timestamptz</c> can), and the events delta filters and
/// orders by <c>UpdatedAt</c>. The domain normalizes every timestamp to UTC, so ticks round-trip losslessly and order
/// the same way.
/// </summary>
internal sealed class SqliteDateTimeOffsetModelCustomizer(ModelCustomizerDependencies dependencies) : ModelCustomizer(dependencies)
{
    private static readonly ValueConverter<DateTimeOffset, long> UtcTicks =
        new(value => value.UtcTicks, ticks => new DateTimeOffset(ticks, TimeSpan.Zero));

    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);
        var timestamps = modelBuilder.Model.GetEntityTypes()
            .SelectMany(entityType => entityType.GetProperties())
            .Where(property => property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?));
        foreach (var property in timestamps)
        {
            property.SetValueConverter(UtcTicks);
        }
    }
}
