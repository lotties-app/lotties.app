using BabyRoutine.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BabyRoutine.Infrastructure.Persistence.Configurations;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.HasKey(user => user.Id);
        builder.Property(user => user.Id).ValueGeneratedNever();
        builder.Property(user => user.Subject).HasMaxLength(User.SubjectMaxLength).IsRequired();
        builder.Property(user => user.DisplayName).HasMaxLength(User.DisplayNameMaxLength).IsRequired();
        builder.Property(user => user.CreatedAt).IsRequired();
        builder.HasIndex(user => user.Subject).IsUnique();
    }
}
