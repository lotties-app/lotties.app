using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Infrastructure.Catalog.Official;

namespace Lotties.Infrastructure.Tests.Catalog;

/// <summary>
/// The importer's curated product list (<c>code/api/tools/Lotties.CatalogImporter/Data/curated-products.json</c>, linked
/// into the test output): it parses and plans, nothing in it is marked reviewed, and the entries say what they say.
/// </summary>
public sealed class CuratedProductListTests
{
    private static readonly IReadOnlyList<CuratedProductEntry> Entries =
        CuratedProducts.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Catalog", CuratedProducts.FileName)));

    private static readonly CuratedCatalogPlan Plan = CuratedCatalogPlanner.Plan(Entries, CuratedSubstances.Dictionary());

    private static CatalogProductPlan Product(string id) => Assert.Single(Plan.Products, product => product.ExternalRef == id);

    [Fact]
    public void List_PlansAsUnreviewedCuratedProductsWithIngredientsAndABasis()
    {
        Assert.NotEmpty(Plan.Products);
        Assert.All(Entries, entry => Assert.False(entry.Reviewed, entry.Id));
        Assert.All(Entries, entry => Assert.False(string.IsNullOrWhiteSpace(entry.Basis), entry.Id));
        Assert.All(Plan.Products, product => Assert.Equal(("curated", ProductStatus.Curated), (product.Source, product.Status)));
        Assert.All(Plan.Products, product => Assert.NotEmpty(product.SubstanceKeys));
        Assert.All(Plan.Substances, substance => Assert.True(substance.Curated, substance.Key));
    }

    [Theory]
    [InlineData("flygas-drops", "Flygas", ProductForm.Drops, "simethicone")]
    [InlineData("luftal-drops", "Luftal", ProductForm.Drops, "simethicone")]
    [InlineData("colidis-drops", "Colidis", ProductForm.Drops, "limosilactobacillus_reuteri")]
    [InlineData("sorine-saline-spray", "Sorine Solução Nasal Salina", ProductForm.Spray, "sodium_chloride")]
    [InlineData("sorine-saline-drops", "Sorine Solução Nasal Salina", ProductForm.Drops, "sodium_chloride")]
    [InlineData("rinosoro-saline-spray", "Rinosoro Solução Nasal Salina", ProductForm.Spray, "sodium_chloride")]
    [InlineData("rinosoro-saline-drops", "Rinosoro Solução Nasal Salina", ProductForm.Drops, "sodium_chloride")]
    public void List_HasTheRequestedProducts(string id, string name, ProductForm form, string substanceKey)
    {
        var product = Product(id);

        Assert.Equal((name, form), (product.Name, product.Form));
        Assert.Equal([substanceKey], product.SubstanceKeys);
    }

    [Fact]
    public void List_SalineVariantsAreNamedApartFromTheRegisteredNaphazolineSorine()
    {
        Assert.All(
            Plan.Products.Where(product => product.SubstanceKeys.Contains("sodium_chloride")),
            product => Assert.Contains("Salina", product.Name, StringComparison.Ordinal));
        Assert.DoesNotContain(Plan.Products, product => product.NormalizedName is "sorine" or "rinosoro");
    }

    [Fact]
    public void List_ColidisIsTheProbioticNotSimethicone()
    {
        Assert.DoesNotContain("simethicone", Product("colidis-drops").SubstanceKeys);
    }

    [Fact]
    public void Parse_UnknownFormOrMissingReviewFlag_Throws()
    {
        Assert.Throws<ArgumentException>(() => CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"capsule","ingredients":["simeticona"],"reviewed":false,"basis":"b"}]}"""));
        Assert.Throws<ArgumentException>(() => CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"basis":"b"}]}"""));
        Assert.Throws<ArgumentException>(() => CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"reviewed":false,"basis":""}]}"""));
    }
}
