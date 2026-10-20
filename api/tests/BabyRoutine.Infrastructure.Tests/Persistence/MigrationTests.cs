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
