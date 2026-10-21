using BabyRoutine.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

/// <remarks>
/// A named leader lease. Taking it is an optimistic update guarded by the <c>xmin</c> row version
/// (<see cref="RowVersions"/>): of two instances that read the same expired lease, the second save fails with a
/// concurrency conflict and that instance skips the tick.
/// </remarks>
internal sealed class JobLeaseConfiguration : IEntityTypeConfiguration<JobLease>
{
    public void Configure(EntityTypeBuilder<JobLease> builder)
    {
        builder.ToTable("job_leases");
        builder.HasXminRowVersion();
        builder.HasKey(lease => lease.Name);
        builder.Property(lease => lease.Name).HasMaxLength(JobLease.NameMaxLength).ValueGeneratedNever();
        builder.Property(lease => lease.HolderId).HasMaxLength(JobLease.HolderMaxLength).IsRequired();
        builder.Property(lease => lease.LeaseUntil).IsRequired();
    }
}
