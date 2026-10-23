using Lotties.Infrastructure.Persistence;
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

    /// <summary>
    /// The migrations already applied in production, in order. This list never changes: a deployed migration is never
    /// renamed, regenerated or reordered. A new migration is NOT added here; the rules below check it (docs/PROCESS.md).
    /// </summary>
    private static readonly string[] DeployedMigrations =
    [
        "20261020231413_InitialCreate",
        "20261021000249_BuiltInFieldFixups",
        "20261021000934_AddMeasurements",
        "20261021002724_SleepKindBedWake",
        "20261021010818_EventClientUpdatedAt",
        "20261021014553_Wave2Hardening",
        "20261021043358_SleepKindFellAsleep",
        "20261021045736_ConditionalFieldsAndBreastPump",
        "20261021104705_MedicationsPrescriptionsCatalog",
        "20261021120142_PauseAndSleepDetailFields",
        "20261021182304_PushNotifications",
        "20261022000952_NasalSuction",
        "20261022004855_PrescriptionDayParts",
        "20261022011434_BellyMassage",
        "20261022014026_BellyPainPattern",
        "20261022020422_FussyEvent",
        "20261022021117_FussyAndOvertiredPrefs",
        "20261022045238_DiaperHeadsUpPrefs",
        "20261022143647_ProductExternalRef",
        "20261022154530_Formulas",
        "20261022175012_Appointments",
        "20261022185120_DoctorAccess",
        "20261022203709_DoctorProposals",
        "20261022213633_MoreEventTypes",
        "20261022230039_Vaccines",
    ];

    [Fact]
    public void Migrations_StartWithTheDeployedOnesUnchangedAndInOrder()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();

        // A newer migration sorts after the last deployed one: its timestamp must be later (scripts/regen-migrations.sh).
        Assert.Equal(DeployedMigrations, migrations.Take(DeployedMigrations.Length));
    }

    [Fact]
    public void Migrations_HaveWellFormedUniqueIdsAndNames()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();

        Assert.All(migrations, id => Assert.Matches("^[0-9]{14}_[A-Z][A-Za-z0-9]*$", id));
        Assert.Equal(migrations.Length, migrations.Select(id => id[..14]).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(migrations.Length, migrations.Select(id => id[15..]).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Equal(migrations.Order(StringComparer.Ordinal), migrations);
    }

    [Fact]
    public void Migrations_EveryMigrationClassHasItsDesignerAndMatchesItsId()
    {
        using var context = ModelTestContext.Create();
        var assembly = context.GetService<IMigrationsAssembly>();

        // A migration class without its .Designer.cs has no [Migration]/[DbContext] attributes: EF would skip it silently.
        var classes = typeof(LottiesDbContext).Assembly.GetTypes().Where(type => type.IsSubclassOf(typeof(Migration)) && !type.IsAbstract).ToArray();
        var discovered = assembly.Migrations;

        Assert.Equal(classes.Length, discovered.Count);
        Assert.All(discovered, pair => Assert.Equal(pair.Key[15..], pair.Value.Name));
        Assert.All(discovered, pair => Assert.NotEmpty(assembly.CreateMigration(pair.Value, context.Database.ProviderName!).TargetModel.GetEntityTypes()));
    }

    [Fact]
    public void Migrations_LatestTargetModelMatchesTheSnapshot()
    {
        using var context = ModelTestContext.Create();
        var assembly = context.GetService<IMigrationsAssembly>();
        var latest = assembly.Migrations.MaxBy(pair => pair.Key, StringComparer.Ordinal);
        var latestModel = assembly.CreateMigration(latest.Value, context.Database.ProviderName!).TargetModel;

        // Fails after an integration where main gained migrations and the branch's migration (its Designer) or the
        // snapshot was not regenerated on top of them: run scripts/regen-migrations.sh <MigrationName>.
        var differences = context.GetService<IMigrationsModelDiffer>().GetDifferences(
            Initialize(context, latestModel).GetRelationalModel(),
            Initialize(context, assembly.ModelSnapshot!.Model).GetRelationalModel());

        Assert.Empty(differences);
    }

    private static IModel Initialize(LottiesDbContext context, IModel model)
    {
        var finalized = model is IMutableModel mutable ? mutable.FinalizeModel() : model;
        return context.GetService<IModelRuntimeInitializer>().Initialize(finalized);
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
        // Only indexes are ever dropped (they hold no data), and each one is created again further on (a wider filter,
        // for example), so no data is dropped. ix_users_subject (deployed) was replaced by ix_users_issuer_subject.
        var drops = DropStatements(script);
        Assert.NotEmpty(drops);
        Assert.All(drops, drop => Assert.Matches("^DROP INDEX [a-z0-9_]+;$", drop));
        Assert.All(
            drops.Select(drop => drop["DROP INDEX ".Length..^1]).Where(index => index != "ix_users_subject"),
            index => Assert.True(IsCreatedAfterEachDrop(script, index), $"{index} is dropped and not created again"));
        Assert.Contains("CREATE UNIQUE INDEX ix_users_issuer_subject ON users (issuer, subject);", script, StringComparison.Ordinal);
        Assert.DoesNotContain("TRUNCATE", script, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Every <c>DROP INDEX index;</c> of the script is followed, later on, by a <c>CREATE ... INDEX index ON</c>.</summary>
    private static bool IsCreatedAfterEachDrop(string script, string index)
    {
        var drop = $"DROP INDEX {index};";
        var create = new System.Text.RegularExpressions.Regex($@"CREATE (UNIQUE )?INDEX {index} ON ");
        for (var at = script.IndexOf(drop, StringComparison.Ordinal); at >= 0; at = script.IndexOf(drop, at + drop.Length, StringComparison.Ordinal))
        {
            if (!create.IsMatch(script, at + drop.Length))
            {
                return false;
            }
        }

        return true;
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
