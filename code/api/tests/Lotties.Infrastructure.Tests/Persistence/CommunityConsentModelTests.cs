using Lotties.Domain.CommunityInsights;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model checks of <c>community_consents</c> (migration <c>CommunityConsents</c>; docs/design/34-community-insights.md section 3.2).</summary>
public sealed class CommunityConsentModelTests
{
    [Fact]
    public void CommunityConsents_AppendOnlyLinesKeyedById_WithRestrictedBabyAndUserReferences()
    {
        using var context = ModelTestContext.Create();
        var entries = context.Entity<CommunityConsentEntry>();

        var references = entries.GetForeignKeys().ToDictionary(key => key.PrincipalEntityType.GetTableName()!, key => key.DeleteBehavior);
        var action = entries.FindProperty(nameof(CommunityConsentEntry.Action))!;
        var scopes = entries.FindProperty(nameof(CommunityConsentEntry.Scopes))!;

        Assert.Equal("community_consents", entries.GetTableName());
        Assert.Equal(["id"], entries.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Restrict, references["babies"]);
        Assert.Equal(DeleteBehavior.Restrict, references["users"]);
        Assert.Equal("withdrawn", action.GetValueConverter()!.ConvertToProvider(CommunityConsentAction.Withdrawn));
        Assert.Equal(CommunityConsentAction.Granted, action.GetValueConverter()!.ConvertFromProvider("granted"));
        Assert.Equal("jsonb", scopes.GetColumnType());
        Assert.Equal("[\"all\"]", scopes.GetValueConverter()!.ConvertToProvider(new List<string> { "all" }));
        Assert.Contains(entries.GetIndexes(), index => index.Properties.Select(property => property.GetColumnName()).SequenceEqual(["baby_id", "at"]));
    }

    [Fact]
    public void CommunityConsents_IsControlPlane_NotADataTable()
    {
        Assert.DoesNotContain(typeof(CommunityConsentEntry), DataPlane.EntityTypes);
        using var data = ModelTestContext.CreateData();
        Assert.Null(data.Model.FindEntityType(typeof(CommunityConsentEntry)));
    }
}
