using System.Reflection;
using Lotties.Domain.EventTypes;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.AutoMigration;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure.Internal;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>
/// The data migration chain of external stores (docs/design/47-bring-your-own-database.md section 4, task T5): its own context
/// shape, history table and folder, a baseline that creates the 12 data tables and <c>store_meta</c> in schema <c>lotties</c> with
/// the current built-in event types and no key to a control table, and every guarantee that it is never applied to the Lotties
/// (built-in) database, which keeps its own chain. The Postgres container tests run it on a real database.
/// </summary>
public sealed class DataMigrationChainTests
{
    private const string DataMigrationsNamespace = "Lotties.Infrastructure.Persistence.DataMigrations";
    private const string ControlMigrationsNamespace = "Lotties.Infrastructure.Persistence.Migrations";

    private static readonly string[] DataTables =
    [
        "appointments", "baby_notes", "care_providers", "event_types", "events", "formulas", "measurements", "medications",
        "note_reads", "prescription_proposals", "prescriptions", "vaccinations",
    ];

    private static readonly string[] ExternalTables = [.. DataTables.Append("store_meta").Order(StringComparer.Ordinal)];

    [Fact]
    public void DataChain_HistoryTableIsLottiesDataMigrations()
    {
        using var context = External();

        var npgsql = context.GetService<IDbContextOptions>().FindExtension<NpgsqlOptionsExtension>()!;

        Assert.Equal(("__ef_data_migrations", "lotties"), (npgsql.MigrationsHistoryTableName, npgsql.MigrationsHistoryTableSchema));
    }

    [Fact]
    public void DataChain_IsEveryMigrationOfTheDataFolderAndOnlyThose()
    {
        using var context = External();

        var discovered = context.GetService<IMigrationsAssembly>().Migrations;

        Assert.NotEmpty(discovered);
        Assert.All(discovered.Values, type => Assert.Equal(DataMigrationsNamespace, type.Namespace));
        Assert.Equal(MigrationClassesIn(DataMigrationsNamespace).Length, discovered.Count);
        Assert.All(discovered, pair => Assert.Equal(pair.Key[15..], pair.Value.Name));
        Assert.All(context.Database.GetMigrations(), id => Assert.Matches("^[0-9]{14}_[A-Z][A-Za-z0-9]*$", id));
    }

    [Fact]
    public void ControlChain_HoldsNoDataMigration()
    {
        using var control = ModelTestContext.Create();
        using var data = External();

        var controlMigrations = control.GetService<IMigrationsAssembly>().Migrations;

        Assert.All(controlMigrations.Values, type => Assert.Equal(ControlMigrationsNamespace, type.Namespace));
        Assert.Empty(controlMigrations.Keys.Intersect(data.Database.GetMigrations()));
        Assert.All(MigrationClassesIn(DataMigrationsNamespace), type => Assert.Equal(typeof(LottiesDataDbContext), type.GetCustomAttribute<DbContextAttribute>()!.ContextType));
    }

    [Fact]
    public void DataChain_MatchesTheExternalStoreModel()
    {
        using var context = External();
        var assembly = context.GetService<IMigrationsAssembly>();
        var snapshot = assembly.ModelSnapshot!.Model;
        var finalized = snapshot is IMutableModel mutable ? mutable.FinalizeModel() : snapshot;

        var differences = context.GetService<IMigrationsModelDiffer>().GetDifferences(
            context.GetService<IModelRuntimeInitializer>().Initialize(finalized).GetRelationalModel(),
            context.DesignTimeModel().GetRelationalModel());

        Assert.Empty(differences);
        Assert.False(context.Database.HasPendingModelChanges());
    }

    [Fact]
    public void ExternalModel_PutsTheDataTablesAndStoreMetaInSchemaLotties()
    {
        using var context = External();

        var tables = context.DesignTimeModel().GetEntityTypes().Select(entity => (entity.GetSchema(), entity.GetTableName())).Distinct().ToArray();

        Assert.Equal(ExternalTables, tables.Select(table => table.Item2).Order(StringComparer.Ordinal));
        Assert.All(tables, table => Assert.Equal("lotties", table.Item1));
    }

    [Fact]
    public void BuiltInDataModel_KeepsItsTablesInPublicAndHasNoStoreMeta()
    {
        using var builtIn = ModelTestContext.CreateData();

        var model = builtIn.DesignTimeModel();

        Assert.All(model.GetEntityTypes(), entity => Assert.Null(entity.GetSchema()));
        Assert.Null(model.FindEntityType(typeof(StoreMetaRow)));
        Assert.Equal(DataTables, model.GetEntityTypes().Select(entity => entity.GetTableName()).Distinct().Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Baseline_CreatesTheDataTablesAndStoreMetaWithoutAnyKeyLeavingTheStore()
    {
        var operations = BaselineOperations();

        var created = operations.OfType<CreateTableOperation>().ToArray();

        Assert.Equal(ExternalTables, created.Select(table => table.Name).Order(StringComparer.Ordinal));
        Assert.All(created, table => Assert.Equal("lotties", table.Schema));
        Assert.All(created.SelectMany(table => table.ForeignKeys), key => Assert.Contains(key.PrincipalTable, DataTables));
        Assert.All(created.SelectMany(table => table.ForeignKeys), key => Assert.Equal("lotties", key.PrincipalSchema));
        Assert.Empty(operations.OfType<AddForeignKeyOperation>());
    }

    [Fact]
    public void Baseline_SeedsEveryCurrentBuiltInEventType()
    {
        var seeded = BaselineOperations().OfType<InsertDataOperation>().Single(insert => insert.Table == "event_types");

        var ids = Enumerable.Range(0, seeded.Values.GetLength(0)).Select(row => (Guid)seeded.Values[row, Array.IndexOf(seeded.Columns, "id")]!);

        Assert.Equal("lotties", seeded.Schema);
        Assert.Equal(BuiltInEventTypes.All.Select(type => type.Id).Order(), ids.Order());
        Assert.All(Enumerable.Range(0, seeded.Values.GetLength(0)), row => Assert.Null(seeded.Values[row, Array.IndexOf(seeded.Columns, "baby_id")]));
    }

    [Fact]
    public void Baseline_RefusesTheLottiesDatabaseBeforeCreatingAnything()
    {
        var operations = BaselineOperations();

        var guard = Assert.IsType<SqlOperation>(operations[0]);

        Assert.Contains("'__EFMigrationsHistory', 'babies', 'baby_members'", guard.Sql, StringComparison.Ordinal);
        Assert.Contains("RAISE EXCEPTION 'lotties_data_chain_on_control_database'", guard.Sql, StringComparison.Ordinal);
    }

    [Fact]
    public void DesignTimeFactory_NeverPointsAtARealDatabase()
    {
        using var context = new LottiesDataDbContextFactory().CreateDbContext([]);

        var connection = new Npgsql.NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());

        Assert.Equal(LottiesDataDbContextFactory.DesignTimeHost, connection.Host);
        Assert.EndsWith(".invalid", connection.Host, StringComparison.Ordinal);
        Assert.True(context.IsExternalStore);
    }

    [Fact]
    public void StartupMigration_AppliesOnlyTheControlChain()
    {
        var contextTypes = typeof(NpgsqlMigrationSession)
            .GetFields(BindingFlags.Instance | BindingFlags.NonPublic)
            .Select(field => field.FieldType)
            .Where(type => type.IsSubclassOf(typeof(DbContext)));

        Assert.Equal([typeof(LottiesDbContext)], contextTypes);
    }

    private static LottiesDataDbContext External() =>
        new LottiesDataDbContextFactory().CreateDbContext([]);

    private static IReadOnlyList<MigrationOperation> BaselineOperations()
    {
        using var context = External();
        var assembly = context.GetService<IMigrationsAssembly>();
        var baseline = assembly.Migrations.First(pair => pair.Key.EndsWith("_DataBaseline", StringComparison.Ordinal));
        return assembly.CreateMigration(baseline.Value, context.Database.ProviderName!).UpOperations;
    }

    private static Type[] MigrationClassesIn(string ns) =>
        typeof(LottiesDataDbContext).Assembly.GetTypes()
            .Where(type => type.IsSubclassOf(typeof(Migration)) && !type.IsAbstract && type.Namespace == ns)
            .ToArray();
}
