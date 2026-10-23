using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Catalog.Official.Verification;

namespace Lotties.Domain.Tests.Catalog;

/// <summary>Reading strengths from (synthetic, real-looking) CMED presentation texts: only one unambiguous amount counts, everything else is unknown.</summary>
public sealed class StrengthParserTests
{
    [Theory]
    [InlineData("75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML", "75 mg/ml", "75 mg/mL")]
    [InlineData("75 MG/ML SUS OR CT FR PLAS OPC GOT X 15 ML", "75 mg/ml", "75 mg/mL")]
    [InlineData("40 MG COM CT BL AL PLAS INC X 20", "40 mg", "40 mg")]
    [InlineData("500MG COM REV CT BL AL PLAS PVC X 100", "500 mg", "500 mg")]
    [InlineData("0,5 MG/ML SOL NAS CT FR GOT PLAS TRANS X 30 ML ", "0.5 mg/ml", "0,5 mg/mL")]
    [InlineData("30 MG/ML SOL NASAL CT FR PLAS OPC SPRAY X 50 ML", "30 mg/ml", "30 mg/mL")]
    [InlineData("9 MG/ML SOL INJ IV CX 20 FA PLAS PEBD TRANS SIST FECH X 100 ML", "9 mg/ml", "9 mg/mL")]
    [InlineData("1 G PO EFEV CT 10 ENV AL X 5 G", "1000 mg", "1 g")]
    [InlineData("500 MCG COM CT BL AL PLAS TRANS X 30", "0.5 mg", "500 mcg")]
    [InlineData("15 MCG/ML SOL OFT CT 30 FLAC PLAS PEBD TRANS X 0,3 ML", "0.015 mg/ml", "15 mcg/mL")]
    [InlineData("10 MG/5 ML XPE CT FR VD AMB X 120 ML", "2 mg/ml", "10 mg/5 mL")]
    [InlineData("200 MG/5ML SUS OR CT FR PLAS OPC X 100 ML", "40 mg/ml", "200 mg/5 mL")]
    [InlineData("5 MG/10ML SOL OR CT FR PLAS OPC X 100 ML", "0.5 mg/ml", "5 mg/10 mL")]
    [InlineData("5 MG / ML SOL OR CT FR GOT PLAS OPC X 20 ML", "5 mg/ml", "5 mg/mL")]
    [InlineData("50 MG/G CREM DERM CT BG AL X 10 G", "50 mg/g", "50 mg/g")]
    [InlineData("1.0 MG/G CREM DERM CT BG AL X 30 G", "1 mg/g", "1.0 mg/g")]
    [InlineData("2,00 MG COM CT BL AL PLAS TRANS X 63", "2 mg", "2,00 mg")]
    [InlineData("0,9 % SOL NAS CT FR PLAS SPRAY X 100 ML", "0.9 %", "0,9%")]
    [InlineData("20% SOL TOP CT FR PLAS X 100 ML", "20 %", "20%")]
    [InlineData("1000 UI/ML SOL OR CT FR GOT PLAS X 20 ML", "1000 ui/ml", "1000 UI/mL")]
    [InlineData("100 U/ML SOL INJ CT 1 FA VD INC X 10 ML", "100 u/ml", "100 U/mL")]
    [InlineData("4 MEQ/ML SOL INJ IV CX 50 AMP VD X 10 ML", "4 meq/ml", "4 mEq/mL")]
    [InlineData("1,5 MMOL/ML SOL INJ CT 10 AMP VD X 10 ML", "1.5 mmol/ml", "1,5 mmol/mL")]
    [InlineData("13,3 MG/DIA ADES TRANSD CT 5 ENV PET/AL/POLIOF OPC X 6", "13.3 mg/dia", "13,3 mg/dia")]
    [InlineData("25 MCG/DOSE SPRAY NAS CT FR VD AMB X 120 DOSES", "0.025 mg/dose", "25 mcg/dose")]
    [InlineData("0,25 ML/ML GOT CT FR VD AMB X 30 ML", "0.25 ml/ml", "0,25 mL/mL")]
    [InlineData("100 mg/ml sol or ct fr gotas x 10 ml", "100 mg/ml", "100 mg/mL")]
    public void Read_OneUnambiguousAmount_IsNormalised(string presentation, string token, string display)
    {
        var reading = StrengthParser.Read(presentation);

        Assert.True(reading.IsKnown);
        Assert.Equal((token, display), (reading.Amount!.Token, reading.Display));
    }

    [Theory]
    [InlineData("(10 + 0,4) MG/G CREM DERM CT BG AL X 40G")]
    [InlineData("(400 + 400 + 30)MG/5ML SUS OR CT FR PLAS OPC X 240 ML (TRADICIONAL)")]
    [InlineData("(153 + 200 + 25) MG COM MAST CT BL AL PLAS PVC TRANS X 20")]
    [InlineData("80MG/ML + 80MG/ML + 6MG/ML SUS OR CT FR PLAS PEAD OPC X 240ML (SABOR MENTA)")]
    [InlineData("50 MG + 5 MG COM CT BL AL X 20")]
    [InlineData("20 MG/G + 1.0 MG/G CREM DERM CT BG AL X 15 G")]
    [InlineData("50 MG/G + 10 UI/G POM DERM CT BG AL X 30 G")]
    [InlineData("2% + 1% CREM DERM CT BG AL X 30 G")]
    [InlineData("75 MG ML EMU OR CT FR PLAS OPC GOT X 15 ML")]
    [InlineData("1.000 UI COM REV CT BL AL X 30")]
    [InlineData("50.000 UI CAP MOLE CT BL AL X 4")]
    [InlineData("1 X 10E7 GV/ML SUS OR CT FR X 5 ML")]
    [InlineData("50 MG (50 KUI) COM CT BL AL X 10")]
    [InlineData("10 MG/3 ML SOL OR CT FR PLAS X 30 ML")]
    [InlineData("10 MG/0 ML SOL OR CT FR PLAS X 30 ML")]
    [InlineData("10 MG - 20 MG COM CT BL AL X 10")]
    [InlineData("5 BILHOES UFC PO CT 10 ENV X 1 G")]
    [InlineData("500 MG PO LIOF SOL INJ IV CT 1 FA VD TRANS + 1 AMP DIL X 10 ML")]
    [InlineData("1.234,5 MG COM CT BL AL X 10")]
    [InlineData("SOL INJ CX FA PLAS TRANS SIST FECH X 500 ML")]
    [InlineData("COM REV CT BL AL AL X 30")]
    [InlineData("MG/ML SOL OR")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Read_CombinationRangeOddUnitOrNoAmount_IsUnknown(string? presentation)
    {
        var reading = StrengthParser.Read(presentation);

        Assert.False(reading.IsKnown);
        Assert.Null(reading.Display);
    }

    [Theory]
    [InlineData("9", "mg/mL", "9 mg/ml")]
    [InlineData("0,25", "mL/mL", "0.25 ml/ml")]
    [InlineData("150", "mg/mL", "150 mg/ml")]
    [InlineData("0,5", "g", "500 mg")]
    [InlineData("30", "%", "30 %")]
    public void Canonical_StructuredAmountAndUnit(string amount, string unit, string token)
    {
        Assert.Equal(token, StrengthParser.Canonical(amount, unit)!.Token);
    }

    [Theory]
    [InlineData(null, "mg/mL")]
    [InlineData("9", null)]
    [InlineData("nine", "mg/mL")]
    [InlineData("9", "furlongs")]
    [InlineData("9", "mg/mL + 1 mg/mL")]
    public void Canonical_NotUnderstood_IsNull(string? amount, string? unit)
    {
        Assert.Null(StrengthParser.Canonical(amount, unit));
    }

    [Fact]
    public void Read_PercentIsNeverConvertedToMilligramsPerMillilitre()
    {
        Assert.NotEqual(StrengthParser.Read("0,9 % SOL NAS X 100 ML").Amount!.Token, StrengthParser.Read("9 MG/ML SOL NAS X 100 ML").Amount!.Token);
    }
}

public sealed class StrengthKeysTests
{
    [Theory]
    [InlineData("simethicone=75 mg/ml", "simethicone=75 mg/ml", StrengthComparison.Equal)]
    [InlineData("simethicone=75 mg/ml", "simethicone=150 mg/ml", StrengthComparison.Different)]
    [InlineData("sodium_chloride=9 mg/ml", "sodium_chloride=30 mg/ml", StrengthComparison.Different)]
    [InlineData("sodium_chloride=0.9 %", "sodium_chloride=9 mg/ml", StrengthComparison.Unknown)]
    [InlineData("simethicone=40 mg", "simethicone=75 mg/ml", StrengthComparison.Unknown)]
    [InlineData(null, "simethicone=75 mg/ml", StrengthComparison.Unknown)]
    [InlineData("simethicone=75 mg/ml", null, StrengthComparison.Unknown)]
    [InlineData(null, null, StrengthComparison.Unknown)]
    [InlineData("", "", StrengthComparison.Unknown)]
    [InlineData("a=1 mg;b=2 mg", "a=1 mg;b=2 mg", StrengthComparison.Equal)]
    [InlineData("a=1 mg;b=2 mg", "a=1 mg;b=3 mg", StrengthComparison.Different)]
    [InlineData("a=1 mg;b=2 mg", "a=2 mg;b=2 mg", StrengthComparison.Different)]
    [InlineData("a=1 mg;b=2 mg", "a=1 mg;c=2 mg", StrengthComparison.Unknown)]
    [InlineData("a=1 mg;b=2 mg", "a=1 mg", StrengthComparison.Unknown)]
    [InlineData("a=1 mg;b=2 mg", "a=1 mg;b=2 %", StrengthComparison.Unknown)]
    [InlineData("a=strain:dsm 17938", "a=strain:dsm 17938", StrengthComparison.Equal)]
    [InlineData("a=strain:dsm 17938", "a=strain:atcc 55730", StrengthComparison.Unknown)]
    public void Compare_EqualDifferentOrUnknown(string? first, string? second, StrengthComparison expected)
    {
        Assert.Equal(expected, StrengthKeys.Compare(first, second));
    }

    [Fact]
    public void Of_SortsTokensBySubstanceKeyAndStrainTokenIsLowerCaseWithoutSeparators()
    {
        Assert.Equal("a=1 mg;b=2 mg", StrengthKeys.Of(["b=2 mg", "a=1 mg"]));
        Assert.Equal("limosilactobacillus_reuteri=strain:dsm 17938", StrengthKeys.StrainToken("limosilactobacillus_reuteri", " DSM  17938;="));
    }
}

/// <summary>The alternatives rule on synthetic products: equivalent only with the same ingredients, strength and known form; everything else is labelled, never silent.</summary>
public sealed class AlternativesTests
{
    private static readonly CountryCode Brazil = CountryCode.From("BR");
    private static readonly Substance Saline = Substance.Seed(Guid.NewGuid(), "sodium_chloride", "Sodium chloride", "Cloreto de sódio", [], TestClock.Now);
    private static readonly Substance Homeopathic = Substance.Seed(Guid.NewGuid(), "matricaria_chamomilla_4ch", "Matricaria 4CH", "Matricaria 4CH", [], TestClock.Now);

    private static Product Make(string name, ProductForm form, string? key, Substance? substance = null, ProductStatus status = ProductStatus.Official)
    {
        var chosen = substance ?? CatalogData.Simethicone;
        var data = new SourcedProductData(name, form, null, status, status == ProductStatus.Curated ? "curated" : "anvisa", $"{ProductNames.Key(name)}:{form}", [chosen.Id], StrengthKey: key, StrengthText: key is null ? null : "text of " + key);
        return Product.FromSource(Guid.NewGuid(), data, Brazil, TestClock.Now);
    }

    private static Product Simethicone(string name, ProductForm form, string? mgPerMl) =>
        Make(name, form, mgPerMl is null ? null : $"simethicone={mgPerMl} mg/ml");

    private static Product Salt(string name, ProductForm form, string? token) =>
        Make(name, form, token is null ? null : $"sodium_chloride={token}", Saline);

    private static string[] Levels(IEnumerable<ProductAlternative> alternatives) => alternatives.Select(alternative => $"{alternative.Product.Name}:{alternative.Level}").ToArray();

    [Fact]
    public void Alternatives_IsotonicSprayAgainstHypertonicDropsAndUnknown_AreTieredAndLabelled()
    {
        var iso = Salt("Aaa Iso Spray", ProductForm.Spray, "9 mg/ml");
        var isoOther = Salt("Bbb Iso Other Brand", ProductForm.Spray, "9 mg/ml");
        var isoDrops = Salt("Ccc Iso Drops", ProductForm.Drops, "9 mg/ml");
        var unknown = Salt("Ddd Unknown", ProductForm.Spray, null);
        var hyper = Salt("Eee Hypertonic 3pct", ProductForm.Spray, "30 mg/ml");
        var percent = Salt("Fff Percent", ProductForm.Spray, "0.9 %");

        var result = ProductSearch.Alternatives(iso, [hyper, unknown, percent, isoDrops, isoOther, iso]);

        Assert.Equal(
            ["Bbb Iso Other Brand:Equivalent", "Ccc Iso Drops:DifferentForm", "Ddd Unknown:StrengthNotKnown", "Fff Percent:StrengthNotKnown", "Eee Hypertonic 3pct:DifferentStrength"],
            Levels(result));
    }

    [Fact]
    public void Alternatives_Simethicone150Against75_IsDifferentStrengthAndNeverEquivalent()
    {
        var flyGotas = Simethicone("Fly Gotas", ProductForm.Drops, "150");
        var luftal = Simethicone("Luftal", ProductForm.Drops, "75");
        var mylicon = Simethicone("Mylicon", ProductForm.Drops, "75");

        Assert.Equal(["Luftal:DifferentStrength", "Mylicon:DifferentStrength"], Levels(ProductSearch.Alternatives(flyGotas, [luftal, mylicon])));
        Assert.Equal(["Mylicon:Equivalent", "Fly Gotas:DifferentStrength"], Levels(ProductSearch.Alternatives(luftal, [flyGotas, mylicon])));
    }

    [Fact]
    public void Alternatives_DropsAgainstSyrupWithTheSameStrength_IsDifferentForm()
    {
        var drops = Simethicone("Aaa Drops", ProductForm.Drops, "75");
        var syrup = Simethicone("Bbb Syrup", ProductForm.Syrup, "75");

        Assert.Equal(["Bbb Syrup:DifferentForm"], Levels(ProductSearch.Alternatives(drops, [syrup])));
    }

    [Fact]
    public void Alternatives_UnknownFormNeverCountsAsTheSameForm_EvenWithTheSameStrength()
    {
        var spray = Salt("Aaa Spray", ProductForm.Spray, "9 mg/ml");
        var other = Salt("Bbb Irrigation", ProductForm.Other, "9 mg/ml");
        var otherToo = Salt("Ccc Irrigation", ProductForm.Other, "9 mg/ml");

        Assert.Equal(["Bbb Irrigation:DifferentForm"], Levels(ProductSearch.Alternatives(spray, [other])));
        Assert.Equal(["Aaa Spray:DifferentForm", "Ccc Irrigation:DifferentForm"], Levels(ProductSearch.Alternatives(other, [spray, otherToo])));
    }

    [Fact]
    public void Alternatives_NoStructuredStrengthAnywhere_EverythingIsStrengthNotKnown_InTheOldOrder()
    {
        var spray = Simethicone("Aaa Spray", ProductForm.Spray, null);
        var otherForm = Simethicone("Aaa Irrigation", ProductForm.Other, null);
        var drops = Simethicone("Zzz Drops", ProductForm.Drops, null);
        var curated = Make("Mmm Curated", ProductForm.Spray, null, status: ProductStatus.Curated);

        var result = ProductSearch.Alternatives(spray, [otherForm, drops, curated]);

        Assert.Equal(["Mmm Curated:StrengthNotKnown", "Aaa Irrigation:StrengthNotKnown", "Zzz Drops:StrengthNotKnown"], Levels(result));
        Assert.Equal(["Mmm Curated", "Aaa Irrigation", "Zzz Drops"], ProductSearch.SameActiveIngredient(spray, [otherForm, drops, curated]).Select(product => product.Name));
    }

    [Fact]
    public void Alternatives_OneSideWithoutStrength_IsStrengthNotKnown()
    {
        var known = Simethicone("Alfa", ProductForm.Drops, "75");
        var unknown = Simethicone("Beta", ProductForm.Drops, null);

        Assert.Equal(["Beta:StrengthNotKnown"], Levels(ProductSearch.Alternatives(known, [unknown])));
        Assert.Equal(["Alfa:StrengthNotKnown"], Levels(ProductSearch.Alternatives(unknown, [known])));
    }

    [Fact]
    public void Alternatives_OneBrandInSeveralForms_IsListedOnceAtItsBestLevel()
    {
        var drops = Simethicone("Aaa Drops", ProductForm.Drops, "75");
        var brandTablet = Make("Mylicon", ProductForm.Tablet, "simethicone=40 mg");
        var brandDrops = Make("Mylicon", ProductForm.Drops, "simethicone=75 mg/ml");

        var result = ProductSearch.Alternatives(drops, [brandTablet, brandDrops]);

        Assert.Equal(["Mylicon:Equivalent"], Levels(result));
        Assert.Equal(ProductForm.Drops, result[0].Product.Form);
    }

    [Fact]
    public void Alternatives_CapKeepsTheBestLevelsFirst()
    {
        var searched = Simethicone("Searched", ProductForm.Drops, "75");
        var different = Enumerable.Range(0, ProductSearch.MaxSiblings + 3).Select(index => Simethicone($"Aa Different {index:00}", ProductForm.Drops, "150")).ToList();
        var equivalent = Simethicone("Zz Equivalent", ProductForm.Drops, "75");

        var result = ProductSearch.Alternatives(searched, [.. different, equivalent]);

        Assert.Equal(ProductSearch.MaxSiblings, result.Count);
        Assert.Equal(("Zz Equivalent", AlternativeLevel.Equivalent), (result[0].Product.Name, result[0].Level));
        Assert.All(result.Skip(1), alternative => Assert.Equal(AlternativeLevel.DifferentStrength, alternative.Level));
    }

    [Fact]
    public void Alternatives_HomeopathicOrCombinationSetsAreNeverAlternativesOfASingleIngredient()
    {
        var simethicone = Simethicone("Alfa", ProductForm.Drops, "75");
        var homeopathic = Make("Colicaliv", ProductForm.Drops, "matricaria_chamomilla_4ch=0.25 ml/ml", Homeopathic);

        Assert.Empty(ProductSearch.Alternatives(simethicone, [homeopathic]));
        Assert.Empty(ProductSearch.Alternatives(homeopathic, [simethicone]));
    }

    [Fact]
    public void Alternatives_ProductsWithSeveralStrengthsOrAComboHaveNoKeyAndAreNotKnown()
    {
        var searched = Simethicone("Alfa", ProductForm.Drops, "75");
        var several = Make("Bbb Several", ProductForm.Drops, null);

        Assert.Equal(AlternativeLevel.StrengthNotKnown, ProductSearch.LevelOf(searched, several));
    }

    [Fact]
    public void ApplySource_StrengthChange_IsAChangeAndIsStoredOnTheProduct()
    {
        var product = Simethicone("Alfa", ProductForm.Drops, null);
        var data = new SourcedProductData(product.Name, product.Form, null, product.Status, "anvisa", product.ExternalRef!, [CatalogData.Simethicone.Id], StrengthKey: "simethicone=75 mg/ml", StrengthText: "75 mg/mL");

        var changed = product.ApplySource(data);
        var again = product.ApplySource(data);

        Assert.True(changed);
        Assert.False(again);
        Assert.Equal(("simethicone=75 mg/ml", "75 mg/mL"), (product.StrengthKey, product.StrengthText));
    }
}

/// <summary>The planners turn CMED presentations and curated structured strengths into product keys.</summary>
public sealed class StrengthPlanningTests
{
    private static CatalogProductPlan Product(OfficialCatalogPlan plan, string name) => Assert.Single(plan.Products, product => product.Name == name);

    private static OfficialCatalogPlan Plan(IReadOnlyList<AnvisaRegistrationRow> rows, params CmedPresentationRow[] presentations) =>
        OfficialCatalogPlanner.Plan(rows, presentations, OfficialData.Dictionary);

    [Fact]
    public void Plan_SingleIngredientWithOneStrength_GetsKeyAndText()
    {
        var plan = Plan(
            [OfficialData.Row("MYLICON", "157211209", "simeticona")],
            OfficialData.Presentation("1572112090011", "75 MG/ML EMU OR CT FR GOT X 15 ML"),
            OfficialData.Presentation("1572112090022", "75 MG/ML EMU OR CX 200 FR GOT X 15 ML (EMB HOSP)"));

        var product = Product(plan, "Mylicon");

        Assert.Equal(("simethicone=75 mg/ml", "75 mg/mL"), (product.StrengthKey, product.StrengthText));
        Assert.Equal((2, 0, 1, 0), (plan.Report.PresentationStrengthsRead, plan.Report.PresentationStrengthsUnknown, plan.Report.ProductsWithStrengthKey, plan.Report.ProductsWithSeveralStrengths));
    }

    [Fact]
    public void Plan_SeveralReadableStrengths_ShowsThemButHasNoKey()
    {
        var plan = Plan(
            [OfficialData.Row("TYLENOL", "157211214", "simeticona")],
            OfficialData.Presentation("1572112140178", "500 MG COM REV CT BL AL PVC X 100"),
            OfficialData.Presentation("1572112140186", "750 MG COM REV CT BL AL PVC X 20"));

        var product = Product(plan, "Tylenol");

        Assert.Null(product.StrengthKey);
        Assert.Equal("500 mg; 750 mg", product.StrengthText);
        Assert.Equal(1, plan.Report.ProductsWithSeveralStrengths);
    }

    [Fact]
    public void Plan_AnyUnreadablePresentation_LeavesNothing()
    {
        var plan = Plan(
            [OfficialData.Row("LUFTAL", "173900009", "simeticona")],
            OfficialData.Presentation("1739000090031", "75 MG ML EMU OR CT FR PLAS OPC GOT X 15 ML"),
            OfficialData.Presentation("1739000090056", "75 MG/ML EMU OR CT FR PLAS OPC GOT X 30 ML"));

        var product = Product(plan, "Luftal");

        Assert.Equal((null, null), (product.StrengthKey, product.StrengthText));
        Assert.Equal((1, 1), (plan.Report.PresentationStrengthsRead, plan.Report.PresentationStrengthsUnknown));
    }

    [Fact]
    public void Plan_CombinationWithTwoIngredients_HasNoStrengthEvenWhenTheTextReads()
    {
        var plan = Plan(
            [OfficialData.Row("ESPASMO", "167730170", "simeticona, cafeína")],
            OfficialData.Presentation("1677301700012", "75 MG/ML GOT X 10 ML"));

        Assert.Equal((null, null), (Product(plan, "Espasmo").StrengthKey, Product(plan, "Espasmo").StrengthText));
    }

    [Fact]
    public void Plan_NotifiedProductsAndRegistrationsWithoutPresentations_HaveNoStrength()
    {
        var plan = Plan([OfficialData.Row("SORINE JET", string.Empty, "cloreto de sódio"), OfficialData.Row("NOVALGINA", "186200018", "dipirona")]);

        Assert.All(plan.Products, product => Assert.Equal((null, null), (product.StrengthKey, product.StrengthText)));
    }

    [Fact]
    public void Plan_SameBrandInTwoFormsGetsEachFormsOwnStrength()
    {
        var plan = Plan(
            [OfficialData.Row("NOVALGINA", "186200018", "dipirona monoidratada")],
            OfficialData.Presentation("1862000180011", "500 MG/ML SOL OR CT FR GOT X 10 ML"),
            OfficialData.Presentation("1862000180029", "500 MG COM CT BL AL X 10"));

        var keys = plan.Products.Select(product => (product.Form, product.StrengthKey)).ToArray();

        Assert.Contains((ProductForm.Drops, "metamizole=500 mg/ml"), keys);
        Assert.Contains((ProductForm.Tablet, "metamizole=500 mg"), keys);
    }

    private static CuratedProductEntry Entry(string id, string name, string[] ingredients, params CuratedStrength[] strengths) =>
        new(id, name, ProductForm.Drops, ingredients, Reviewed: false, "test", Strengths: strengths.Length == 0 ? null : strengths);

    [Fact]
    public void CuratedPlan_StructuredStrength_BecomesTheKeyAndTheDisplayText()
    {
        var plan = CuratedCatalogPlanner.Plan(
            [
                Entry("fly-drops", "Fly", ["simeticona"], new CuratedStrength("simeticona", "150", "mg/mL")) with { Strength = "150 mg/mL" },
                Entry("sal-spray", "Sal", ["cloreto de sódio"], new CuratedStrength("cloreto de sódio", "9", "mg/mL")),
                Entry("none-drops", "None", ["simeticona"]),
            ],
            OfficialData.Dictionary);

        Assert.Equal(("simethicone=150 mg/ml", "150 mg/mL"), (plan.Products[0].StrengthKey, plan.Products[0].StrengthText));
        Assert.Equal(("sodium_chloride=9 mg/ml", "9 mg/mL"), (plan.Products[1].StrengthKey, plan.Products[1].StrengthText));
        Assert.Equal((null, null), (plan.Products[2].StrengthKey, plan.Products[2].StrengthText));
    }

    [Fact]
    public void CuratedPlan_SeveralIngredientsAndAStrain_AreSortedAndComplete()
    {
        var plan = CuratedCatalogPlanner.Plan(
            [Entry("combo-drops", "Combo", ["simeticona", "cafeína"], new CuratedStrength("simeticona", "75", "mg/mL"), new CuratedStrength("cafeína", "10", "mg/mL"))],
            OfficialData.Dictionary);

        Assert.Equal("caffeine=10 mg/ml;simethicone=75 mg/ml", plan.Products[0].StrengthKey);
    }

    [Fact]
    public void CuratedPlan_StrainStrength_IsAStrainToken()
    {
        var plan = CuratedCatalogPlanner.Plan([Entry("probiotic-drops", "Probiotic", ["simeticona"], new CuratedStrength("simeticona", Strain: "DSM 17938"))], OfficialData.Dictionary);

        Assert.Equal("simethicone=strain:dsm 17938", plan.Products[0].StrengthKey);
    }

    [Fact]
    public void CuratedPlan_IncompleteOrUnreadableStrengths_Throw()
    {
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-drops", "Alfa", ["simeticona", "cafeína"], new CuratedStrength("simeticona", "75", "mg/mL"))], OfficialData.Dictionary));
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-drops", "Alfa", ["simeticona"], new CuratedStrength("simeticona", "75", "furlongs"))], OfficialData.Dictionary));
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-drops", "Alfa", ["simeticona"], new CuratedStrength("simeticona", "75", "mg/mL"), new CuratedStrength("simeticona", "75", "mg/mL"))], OfficialData.Dictionary));
        Assert.Throws<ArgumentException>(() => CuratedCatalogPlanner.Plan([Entry("a-drops", "Alfa", ["simeticona"], new CuratedStrength("cafeína", "75", "mg/mL"))], OfficialData.Dictionary));
    }

    [Fact]
    public void CuratedPlan_TwoIsotonicSalineEntriesAgree_AndTheDifferentUnitFamilyIsNotConverted()
    {
        var plan = CuratedCatalogPlanner.Plan(
            [
                Entry("a-spray", "Alfa", ["cloreto de sódio"], new CuratedStrength("cloreto de sódio", "9", "mg/mL")),
                Entry("b-spray", "Beta", ["cloreto de sódio"], new CuratedStrength("cloreto de sódio", "0,9", "%")),
            ],
            OfficialData.Dictionary);

        Assert.Equal(StrengthComparison.Unknown, StrengthKeys.Compare(plan.Products[0].StrengthKey, plan.Products[1].StrengthKey));
    }
}

public sealed class StrengthVerificationTests
{
    private static CuratedProductEntry Entry(string name, params CuratedStrength[] strengths) =>
        new("e-drops", name, ProductForm.Drops, ["simeticona"], Reviewed: false, "test", Strengths: strengths.Length == 0 ? null : strengths);

    private static CuratedVerifier Verifier(params string[] presentations) =>
        new(
            [new AnvisaRegistrationDetail("MYLICON", "157211209", "Ativo", "simeticona", "1 - HOLDER", "MEDICAMENTO")],
            presentations.Select((text, index) => new CmedPresentationDetail($"157211209001{index}", "MYLICON", text, "SIMETICONA")).ToArray(),
            OfficialData.Dictionary);

    [Fact]
    public void Verify_StrengthEqualToCmed_Agrees()
    {
        var verification = Verifier("75 MG/ML EMU OR GOT X 15 ML").Verify(Entry("Mylicon", new CuratedStrength("simeticona", "75", "mg/mL")));

        Assert.Equal(StrengthOutcome.Agrees, verification.Strength!.Outcome);
        Assert.Contains(verification.Notes, note => note.StartsWith("Strength (Agrees)", StringComparison.Ordinal));
    }

    [Fact]
    public void Verify_StrengthInTheSameUnitButOtherValue_Differs()
    {
        var verification = Verifier("75 MG/ML EMU OR GOT X 15 ML").Verify(Entry("Mylicon", new CuratedStrength("simeticona", "150", "mg/mL")));

        Assert.Equal(StrengthOutcome.Differs, verification.Strength!.Outcome);
        Assert.Contains("75 mg/ml", verification.Strength.Detail);
    }

    [Fact]
    public void Verify_OtherUnitFamilyUnreadableOrAbsent_IsNeverADifference()
    {
        Assert.Equal(StrengthOutcome.NotComparable, Verifier("40 MG COM X 20").Verify(Entry("Mylicon", new CuratedStrength("simeticona", "75", "mg/mL"))).Strength!.Outcome);
        Assert.Equal(StrengthOutcome.NotReadable, Verifier("75 MG ML EMU OR GOT X 15 ML").Verify(Entry("Mylicon", new CuratedStrength("simeticona", "75", "mg/mL"))).Strength!.Outcome);
        Assert.Equal(StrengthOutcome.NoCmed, Verifier().Verify(Entry("Mylicon", new CuratedStrength("simeticona", "75", "mg/mL"))).Strength!.Outcome);
        Assert.Equal(StrengthOutcome.NotStated, Verifier("75 MG/ML EMU OR GOT X 15 ML").Verify(Entry("Mylicon")).Strength!.Outcome);
    }

    [Fact]
    public void Run_StrengthDifference_IsAnErrorFinding_AndUnconfirmedOnesAreWarnings()
    {
        var dictionary = OfficialData.Dictionary;
        var verifier = Verifier("75 MG/ML EMU OR GOT X 15 ML");
        var wrong = Entry("Mylicon", new CuratedStrength("simeticona", "150", "mg/mL"));

        var report = CuratedVerificationRunner.Run([wrong], verifier, dictionary, OfficialCatalogPlanner.Plan([], [], dictionary), new DateOnly(2026, 10, 23));

        Assert.Contains(report.Findings, finding => finding is { Code: "STRENGTH_MISMATCH", Severity: FindingSeverity.Error });
        Assert.True(report.HasFailures);
    }

    [Fact]
    public void Run_AlternativeChecksCarryTheAppLabel()
    {
        var dictionary = OfficialData.Dictionary;
        var verifier = new CuratedVerifier([], [], dictionary);
        var entries = new[]
        {
            Entry("Aaa Drops", new CuratedStrength("simeticona", "75", "mg/mL")) with { Id = "a-drops" },
            Entry("Bbb Drops", new CuratedStrength("simeticona", "150", "mg/mL")) with { Id = "b-drops" },
        };

        var report = CuratedVerificationRunner.Run(entries, verifier, dictionary, OfficialCatalogPlanner.Plan([], [], dictionary), new DateOnly(2026, 10, 23));

        Assert.Contains(report.Alternatives, check => check is { EntryId: "a-drops", AlternativeName: "Bbb Drops", MatchLevel: "DifferentStrength" });
    }
}
