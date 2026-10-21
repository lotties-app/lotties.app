using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

internal sealed class EventTypeConfiguration : IEntityTypeConfiguration<EventType>
{
    public void Configure(EntityTypeBuilder<EventType> builder)
    {
        builder.ToTable("event_types");
        builder.HasKey(eventType => eventType.Id);
        builder.Property(eventType => eventType.Id).ValueGeneratedNever();
        builder.Property(eventType => eventType.Key)
            .HasConversion(ValueObjectConverters.EventTypeKey)
            .HasMaxLength(EventTypeKey.MaxLength)
            .IsRequired();
        builder.Property(eventType => eventType.Name).HasMaxLength(EventType.NameMaxLength).IsRequired();
        builder.Property(eventType => eventType.Icon).HasMaxLength(EventType.IconMaxLength).IsRequired();
        builder.Property(eventType => eventType.Color)
            .HasConversion(ValueObjectConverters.HexColor)
            .HasMaxLength(HexColor.Length)
            .IsRequired();
        builder.Property(eventType => eventType.Fields)
            .HasConversion(new EventFieldDefinitionsConverter(), EventFieldDefinitionsConverter.Comparer)
            .HasColumnType("jsonb")
            .IsRequired();
        builder.HasIndex(eventType => new { eventType.BabyId, eventType.Key }).IsUnique().AreNullsDistinct(false);
        builder.HasOne<Baby>().WithMany().HasForeignKey(eventType => eventType.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasData(BuiltInEventTypes.All);
    }
}
