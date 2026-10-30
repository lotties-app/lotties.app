using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Catalog.Official.Verification;
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

    private static CuratedProductEntry Entry(string id) => Assert.Single(Entries, entry => entry.Id == id);

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
    [InlineData("fly-gotas-drops", "Fly Gotas", ProductForm.Drops, "simethicone")]
    [InlineData("rinosoro-jet-infantil-spray", "Rinosoro Jet Infantil", ProductForm.Spray, "sodium_chloride")]
    [InlineData("sorine-jet-baby-spray", "Sorine Jet Baby", ProductForm.Spray, "sodium_chloride")]
    [InlineData("sorine-infantil-jet-baby-spray", "Sorine Infantil Jet Baby", ProductForm.Spray, "sodium_chloride")]
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
            product => Assert.Matches("Salina|Jet", product.Name));
        Assert.DoesNotContain(Plan.Products, product => product.NormalizedName is "sorine" or "rinosoro");
    }

    [Fact]
    public void List_ColidisIsTheProbioticNotSimethicone()
    {
        Assert.DoesNotContain("simethicone", Product("colidis-drops").SubstanceKeys);
    }

    [Fact]
    public void List_PackagingFacts_AreRecordedAsPrinted()
    {
        Assert.Equal(("9 mg/mL (0,9%); 100 mL", "medicine"), (Product("rinosoro-jet-infantil-spray").Presentation, Entry("rinosoro-jet-infantil-spray").Category));
        Assert.Equal(("0,9% (9 mg/mL); 100 mL", "medicine"), (Product("sorine-jet-baby-spray").Presentation, Entry("sorine-jet-baby-spray").Category));
        Assert.Equal(("150 mg/mL; 15 mL", "medicine"), (Product("fly-gotas-drops").Presentation, Entry("fly-gotas-drops").Category));
        Assert.Equal(("10 mL", "supplement"), (Product("colidis-drops").Presentation, Entry("colidis-drops").Category));
        Assert.Equal("homeopathic", Entry("colicaliv-drops").Category);
        Assert.All(Entries, entry => Assert.True(entry.Category is null || CuratedCatalogPlanner.Categories.Contains(entry.Category), entry.Id));
        Assert.All(Entries.Where(entry => entry.Id is "rinosoro-jet-infantil-spray" or "sorine-jet-baby-spray" or "fly-gotas-drops" or "colicaliv-drops" or "colidis-drops"),
            entry => Assert.Contains("packaging photo provided by the owner, 2026-10-23", entry.Basis, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void List_FlygasIsOnlyAnAliasOfFlyGotas_AndSoIsTheStoreNameOfSorineJetBaby()
    {
        Assert.Equal("fly-gotas-drops", Entry("flygas-drops").AliasOf);
        Assert.Equal("sorine-jet-baby-spray", Entry("sorine-infantil-jet-baby-spray").AliasOf);
        Assert.Equal(["flygas-drops", "sorine-infantil-jet-baby-spray"], Entries.Where(entry => entry.AliasOf is not null).Select(entry => entry.Id));
    }

    [Fact]
    public void List_ColicalivIsFourHomeopathicIngredientsAndNeverEquivalentToSimethiconeOrAnyOtherEntry()
    {
        var ids = Plan.Products.SelectMany(product => product.SubstanceKeys).Distinct().ToDictionary(key => key, _ => Guid.NewGuid());
        var pool = Plan.Products
            .Where(product => product.AliasOfExternalRef is null)
            .Select(product => Lotties.Domain.Catalog.Product.FromSource(Guid.NewGuid(), new SourcedProductData(product.Name, product.Form, product.Presentation, product.Status, product.Source, product.ExternalRef, product.SubstanceKeys.Select(key => ids[key]).ToArray(), product.AmbiguousName, product.StrengthKey, product.StrengthText), CountryCode.From("BR"), DateTimeOffset.UnixEpoch))
            .ToArray();
        var colicaliv = pool.Single(product => product.ExternalRef == "colicaliv-drops");
        var flyGotas = pool.Single(product => product.ExternalRef == "fly-gotas-drops");

        Assert.Equal(4, Product("colicaliv-drops").SubstanceKeys.Count);
        Assert.DoesNotContain("simethicone", Product("colicaliv-drops").SubstanceKeys);
        Assert.Empty(ProductSearch.SameActiveIngredient(colicaliv, pool));
        Assert.All(pool.Where(product => product.Id != colicaliv.Id), other => Assert.DoesNotContain("Colicaliv", ProductSearch.SameActiveIngredient(other, pool).Select(sibling => sibling.Name)));
        Assert.Equal(["Luftal"], ProductSearch.SameActiveIngredient(flyGotas, pool).Select(sibling => sibling.Name));
    }

    [Fact]
    public void List_StructuredStrengths_AreStatedOnlyWhereTheLabelOrBasisStatesThem()
    {
        Assert.Equal("simethicone=150 mg/ml", Product("fly-gotas-drops").StrengthKey);
        Assert.Equal("simethicone=75 mg/ml", Product("luftal-drops").StrengthKey);
        Assert.Equal("sodium_chloride=9 mg/ml", Product("rinosoro-jet-infantil-spray").StrengthKey);
        Assert.Equal("sodium_chloride=9 mg/ml", Product("sorine-jet-baby-spray").StrengthKey);
        Assert.Equal("limosilactobacillus_reuteri=strain:dsm 17938", Product("colidis-drops").StrengthKey);
        Assert.Equal(
            "colocynthis_6ch=0.25 ml/ml;magnesia_phosphorica_5ch=0.25 ml/ml;matricaria_chamomilla_4ch=0.25 ml/ml;mentha_piperita_6ch=0.25 ml/ml",
            Product("colicaliv-drops").StrengthKey);
        Assert.All(Entries.Where(entry => entry.Id is "sorine-saline-spray" or "sorine-saline-drops" or "rinosoro-saline-spray" or "rinosoro-saline-drops" or "flygas-drops" or "sorine-infantil-jet-baby-spray"),
            entry => Assert.Null(Product(entry.Id).StrengthKey));
        Assert.All(Entries.Where(entry => entry.Strengths is not null), entry => Assert.False(string.IsNullOrWhiteSpace(Product(entry.Id).StrengthText), entry.Id));
    }

    [Fact]
    public void List_Alternatives_SeparateFlyGotasFromLuftal_AndKeepTheUnknownSalinesApartFromTheIsotonicOnes()
    {
        var ids = Plan.Products.SelectMany(product => product.SubstanceKeys).Distinct().ToDictionary(key => key, _ => Guid.NewGuid());
        var pool = Plan.Products
            .Where(product => product.AliasOfExternalRef is null)
            .Select(product => Lotties.Domain.Catalog.Product.FromSource(Guid.NewGuid(), new SourcedProductData(product.Name, product.Form, product.Presentation, product.Status, product.Source, product.ExternalRef, product.SubstanceKeys.Select(key => ids[key]).ToArray(), product.AmbiguousName, product.StrengthKey, product.StrengthText), CountryCode.From("BR"), DateTimeOffset.UnixEpoch))
            .ToArray();
        string Level(string from, string to) => ProductSearch.Alternatives(pool.Single(product => product.ExternalRef == from), pool).Single(alternative => alternative.Product.ExternalRef == to).Level.ToString();

        Assert.Equal("DifferentStrength", Level("fly-gotas-drops", "luftal-drops"));
        Assert.Equal("DifferentStrength", Level("luftal-drops", "fly-gotas-drops"));
        Assert.Equal("Equivalent", Level("rinosoro-jet-infantil-spray", "sorine-jet-baby-spray"));
        Assert.Equal("StrengthNotKnown", Level("rinosoro-jet-infantil-spray", "rinosoro-saline-spray"));
        Assert.Equal("StrengthNotKnown", Level("sorine-saline-drops", "rinosoro-saline-drops"));
        Assert.Equal("StrengthNotKnown", Level("sorine-saline-spray", "sorine-jet-baby-spray"));
        Assert.DoesNotContain(ProductSearch.Alternatives(pool.Single(product => product.ExternalRef == "rinosoro-jet-infantil-spray"), pool), alternative => alternative.Level == AlternativeLevel.Equivalent && alternative.Product.ExternalRef != "sorine-jet-baby-spray");
    }

    [Fact]
    public void List_NoCategoryClashAndNoAliasProblem_AndSupplementsAndHomeopathicsHaveNoMedicineAlternatives()
    {
        var dictionary = CuratedSubstances.Dictionary();
        var verifier = new CuratedVerifier([], [], dictionary);

        var report = CuratedVerificationRunner.Run(Entries, verifier, dictionary, OfficialCatalogPlanner.Plan([], [], dictionary), new DateOnly(2026, 10, 23));

        Assert.DoesNotContain(report.Alternatives, alternative => alternative.EntryId is "colidis-drops" or "colicaliv-drops" || alternative.AlternativeName is "Colidis" or "Colicaliv");
        Assert.DoesNotContain(report.Findings, finding => finding.Code is "CATEGORY_EQUIVALENCE" or "ALIAS_TARGET");
    }

    [Fact]
    public void Parse_UnknownFormOrMissingReviewFlag_Throws()
    {
        Assert.Throws<ArgumentException>(() => CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"capsule","ingredients":["simeticona"],"reviewed":false,"basis":"b"}]}"""));
        Assert.Throws<ArgumentException>(() => CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"basis":"b"}]}"""));
        Assert.Throws<ArgumentException>(() => CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"reviewed":false,"basis":""}]}"""));
    }

    [Fact]
    public void List_RecordedAnvisaChecks_AreWellFormedAndNeverMeanAPharmacistReview()
    {
        var statuses = Enum.GetValues<VerificationStatus>().Select(CuratedVerificationRunner.StatusCode).ToHashSet(StringComparer.Ordinal);

        Assert.All(Entries.Where(entry => entry.AnvisaCheck is not null), entry =>
        {
            var check = entry.AnvisaCheck!;
            Assert.Contains(check.Status, statuses);
            Assert.True(DateOnly.TryParseExact(check.Date, "yyyy-MM-dd", out _), entry.Id);
            Assert.False(entry.Reviewed, entry.Id);
            Assert.True(check.Status != "VERIFIED" || check.Evidence.Count > 0, $"{entry.Id}: VERIFIED needs its evidence references");
        });
        Assert.All(Entries, entry => Assert.NotNull(entry.AnvisaCheck));
    }

    [Fact]
    public void List_HasNoInternalInconsistency_WhateverTheOfficialData()
    {
        var dictionary = CuratedSubstances.Dictionary();
        var verifier = new CuratedVerifier([], [], dictionary);

        var report = CuratedVerificationRunner.Run(Entries, verifier, dictionary, OfficialCatalogPlanner.Plan([], [], dictionary), new DateOnly(2026, 10, 23));

        Assert.DoesNotContain(report.Findings, finding => finding.Severity == FindingSeverity.Error && finding.Code != "STALE_CHECK");
        Assert.DoesNotContain(report.Findings, finding => finding.Code is "UNMAPPED_INGREDIENT" or "EQUIVALENCE_SPLIT" or "EMPTY_INGREDIENTS");
    }

    [Fact]
    public void Parse_LabelFieldsAreRead()
    {
        var entry = Assert.Single(CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"reviewed":false,"basis":"b","strength":"150 mg/mL","packageSize":"15 mL","category":"medicine","aliasOf":"y-1"}]}"""));

        Assert.Equal(("150 mg/mL", "15 mL", "medicine", "y-1"), (entry.Strength, entry.PackageSize, entry.Category, entry.AliasOf));
    }

    [Fact]
    public void Parse_StructuredStrengthsAreRead()
    {
        var entry = Assert.Single(CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"reviewed":false,"basis":"b","strengths":[{"ingredient":"simeticona","amount":"150","unit":"mg/mL"},{"ingredient":"x","strain":"DSM 1"}]}]}"""));

        Assert.Equal([new CuratedStrength("simeticona", "150", "mg/mL"), new CuratedStrength("x", null, null, "DSM 1")], entry.Strengths);
    }

    [Fact]
    public void Parse_OptionalVerifierFieldsAreRead()
    {
        var entry = Assert.Single(CuratedProducts.Parse("""{"products":[{"id":"x-1","name":"X","form":"drops","ingredients":["simeticona"],"reviewed":false,"basis":"b","officialName":"Xx","registration":"1.0000.0001","route":"oral","anvisaCheck":{"date":"2026-10-23","status":"NOT_FOUND","evidence":["r1"]}}]}"""));

        Assert.Equal(("Xx", "1.0000.0001", "oral"), (entry.OfficialName, entry.Registration, entry.Route));
        Assert.Equal(new AnvisaCheck("2026-10-23", "NOT_FOUND", ["r1"]).Status, entry.AnvisaCheck!.Status);
        Assert.Equal(["r1"], entry.AnvisaCheck.Evidence);
    }
}
