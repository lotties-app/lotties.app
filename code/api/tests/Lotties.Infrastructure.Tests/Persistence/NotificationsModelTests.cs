using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Converters;
using Lotties.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the push notification tables (docs/design/09-push-notifications.md section 5).</summary>
public sealed class NotificationsModelTests
{
    [Fact]
    public void Migrations_PushNotificationsComesAfterPauseAndSleepDetailFields()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var previous = Array.FindIndex(migrations, migration => migration.EndsWith("_PauseAndSleepDetailFields", StringComparison.Ordinal));
        var push = Array.FindIndex(migrations, migration => migration.EndsWith("_PushNotifications", StringComparison.Ordinal));

        Assert.True(previous >= 0 && push == previous + 1, $"previous {previous}, push {push}");
    }

    [Theory]
    [InlineData(typeof(PushSubscription), "push_subscriptions", "id")]
    [InlineData(typeof(UserNotificationSettings), "user_notification_settings", "user_id")]
    [InlineData(typeof(BabyNotificationPreferences), "baby_notification_preferences", "baby_id,user_id")]
    [InlineData(typeof(NotificationDelivery), "notification_deliveries", "id")]
    [InlineData(typeof(NotificationAction), "notification_actions", "user_id,base_key")]
    [InlineData(typeof(JobLease), "job_leases", "name")]
    public void Tables_UseSnakeCaseNamesAndSpecPrimaryKeys(Type entity, string table, string primaryKey)
    {
        using var context = ModelTestContext.Create();
        var entityType = context.DesignTimeModel().FindEntityType(entity)!;

        Assert.Equal(table, entityType.GetTableName());
        Assert.Equal(primaryKey, Columns(entityType.FindPrimaryKey()!.Properties));
    }

    [Fact]
    public void PushSubscriptions_AreUniqueByEndpointHashWithActiveUserIndexAndCascadeFromUsers()
    {
        using var context = ModelTestContext.Create();
        var subscription = context.Entity<PushSubscription>();

        var unique = subscription.GetIndexes().Single(index => index.IsUnique);
        var byUser = subscription.GetIndexes().Single(index => Columns(index.Properties) == "user_id");
        var user = subscription.GetForeignKeys().Single(key => key.PrincipalEntityType.ClrType == typeof(User));

        Assert.Equal("endpoint_hash", Columns(unique.Properties));
        Assert.Equal("revoked_at IS NULL", byUser.GetFilter());
        Assert.Equal(DeleteBehavior.Cascade, user.DeleteBehavior);
    }

    [Fact]
    public void PushSubscriptions_StoreKeysInTheirOwnColumns()
    {
        using var context = ModelTestContext.Create();

        var keys = context.Entity<PushSubscription>().FindComplexProperty(nameof(PushSubscription.Keys))!.ComplexType;

        Assert.Equal("p256dh", keys.FindProperty(nameof(PushKeys.P256dh))!.GetColumnName());
        Assert.Equal("auth", keys.FindProperty(nameof(PushKeys.Auth))!.GetColumnName());
    }

    [Fact]
    public void Preferences_CascadeFromTheMembershipAlternateKeyAndIndexCandidateBabies()
    {
        using var context = ModelTestContext.Create();
        var preferences = context.Entity<BabyNotificationPreferences>();

        var membership = preferences.GetForeignKeys().Single();
        var candidates = preferences.GetIndexes().Single();

        Assert.Equal(typeof(BabyMember), membership.PrincipalEntityType.ClrType);
        Assert.Equal("baby_id,user_id", Columns(membership.PrincipalKey.Properties));
        Assert.False(membership.PrincipalKey.IsPrimaryKey());
        Assert.Equal(DeleteBehavior.Cascade, membership.DeleteBehavior);
        Assert.Equal("baby_id", Columns(candidates.Properties));
        Assert.Equal("dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders OR doctor_suggestions OR vaccine_reminders OR cry_detected", candidates.GetFilter());
    }

    [Theory]
    [InlineData(nameof(BabyNotificationPreferences.OvertiredWarning), "overtired_warning")]
    [InlineData(nameof(BabyNotificationPreferences.FussyPattern), "fussy_pattern")]
    [InlineData(nameof(BabyNotificationPreferences.DiaperWetHeadsUp), "diaper_wet_headsup")]
    [InlineData(nameof(BabyNotificationPreferences.DiaperDirtyHeadsUp), "diaper_dirty_headsup")]
    [InlineData(nameof(BabyNotificationPreferences.AppointmentReminders), "appointment_reminders")]
    [InlineData(nameof(BabyNotificationPreferences.CryDetected), "cry_detected")]
    public void Preferences_StoreTheHeadsUpChoicesAsRequiredBooleans(string property, string columnName)
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<BabyNotificationPreferences>().FindProperty(property)!;

        Assert.Equal((columnName, false, typeof(bool)), (column.GetColumnName(), column.IsNullable, column.ClrType));
    }

    [Fact]
    public void IdempotentScript_FussyAndOvertiredPrefsAddsFalseDefaultedColumnsAndWidensTheCandidateIndex()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("_FussyAndOvertiredPrefs'", StringComparison.Ordinal);
        var section = script[start..script.IndexOf("_DiaperHeadsUpPrefs'", start, StringComparison.Ordinal)];

        Assert.Contains("ALTER TABLE baby_notification_preferences ADD fussy_pattern boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_notification_preferences ADD overtired_warning boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.True(
            section.IndexOf("DROP INDEX ix_baby_notification_preferences_baby_id;", StringComparison.Ordinal) < section.IndexOf("CREATE INDEX ix_baby_notification_preferences_baby_id", StringComparison.Ordinal),
            "the candidate index is dropped before it is created again");
        Assert.Contains("CREATE INDEX ix_baby_notification_preferences_baby_id ON baby_notification_preferences (baby_id) WHERE dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_DiaperHeadsUpPrefsAddsFalseDefaultedColumnsAndWidensTheCandidateIndex()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_DiaperHeadsUpPrefs'", StringComparison.Ordinal)..script.LastIndexOf("_DiaperHeadsUpPrefs'", StringComparison.Ordinal)];

        Assert.Contains("ALTER TABLE baby_notification_preferences ADD diaper_wet_headsup boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE baby_notification_preferences ADD diaper_dirty_headsup boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.True(
            section.IndexOf("DROP INDEX ix_baby_notification_preferences_baby_id;", StringComparison.Ordinal) < section.IndexOf("CREATE INDEX ix_baby_notification_preferences_baby_id", StringComparison.Ordinal),
            "the candidate index is dropped before it is created again");
        Assert.Contains("CREATE INDEX ix_baby_notification_preferences_baby_id ON baby_notification_preferences (baby_id) WHERE dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
    }

    [Fact]
    public void Migrations_DiaperHeadsUpPrefsComesRightAfterFussyAndOvertiredPrefs()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var previous = Array.FindIndex(migrations, migration => migration.EndsWith("_FussyAndOvertiredPrefs", StringComparison.Ordinal));
        var diapers = Array.FindIndex(migrations, migration => migration.EndsWith("_DiaperHeadsUpPrefs", StringComparison.Ordinal));

        Assert.True(previous >= 0 && diapers == previous + 1, $"previous {previous}, diaper heads-ups {diapers}");
    }

    [Fact]
    public void Preferences_StoreTheBellyPainPatternChoiceAsARequiredBoolean()
    {
        using var context = ModelTestContext.Create();

        var column = context.Entity<BabyNotificationPreferences>().FindProperty(nameof(BabyNotificationPreferences.BellyPainPattern))!;

        Assert.Equal("belly_pain_pattern", column.GetColumnName());
        Assert.False(column.IsNullable);
    }

    [Fact]
    public void IdempotentScript_BellyPainPatternAddsAFalseDefaultedColumnAndWidensTheCandidateIndex()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_BellyPainPattern'", StringComparison.Ordinal)..script.LastIndexOf("_BellyPainPattern'", StringComparison.Ordinal)];

        Assert.Contains("ALTER TABLE baby_notification_preferences ADD belly_pain_pattern boolean NOT NULL DEFAULT FALSE;", section, StringComparison.Ordinal);
        Assert.True(
            section.IndexOf("DROP INDEX ix_baby_notification_preferences_baby_id;", StringComparison.Ordinal) < section.IndexOf("CREATE INDEX ix_baby_notification_preferences_baby_id", StringComparison.Ordinal),
            "the candidate index is dropped before it is created again");
        Assert.Contains("CREATE INDEX ix_baby_notification_preferences_baby_id ON baby_notification_preferences (baby_id) WHERE dose_due OR nap_window OR belly_pain_pattern;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE ", section, StringComparison.Ordinal);
    }

    [Fact]
    public void Migrations_BellyPainPatternComesAfterBellyMassage()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var previous = Array.FindIndex(migrations, migration => migration.EndsWith("_BellyMassage", StringComparison.Ordinal));
        var belly = Array.FindIndex(migrations, migration => migration.EndsWith("_BellyPainPattern", StringComparison.Ordinal));

        Assert.True(previous >= 0 && belly == previous + 1, $"previous {previous}, belly pain pattern {belly}");
    }

    [Fact]
    public void Deliveries_HaveUniqueClaimRetryPurgeAndSnoozeIndexes()
    {
        using var context = ModelTestContext.Create();
        var delivery = context.Entity<NotificationDelivery>();

        var indexes = delivery.GetIndexes().ToDictionary(index => Columns(index.Properties), index => index.IsUnique);
        var subscription = delivery.GetForeignKeys().Single();

        Assert.Equal(
            new Dictionary<string, bool>
            {
                ["subscription_id,dedupe_key"] = true,
                ["status,next_attempt_at"] = false,
                ["created_at"] = false,
                ["user_id,base_key"] = false,
            },
            indexes);
        Assert.Equal(typeof(PushSubscription), subscription.PrincipalEntityType.ClrType);
        Assert.Equal(DeleteBehavior.Cascade, subscription.DeleteBehavior);
    }

    [Fact]
    public void JobLeases_UseTheXminRowVersion()
    {
        using var context = ModelTestContext.Create();

        var version = context.Entity<JobLease>().FindProperty("Version")!;

        Assert.True(version.IsConcurrencyToken);
        Assert.Equal("xmin", version.GetColumnName());
        Assert.Equal("xid", version.GetColumnType());
    }

    [Fact]
    public void IdempotentScript_CreatesPushTablesWithSpecColumnTypesAndNoXminDdl()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("PushNotifications", StringComparison.Ordinal);
        var section = script[start..script.IndexOf("_NasalSuction'", start, StringComparison.Ordinal)];

        Assert.Contains("ALTER TABLE baby_members ADD CONSTRAINT ak_baby_members_baby_id_user_id UNIQUE (baby_id, user_id);", section, StringComparison.Ordinal);
        Assert.Contains("endpoint_hash character(43) NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("endpoint character varying(2048) NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("p256dh character varying(88) NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("auth character varying(24) NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("quiet_start time without time zone NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("dose_lead_minutes smallint NOT NULL", section, StringComparison.Ordinal);
        Assert.Contains("action_token_hash character(43)", section, StringComparison.Ordinal);
        Assert.Contains("REFERENCES baby_members (baby_id, user_id) ON DELETE CASCADE", section, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE INDEX ix_notification_deliveries_subscription_id_dedupe_key ON notification_deliveries (subscription_id, dedupe_key);", section, StringComparison.Ordinal);
        Assert.Contains("CREATE INDEX ix_push_subscriptions_user_id ON push_subscriptions (user_id) WHERE revoked_at IS NULL;", section, StringComparison.Ordinal);
        Assert.Contains("CREATE INDEX ix_baby_notification_preferences_baby_id ON baby_notification_preferences (baby_id) WHERE dose_due OR nap_window;", section, StringComparison.Ordinal);
        Assert.DoesNotContain("xmin", section, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DROP ", section, StringComparison.Ordinal);
    }

    [Fact]
    public void Converters_StoreEnumsAsTheirLowerSnakeCaseCodes()
    {
        Assert.Equal("dose_due", NotificationConverters.Kind.ConvertToProvider(NotificationKind.DoseDue));
        Assert.Equal("cancelled", NotificationConverters.DeliveryStatus.ConvertToProvider(DeliveryStatus.Cancelled));
        Assert.Equal("transferred", NotificationConverters.RevokeReason.ConvertToProvider(SubscriptionRevokeReason.Transferred));
        Assert.Equal("snoozed", NotificationConverters.ActionKind.ConvertToProvider(NotificationActionKind.Snoozed));
        Assert.Equal(DeliveryStatus.Expired, NotificationConverters.DeliveryStatus.ConvertFromProvider("expired"));
        Assert.Throws<InvalidOperationException>(() => NotificationConverters.Kind.ConvertFromProvider("Pending"));
    }

    [Fact]
    public void Converters_RoundTripKeysTokenHashesAndLocales()
    {
        var key = NotificationKey.ForDose(Guid.NewGuid(), new DateTimeOffset(2026, 10, 21, 21, 0, 0, TimeSpan.Zero)).Snoozed(2);
        var hash = NotificationActionToken.Generate().Hash();

        Assert.Equal(key, NotificationConverters.Key.ConvertFromProvider(NotificationConverters.Key.ConvertToProvider(key)));
        Assert.Equal(hash, NotificationConverters.ActionTokenHash.ConvertFromProvider(NotificationConverters.ActionTokenHash.ConvertToProvider(hash)));
        Assert.Equal(NotificationLocale.English, NotificationConverters.Locale.ConvertFromProvider("fr"));
    }

    [Fact]
    public void CandidatesQuery_TranslatesToOneStatementJoiningMembersAndActiveSubscriptions()
    {
        using var context = ModelTestContext.Create();

        var sql = EfBabyNotificationPreferencesRepository.CandidatesQuery(context, DateTimeOffset.UtcNow).ToQueryString();

        Assert.Contains("INNER JOIN baby_members", sql, StringComparison.Ordinal);
        Assert.Contains("EXISTS", sql, StringComparison.Ordinal);
        Assert.Contains("revoked_at IS NULL", sql, StringComparison.Ordinal);
        Assert.Contains("dose_due OR", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void CandidateQueries_LeaveOutBabiesWhosePointerNamesAnExternalStore()
    {
        using var context = ModelTestContext.Create();
        var now = DateTimeOffset.UtcNow;

        var stored = EfBabyNotificationPreferencesRepository.CandidatesQuery(context, now).ToQueryString();
        var defaults = EfBabyNotificationPreferencesRepository.DefaultCandidatesQuery(context, now).ToQueryString();

        Assert.All(new[] { stored, defaults }, sql =>
        {
            Assert.Matches(@"NOT\s*\(?\s*EXISTS", sql);
            Assert.Matches(@"\.data_store_id IS NOT NULL", sql);
        });
    }

    private static string Columns(IEnumerable<IReadOnlyProperty> properties) =>
        string.Join(',', properties.Select(property => property.GetColumnName()));
}
