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
    public void Migrations_AreOrderedInitialCreateFixupsMeasurementsSleepKindsThenClientUpdatedAt()
    {
        using var context = ModelTestContext.Create();

        var migrations = context.Database.GetMigrations().ToArray();
        var expectedOrder = new[] { "_InitialCreate", "_BuiltInFieldFixups", "_AddMeasurements", "_SleepKindBedWake", "_EventClientUpdatedAt" };

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
        Assert.DoesNotContain("DROP ", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("TRUNCATE", script, StringComparison.OrdinalIgnoreCase);
    }
}
