using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>
/// The control/data split of the model (docs/design/47-bring-your-own-database.md section 2.1, task T1). The data context maps
/// the data tables only, with no foreign key to a control table; the control context still maps the whole built-in database
/// (its migrations own every table, <see cref="MigrationTests"/> pins it to the snapshot), and the two describe the data tables
/// identically apart from those foreign keys.
/// </summary>
public sealed class PlaneModelTests
{
    private static readonly string[] DataTables =
    [
        "appointments", "baby_notes", "care_providers", "event_types", "events", "formulas", "measurements", "medications",
        "note_reads", "prescription_proposals", "prescriptions", "vaccinations",
    ];

    /// <summary>The physical keys of the built-in database that leave the data plane: table.column -> principal table (on delete).</summary>
    private static readonly string[] CrossPlaneKeys =
    [
        "appointments.baby_id -> babies (Restrict)", "appointments.created_by -> users (Restrict)",
        "baby_notes.author_user_id -> users (Restrict)", "baby_notes.baby_id -> babies (Restrict)",
        "care_providers.baby_id -> babies (Restrict)", "care_providers.created_by -> users (Restrict)",
        "event_types.baby_id -> babies (Restrict)",
        "events.baby_id -> babies (Restrict)", "events.created_by -> users (Restrict)",
        "formulas.baby_id -> babies (Restrict)", "formulas.created_by -> users (Restrict)",
        "measurements.baby_id -> babies (Restrict)", "measurements.created_by -> users (Restrict)",
        "medications.baby_id -> babies (Restrict)", "medications.product_id -> products (SetNull)",
        "note_reads.baby_id -> babies (Restrict)", "note_reads.user_id -> users (Restrict)",
        "prescription_proposals.author_user_id -> users (Restrict)", "prescription_proposals.baby_id -> babies (Restrict)",
        "prescription_proposals.decided_by -> users (Restrict)",
        "prescriptions.baby_id -> babies (Restrict)", "prescriptions.created_by -> users (Restrict)",
        "vaccinations.baby_id -> babies (Restrict)", "vaccinations.created_by -> users (Restrict)",
    ];

    [Fact]
    public void DataContext_MapsExactlyTheDataTables()
    {
        using var data = ModelTestContext.CreateData();

        Assert.Equal(DataTables, TablesOf(data.DesignTimeModel()));
        Assert.Equal(DataTables, DataPlane.EntityTypes.Select(type => data.DesignTimeModel().FindEntityType(type)!.GetTableName()).Order().ToArray());
    }

    [Fact]
    public void ControlContext_StillMapsTheDataTablesOfTheBuiltInDatabase()
    {
        using var control = ModelTestContext.Create();

        Assert.Subset(TablesOf(control.DesignTimeModel()).ToHashSet(), DataTables.ToHashSet());
    }

    [Fact]
    public void DataModel_DeclaresNoForeignKeyToAControlTable()
    {
        using var data = ModelTestContext.CreateData();

        var leaving = data.DesignTimeModel().GetEntityTypes()
            .SelectMany(entity => entity.GetForeignKeys())
            .Where(key => !key.PrincipalEntityType.IsOwned() && !DataPlane.EntityTypes.Contains(key.PrincipalEntityType.ClrType))
            .Select(Describe)
            .ToArray();

        Assert.Empty(leaving);
    }

    [Fact]
    public void DataModel_KeepsTheKeysInsideThePlane()
    {
        using var data = ModelTestContext.CreateData();

        var keys = data.DesignTimeModel().GetEntityTypes()
            .Where(entity => !entity.IsOwned())
            .SelectMany(entity => entity.GetForeignKeys())
            .Select(Describe)
            .Order()
            .ToArray();

        Assert.Equal(["events.type_id -> event_types (Restrict)", "note_reads.note_id -> baby_notes (Cascade)"], keys);
    }

    [Fact]
    public void BuiltInDatabase_KeepsEveryKeyFromTheDataTablesToTheControlTables()
    {
        using var control = ModelTestContext.Create();

        var crossing = control.DesignTimeModel().GetEntityTypes()
            .Where(entity => DataPlane.EntityTypes.Contains(entity.ClrType))
            .SelectMany(entity => entity.GetForeignKeys())
            .Where(key => !DataPlane.EntityTypes.Contains(key.PrincipalEntityType.ClrType))
            .Select(Describe)
            .Order()
            .ToArray();

        Assert.Equal(CrossPlaneKeys, crossing);
    }

    [Fact]
    public void ControlTables_HaveNoKeyToADataTable()
    {
        using var control = ModelTestContext.Create();

        var intoData = control.DesignTimeModel().GetEntityTypes()
            .Where(entity => !entity.IsOwned() && !DataPlane.EntityTypes.Contains(entity.ClrType))
            .SelectMany(entity => entity.GetForeignKeys())
            .Where(key => DataPlane.EntityTypes.Contains(key.PrincipalEntityType.ClrType))
            .Select(Describe)
            .ToArray();

        Assert.Empty(intoData);
    }

    [Fact]
    public void DataTables_AreDescribedTheSameByBothContexts()
    {
        using var control = ModelTestContext.Create();
        using var data = ModelTestContext.CreateData();
        var builtIn = control.DesignTimeModel().GetRelationalModel();
        var dataModel = data.DesignTimeModel().GetRelationalModel();

        foreach (var name in DataTables)
        {
            var expected = builtIn.FindTable(name, null)!;
            var actual = dataModel.FindTable(name, null)!;
            Assert.Equal(Columns(expected), Columns(actual));
            Assert.Equal(Indexes(expected), Indexes(actual));
            Assert.Equal(PrimaryKey(expected), PrimaryKey(actual));
            Assert.Equal(expected.EntityTypeMappings.Select(mapping => mapping.TypeBase.ClrType).Order(TypeOrder), actual.EntityTypeMappings.Select(mapping => mapping.TypeBase.ClrType).Order(TypeOrder));
        }
    }

    [Theory]
    [InlineData(typeof(Lotties.Domain.Events.Event))]
    [InlineData(typeof(Lotties.Domain.EventTypes.EventType))]
    public void DataTables_KeepQueryFiltersAndSeeds(Type entityType)
    {
        using var control = ModelTestContext.Create();
        using var data = ModelTestContext.CreateData();
        var expected = control.DesignTimeModel().FindEntityType(entityType)!;
        var actual = data.DesignTimeModel().FindEntityType(entityType)!;

        Assert.Equal(expected.GetDeclaredQueryFilters().Count, actual.GetDeclaredQueryFilters().Count);
        Assert.Equal(expected.GetSeedData().Count(), actual.GetSeedData().Count());
    }

    private static readonly Comparer<Type> TypeOrder = Comparer<Type>.Create((left, right) => string.CompareOrdinal(left.FullName, right.FullName));

    private static string[] TablesOf(IModel model) =>
        model.GetEntityTypes().Where(entity => !entity.IsOwned()).Select(entity => entity.GetTableName()!).Distinct().Order().ToArray();

    private static string Describe(IForeignKey key) =>
        $"{key.DeclaringEntityType.GetTableName()}.{string.Join(",", key.Properties.Select(property => property.GetColumnName()))} -> {key.PrincipalEntityType.GetTableName()} ({key.DeleteBehavior})";

    private static string[] Columns(ITable table) =>
        table.Columns
            .Select(column => $"{column.Name} {column.StoreType} null={column.IsNullable} default={column.DefaultValue ?? column.DefaultValueSql} computed={column.ComputedColumnSql}")
            .Order()
            .ToArray();

    private static string[] Indexes(ITable table) =>
        table.Indexes
            .Select(index => $"{index.Name} ({string.Join(",", index.Columns.Select(column => column.Name))}) unique={index.IsUnique} filter={index.Filter}")
            .Order()
            .ToArray();

    private static string PrimaryKey(ITable table) =>
        $"{table.PrimaryKey!.Name} ({string.Join(",", table.PrimaryKey.Columns.Select(column => column.Name))})";
}
