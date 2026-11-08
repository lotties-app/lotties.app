using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// <c>lotties.store_meta</c>: the one row an external store keeps about itself (docs/design/47-bring-your-own-database.md
/// sections 2.3 and 4), written by the store migrator only. <see cref="StoreId"/> is the <c>data_stores</c> id the schema was set
/// up for (a database already set up for another store is refused), <see cref="Epoch"/> a random value drawn when the store
/// first became ready, <see cref="SchemaVersion"/> the latest data migration applied and <see cref="State"/> the
/// <see cref="Domain.Stores.DataStoreState"/> name the migrator last recorded (mirrored in <c>data_stores.state</c>). Persistence
/// only: no rule lives here. Not an <c>IEntityTypeConfiguration</c>, so the control context never maps it.
/// </summary>
internal sealed class StoreMetaRow
{
    /// <summary>The only key value: the table holds one row.</summary>
    public const short SingleRowId = 1;

    public const int StateMaxLength = 32;

    public const int SchemaVersionMaxLength = 150;

    public short Id { get; set; } = SingleRowId;

    public Guid StoreId { get; set; }

    public Guid Epoch { get; set; }

    public string SchemaVersion { get; set; } = string.Empty;

    public string State { get; set; } = string.Empty;

    public DateTimeOffset UpdatedAt { get; set; }

    internal static void Configure(EntityTypeBuilder<StoreMetaRow> builder)
    {
        builder.ToTable(ExternalStoreSchema.MetaTable, table => table.HasCheckConstraint("ck_store_meta_single_row", "id = 1"));
        builder.HasKey(row => row.Id);
        builder.Property(row => row.Id).ValueGeneratedNever();
        builder.Property(row => row.SchemaVersion).HasMaxLength(SchemaVersionMaxLength).IsRequired();
        builder.Property(row => row.State).HasMaxLength(StateMaxLength).IsRequired();
    }
}
