using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Lotties.Infrastructure.Tests.Persistence;

public sealed class ModelTests
{
    [Fact]
    public void Model_MapsEveryAggregateToSnakeCaseTable()
    {
        using var context = ModelTestContext.Create();

        var tables = context.DesignTimeModel().GetEntityTypes()
            .Where(entity => !entity.IsOwned())
            .Select(entity => entity.GetTableName())
            .Order()
            .ToArray();

        Assert.Equal(["access_log", "appointments", "babies", "baby_members", "baby_notes", "baby_notification_preferences", "care_providers", "event_types", "events", "formulas", "invites", "job_leases", "measurements", "medications", "note_reads", "notification_actions", "notification_deliveries", "prescription_proposals", "prescriptions", "product_substances", "products", "professional_profiles", "push_subscriptions", "substances", "user_notification_settings", "users", "vaccinations"], tables);
    }

    [Theory]
    [InlineData(typeof(Event), nameof(Event.Payload))]
    [InlineData(typeof(EventType), nameof(EventType.Fields))]
    public void JsonProperties_UseJsonbColumns(Type entityType, string propertyName)
    {
        using var context = ModelTestContext.Create();

        var property = context.DesignTimeModel().FindEntityType(entityType)!.FindProperty(propertyName)!;

        Assert.Equal("jsonb", property.GetColumnType());
        Assert.False(property.IsNullable);
    }

    [Fact]
    public void Events_HaveDeltaSyncAndTimelineIndexes()
    {
        using var context = ModelTestContext.Create();

        var indexes = IndexColumns(context.Entity<Event>());

        Assert.Contains("baby_id,updated_at", indexes);
        Assert.Contains("baby_id,started_at", indexes);
    }

    [Fact]
    public void Events_IdIsClientGenerated()
    {
        using var context = ModelTestContext.Create();

        Assert.Equal(ValueGenerated.Never, context.Entity<Event>().FindProperty(nameof(Event.Id))!.ValueGenerated);
    }

    [Fact]
    public void Events_HaveSoftDeleteQueryFilter()
    {
        using var context = ModelTestContext.Create();

        var filtered = context.Events.ToQueryString();
        var unfiltered = context.EventsIncludingDeleted.ToQueryString();

        Assert.Contains("deleted_at IS NULL", filtered, StringComparison.Ordinal);
        Assert.DoesNotContain("deleted_at IS NULL", unfiltered, StringComparison.Ordinal);
    }

    [Fact]
    public void BabyMembers_HaveUniqueBabyAndUser()
    {
        using var context = ModelTestContext.Create();

        Assert.Contains("baby_id,user_id", UniqueIndexColumns(context.Entity<BabyMember>()));
    }

    [Fact]
    public void Invites_HaveUniqueToken()
    {
        using var context = ModelTestContext.Create();

        Assert.Contains("token", UniqueIndexColumns(context.Entity<Invite>()));
    }

    [Fact]
    public void Users_HaveUniqueIssuerAndSubject()
    {
        using var context = ModelTestContext.Create();

        var unique = UniqueIndexColumns(context.Entity<User>());

        Assert.Contains("issuer,subject", unique);
        Assert.DoesNotContain("subject", unique);
    }

    [Theory]
    [InlineData(typeof(Invite))]
    [InlineData(typeof(Baby))]
    public void InvitesAndBabies_HaveXminRowVersion(Type entityType)
    {
        using var context = ModelTestContext.Create();

        var version = context.DesignTimeModel().FindEntityType(entityType)!.FindProperty("Version")!;

        Assert.True(version.IsShadowProperty());
        Assert.True(version.IsConcurrencyToken);
        Assert.Equal(ValueGenerated.OnAddOrUpdate, version.ValueGenerated);
        Assert.Equal(("xmin", "xid"), (version.GetColumnName(), version.GetColumnType()));
    }

    [Fact]
    public void EventTypes_KeyIsUniquePerBabyWithBuiltInsTreatedAsOneScope()
    {
        using var context = ModelTestContext.Create();

        var index = context.Entity<EventType>().GetIndexes()
            .Single(candidate => Columns(candidate) == "baby_id,key");

        Assert.True(index.IsUnique);
        Assert.False(index.GetAreNullsDistinct());
    }

    [Fact]
    public void Roles_AreStoredAsText()
    {
        using var context = ModelTestContext.Create();

        var role = context.Entity<BabyMember>().FindProperty(nameof(BabyMember.Role))!;

        Assert.Equal(typeof(string), role.GetTypeMapping().Converter?.ProviderClrType);
    }

    [Fact]
    public void Measurements_HaveNonUniqueBabyDateIndex()
    {
        using var context = ModelTestContext.Create();

        var index = context.Entity<Measurement>().GetIndexes()
            .Single(candidate => Columns(candidate) == "baby_id,date");

        Assert.False(index.IsUnique);
    }

    [Fact]
    public void Medications_DefaultDosageIsOptionalOwnedColumns()
    {
        using var context = ModelTestContext.Create();

        var dosage = context.Entity<Medication>().FindNavigation(nameof(Medication.DefaultDosage))!.TargetEntityType;
        var columns = dosage.GetProperties()
            .Where(property => !property.IsPrimaryKey())
            .Select(property => property.GetColumnName())
            .Order()
            .ToArray();

        Assert.Equal(["default_dose_amount", "default_dose_unit"], columns);
        Assert.Equal("medications", dosage.GetTableName());
    }

    [Fact]
    public void BuiltInEventTypes_AreSeededWithStableIds()
    {
        using var context = ModelTestContext.Create();

        var seededIds = context.Entity<EventType>().GetSeedData()
            .Select(row => (Guid)row[nameof(EventType.Id)]!)
            .Order()
            .ToArray();

        Assert.Equal(BuiltInEventTypes.All.Select(type => type.Id).Order(), seededIds);
    }

    [Fact]
    public void BuiltInEventTypes_SeedRowsAreTemplates()
    {
        using var context = ModelTestContext.Create();

        var rows = context.Entity<EventType>().GetSeedData();

        Assert.All(rows, row => Assert.Null(row[nameof(EventType.BabyId)]));
    }

    private static string Columns(IReadOnlyIndex index) =>
        string.Join(',', index.Properties.Select(property => property.GetColumnName()));

    private static string[] IndexColumns(IEntityType entity) =>
        entity.GetIndexes().Select(Columns).ToArray();

    private static string[] UniqueIndexColumns(IEntityType entity) =>
        entity.GetIndexes().Where(index => index.IsUnique).Select(Columns).ToArray();
}
