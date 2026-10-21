using BabyRoutine.Domain.Catalog;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.Catalog;

internal static class CatalogData
{
    public static readonly Substance Simethicone = Substance.Seed(Guid.NewGuid(), "simethicone", "Simethicone", "Simeticona", [], TestClock.Now);
    public static readonly Substance Paracetamol = Substance.Seed(Guid.NewGuid(), "paracetamol", "Paracetamol", "Paracetamol", ["Acetaminophen"], TestClock.Now);
    public static readonly Substance Metamizole = Substance.Seed(Guid.NewGuid(), "metamizole", "Metamizole", "Dipirona", ["Dipyrone"], TestClock.Now);
    public static readonly IReadOnlySet<Guid> KnownIds = new HashSet<Guid> { Simethicone.Id, Paracetamol.Id, Metamizole.Id };
    public static readonly CountryCode Brazil = CountryCode.From("BR");

    public static Product Community(string name, params Substance[] substances) =>
        Product.CreateCommunity(name, ProductForm.Drops, Brazil, substances.Select(substance => new ProductIngredient(substance.Id, null)).ToArray(), KnownIds, Guid.NewGuid(), TestClock.Now);
}

public sealed class ProductNamesTests
{
    [Theory]
    [InlineData("Flygas", "flygas")]
    [InlineData("  Fly-Gass ", "flygas")]
    [InlineData("FLÝGAS", "flygas")]
    [InlineData("Luftal Gotas 75 mg/mL", "luftalgotas75mgml")]
    [InlineData("Vitamina D 1000", "vitaminad1000")]
    [InlineData("Colidis!!", "colidis")]
    public void Key_NormalizesCaseDiacriticsPunctuationAndRepeatedLetters(string name, string expected)
    {
        var key = ProductNames.Key(name);

        Assert.Equal(expected, key);
    }

    [Fact]
    public void Key_KeepsRepeatedDigits()
    {
        Assert.Equal("d1000", ProductNames.Key("D 1000"));
    }

    [Fact]
    public void Sanitize_CollapsesWhitespaceAndTrims()
    {
        var name = ProductNames.Sanitize("  Luftal \t  Gotas  ", "name", 100);

        Assert.Equal("Luftal Gotas", name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a")]
    [InlineData("-- !")]
    [InlineData("Luf\u0000tal")]
    [InlineData("Luf\u0007tal")]
    public void Sanitize_Invalid_ThrowsValidationForTheField(string name)
    {
        var exception = Assert.Throws<DomainValidationException>(() => ProductNames.Sanitize(name, "name", 100));

        Assert.Equal("name", exception.Field);
    }

    [Fact]
    public void Sanitize_TooLong_Throws()
    {
        Assert.Throws<DomainValidationException>(() => ProductNames.Sanitize(new string('a', 101), "name", 100));
    }
}

public sealed class ProductTests
{
    [Fact]
    public void CreateCommunity_ValidInput_StoresKeyStatusAndSubstances()
    {
        var product = Product.CreateCommunity(
            " Flygas ",
            ProductForm.Drops,
            CountryCode.From("br"),
            [new ProductIngredient(CatalogData.Simethicone.Id, SubstanceStrength.Create(75, "mg", 1, "mL"))],
            CatalogData.KnownIds,
            Guid.NewGuid(),
            TestClock.Now);

        Assert.Equal(("Flygas", "flygas", ProductStatus.Community, "BR"), (product.Name, product.NormalizedName, product.Status, product.Country.Value));
        var link = Assert.Single(product.Substances);
        Assert.Equal((CatalogData.Simethicone.Id, 75m, "mg", 1m, "mL"), (link.SubstanceId, link.Strength!.Amount, link.Strength.Unit, link.Strength.PerAmount, link.Strength.PerUnit));
    }

    [Fact]
    public void CreateCommunity_UnknownSubstance_ThrowsWithTheIds()
    {
        var unknown = Guid.NewGuid();

        var exception = Assert.Throws<SubstanceNotFoundException>(() =>
            Product.CreateCommunity("X drops", ProductForm.Drops, CatalogData.Brazil, [new ProductIngredient(unknown, null)], CatalogData.KnownIds, Guid.NewGuid(), TestClock.Now));

        Assert.Equal([unknown], exception.SubstanceIds);
    }

    [Fact]
    public void CreateCommunity_SameSubstanceTwice_Throws()
    {
        var twice = new[] { new ProductIngredient(CatalogData.Simethicone.Id, null), new ProductIngredient(CatalogData.Simethicone.Id, null) };

        var exception = Assert.Throws<DomainValidationException>(() =>
            Product.CreateCommunity("X drops", ProductForm.Drops, CatalogData.Brazil, twice, CatalogData.KnownIds, Guid.NewGuid(), TestClock.Now));

        Assert.Equal("substances", exception.Field);
    }

    [Fact]
    public void CreateCommunity_UndefinedForm_Throws()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            Product.CreateCommunity("X drops", (ProductForm)42, CatalogData.Brazil, [], CatalogData.KnownIds, Guid.NewGuid(), TestClock.Now));

        Assert.Equal("form", exception.Field);
    }

    [Theory]
    [InlineData("B")]
    [InlineData("BRA")]
    [InlineData("1R")]
    [InlineData(null)]
    public void CountryCode_Invalid_Throws(string? value)
    {
        var exception = Assert.Throws<DomainValidationException>(() => CountryCode.From(value));

        Assert.Equal("country", exception.Field);
    }

    [Theory]
    [InlineData(0, "mg", null, null, "strength.amount")]
    [InlineData(1, " ", null, null, "strength.unit")]
    [InlineData(1, "mg", 1.0, null, "strength.perUnit")]
    [InlineData(1, "mg", null, "mL", "strength.perUnit")]
    [InlineData(1, "mg", 0.0, "mL", "strength.perAmount")]
    public void SubstanceStrength_Invalid_ThrowsForTheField(double amount, string unit, double? perAmount, string? perUnit, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => SubstanceStrength.Create((decimal)amount, unit, (decimal?)perAmount, perUnit));

        Assert.Equal(field, exception.Field);
    }

    [Fact]
    public void HasSameActiveIngredientsAs_EqualSets_IsTrueAndEmptySetsNever()
    {
        var luftal = CatalogData.Community("Luftal", CatalogData.Simethicone);
        var flygas = CatalogData.Community("Flygas", CatalogData.Simethicone);
        var mix = CatalogData.Community("Mix", CatalogData.Simethicone, CatalogData.Paracetamol);

        Assert.True(luftal.HasSameActiveIngredientsAs(flygas));
        Assert.False(luftal.HasSameActiveIngredientsAs(mix));
        Assert.False(CatalogData.Community("Empty").HasSameActiveIngredientsAs(CatalogData.Community("Other")));
    }

    [Fact]
    public void Duplicates_SameKeyFormAndCountry_IsTrue()
    {
        var product = CatalogData.Community("Flygas", CatalogData.Simethicone);

        Assert.True(product.Duplicates("flygas", ProductForm.Drops, CatalogData.Brazil));
        Assert.False(product.Duplicates("flygas", ProductForm.Syrup, CatalogData.Brazil));
        Assert.False(product.Duplicates("flygas", ProductForm.Drops, CountryCode.From("PT")));
    }

    [Fact]
    public void MergeInto_AnotherProduct_MakesItAnAlias()
    {
        var target = CatalogData.Community("Luftal", CatalogData.Simethicone);
        var duplicate = CatalogData.Community("Luftall", CatalogData.Simethicone);

        duplicate.MergeInto(target);

        Assert.Equal(target.Id, duplicate.MergedIntoId);
        Assert.False(duplicate.Duplicates("luftal", ProductForm.Drops, CatalogData.Brazil));
    }

    [Fact]
    public void MergeInto_ItselfOrAMergedTargetOrTwice_Throws()
    {
        var target = CatalogData.Community("Luftal");
        var merged = CatalogData.Community("Old");
        merged.MergeInto(target);

        Assert.Throws<DomainValidationException>(() => target.MergeInto(target));
        Assert.Throws<DomainValidationException>(() => CatalogData.Community("New").MergeInto(merged));
        Assert.Throws<DomainValidationException>(() => merged.MergeInto(CatalogData.Community("Other")));
    }

    [Fact]
    public void Substance_SearchNames_IncludeKeyBothLanguagesAndSynonyms()
    {
        Assert.Equal(["metamizole", "Metamizole", "Dipirona", "Dipyrone"], CatalogData.Metamizole.SearchNames);
    }

    [Fact]
    public void Substance_SynonymWithSeparator_Throws()
    {
        Assert.Throws<DomainValidationException>(() => Substance.Seed(Guid.NewGuid(), "x_y", "X", "X", ["a|b"], TestClock.Now));
    }
}

public sealed class ProductSearchTests
{
    private static IReadOnlyList<ProductMatch> Search(string text, IReadOnlyList<Product> names, IReadOnlyList<Product>? targets = null, IReadOnlyList<Product>? bySubstance = null, int limit = 10) =>
        ProductSearch.Rank(CatalogQuery.From(text), names, targets ?? [], bySubstance ?? [], limit);

    [Fact]
    public void Rank_ExactBeforePrefixBeforeTypo()
    {
        var flygas = CatalogData.Community("Flygas", CatalogData.Simethicone);
        var flygasPlus = CatalogData.Community("Flygas Plus", CatalogData.Simethicone);
        var flagas = CatalogData.Community("Flagas", CatalogData.Simethicone);

        var matches = Search("flygas", [flagas, flygasPlus, flygas]);

        Assert.Equal(["Flygas", "Flygas Plus", "Flagas"], matches.Select(match => match.Product.Name));
        Assert.Equal([0, 1, 2], matches.Select(match => match.Rank));
        Assert.Equal(1, matches[2].Distance);
    }

    [Fact]
    public void Rank_TypoBeyondTolerance_IsNotAMatch()
    {
        var matches = Search("luftal", [CatalogData.Community("Colidis")]);

        Assert.Empty(matches);
    }

    [Fact]
    public void Rank_MergedProduct_ResolvesToItsTargetAsAlias()
    {
        var target = CatalogData.Community("Luftal", CatalogData.Simethicone);
        var merged = MergedInto(CatalogData.Community("Luftal gotinhas"), target);

        var match = Assert.Single(Search("luftal got", [merged], [target]));

        Assert.Equal((target.Id, CatalogMatchKind.Alias), (match.Product.Id, match.MatchedBy));
    }

    [Fact]
    public void Rank_MergedProductWithoutLoadedTarget_IsDropped()
    {
        var merged = MergedInto(CatalogData.Community("Luftal gotinhas"), CatalogData.Community("Elsewhere"));

        Assert.Empty(Search("luftal", [merged]));
    }

    [Fact]
    public void Rank_SubstanceProducts_ComeAfterNameMatchesAndAreDeduplicated()
    {
        var luftal = CatalogData.Community("Luftal", CatalogData.Simethicone);
        var simeco = CatalogData.Community("Simeco", CatalogData.Simethicone);

        var matches = Search("simeticona", [], bySubstance: [luftal, simeco, luftal]);

        Assert.Equal([CatalogMatchKind.Substance, CatalogMatchKind.Substance], matches.Select(match => match.MatchedBy));
        Assert.Equal(["Luftal", "Simeco"], matches.Select(match => match.Product.Name));
    }

    [Fact]
    public void Rank_ProductMatchedByNameAndSubstance_KeepsTheNameMatch()
    {
        var luftal = CatalogData.Community("Luftal", CatalogData.Simethicone);

        var match = Assert.Single(Search("luftal", [luftal], bySubstance: [luftal]));

        Assert.Equal(CatalogMatchKind.Name, match.MatchedBy);
    }

    [Fact]
    public void Rank_RespectsLimit()
    {
        var products = Enumerable.Range(1, 5).Select(index => CatalogData.Community($"Luftal {index}")).ToArray();

        Assert.Equal(2, Search("luftal", products, limit: 2).Count);
    }

    [Theory]
    [InlineData("simeticona")]
    [InlineData("Simethicone")]
    [InlineData("simetic")]
    [InlineData("simeticna")]
    public void MatchSubstances_MatchesEitherLanguagePrefixAndTypos(string text)
    {
        var matches = ProductSearch.MatchSubstances(CatalogQuery.From(text), [CatalogData.Simethicone, CatalogData.Paracetamol]);

        Assert.Equal(CatalogData.Simethicone.Id, Assert.Single(matches).Substance.Id);
    }

    [Theory]
    [InlineData("acetaminophen", "paracetamol")]
    [InlineData("dipyrone", "metamizole")]
    [InlineData("dipirona", "metamizole")]
    public void MatchSubstances_MatchesSynonyms(string text, string expectedKey)
    {
        var matches = ProductSearch.MatchSubstances(CatalogQuery.From(text), [CatalogData.Simethicone, CatalogData.Paracetamol, CatalogData.Metamizole]);

        Assert.Equal(expectedKey, Assert.Single(matches).Substance.Key);
    }

    [Fact]
    public void SameActiveIngredient_ListsOtherNonMergedProductsWithTheSameSet()
    {
        var luftal = CatalogData.Community("Luftal", CatalogData.Simethicone);
        var flygas = CatalogData.Community("Flygas", CatalogData.Simethicone);
        var mix = CatalogData.Community("Mix", CatalogData.Simethicone, CatalogData.Paracetamol);
        var merged = MergedInto(CatalogData.Community("Old", CatalogData.Simethicone), flygas);

        var siblings = ProductSearch.SameActiveIngredient(luftal, [luftal, flygas, mix, merged]);

        Assert.Equal([flygas.Id], siblings.Select(sibling => sibling.Id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a")]
    [InlineData("--")]
    public void CatalogQuery_TooShort_ThrowsForQ(string? text)
    {
        var exception = Assert.Throws<DomainValidationException>(() => CatalogQuery.From(text));

        Assert.Equal("q", exception.Field);
    }

    [Fact]
    public void CatalogQuery_TooLong_Throws()
    {
        Assert.Throws<DomainValidationException>(() => CatalogQuery.From(new string('a', 101)));
    }

    [Fact]
    public void CatalogQuery_CandidateFilter_UsesPrefixAndLengthBucket()
    {
        var filter = CatalogQuery.From("Flygas").CandidateFilter;

        Assert.Equal(new ProductCandidateFilter("flygas", "f", "s", 4, 8), filter);
    }

    [Theory]
    [InlineData(null, 10)]
    [InlineData(1, 1)]
    [InlineData(20, 20)]
    public void ValidLimit_InRange_ReturnsIt(int? limit, int expected)
    {
        Assert.Equal(expected, ProductSearch.ValidLimit(limit));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(21)]
    public void ValidLimit_OutOfRange_Throws(int limit)
    {
        Assert.Equal("limit", Assert.Throws<DomainValidationException>(() => ProductSearch.ValidLimit(limit)).Field);
    }

    private static Product MergedInto(Product product, Product target)
    {
        product.MergeInto(target);
        return product;
    }
}
