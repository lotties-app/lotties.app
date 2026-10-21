using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

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
    public void Migrations_AreOrderedInitialCreateFixupsMeasurementsSleepKindsClientUpdatedAtWave2HardeningFellAsleepConditionalFieldsMedicationsThenPauses()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var expectedOrder = new[] { "_InitialCreate", "_BuiltInFieldFixups", "_AddMeasurements", "_SleepKindBedWake", "_EventClientUpdatedAt", "_Wave2Hardening", "_SleepKindFellAsleep", "_ConditionalFieldsAndBreastPump", "_MedicationsPrescriptionsCatalog", "_PauseAndSleepDetailFields" };

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
        Assert.Equal(["DROP INDEX ix_users_subject;"], DropStatements(script));
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
