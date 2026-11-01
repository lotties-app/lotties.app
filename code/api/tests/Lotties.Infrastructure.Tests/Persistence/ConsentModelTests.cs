using Lotties.Domain.Consents;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model checks of <c>user_consents</c> and <c>user_consent_history</c> (migration <c>Consent</c>).</summary>
public sealed class ConsentModelTests
{
    [Fact]
    public void UserConsents_OneRowPerUserAndKind_StoredAsWireNames()
    {
        using var context = ModelTestContext.Create();
        var consents = context.Entity<UserConsent>();

        var kind = consents.FindProperty(nameof(UserConsent.Kind))!;
        var capacity = consents.FindProperty(nameof(UserConsent.Capacity))!;

        Assert.Equal("user_consents", consents.GetTableName());
        Assert.Equal(["user_id", "kind"], consents.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Cascade, consents.GetForeignKeys().Single().DeleteBehavior);
        Assert.Equal("alexa", kind.GetValueConverter()!.ConvertToProvider(ConsentKind.Alexa));
        Assert.Equal(ConsentKind.Mcp, kind.GetValueConverter()!.ConvertFromProvider("mcp"));
        Assert.Equal("guardian", capacity.GetValueConverter()!.ConvertToProvider(ConsentCapacity.Guardian));
        Assert.True(capacity.IsNullable);
        Assert.Null(consents.FindProperty(nameof(UserConsent.IsGranted)));
        Assert.Equal(new[] { "accepted_at", "capacity", "kind", "locale", "user_id", "version", "withdrawn_at" }, consents.GetProperties().Select(property => property.GetColumnName()).Order());
    }

    [Fact]
    public void UserConsentHistory_IsAppendOnlyPerUser_AndDiesWithTheUser()
    {
        using var context = ModelTestContext.Create();
        var history = context.Entity<UserConsentHistoryEntry>();

        Assert.Equal("user_consent_history", history.GetTableName());
        Assert.Equal(["id"], history.FindPrimaryKey()!.Properties.Select(property => property.GetColumnName()));
        Assert.Equal(DeleteBehavior.Cascade, history.GetForeignKeys().Single().DeleteBehavior);
        Assert.Contains(history.GetIndexes(), index => index.Properties.Select(property => property.GetColumnName()).SequenceEqual(["user_id", "at"]));
        Assert.Equal(new[] { "action", "at", "capacity", "id", "kind", "locale", "user_id", "version" }, history.GetProperties().Select(property => property.GetColumnName()).Order());
    }

    [Fact]
    public void NoIpAddressOrDeviceColumn_IsKept()
    {
        using var context = ModelTestContext.Create();
        var columns = context.Entity<UserConsent>().GetProperties().Concat(context.Entity<UserConsentHistoryEntry>().GetProperties()).Select(property => property.GetColumnName());

        Assert.DoesNotContain(columns, column => column.Contains("ip", StringComparison.Ordinal) || column.Contains("agent", StringComparison.Ordinal) || column.Contains("device", StringComparison.Ordinal));
    }
}
