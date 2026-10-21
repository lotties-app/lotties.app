using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Soft-deleted events are hidden by a global query filter. Delta sync must see deletions, so it reads
/// <see cref="LottiesDbContext.EventsIncludingDeleted"/> (which calls <c>IgnoreQueryFilters()</c>).
/// </remarks>
internal sealed class EventConfiguration : IEntityTypeConfiguration<Event>
{
    public void Configure(EntityTypeBuilder<Event> builder)
    {
        builder.ToTable("events");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Id).ValueGeneratedNever();
        builder.Property(item => item.StartedAt).IsRequired();
        builder.Property(item => item.Payload)
            .HasConversion(ValueObjectConverters.EventPayload)
            .HasColumnType("jsonb")
            .IsRequired();
        builder.Property(item => item.Notes).HasMaxLength(Event.NotesMaxLength);
        builder.Property(item => item.CreatedAt).IsRequired();
        builder.Property(item => item.UpdatedAt).IsRequired();
        builder.Property(item => item.ClientUpdatedAt).IsRequired();
        builder.HasIndex(item => new { item.BabyId, item.UpdatedAt });
        builder.HasIndex(item => new { item.BabyId, item.StartedAt });
        builder.HasOne<Baby>().WithMany().HasForeignKey(item => item.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EventType>().WithMany().HasForeignKey(item => item.TypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(item => item.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasQueryFilter(item => item.DeletedAt == null);
    }
}
