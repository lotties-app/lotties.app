using Lotties.Domain.Board;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// The project board (docs/design/36-project-board.md section 2): internal project tracking, no reference to babies.
/// Topics are keyed by their slug and the ten default ones are seeded here (<c>HasData</c>, migration
/// <c>ProjectBoard</c>); topics are never deleted.
/// </remarks>
internal sealed class BoardTopicConfiguration : IEntityTypeConfiguration<BoardTopic>
{
    /// <summary>The creation time of the seeded topics (a constant, so the seed never changes the model).</summary>
    public static readonly DateTimeOffset SeedTime = new(2026, 10, 24, 0, 0, 0, TimeSpan.Zero);

    public void Configure(EntityTypeBuilder<BoardTopic> builder)
    {
        builder.ToTable("board_topics");
        builder.HasKey(topic => topic.Key);
        builder.Property(topic => topic.Key).HasMaxLength(BoardTopicKeys.MaxLength).ValueGeneratedNever();
        builder.Property(topic => topic.Name).HasMaxLength(BoardTopic.NameMaxLength).IsRequired();
        builder.Property(topic => topic.Description).HasMaxLength(BoardTopic.DescriptionMaxLength);
        builder.Property(topic => topic.SortOrder).IsRequired();
        builder.Property(topic => topic.Archived).IsRequired();
        builder.Property(topic => topic.CreatedAt).IsRequired();
        builder.Property(topic => topic.UpdatedAt).IsRequired();
        builder.HasData(BoardTopic.Seeded.Select((topic, index) => new
        {
            topic.Key,
            topic.Name,
            topic.Description,
            SortOrder = (index + 1) * 10,
            Archived = false,
            CreatedAt = SeedTime,
            UpdatedAt = SeedTime,
        }));
    }
}

/// <remarks>
/// Items are never removed (<c>deleted_at</c> is the soft delete), so there is no query filter. <c>version</c> is an
/// application-managed concurrency token (the item's ETag; <c>xmin</c> would not change in the SQLite test host).
/// Labels are stored as <c>,a,b,</c> (<see cref="BoardLabels"/>) so a label filter is a portable substring test.
/// <c>external_key</c> is unique where present (bulk import idempotency).
/// </remarks>
internal sealed class BoardItemConfiguration : IEntityTypeConfiguration<BoardItem>
{
    public const string HasExternalKeyFilter = "external_key IS NOT NULL";

    public void Configure(EntityTypeBuilder<BoardItem> builder)
    {
        builder.ToTable("board_items");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Id).ValueGeneratedNever();
        builder.Property(item => item.Type).HasConversion(BoardConverters.Code<BoardItemType>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(item => item.TopicKey).HasMaxLength(BoardTopicKeys.MaxLength).IsRequired();
        builder.Property(item => item.Title).HasMaxLength(BoardItemContent.TitleMaxLength).IsRequired();
        builder.Property(item => item.Body).HasMaxLength(BoardItemContent.BodyMaxLength);
        builder.Property(item => item.Status).HasConversion(BoardConverters.Code<BoardItemStatus>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(item => item.Side).HasConversion(BoardConverters.Code<BoardSide>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(item => item.Priority).HasConversion(BoardConverters.Code<BoardPriority>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(item => item.LabelCodes).HasColumnName("labels").HasMaxLength(BoardLabels.StorageMaxLength).IsRequired();
        builder.Property(item => item.DueDate);
        builder.Property(item => item.Links)
            .HasConversion(BoardConverters.Links, BoardConverters.LinksComparer)
            .HasColumnType("jsonb")
            .IsRequired();
        builder.Property(item => item.Pinned).IsRequired();
        builder.Property(item => item.DecidedAt);
        builder.Property(item => item.DecisionSummary).HasMaxLength(BoardItemContent.DecisionSummaryMaxLength);
        builder.Property(item => item.Rationale).HasMaxLength(BoardItemContent.RationaleMaxLength);
        builder.Property(item => item.Source).HasMaxLength(BoardItemContent.SourceMaxLength);
        builder.Property(item => item.ExternalKey).HasMaxLength(BoardItem.ExternalKeyMaxLength);
        builder.Property(item => item.ImportedVersion);
        builder.Property(item => item.CreatedByName).HasMaxLength(User.DisplayNameMaxLength).IsRequired();
        builder.Property(item => item.CreatedAt).IsRequired();
        builder.Property(item => item.UpdatedAt).IsRequired();
        builder.Property(item => item.ClosedAt);
        builder.Property(item => item.DeletedAt);
        builder.Property(item => item.Version).IsConcurrencyToken().IsRequired();
        builder.Ignore(item => item.Labels);
        builder.Ignore(item => item.Content);
        builder.Ignore(item => item.IsDeleted);
        builder.Ignore(item => item.IsOpen);
        builder.Ignore(item => item.IsUntouchedSinceImport);
        builder.HasIndex(item => new { item.TopicKey, item.UpdatedAt });
        builder.HasIndex(item => item.UpdatedAt);
        builder.HasIndex(item => item.ExternalKey).IsUnique().HasFilter(HasExternalKeyFilter);
        builder.HasOne<BoardTopic>().WithMany().HasForeignKey(item => item.TopicKey).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(item => item.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<BoardApiKey>().WithMany().HasForeignKey(item => item.CreatedByKeyId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <remarks>The immutable history of the items: one row per write, read per item in time order.</remarks>
internal sealed class BoardItemEventConfiguration : IEntityTypeConfiguration<BoardItemEvent>
{
    public void Configure(EntityTypeBuilder<BoardItemEvent> builder)
    {
        builder.ToTable("board_item_events");
        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id).ValueGeneratedNever();
        builder.Property(entry => entry.At).IsRequired();
        builder.Property(entry => entry.Kind).HasConversion(BoardConverters.Code<BoardEventKind>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(entry => entry.ActorKind).HasConversion(BoardConverters.Code<BoardActorKind>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(entry => entry.ActorName).HasMaxLength(User.DisplayNameMaxLength).IsRequired();
        builder.Property(entry => entry.Changes)
            .HasConversion(BoardConverters.Changes, BoardConverters.ChangesComparer)
            .HasColumnType("jsonb")
            .IsRequired();
        builder.Property(entry => entry.Comment).HasMaxLength(BoardItemEvent.CommentMaxLength);
        builder.HasIndex(entry => new { entry.ItemId, entry.At });
        builder.HasOne<BoardItem>().WithMany().HasForeignKey(entry => entry.ItemId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(entry => entry.ActorUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<BoardApiKey>().WithMany().HasForeignKey(entry => entry.ActorKeyId).OnDelete(DeleteBehavior.Restrict);
    }
}

/// <remarks>
/// API keys: only the SHA-256 of the secret (<c>key_hash</c>, unique) and its first 12 characters (<c>prefix</c>, the
/// lookup index) are stored. Never deleted (revocation is the soft delete).
/// </remarks>
internal sealed class BoardApiKeyConfiguration : IEntityTypeConfiguration<BoardApiKey>
{
    public void Configure(EntityTypeBuilder<BoardApiKey> builder)
    {
        builder.ToTable("board_api_keys");
        builder.HasKey(key => key.Id);
        builder.Property(key => key.Id).ValueGeneratedNever();
        builder.Property(key => key.Name).HasMaxLength(BoardApiKey.NameMaxLength).IsRequired();
        builder.Property(key => key.Prefix).HasMaxLength(BoardKeySecret.PrefixLength).IsRequired();
        builder.Property(key => key.KeyHash).HasMaxLength(BoardKeySecret.HashLength).IsRequired();
        builder.Property(key => key.Scope).HasConversion(BoardConverters.Code<BoardKeyScope>()).HasMaxLength(BoardCodes.MaxLength).IsRequired();
        builder.Property(key => key.AllowedTopicCodes).HasColumnName("allowed_topics").HasMaxLength(BoardTopicKeys.SetStorageMaxLength);
        builder.Property(key => key.CreatedByName).HasMaxLength(User.DisplayNameMaxLength).IsRequired();
        builder.Property(key => key.CreatedAt).IsRequired();
        builder.Property(key => key.UseCount).IsRequired();
        builder.Ignore(key => key.AllowedTopics);
        builder.Ignore(key => key.IsRevoked);
        builder.HasIndex(key => key.Prefix);
        builder.HasIndex(key => key.KeyHash).IsUnique();
        builder.HasOne<User>().WithMany().HasForeignKey(key => key.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
