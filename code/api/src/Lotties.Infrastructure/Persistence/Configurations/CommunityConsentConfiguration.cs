using System.Text.Json;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Consents;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// <c>community_consents</c> (migration <c>CommunityConsents</c>; docs/design/34-community-insights.md section 3.2): the append-only
/// community insights consent history of each baby. Control plane (the Lotties database, never a family's own store). The action is
/// stored as its wire name, the purposes as a JSON array (jsonb on PostgreSQL, text on the SQLite test host). Both references are
/// <c>RESTRICT</c>: the account eraser deletes an erased baby's lines, and a deleted member's lines stay for the family under the
/// anonymized user row (<c>AccountErasureTests.Rules</c>), so the baby's state never changes because someone left.
/// </remarks>
internal sealed class CommunityConsentConfiguration : IEntityTypeConfiguration<CommunityConsentEntry>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly ValueConverter<IReadOnlyList<string>, string> ScopesConverter =
        new(scopes => JsonSerializer.Serialize(scopes, Json), json => JsonSerializer.Deserialize<List<string>>(json, Json) ?? new List<string>());

    private static readonly ValueComparer<IReadOnlyList<string>> ScopesComparer =
        new((left, right) => left!.SequenceEqual(right!), list => list.Aggregate(0, (hash, item) => HashCode.Combine(hash, item)), list => list.ToList());

    public void Configure(EntityTypeBuilder<CommunityConsentEntry> builder)
    {
        builder.ToTable("community_consents");
        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id).ValueGeneratedNever();
        builder.Property(entry => entry.BabyId).IsRequired();
        builder.Property(entry => entry.UserId).IsRequired();
        builder.Property(entry => entry.Action)
            .HasConversion(action => action == CommunityConsentAction.Granted ? "granted" : "withdrawn", name => name == "granted" ? CommunityConsentAction.Granted : CommunityConsentAction.Withdrawn)
            .HasMaxLength(16)
            .IsRequired();
        builder.Property(entry => entry.TextVersion).HasMaxLength(CommunityConsentTexts.MaxTextVersionLength).IsRequired();
        builder.Property(entry => entry.PolicyVersion).HasMaxLength(32).IsRequired();
        builder.Property(entry => entry.Scopes)
            .HasConversion(ScopesConverter, ScopesComparer)
            .HasColumnType("jsonb")
            .IsRequired();
        builder.Property(entry => entry.GuardianConfirmed).IsRequired();
        builder.Property(entry => entry.Locale).HasMaxLength(UserConsent.MaxLocaleLength).IsRequired();
        builder.Property(entry => entry.At).IsRequired();
        builder.HasIndex(entry => new { entry.BabyId, entry.At });
        builder.HasOne<Baby>().WithMany().HasForeignKey(entry => entry.BabyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(entry => entry.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
