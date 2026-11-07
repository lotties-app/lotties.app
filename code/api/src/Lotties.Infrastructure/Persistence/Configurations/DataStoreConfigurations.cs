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
/// erasure handles explicitly. Empty until the bring-your-own-database endpoints exist (task T6).
/// </remarks>
internal sealed class DataStoreConfiguration : IEntityTypeConfiguration<DataStore>
{
    public const int StateMaxLength = 32;

    public void Configure(EntityTypeBuilder<DataStore> builder)
    {
        builder.ToTable("data_stores");
        builder.HasKey(store => store.Id);
        builder.Property(store => store.Id).ValueGeneratedNever();
        builder.Property(store => store.State).HasConversion<string>().HasMaxLength(StateMaxLength).IsRequired();
        builder.Property(store => store.SealedDescriptor);
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
