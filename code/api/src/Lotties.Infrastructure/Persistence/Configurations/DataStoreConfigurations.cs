using Lotties.Domain.Babies;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// <c>data_stores</c> (control plane; docs/design/47-bring-your-own-database.md D1, D11): one row per external store, owned by an
/// account. The state is stored by name; the sealed descriptor is opaque bytes (task T3), nullable until the owner saves one.
/// Deleting the account deletes its rows (<c>EfAccountDataEraser</c>); the user key is <c>RESTRICT</c> like the other keys
/// erasure handles explicitly. <c>schema_version</c> mirrors the store's <c>lotties.store_meta</c> (task T5, the store migrator).
/// The owner's routes (task T6) write it: one store per account in the MVP (D11, kept by the service, not by an index, so
/// per-baby stores of one account stay possible later), the provider label (the one
/// readable field of the descriptor, display only) and the last connection test (time and coarse code).
/// </remarks>
internal sealed class DataStoreConfiguration : IEntityTypeConfiguration<DataStore>
{
    public const int StateMaxLength = 32;

    /// <summary>A data migration id (EF's own history column is at most 150).</summary>
    public const int SchemaVersionMaxLength = 150;

    /// <summary>A coarse test result code (<c>ok</c>, <c>store_*</c>, <c>endpoint_*</c>).</summary>
    public const int CheckResultMaxLength = 48;

    public void Configure(EntityTypeBuilder<DataStore> builder)
    {
        builder.ToTable("data_stores");
        builder.HasKey(store => store.Id);
        builder.Property(store => store.Id).ValueGeneratedNever();
        builder.Property(store => store.State).HasConversion<string>().HasMaxLength(StateMaxLength).IsRequired();
        builder.Property(store => store.SealedDescriptor);
        builder.Property(store => store.SchemaVersion).HasMaxLength(SchemaVersionMaxLength);
        builder.Property(store => store.ProviderLabel).HasMaxLength(StoreDescriptor.MaxProviderLabelLength);
        builder.Property(store => store.LastCheckedAt);
        builder.Property(store => store.LastCheckResult).HasMaxLength(CheckResultMaxLength);
        builder.Ignore(store => store.HasDescriptor);
        builder.Property(store => store.CreatedAt).IsRequired();
        builder.Property(store => store.UpdatedAt).IsRequired();
        builder.HasOne<User>().WithMany().HasForeignKey(store => store.OwnerUserId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <remarks>
/// The routing columns of the baby's own row (<c>babies.data_store_id</c>, null = the built-in store, and
/// <c>babies.store_epoch</c>, DEFAULT 0), mapped as a second entity on table <c>babies</c> (table splitting) so that the
/// queries of <see cref="Baby"/> read and write exactly the columns they did before. Every baby row has them: a new baby gets the
/// database defaults (built-in, epoch 0). The pointer is <c>RESTRICT</c>: a store a baby still points at cannot be deleted, so a
/// baby never silently falls back to the built-in store. EF maps the columns of an optional table-sharing entity as nullable and
/// reads the row only where <c>store_epoch IS NOT NULL</c>; the check constraint <see cref="EpochPresentConstraint"/> keeps
/// <c>store_epoch</c> from ever being null, so a pointer can never hide behind a null epoch.
/// </remarks>
internal sealed class BabyStoreAssignmentConfiguration : IEntityTypeConfiguration<BabyStoreAssignment>
{
    /// <summary>The key column of <c>babies</c>, named the same on both entity types whatever the naming convention.</summary>
    public const string KeyColumn = "id";

    public const string EpochPresentConstraint = "ck_babies_store_epoch_present";

    public void Configure(EntityTypeBuilder<BabyStoreAssignment> builder)
    {
        builder.ToTable("babies", table => table.HasCheckConstraint(EpochPresentConstraint, "store_epoch IS NOT NULL"));
        builder.HasXminRowVersion();
        builder.HasKey(assignment => assignment.BabyId);
        builder.Property(assignment => assignment.BabyId).HasColumnName(KeyColumn).ValueGeneratedNever();
        builder.Property(assignment => assignment.DataStoreId);
        builder.Property(assignment => assignment.Epoch).HasColumnName("store_epoch").IsRequired().HasDefaultValue(0);
        builder.Ignore(assignment => assignment.Store);
        builder.Ignore(assignment => assignment.Route);
        builder.HasOne<Baby>().WithOne().HasForeignKey<BabyStoreAssignment>(assignment => assignment.BabyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<DataStore>().WithMany().HasForeignKey(assignment => assignment.DataStoreId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <remarks>
/// <c>data_store_moves</c> (control plane; docs/design/47-bring-your-own-database.md section 6, task T7): one row per baby, its latest
/// move between the built-in store and the owner's store. The store ids are plain columns, not keys: a store may be removed after a
/// move out (its old copy then stays in the family's database). The baby key is <c>RESTRICT</c> like the other per-baby rows erasure
/// handles explicitly (<c>EfAccountDataEraser</c>). The <c>xmin</c> row version decides a race between two workers, or between a
/// worker and the owner starting a new move (<see cref="DataStoreMove"/>'s lease is taken by an optimistic update). Enum values are
/// stored by name.
/// </remarks>
internal sealed class DataStoreMoveConfiguration : IEntityTypeConfiguration<DataStoreMove>
{
    public const int DirectionMaxLength = 8;
    public const int StateMaxLength = 16;

    public void Configure(EntityTypeBuilder<DataStoreMove> builder)
    {
        builder.ToTable("data_store_moves");
        builder.HasXminRowVersion();
        builder.HasKey(move => move.BabyId);
        builder.Property(move => move.BabyId).ValueGeneratedNever();
        builder.Property(move => move.Direction).HasConversion<string>().HasMaxLength(DirectionMaxLength).IsRequired();
        builder.Property(move => move.State).HasConversion<string>().HasMaxLength(StateMaxLength).IsRequired();
        builder.Property(move => move.LeaseHolder).HasMaxLength(DataStoreMove.HolderMaxLength);
        builder.Property(move => move.FailureCode).HasMaxLength(DataStoreMove.FailureCodeMaxLength);
        builder.Property(move => move.StartedAt).IsRequired();
        builder.Property(move => move.UpdatedAt).IsRequired();
        builder.Ignore(move => move.Source);
        builder.Ignore(move => move.Target);
        builder.Ignore(move => move.IsInProgress);
        builder.HasOne<Baby>().WithOne().HasForeignKey<DataStoreMove>(move => move.BabyId).OnDelete(DeleteBehavior.Restrict);
    }
}
