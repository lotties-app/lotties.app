using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

public sealed class MigrationTests
{
    [Fact]
    public void Migrations_MatchCurrentModel()
    {
        using var context = ModelTestContext.Create();
        var snapshotModel = context.GetService<IMigrationsAssembly>().ModelSnapshot?.Model;
        Assert.NotNull(snapshotModel);
        var finalizedSnapshot = snapshotModel is IMutableModel mutable ? mutable.FinalizeModel() : snapshotModel;
        var initializedSnapshot = context.GetService<IModelRuntimeInitializer>().Initialize(finalizedSnapshot);

        var differences = context.GetService<IMigrationsModelDiffer>().GetDifferences(
            initializedSnapshot.GetRelationalModel(),
            context.DesignTimeModel().GetRelationalModel());

        Assert.Empty(differences);
    }

    [Fact]
    public void Migrations_ContainInitialCreate()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();

        Assert.Single(migrations, migration => migration.EndsWith("_InitialCreate", StringComparison.Ordinal));
    }

    [Fact]
    public void Migrations_AreOrderedInTheOrderTheyWereAdded()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var expectedOrder = new[] { "_InitialCreate", "_BuiltInFieldFixups", "_AddMeasurements", "_SleepKindBedWake", "_EventClientUpdatedAt", "_Wave2Hardening", "_SleepKindFellAsleep", "_ConditionalFieldsAndBreastPump", "_MedicationsPrescriptionsCatalog", "_PauseAndSleepDetailFields", "_PushNotifications", "_NasalSuction", "_PrescriptionDayParts", "_BellyMassage", "_BellyPainPattern", "_FussyEvent", "_FussyAndOvertiredPrefs", "_DiaperHeadsUpPrefs", "_ProductExternalRef", "_Formulas", "_Appointments", "_DoctorAccess", "_DoctorProposals", "_MoreEventTypes", "_Vaccines" };

        Assert.Equal(expectedOrder, expectedOrder.OrderBy(suffix => Array.FindIndex(migrations, migration => migration.EndsWith(suffix, StringComparison.Ordinal))));
        Assert.All(expectedOrder, suffix => Assert.Single(migrations, migration => migration.EndsWith(suffix, StringComparison.Ordinal)));
    }

    [Fact]
    public void IdempotentScript_BackfillsClientUpdatedAtBeforeMakingItRequired()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var added = script.IndexOf("ALTER TABLE events ADD client_updated_at timestamp with time zone;", StringComparison.Ordinal);
        var backfilled = script.IndexOf("UPDATE events SET client_updated_at = updated_at", StringComparison.Ordinal);
        var required = script.IndexOf("ALTER COLUMN client_updated_at SET NOT NULL", StringComparison.Ordinal);

        Assert.True(added >= 0 && added < backfilled && backfilled < required, $"add {added}, backfill {backfilled}, not null {required}");
    }

    [Fact]
    public void IdempotentScript_AddsBedTimeAndWokeUpSleepKinds()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("\"night_waking\",\"bed_time\",\"woke_up\"", script, StringComparison.Ordinal);
        Assert.Contains("SleepKindBedWake", script, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_AddsFellAsleepSleepKind()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("\"bed_time\",\"woke_up\",\"fell_asleep\"", script, StringComparison.Ordinal);
        Assert.Contains("SleepKindFellAsleep", script, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsFeedingVisibilityAndBreastPumpType()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("\"options\":[\"formula\",\"breast_milk\"],\"visibleWhen\":{\"field\":\"method\",\"equals\":[\"bottle\"]}", script, StringComparison.Ordinal);
        Assert.Contains("'ddfdaa52-57ee-4d34-8129-a78262c2172c', NULL, '#26c6da'", script, StringComparison.Ordinal);
        Assert.Contains("'opacity', 'breast_pump', 'Breast pump'", script, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsNasalSuctionTypeWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_NasalSuction'", StringComparison.Ordinal)..];

        Assert.Contains("'4124b99c-e000-4ee0-b74a-a6579553a450', NULL, '#78909c'", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"tool\",\"label\":\"Tool\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"bulb\",\"electric\",\"mouth\"]}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"saline\",\"label\":\"Saline used\",\"kind\":\"bool\",\"isRequired\":false}", section, StringComparison.Ordinal);
        Assert.Contains("FALSE, 'air', 'nasal_suction', 'Nasal suction'", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsBellyMassageTypeOnceWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("_BellyMassage'", StringComparison.Ordinal);
        var section = script[start..script.IndexOf("_BellyPainPattern'", start, StringComparison.Ordinal)];

        Assert.Single(System.Text.RegularExpressions.Regex.Matches(section, "INSERT INTO event_types"));
        Assert.Contains("'44540b60-eb87-470f-8a3e-08170a525538', NULL, '#ff7043'", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"reason\",\"label\":\"Reason\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"gas\",\"constipation\",\"colic\",\"other\"]}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"helped\",\"label\":\"Did it help?\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"yes\",\"a_little\",\"no\"]}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"pause_count\"", section, StringComparison.Ordinal);
        Assert.Contains("TRUE, 'massage', 'belly_massage', 'Belly massage'", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsFussyTypeOnceWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("_FussyEvent'", StringComparison.Ordinal);
        var section = script[start..script.IndexOf("_FussyAndOvertiredPrefs'", start, StringComparison.Ordinal)];

        Assert.Single(System.Text.RegularExpressions.Regex.Matches(section, "INSERT INTO event_types"));
        Assert.Contains("'6191006e-8767-4cd8-882f-81898fad58d3', NULL, '#81c784'", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"intensity\",\"label\":\"Intensity\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"mild\",\"moderate\",\"intense\"]}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"what_helped\",\"label\":\"What helped\",\"kind\":\"select\",\"isRequired\":false,\"options\":[\"feeding\",\"rocking\",\"pacifier\",\"massage\",\"sleep\",\"other\",\"nothing\"]}", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"pause_count\"", section, StringComparison.Ordinal);
        Assert.Contains("TRUE, 'sentiment_very_dissatisfied', 'fussy', 'Fussy / crying'", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsTheEightMoreEventTypesWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("_MoreEventTypes'", StringComparison.Ordinal);
        var section = script[start..script.LastIndexOf("_MoreEventTypes'", StringComparison.Ordinal)];

        Assert.Equal(8, System.Text.RegularExpressions.Regex.Matches(section, "', NULL, '#").Count);
        Assert.Contains("'c3691235-0279-429c-be1c-db6692ad5455', NULL, '#ffca28'", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"value_c\",\"label\":\"Temperature\",\"kind\":\"number\",\"isRequired\":true,\"min\":30,\"max\":45,\"unit\":\"\\u00B0C\",\"decimals\":1}", section, StringComparison.Ordinal);
        Assert.Contains("\"visibleWhen\":{\"field\":\"stage\",\"equals\":[\"tooth_came_through\"]}", section, StringComparison.Ordinal);
        Assert.Contains("\"visibleWhen\":{\"field\":\"milestone\",\"equals\":[\"other\"]}", section, StringComparison.Ordinal);
        Assert.Contains("TRUE, 'park', 'outdoor', 'Outdoor time'", section, StringComparison.Ordinal);
        Assert.Contains("FALSE, 'thermostat', 'temperature', 'Temperature'", section, StringComparison.Ordinal);
        foreach (var key in new[] { "nail_trim", "temperature", "spit_up", "teething", "milestone", "symptom", "outdoor", "skin_care" })
        {
            Assert.Contains($"'{key}', '", section, StringComparison.Ordinal);
        }

        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE event_types", section, StringComparison.Ordinal);
    }

    [Fact]
    public void Migrations_MoreEventTypesComesRightAfterDoctorProposals()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var proposals = Array.FindIndex(migrations, migration => migration.EndsWith("_DoctorProposals", StringComparison.Ordinal));
        var types = Array.FindIndex(migrations, migration => migration.EndsWith("_MoreEventTypes", StringComparison.Ordinal));

        Assert.True(proposals >= 0 && types == proposals + 1, $"doctor proposals {proposals}, more event types {types}");
    }

    [Fact]
    public void Migrations_FussyEventAndThePreferencesComeRightAfterBellyPainPattern()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var belly = Array.FindIndex(migrations, migration => migration.EndsWith("_BellyPainPattern", StringComparison.Ordinal));
        var fussy = Array.FindIndex(migrations, migration => migration.EndsWith("_FussyEvent", StringComparison.Ordinal));
        var preferences = Array.FindIndex(migrations, migration => migration.EndsWith("_FussyAndOvertiredPrefs", StringComparison.Ordinal));

        Assert.True(belly >= 0 && fussy == belly + 1 && preferences == fussy + 1, $"belly pain pattern {belly}, fussy {fussy}, preferences {preferences}");
    }

    [Fact]
    public void IdempotentScript_RewritesStoredBottleContentsToLowerCaseOnlyWhereStillUpperCase()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var seeded = script.IndexOf("\"options\":[\"formula\",\"breast_milk\"]", StringComparison.Ordinal);
        var rewritten = script.IndexOf("to_jsonb(lower(payload ->> 'bottle_feeding_type'))", StringComparison.Ordinal);

        Assert.True(seeded >= 0 && seeded < rewritten, $"seed {seeded}, rewrite {rewritten}");
        Assert.Contains("WHERE type_id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f'", script, StringComparison.Ordinal);
        Assert.Contains("AND payload ->> 'bottle_feeding_type' IN ('FORMULA', 'BREAST_MILK');", script, StringComparison.Ordinal);
        Assert.Contains("updated_at = now()", script, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsHiddenPauseKeysAndSleepDetailsWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var start = script.IndexOf("PauseAndSleepDetailFields", StringComparison.Ordinal);
        var section = script[start..];

        Assert.Contains("{\"key\":\"paused_at\",\"label\":\"Paused at\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}", section, StringComparison.Ordinal);
        Assert.Contains("\"key\":\"how_slept\"", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"mood\",\"label\":\"Mood\",\"kind\":\"text\",\"isRequired\":false,\"hidden\":true}", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsDiaperContentField()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("\"key\":\"content\"", script, StringComparison.Ordinal);
        Assert.Contains("BuiltInFieldFixups", script, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_CreatesTablesWithoutDestructiveStatements()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("CREATE TABLE events", script, StringComparison.Ordinal);
        Assert.Contains("payload jsonb NOT NULL", script, StringComparison.Ordinal);
        // Every index is recreated right after (issuer + subject; the wider belly pain, then overtired and fussy, then
        // diaper, then appointment, then doctor suggestions, then vaccine reminders candidate filter): no data is dropped.
        Assert.Equal(["DROP INDEX ix_users_subject;", "DROP INDEX ix_baby_notification_preferences_baby_id;", "DROP INDEX ix_baby_notification_preferences_baby_id;", "DROP INDEX ix_baby_notification_preferences_baby_id;", "DROP INDEX ix_baby_notification_preferences_baby_id;", "DROP INDEX ix_baby_notification_preferences_baby_id;", "DROP INDEX ix_baby_notification_preferences_baby_id;"], DropStatements(script));
        Assert.DoesNotContain("TRUNCATE", script, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void IdempotentScript_KeysUsersByIssuerAndSubjectWithUnknownIssuerForExistingRows()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var dropped = script.IndexOf("DROP INDEX ix_users_subject;", StringComparison.Ordinal);
        var added = script.IndexOf("ALTER TABLE users ADD issuer character varying(255) NOT NULL DEFAULT '';", StringComparison.Ordinal);
        var indexed = script.IndexOf("CREATE UNIQUE INDEX ix_users_issuer_subject ON users (issuer, subject);", StringComparison.Ordinal);

        Assert.True(dropped >= 0 && dropped < added && added < indexed, $"drop {dropped}, add {added}, index {indexed}");
        Assert.Contains("UPDATE users SET display_name = 'Parent' WHERE display_name LIKE '%@%';", script, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_RowVersionsUseTheXminSystemColumnWithoutDdl()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.DoesNotContain("xmin", script, StringComparison.OrdinalIgnoreCase);
    }

    private static string[] DropStatements(string script) =>
        script.Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.StartsWith("DROP ", StringComparison.OrdinalIgnoreCase))
            .ToArray();
}
