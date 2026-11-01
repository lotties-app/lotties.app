using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

/// <summary>
/// Optimistic concurrency on PostgreSQL's system column <c>xmin</c> (the id of the transaction that last wrote the row,
/// type <c>xid</c>), mapped as a shadow <see cref="uint"/> row version. No real column is added: Npgsql skips system
/// columns in migrations. Every update of the row checks the value read, so a concurrent writer makes
/// <c>SaveChanges</c> fail with <see cref="DbUpdateConcurrencyException"/>.
/// </summary>
internal static class RowVersions
{
    /// <summary>Name of the shadow property.</summary>
    public const string PropertyName = "Version";

    public const string ColumnName = "xmin";

    public const string ColumnType = "xid";

    public static void HasXminRowVersion<TEntity>(this EntityTypeBuilder<TEntity> builder)
        where TEntity : class
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Property<uint>(PropertyName)
            .HasColumnName(ColumnName)
            .HasColumnType(ColumnType)
            .IsRowVersion();
    }
}
