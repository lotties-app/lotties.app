using Lotties.Domain.Formulas;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the per-baby formulas.</summary>
public sealed class FormulasModelTests
{
    [Fact]
    public void Formulas_OneCurrentPerBabyIsAPartialUniqueIndex()
    {
        using var context = ModelTestContext.Create();

        var index = context.Entity<Formula>().GetIndexes().Single(candidate => candidate.IsUnique);

        Assert.Equal(["BabyId"], index.Properties.Select(property => property.Name));
        Assert.Equal("is_current", index.GetFilter());
        Assert.Equal("ux_formulas_one_current_per_baby", index.GetDatabaseName());
    }

    [Fact]
    public void Formulas_HaveADeltaIndexAndTheBabyCannotBeDeletedUnderThem()
    {
        using var context = ModelTestContext.Create();
        var formula = context.Entity<Formula>();

        var delta = formula.GetIndexes().Single(candidate => candidate.Properties.Count == 2);
        var babyKey = formula.GetForeignKeys().Single(key => key.Properties[0].Name == nameof(Formula.BabyId));

        Assert.Equal(["BabyId", "UpdatedAt"], delta.Properties.Select(property => property.Name));
        Assert.Equal(DeleteBehavior.Restrict, babyKey.DeleteBehavior);
        Assert.Equal((60, 60, 10, 1000), (formula.FindProperty("Name")!.GetMaxLength(), formula.FindProperty("Brand")!.GetMaxLength(), formula.FindProperty("Stage")!.GetMaxLength(), formula.FindProperty("Notes")!.GetMaxLength()));
    }

    [Fact]
    public void IdempotentScript_CreatesFormulasAndDeclaresTheFeedingFormulaFieldsWithoutTouchingEvents()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        var section = script[script.IndexOf("_Formulas'", StringComparison.Ordinal)..];

        Assert.Contains("CREATE TABLE formulas (", section, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE INDEX ux_formulas_one_current_per_baby ON formulas (baby_id) WHERE is_current;", section, StringComparison.Ordinal);
        Assert.Contains("{\"key\":\"formula_id\",\"label\":\"Formula\",\"kind\":\"text\",\"isRequired\":false,\"visibleWhen\":{\"field\":\"bottle_feeding_type\",\"equals\":[\"formula\"]},\"hidden\":true}", section, StringComparison.Ordinal);
        Assert.DoesNotContain("UPDATE events", section, StringComparison.Ordinal);
        Assert.DoesNotContain("DELETE FROM", section, StringComparison.Ordinal);
    }
}
