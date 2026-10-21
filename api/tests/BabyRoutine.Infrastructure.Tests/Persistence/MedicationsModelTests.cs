using BabyRoutine.Domain.Catalog;
using BabyRoutine.Domain.Medications;
using BabyRoutine.Domain.Prescriptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

/// <summary>Model and migration checks of the medications catalog, prescriptions and the medication product link.</summary>
public sealed class MedicationsModelTests
{
    [Fact]
    public void Products_AreUniqueByNormalizedNameFormAndCountryWhileNotMerged()
    {
        using var context = ModelTestContext.Create();

        var index = context.Entity<Product>().GetIndexes().Single(candidate => candidate.IsUnique);

        Assert.Equal(["NormalizedName", "Form", "Country"], index.Properties.Select(property => property.Name));
        Assert.Equal("merged_into_id IS NULL", index.GetFilter());
    }

    [Fact]
    public void Medications_ProductLinkIsNullableAndClearedWhenTheProductIsDeleted()
    {
        using var context = ModelTestContext.Create();
        var medication = context.Entity<Medication>();

        var foreignKey = medication.GetForeignKeys().Single(key => key.PrincipalEntityType.ClrType == typeof(Product));

        Assert.True(medication.FindProperty(nameof(Medication.ProductId))!.IsNullable);
        Assert.Equal(DeleteBehavior.SetNull, foreignKey.DeleteBehavior);
    }

    [Fact]
    public void Prescriptions_HaveDeltaIndexAndNoMedicationForeignKey()
    {
        using var context = ModelTestContext.Create();
        var prescription = context.Entity<Prescription>();

        var indexes = prescription.GetIndexes().Select(index => string.Join(',', index.Properties.Select(property => property.GetColumnName()))).ToArray();

        Assert.Contains("baby_id,updated_at", indexes);
        Assert.Contains("baby_id,medication_id", indexes);
        Assert.DoesNotContain(prescription.GetForeignKeys(), key => key.PrincipalEntityType.ClrType == typeof(Medication));
        Assert.Empty(context.Prescriptions.ToQueryString().Split("WHERE").Skip(1));
    }

    [Fact]
    public void Prescriptions_FlattenDoseAndScheduleIntoColumns()
    {
        using var context = ModelTestContext.Create();

        var sql = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("dose_per_kg boolean NOT NULL", sql, StringComparison.Ordinal);
        Assert.Contains("times_of_day character varying(144)", sql, StringComparison.Ordinal);
        Assert.Contains("max_doses_per_24h integer", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void IdempotentScript_SeedsSubstancesWithoutDosingAndLinksMedicationsWithSetNull()
    {
        using var context = ModelTestContext.Create();

        var script = context.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);

        Assert.Contains("'simethicone', 'Simethicone', 'Simeticona'", script, StringComparison.Ordinal);
        Assert.Contains("'metamizole', 'Metamizole', 'Dipirona', 'Dipyrone'", script, StringComparison.Ordinal);
        Assert.Contains("ALTER TABLE medications ADD product_id uuid;", script, StringComparison.Ordinal);
        Assert.Contains("REFERENCES products (id) ON DELETE SET NULL", script, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE INDEX ix_products_normalized_name_form_country ON products (normalized_name, form, country) WHERE merged_into_id IS NULL;", script, StringComparison.Ordinal);
        Assert.DoesNotContain("INSERT INTO products", script, StringComparison.Ordinal);
    }

    [Fact]
    public void Converters_RoundTripTimesOfDayAndSynonyms()
    {
        using var context = ModelTestContext.Create();
        var times = context.DesignTimeModel().FindEntityType(typeof(PrescriptionSchedule))!.FindProperty(nameof(PrescriptionSchedule.TimesOfDay))!.GetTypeMapping().Converter!;
        var synonyms = context.Entity<Substance>().FindProperty(nameof(Substance.Synonyms))!.GetTypeMapping().Converter!;

        var storedTimes = (string)times.ConvertToProvider(TimesOfDay.Parse(["20:00", "08:00"]))!;
        var storedSynonyms = (string)synonyms.ConvertToProvider(new[] { "Acetaminophen", "APAP" })!;

        Assert.Equal("08:00,20:00", storedTimes);
        Assert.Equal(TimesOfDay.Parse(["08:00", "20:00"]), times.ConvertFromProvider(storedTimes));
        Assert.Equal("Acetaminophen|APAP", storedSynonyms);
        Assert.Equal(["Acetaminophen", "APAP"], (IReadOnlyList<string>)synonyms.ConvertFromProvider(storedSynonyms)!);
        Assert.Empty((IReadOnlyList<string>)synonyms.ConvertFromProvider(string.Empty)!);
    }
}
