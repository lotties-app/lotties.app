using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Catalog;

internal static class OfficialData
{
    public static readonly SubstanceDictionary Dictionary = SubstanceDictionary.Create(
    [
        new CuratedSubstance("simethicone", "Simethicone", "Simeticona", ["simeticona"], []),
        new CuratedSubstance("metamizole", "Metamizole", "Dipirona", ["dipirona", "dipirona monoidratada", "dipirona sódica"], ["Dipyrone"]),
        new CuratedSubstance("caffeine", "Caffeine", "Cafeína", ["cafeína", "cafeína anidra"], []),
        new CuratedSubstance("sodium_chloride", "Sodium chloride", "Cloreto de sódio", ["cloreto de sódio"], ["Saline"]),
        new CuratedSubstance("naphazoline", "Naphazoline", "Nafazolina", ["cloridrato de nafazolina"], []),
    ]);

    public static AnvisaRegistrationRow Row(string name, string number, string ingredients, string status = "Ativo") =>
        new(name, number, status, ingredients);

    public static CmedPresentationRow Presentation(string registration, string presentation) =>
        new(registration, "X", presentation);

    public static SourcedProductData Data(string name, ProductForm form = ProductForm.Drops, string externalRef = "luftal:drops", Guid[]? substances = null) =>
        new(name, form, null, ProductStatus.Official, "anvisa", externalRef, substances ?? []);
}

public sealed class PharmaceuticalFormsTests
{
    [Theory]
    [InlineData("75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML", ProductForm.Drops)]
    [InlineData("200 MG/ML SOL OR CT FR PLAS OPC GOT X 15 ML", ProductForm.Drops)]
    [InlineData("0,5 MG/ML SOL NAS CT FR GOT PLAS TRANS X 30 ML", ProductForm.Drops)]
    [InlineData("40 MG COM CT BL AL PLAS TRANS X 20", ProductForm.Tablet)]
    [InlineData("10 MG DRG CT BL AL", ProductForm.Tablet)]
    [InlineData("300 MG SUP RET CT STR X 5", ProductForm.Suppository)]
    [InlineData("500 MG/ML SOL INJ CT EST 50 AMP VD AMB X 2 ML", ProductForm.Other)]
    [InlineData("500 MG PO LIOF SOL INJ CT FA VD INC", ProductForm.Other)]
    [InlineData("50 MG/ML SOL OR CT FR VD AMB X 100 ML +COP", ProductForm.Other)]
    [InlineData("400 MG CAP MOLE CT BL AL PLAS PVC/PVDC TRANS X 8", ProductForm.Other)]
    [InlineData("15 MG/ML XPE CT FR PLAS AMB X 120 ML + COP", ProductForm.Syrup)]
    [InlineData("30 MG/ML SOL NASAL CT FR PLAS OPC SPRAY X 50 ML", ProductForm.Spray)]
    [InlineData("50 MCG SUS SPR NAS CT FR VD AMB X 120 DOSES", ProductForm.Spray)]
    [InlineData("9 MG/ML SOL NAS CT FR PLAS X 30 ML", ProductForm.Spray)]
    [InlineData("100 MCG SUS AER INAL OR CT TB AL X 200 DOSES", ProductForm.Inhaler)]
    [InlineData("200 MCG CAP DURA PO INAL CT FR PLAS X 60", ProductForm.Inhaler)]
    [InlineData("10 MG/G POM DERM CT BG AL X 30 G", ProductForm.Ointment)]
    [InlineData("20 MG/G CREM DERM CT BG AL X 20 G", ProductForm.Ointment)]
    [InlineData("10 MG/G GEL CT BG AL X 30 G", ProductForm.Ointment)]
    [InlineData("125 MG CAP GEL MOLE CT BL AL X 10", ProductForm.Other)]
    [InlineData("50 MG/ML PÓ SUS OR CT FR VD AMB X 60 ML", ProductForm.Powder)]
    [InlineData("", ProductForm.Other)]
    public void FromPresentation_MapsCmedAbbreviations(string presentation, ProductForm expected)
    {
        Assert.Equal(expected, PharmaceuticalForms.FromPresentation(presentation));
    }
}

public sealed class OfficialNamesTests
{
    [Theory]
    [InlineData("LUFTAL", "Luftal", null)]
    [InlineData("SIMETICONA + METILBROMETO DE HOMATROPINA", "Simeticona + Metilbrometo de Homatropina", null)]
    [InlineData("VITAMINA D3", "Vitamina D3", null)]
    [InlineData("MANITOL 20%", "Manitol", "20%")]
    [InlineData("CPHD BICARBONATO DE SÓDIO 8,4 %", "Cphd Bicarbonato de Sódio", "8,4 %")]
    [InlineData("SIMETICONA 125 MG CÁPSULA MOLE", "Simeticona", "125 MG CÁPSULA MOLE")]
    [InlineData("DORIL DC 500", "Doril Dc 500", null)]
    [InlineData("  ANTI-GASES   GOTAS ", "Anti-Gases Gotas", null)]
    [InlineData("20%", "20%", null)]
    public void Split_TitleCasesAndMovesTrailingDosage(string raw, string expectedName, string? expectedPresentation)
    {
        var name = OfficialNames.Split(raw);

        Assert.Equal((expectedName, expectedPresentation), (name.DisplayName, name.Presentation));
    }
}

public sealed class ActiveIngredientNamesTests
{
    [Fact]
    public void Split_SeparatesOnCommasDropsNotesAndDuplicates()
    {
        var names = ActiveIngredientNames.Split(" dipirona monoidratada,  cafeína anidra ,, carbidopa (port. 344/98 lista c 1), Cafeína Anidra");

        Assert.Equal(["dipirona monoidratada", "cafeína anidra", "carbidopa"], names);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" , ")]
    public void Split_Empty_ReturnsNothing(string? field)
    {
        Assert.Empty(ActiveIngredientNames.Split(field));
    }
}

public sealed class SubstanceDictionaryTests
{
    [Theory]
    [InlineData("simeticona", "simethicone", "Simethicone")]
    [InlineData("SIMETICONA", "simethicone", "Simethicone")]
    [InlineData("dipirona monoidratada", "metamizole", "Metamizole")]
    [InlineData("Dipirona Sodica", "metamizole", "Metamizole")]
    [InlineData("cloreto de sodio", "sodium_chloride", "Sodium chloride")]
    public void Resolve_CuratedNames_UseTheCuratedKeyAndEnglishName(string name, string expectedKey, string expectedEnglish)
    {
        var substance = OfficialData.Dictionary.Resolve(name);

        Assert.Equal((expectedKey, expectedEnglish, true), (substance.Key, substance.NameEn, substance.Curated));
    }

    [Fact]
    public void Resolve_UnknownName_DerivesKeyAndKeepsThePortugueseNameForBothLanguages()
    {
        var substance = OfficialData.Dictionary.Resolve("cloridrato de ambroxol");

        Assert.Equal(("cloridrato_de_ambroxol", "Cloridrato de Ambroxol", "Cloridrato de Ambroxol", false), (substance.Key, substance.NameEn, substance.NamePtBr, substance.Curated));
    }

    [Fact]
    public void Create_SourceNameOnTwoKeys_Throws()
    {
        Assert.Throws<ArgumentException>(() => SubstanceDictionary.Create(
        [
            new CuratedSubstance("a_one", "A", "A", ["same"], []),
            new CuratedSubstance("b_two", "B", "B", ["Same"], []),
        ]));
    }

    [Fact]
    public void Create_InvalidOrDuplicateKey_Throws()
    {
        Assert.Throws<ArgumentException>(() => SubstanceDictionary.Create([new CuratedSubstance("Not Valid", "A", "A", [], [])]));
        Assert.Throws<ArgumentException>(() => SubstanceDictionary.Create([new CuratedSubstance("dup", "A", "A", [], []), new CuratedSubstance("dup", "B", "B", [], [])]));
    }

    [Theory]
    [InlineData("cloreto de sodio", "cloreto_de_sodio")]
    [InlineData("vitamina b12 (cianocobalamina)", "vitamina_b12_cianocobalamina")]
    [InlineData("3 e 4 (atenuada)", "s_3_e_4_atenuada")]
    public void SubstanceKeys_FromName_IsALowerSnakeCaseSlug(string name, string expected)
    {
        Assert.Equal(expected, SubstanceKeys.FromName(name));
    }

    [Fact]
    public void SubstanceKeys_FromName_LongNamesStayDistinctAndWithinTheLimit()
    {
        var first = SubstanceKeys.FromName("polissacarideo de neisseria meningitidis do sorogrupo a conjugado a proteina");
        var second = SubstanceKeys.FromName("polissacarideo de neisseria meningitidis do sorogrupo c conjugado a proteina");

        Assert.True(first.Length <= Substance.KeyMaxLength && second.Length <= Substance.KeyMaxLength);
        Assert.NotEqual(first, second);
        Assert.True(SubstanceKeys.IsValid(first) && SubstanceKeys.IsValid(second));
    }
}

public sealed class RegistrationNumbersTests
{
    [Theory]
    [InlineData("101800120", "101800120")]
    [InlineData("1800120", "001800120")]
    [InlineData(" 1.0180.0120 ", "101800120")]
    [InlineData("", "")]
    public void Product_KeepsNineDigits(string value, string expected) => Assert.Equal(expected, RegistrationNumbers.Product(value));

    [Theory]
    [InlineData("1739000090013", "173900009")]
    [InlineData("173900009001", "017390000")]
    [InlineData("", "")]
    public void OfPresentation_TakesTheProductPart(string value, string expected) => Assert.Equal(expected, RegistrationNumbers.OfPresentation(value));
}

public sealed class OfficialCatalogPlannerTests
{
    [Fact]
    public void Plan_GroupsRowsByRegistrationAndSplitsForms()
    {
        var rows = new[]
        {
            OfficialData.Row("NOVALGINA", "186200018", "dipirona monoidratada"),
            OfficialData.Row("NOVALGINA", "186200018", "dipirona monoidratada", "Inativo"),
        };
        var presentations = new[]
        {
            OfficialData.Presentation("1862000180013", "300 MG SUP RET CT STR X 5"),
            OfficialData.Presentation("1862000180099", "500 MG/ML SOL OR CT FR GOT VD AMB X 10 ML"),
            OfficialData.Presentation("1862000180100", "500 MG/ML SOL OR CT FR GOT VD AMB X 20 ML"),
        };

        var plan = OfficialCatalogPlanner.Plan(rows, presentations, OfficialData.Dictionary);

        Assert.Equal(["novalgina:drops", "novalgina:suppository"], plan.Products.Select(product => product.ExternalRef));
        Assert.All(plan.Products, product => Assert.Equal(("Novalgina", "metamizole", "anvisa", ProductStatus.Official, (string?)null), (product.Name, Assert.Single(product.SubstanceKeys), product.Source, product.Status, product.AmbiguousName)));
        Assert.Equal(["metamizole"], plan.Substances.Select(substance => substance.Key));
    }

    [Fact]
    public void Plan_InactiveRegistrations_NeverCreateProductsEvenWhenPriced()
    {
        var rows = new[]
        {
            OfficialData.Row("LUFTAL", "173900009", "simeticona", "Inativo"),
            OfficialData.Row("ANTIGO", "100000001", "simeticona", "Inativo"),
            OfficialData.Row("MYLICON", "157211209", "simeticona"),
        };
        var presentations = new[] { OfficialData.Presentation("1739000090031", "75 MG ML EMU OR CT FR PLAS OPC GOT X 15 ML") };

        var plan = OfficialCatalogPlanner.Plan(rows, presentations, OfficialData.Dictionary);

        Assert.Equal(["mylicon:other"], plan.Products.Select(product => product.ExternalRef));
        Assert.Equal((3, 1, 2, 1), (plan.Report.Registrations, plan.Report.ActiveRegistrations, plan.Report.ExcludedRegistrations, plan.Report.ExcludedPricedRegistrations));
    }

    [Fact]
    public void Plan_ActiveNotifiedRows_AreImportedByNameWithoutIngredients()
    {
        var rows = new[]
        {
            OfficialData.Row("RINOSORO JET", string.Empty, string.Empty),
            OfficialData.Row("RINOSORO JET", string.Empty, string.Empty),
            OfficialData.Row("RINOSORO ANTIGO", string.Empty, string.Empty, "Inativo"),
        };

        var plan = OfficialCatalogPlanner.Plan(rows, [], OfficialData.Dictionary);

        var product = Assert.Single(plan.Products);
        Assert.Equal(("Rinosoro Jet", "rinosorojet:other", 0, 0), (product.Name, product.ExternalRef, product.SubstanceKeys.Count, product.RegistrationNumbers.Count));
        Assert.Equal((3, 2, 1), (plan.Report.RowsWithoutRegistration, plan.Report.ActiveNotifiedRows, plan.Report.ProductsWithoutIngredients));
    }

    [Fact]
    public void Plan_EmptyIngredient_InheritsOnlyFromRowsOfTheSameRegistration()
    {
        var rows = new[]
        {
            OfficialData.Row("GASOFIM", "100000010", string.Empty),
            OfficialData.Row("GASOFIM", "100000010", "simeticona", "Inativo"),
            OfficialData.Row("GASOVAZIO", "100000020", string.Empty),
            OfficialData.Row("GASOVAZIO", "100000021", "simeticona", "Inativo"),
        };

        var plan = OfficialCatalogPlanner.Plan(rows, [], OfficialData.Dictionary);

        Assert.Equal(["simethicone"], plan.Products.Single(product => product.Name == "Gasofim").SubstanceKeys);
        Assert.Empty(plan.Products.Single(product => product.Name == "Gasovazio").SubstanceKeys);
        Assert.Equal((1, 1, 1), (plan.Report.InheritedIngredientRegistrations, plan.Report.RegistrationsWithoutIngredients, plan.Report.ProductsWithoutIngredients));
    }

    [Fact]
    public void Plan_SameNameWithDifferentIngredients_SplitsIntoNamedAmbiguousVariants()
    {
        var rows = new[]
        {
            OfficialData.Row("SORINE", "105730050", "cloridrato de nafazolina"),
            OfficialData.Row("SORINE", string.Empty, string.Empty),
            OfficialData.Row("SORINE H", "105730352", "cloreto de sódio", "Inativo"),
            OfficialData.Row("SORINE", "105730999", "cloreto de sódio", "Inativo"),
        };
        var presentations = new[] { OfficialData.Presentation("1057300500024", "0,5 MG/ML SOL NAS CT FR GOT PLAS TRANS X 30 ML") };

        var plan = OfficialCatalogPlanner.Plan(rows, presentations, OfficialData.Dictionary);

        var variants = plan.Products.Select(product => (product.Name, product.Form, product.SubstanceKeys.Count, product.AmbiguousName)).ToArray();
        Assert.Equal(
        [
            ("Sorine (cloridrato de nafazolina)", ProductForm.Drops, 1, (string?)"Sorine"),
            ("Sorine (princípio ativo não informado)", ProductForm.Other, 0, (string?)"Sorine"),
        ],
        variants);
        Assert.DoesNotContain(plan.Products, product => product.SubstanceKeys.Contains("sodium_chloride"));
        Assert.Equal((1, 2), (plan.Report.AmbiguousNames, plan.Report.AmbiguousProducts));
        Assert.Single(plan.Report.AmbiguousNameSamples);
    }

    [Fact]
    public void Plan_SameNameAndIngredients_MergesRegistrations()
    {
        var rows = new[]
        {
            OfficialData.Row("DIPIRONA", "100000002", "dipirona monoidratada"),
            OfficialData.Row("DIPIRONA", "100000001", "dipirona sódica"),
        };

        var plan = OfficialCatalogPlanner.Plan(rows, [], OfficialData.Dictionary);

        var product = Assert.Single(plan.Products);
        Assert.Equal(("Dipirona", "dipirona:other", "metamizole", (string?)null), (product.Name, product.ExternalRef, Assert.Single(product.SubstanceKeys), product.AmbiguousName));
        Assert.Equal(["100000001", "100000002"], product.RegistrationNumbers);
    }

    [Fact]
    public void Plan_DropsTheOtherFallbackWhenTheSameNameAndIngredientsHaveARealForm()
    {
        var rows = new[]
        {
            OfficialData.Row("TYLENOL", "112363326", "paracetamol"),
            OfficialData.Row("TYLENOL", "157211214", "paracetamol"),
        };
        var presentations = new[] { OfficialData.Presentation("1123633260070", "200 MG/ML SOL OR CT FR PLAS OPC GOT X 15 ML") };

        var plan = OfficialCatalogPlanner.Plan(rows, presentations, OfficialData.Dictionary);

        Assert.Equal(["tylenol:drops"], plan.Products.Select(product => product.ExternalRef));
        Assert.Equal(1, plan.Report.DroppedFallbacks);
    }

    [Fact]
    public void Plan_MovesDosageOutOfTheNameAndKeepsMultiIngredientSets()
    {
        var rows = new[] { OfficialData.Row("NOVALGINA FLASH 1 G", "186200023", "dipirona monoidratada, cafeína anidra") };

        var plan = OfficialCatalogPlanner.Plan(rows, [], OfficialData.Dictionary);

        var product = Assert.Single(plan.Products);
        Assert.Equal(("Novalgina Flash", "1 G", "novalginaflash:other"), (product.Name, product.Presentation, product.ExternalRef));
        Assert.Equal(["metamizole", "caffeine"], product.SubstanceKeys);
        Assert.Single(plan.Report.MultiIngredientSamples);
    }

    [Fact]
    public void Plan_TruncatedVariantNamesThatCollide_StayDistinct()
    {
        var longName = "SOLUCAO MUITO LONGA DE NOME QUE OCUPA QUASE TODO O ESPACO DISPONIVEL NO CATALOGO";
        var rows = new[]
        {
            OfficialData.Row(longName, "100000040", "substancia comprida numero um alfa, substancia comprida numero um beta"),
            OfficialData.Row(longName, "100000041", "substancia comprida numero um alfa, substancia comprida numero um gama"),
        };

        var plan = OfficialCatalogPlanner.Plan(rows, [], OfficialData.Dictionary);

        Assert.Equal(2, plan.Products.Select(product => (product.NormalizedName, product.Form)).Distinct().Count());
        Assert.All(plan.Products, product => Assert.True(product.Name.Length <= Product.NameMaxLength));
        Assert.Empty(plan.KeyCollisions());
    }

    [Fact]
    public void Find_MatchesBrandPrefixAndIngredientNames()
    {
        var rows = new[]
        {
            OfficialData.Row("LUFTAL", "173900009", "simeticona"),
            OfficialData.Row("MYLICON", "157211209", "simeticona"),
            OfficialData.Row("NOVALGINA", "186200018", "dipirona"),
        };
        var plan = OfficialCatalogPlanner.Plan(rows, [], OfficialData.Dictionary);

        Assert.Equal(["Luftal"], plan.Find("luft", 10).Select(product => product.Name));
        Assert.Equal(["Luftal", "Mylicon"], plan.Find("simethicone", 10).Select(product => product.Name));
        Assert.Equal(["Novalgina"], plan.Find("dipyrone", 10).Select(product => product.Name));
        Assert.Empty(plan.Find("x", 10));
    }
}

public sealed class CuratedCatalogPlannerTests
{
    private static CuratedProductEntry Entry(string id, string name, params string[] ingredients) =>
        new(id, name, ProductForm.Drops, ingredients, Reviewed: false, "Owner statement");

    [Fact]
    public void Plan_CuratedEntries_BecomeCuratedProductsWithResolvedIngredients()
    {
        var plan = CuratedCatalogPlanner.Plan([Entry("flygas-drops", "Flygas", "simeticona")], OfficialData.Dictionary);

        var product = Assert.Single(plan.Products);
        Assert.Equal(("curated", ProductStatus.Curated, "flygas-drops", "Flygas", "flygas", ProductForm.Drops), (product.Source, product.Status, product.ExternalRef, product.Name, product.NormalizedName, product.Form));
        Assert.Equal(["simethicone"], product.SubstanceKeys);
        Assert.Equal(["simethicone"], plan.Substances.Select(substance => substance.Key));
    }

    [Fact]
    public void Plan_StrengthAndPackageSize_BecomeThePresentationText()
    {
        var plan = CuratedCatalogPlanner.Plan(
            [Entry("a-spray", "Aname", "cloreto de sódio") with { Strength = "9 mg/mL (0,9%)", PackageSize = "100 mL" }, Entry("b-spray", "Bname", "cloreto de sódio") with { PackageSize = "10 mL" }, Entry("c-spray", "Cname", "cloreto de sódio")],
            OfficialData.Dictionary);

        Assert.Equal(["9 mg/mL (0,9%); 100 mL", "10 mL", null], plan.Products.Select(product => product.Presentation));
    }

    [Fact]
    public void Plan_Alias_CarriesTheExternalRefOfItsProduct()
    {
        var plan = CuratedCatalogPlanner.Plan([Entry("a-drops", "Aname", "simeticona"), Entry("b-drops", "Bname", "simeticona") with { AliasOf = "a-drops" }], OfficialData.Dictionary);

        Assert.Equal([null, "a-drops"], plan.Products.Select(product => product.AliasOfExternalRef));
    }

    [Theory]
    [InlineData("nowhere")]
    [InlineData("b-drops")]
    [InlineData("c-drops")]
    public void Plan_AliasOfItselfAnUnknownEntryOrAnotherAlias_Throws(string target)
    {
        var entries = new[] { Entry("a-drops", "Aname", "simeticona"), Entry("b-drops", "Bname", "simeticona") with { AliasOf = target }, Entry("c-drops", "Cname", "simeticona") with { AliasOf = "a-drops" } };

        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan(entries, OfficialData.Dictionary));
    }

    [Fact]
    public void Plan_UnknownCategoryOrTooLongPresentation_Throws()
    {
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-drops", "Aname", "simeticona") with { Category = "herbal" }], OfficialData.Dictionary));
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-drops", "Aname", "simeticona") with { Strength = new string('x', 101) }], OfficialData.Dictionary));
    }

    [Fact]
    public void Plan_EntryWithoutIngredients_Throws()
    {
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("empty-drops", "Empty")], OfficialData.Dictionary));
    }

    [Theory]
    [InlineData("Bad Id")]
    [InlineData("x")]
    public void Plan_InvalidId_Throws(string id)
    {
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry(id, "Flygas", "simeticona")], OfficialData.Dictionary));
    }

    [Fact]
    public void Plan_DuplicateIdOrNameAndForm_Throws()
    {
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-1", "Flygas", "simeticona"), Entry("a-1", "Other", "simeticona")], OfficialData.Dictionary));
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-1", "Flygas", "simeticona"), Entry("a-2", "FLYGAS", "simeticona")], OfficialData.Dictionary));
    }

    [Fact]
    public void With_AddsCuratedProductsAndReportsCollisionsWithOfficialNames()
    {
        var official = OfficialCatalogPlanner.Plan([OfficialData.Row("FLYGAS", "100000050", "simeticona")], [], OfficialData.Dictionary);
        var curated = CuratedCatalogPlanner.Plan([new CuratedProductEntry("flygas-other", "Flygas", ProductForm.Other, ["simeticona"], false, "test")], OfficialData.Dictionary);

        var combined = official.With(curated.Products, curated.Substances);

        Assert.Equal(2, combined.Products.Count);
        Assert.Single(combined.Substances);
        Assert.Single(combined.KeyCollisions());
    }
}

public sealed class OfficialProductTests
{
    private static readonly CountryCode Brazil = CountryCode.From("BR");

    [Fact]
    public void FromSource_CreatesAnActiveOfficialProductWithTheSourceKeys()
    {
        var product = Product.FromSource(Guid.NewGuid(), OfficialData.Data("Luftal", substances: [CatalogData.Simethicone.Id]), Brazil, TestClock.Now);

        Assert.Equal((ProductStatus.Official, "anvisa", "luftal:drops", true, "luftal", 0), (product.Status, product.Source, product.ExternalRef, product.IsActive, product.NormalizedName, product.SourceRank));
        Assert.Equal([CatalogData.Simethicone.Id], product.SubstanceIds);
        Assert.Null(product.CreatedBy);
    }

    [Fact]
    public void FromSource_CuratedProductKeepsItsStatusAndRanksAfterOfficial()
    {
        var data = OfficialData.Data("Flygas", substances: [CatalogData.Simethicone.Id]) with { Status = ProductStatus.Curated, Source = "curated", ExternalRef = "flygas-drops" };

        var product = Product.FromSource(Guid.NewGuid(), data, Brazil, TestClock.Now);

        Assert.Equal((ProductStatus.Curated, "curated", 1), (product.Status, product.Source, product.SourceRank));
    }

    [Theory]
    [InlineData(ProductStatus.Community)]
    [InlineData(ProductStatus.Seed)]
    public void FromSource_NotAnImportedStatus_Throws(ProductStatus status)
    {
        Assert.Throws<DomainValidationException>(() => Product.FromSource(Guid.NewGuid(), OfficialData.Data("Luftal") with { Status = status }, Brazil, TestClock.Now));
    }

    [Fact]
    public void FromSource_TooManyOrRepeatedSubstances_Throws()
    {
        var repeated = OfficialData.Data("Luftal", substances: [CatalogData.Simethicone.Id, CatalogData.Simethicone.Id]);
        var tooMany = OfficialData.Data("Luftal", substances: Enumerable.Range(0, Product.OfficialMaxSubstances + 1).Select(_ => Guid.NewGuid()).ToArray());

        Assert.Throws<DomainValidationException>(() => Product.FromSource(Guid.NewGuid(), repeated, Brazil, TestClock.Now));
        Assert.Throws<DomainValidationException>(() => Product.FromSource(Guid.NewGuid(), tooMany, Brazil, TestClock.Now));
    }

    [Fact]
    public void ApplySource_SameData_ReportsNoChangeAndAmbiguityIsAChange()
    {
        var data = OfficialData.Data("Luftal", substances: [CatalogData.Simethicone.Id]);
        var product = Product.FromSource(Guid.NewGuid(), data, Brazil, TestClock.Now);

        Assert.False(product.ApplySource(data));
        Assert.True(product.ApplySource(data with { AmbiguousName = "Luftal" }));
        Assert.Equal("Luftal", product.AmbiguousName);
    }

    [Fact]
    public void ApplySource_AdoptsACommunityProductKeepingItsIdAndReplacingIngredients()
    {
        var community = CatalogData.Community("LUFTAL", CatalogData.Paracetamol);

        var changed = community.ApplySource(OfficialData.Data("Luftal", substances: [CatalogData.Simethicone.Id]));

        Assert.True(changed);
        Assert.Equal((ProductStatus.Official, "Luftal", "anvisa"), (community.Status, community.Name, community.Source));
        Assert.Equal([CatalogData.Simethicone.Id], community.SubstanceIds);
    }

    [Fact]
    public void ApplySource_OtherKeyOrForm_Throws()
    {
        var product = Product.FromSource(Guid.NewGuid(), OfficialData.Data("Luftal"), Brazil, TestClock.Now);

        Assert.Throws<DomainValidationException>(() => product.ApplySource(OfficialData.Data("Mylicon")));
        Assert.Throws<DomainValidationException>(() => product.ApplySource(OfficialData.Data("Luftal", ProductForm.Tablet)));
    }

    [Fact]
    public void Retire_MarksInactiveOnceAndApplySourceReactivates()
    {
        var data = OfficialData.Data("Luftal");
        var product = Product.FromSource(Guid.NewGuid(), data, Brazil, TestClock.Now);

        Assert.True(product.Retire(TestClock.Now));
        Assert.False(product.Retire(TestClock.Now.AddDays(1)));
        Assert.Equal(TestClock.Now, product.InactiveSince);
        Assert.True(product.ApplySource(data));
        Assert.True(product.IsActive);
    }
}

public sealed class OfficialSearchTests
{
    private static readonly CountryCode Brazil = CountryCode.From("BR");

    private static Product Official(string name, ProductForm form = ProductForm.Drops, string? ambiguousName = null, Substance[]? substances = null) =>
        Product.FromSource(
            Guid.NewGuid(),
            OfficialData.Data(name, form, $"{ProductNames.Key(name)}:{form}", (substances is { Length: > 0 } ? substances : new[] { CatalogData.Simethicone }).Select(substance => substance.Id).ToArray()) with { AmbiguousName = ambiguousName },
            Brazil,
            TestClock.Now);

    [Fact]
    public void SameActiveIngredient_ListsOfficialFirstOncePerNameAndSkipsRetired()
    {
        var luftal = Official("Luftal");
        var luftalTablet = Official("Luftal", ProductForm.Tablet);
        var mylicon = Official("Mylicon");
        var myliconTablet = Official("Mylicon", ProductForm.Tablet);
        var flygas = CatalogData.Community("Flygas", CatalogData.Simethicone);
        var retired = Official("Antigo");
        retired.Retire(TestClock.Now);

        var siblings = ProductSearch.SameActiveIngredient(luftal, [flygas, luftalTablet, myliconTablet, mylicon, retired]);

        Assert.Equal(["Mylicon", "Flygas"], siblings.Select(sibling => sibling.Name));
    }

    [Fact]
    public void SameActiveIngredient_PutsTheSameKnownFormFirstAndNeverTreatsUnknownAsTheSame()
    {
        var spray = Official("Aaa Spray", ProductForm.Spray);
        var otherForm = Official("Aaa Irrigation", ProductForm.Other);
        var drops = Official("Zzz Drops", ProductForm.Drops);
        var sameFormCurated = Product.FromSource(Guid.NewGuid(), OfficialData.Data("Mmm Curated", ProductForm.Spray, "mmmcurated:spray", [CatalogData.Simethicone.Id]) with { Status = ProductStatus.Curated, Source = "curated" }, Brazil, TestClock.Now);

        var siblings = ProductSearch.SameActiveIngredient(spray, [otherForm, drops, sameFormCurated]);
        var fromUnknown = ProductSearch.SameActiveIngredient(otherForm, [spray, drops, Official("Bbb Other", ProductForm.Other)]);

        Assert.Equal(["Mmm Curated", "Aaa Irrigation", "Zzz Drops"], siblings.Select(sibling => sibling.Name));
        Assert.Equal(["Aaa Spray", "Bbb Other", "Zzz Drops"], fromUnknown.Select(sibling => sibling.Name));
    }

    [Fact]
    public void SameActiveIngredient_HomeopathicIngredientSetsAreNeverTheSameAsSimethicone()
    {
        var chamomile = Substance.Seed(Guid.NewGuid(), "matricaria_chamomilla_4ch", "Matricaria chamomilla 4CH", "Matricaria chamomilla 4CH", [], TestClock.Now);
        var mint = Substance.Seed(Guid.NewGuid(), "mentha_piperita_6ch", "Mentha piperita 6CH", "Mentha piperita 6CH", [], TestClock.Now);
        var simethicone = Official("Luftal");
        var homeopathic = Official("Colicaliv", substances: [chamomile, mint]);
        var partOfIt = Official("Camomilina", substances: [chamomile]);

        Assert.Empty(ProductSearch.SameActiveIngredient(homeopathic, [simethicone, partOfIt]));
        Assert.Empty(ProductSearch.SameActiveIngredient(simethicone, [homeopathic, partOfIt]));
    }

    [Fact]
    public void Rank_SkipsRetiredProducts()
    {
        var retired = Official("Luftal");
        retired.Retire(TestClock.Now);
        var active = Official("Luftal", ProductForm.Tablet);

        var matches = ProductSearch.Rank(CatalogQuery.From("luftal"), [retired, active], [], [], 10);

        Assert.Equal([active.Id], matches.Select(match => match.Product.Id));
    }

    [Fact]
    public void WithAmbiguousVariants_ListsEveryVariantRightAfterTheFirstNameMatch()
    {
        var naphazoline = Substance.Seed(Guid.NewGuid(), "naphazoline", "Naphazoline", "Nafazolina", [], TestClock.Now);
        var decongestant = Official("Sorine (cloridrato de nafazolina)", ambiguousName: "Sorine", substances: [naphazoline]);
        var unknown = Product.FromSource(Guid.NewGuid(), OfficialData.Data("Sorine (princípio ativo não informado)", ProductForm.Other, "sorineprincipioativonaoinformado:other") with { AmbiguousName = "Sorine" }, Brazil, TestClock.Now);
        var other = Official("Sorinex");
        var ranked = ProductSearch.Rank(CatalogQuery.From("sorine ("), [decongestant, other], [], [], 1);

        var expanded = ProductSearch.WithAmbiguousVariants(ranked, [unknown, decongestant]);

        Assert.Equal(["Sorine"], ProductSearch.AmbiguousNames(ranked));
        Assert.Equal([decongestant.Id, unknown.Id], expanded.Select(match => match.Product.Id));
        Assert.All(expanded, match => Assert.Equal(CatalogMatchKind.Name, match.MatchedBy));
    }

    [Fact]
    public void WithAmbiguousVariants_SubstanceMatchesAreNotExpanded()
    {
        var variant = Official("Sorine (cloridrato de nafazolina)", ambiguousName: "Sorine");
        var sibling = Official("Sorine (princípio ativo não informado)", ProductForm.Other, ambiguousName: "Sorine");
        var bySubstance = ProductSearch.Rank(CatalogQuery.From("nafazolina"), [], [], [variant], 10);

        var expanded = ProductSearch.WithAmbiguousVariants(bySubstance, [variant, sibling]);

        Assert.Equal([variant.Id], expanded.Select(match => match.Product.Id));
        Assert.Empty(ProductSearch.AmbiguousNames(bySubstance));
    }

    [Fact]
    public void MatchSubstances_ExactMatch_DropsSubstancesThatAreOnlyATypoAway()
    {
        var dimethicone = Substance.Seed(Guid.NewGuid(), "dimeticona", "Dimeticona", "Dimeticona", [], TestClock.Now);

        var exact = ProductSearch.MatchSubstances(CatalogQuery.From("simeticona"), [CatalogData.Simethicone, dimethicone]);
        var typoOnly = ProductSearch.MatchSubstances(CatalogQuery.From("simetikona"), [CatalogData.Simethicone, dimethicone]);

        Assert.Equal(["simethicone"], exact.Select(match => match.Substance.Key));
        Assert.Contains(typoOnly, match => match.Substance.Key == "simethicone");
    }

    [Theory]
    [InlineData(null, null, 0, 20)]
    [InlineData(40, 50, 40, 50)]
    public void CatalogPage_From_DefaultsAndRange(int? offset, int? limit, int expectedOffset, int expectedLimit)
    {
        Assert.Equal(new CatalogPage(expectedOffset, expectedLimit), CatalogPage.From(offset, limit));
    }

    [Theory]
    [InlineData(-1, null, "offset")]
    [InlineData(null, 0, "limit")]
    [InlineData(null, 51, "limit")]
    public void CatalogPage_From_OutOfRange_Throws(int? offset, int? limit, string field)
    {
        Assert.Equal(field, Assert.Throws<DomainValidationException>(() => CatalogPage.From(offset, limit)).Field);
    }
}
