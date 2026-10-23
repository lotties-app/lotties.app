using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Infrastructure.Catalog.Official;

namespace Lotties.Api.Tests.Catalog;

/// <summary>
/// The "same active ingredient" list is tiered and labelled: equivalent only with the same ingredients, strength and
/// known form; synthetic registrations and presentations only.
/// </summary>
public sealed class AlternativeLevelEndpointTests : IClassFixture<ApiFactory>
{
    private const string ProductsPath = "/api/v1/catalog/products";
    private readonly ApiFactory _factory;

    public AlternativeLevelEndpointTests(ApiFactory factory)
    {
        _factory = factory;
        var plan = OfficialImports.Plan(
            [
                OfficialImports.Row("ZALINE SPRAY", "199100001", "cloreto de sódio"),
                OfficialImports.Row("ZALINE FORTE", "199100002", "cloreto de sódio"),
                OfficialImports.Row("ZALINE GOTAS", "199100003", "cloreto de sódio"),
                OfficialImports.Row("ZALINE SEM FORCA", "199100004", "cloreto de sódio"),
                OfficialImports.Row("ZALINE COMBO", "199100005", "cloreto de sódio, simeticona"),
            ],
            OfficialImports.Presentation("1991000010019", "9 MG/ML SOL NAS CT FR PLAS OPC SPRAY X 100 ML"),
            OfficialImports.Presentation("1991000020016", "30 MG/ML SOL NAS CT FR PLAS OPC SPRAY X 100 ML"),
            OfficialImports.Presentation("1991000030013", "9 MG/ML SOL NAS CT FR GOT PLAS OPC X 30 ML"),
            OfficialImports.Presentation("1991000040010", "SOL NAS CT FR PLAS OPC SPRAY X 50 ML"),
            OfficialImports.Presentation("1991000050017", "9 MG/ML + 75 MG/ML SOL NAS CT FR PLAS OPC SPRAY X 50 ML"))
            .WithCurated(
                OfficialImports.Curated("zaline-curado-spray", "Zaline Curado", ProductForm.Spray, "cloreto de sódio") with
                {
                    Strength = "9 mg/mL (0,9%)",
                    Strengths = [new CuratedStrength("cloreto de sódio", "9", "mg/mL")],
                });
        OfficialImports.ImportAsync(factory, plan).GetAwaiter().GetResult();
    }

    private async Task<JsonElement> ResultAsync(string query) =>
        (await (await _factory.CreateClientFor(TestUsers.NewSubject()).GetAsync($"{ProductsPath}?q={Uri.EscapeDataString(query)}&limit=20")).ReadAsync<JsonElement>()).EnumerateArray().First();

    private static string[] Alternatives(JsonElement result) =>
        result.GetProperty("sameActiveIngredient").EnumerateArray().Select(sibling => $"{sibling.GetProperty("name").GetString()}:{sibling.GetProperty("matchLevel").GetString()}").ToArray();

    [Fact]
    public async Task Search_CuratedSalineSpray_ListsEquivalentThenOtherFormThenUnknownThenDifferentStrength()
    {
        var result = await ResultAsync("zaline curado");

        Assert.Equal(["Zaline Spray:equivalent", "Zaline Gotas:differentForm", "Zaline sem Forca:strengthNotKnown", "Zaline Forte:differentStrength"], Alternatives(result));
        Assert.Equal("9 mg/mL (0,9%)", result.GetProperty("product").GetProperty("strengthText").GetString());
    }

    [Fact]
    public async Task Search_Alternatives_CarryTheStrengthTextOfEachSibling()
    {
        var result = await ResultAsync("zaline curado");

        var texts = result.GetProperty("sameActiveIngredient").EnumerateArray().ToDictionary(sibling => sibling.GetProperty("name").GetString()!, sibling => sibling.GetProperty("strengthText").GetString());
        Assert.Equal(("9 mg/mL", "9 mg/mL", null, "30 mg/mL"), (texts["Zaline Spray"], texts["Zaline Gotas"], texts["Zaline sem Forca"], texts["Zaline Forte"]));
    }

    [Fact]
    public async Task Search_OfficialSprayAndHypertonicSpray_AreNeverEquivalentToEachOther()
    {
        var iso = Alternatives(await ResultAsync("zaline spray"));
        var hyper = Alternatives(await ResultAsync("zaline forte"));

        Assert.Contains("Zaline Forte:differentStrength", iso);
        Assert.Contains("Zaline Curado:equivalent", iso);
        Assert.Equal("differentStrength", hyper.First(item => item.StartsWith("Zaline Spray", StringComparison.Ordinal)).Split(':')[1]);
        Assert.DoesNotContain(hyper, item => item.EndsWith(":equivalent", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Search_ProductWithoutAStructuredStrength_ListsEverythingAsStrengthNotKnown_WithoutAnEquivalent()
    {
        var unknown = await ResultAsync("zaline sem forca");

        Assert.All(Alternatives(unknown), item => Assert.EndsWith(":strengthNotKnown", item, StringComparison.Ordinal));
        Assert.Equal(JsonValueKind.Null, unknown.GetProperty("product").GetProperty("strengthText").ValueKind);
    }

    [Fact]
    public async Task Search_ACombinationHasNoStrengthAndNoAlternativeWithASingleIngredient()
    {
        var combo = await ResultAsync("zaline combo");

        Assert.Empty(Alternatives(combo));
        Assert.Equal(JsonValueKind.Null, combo.GetProperty("product").GetProperty("strengthText").ValueKind);
    }

    [Fact]
    public async Task Search_ProductsStillCarryAllEarlierFields_SoOlderClientsKeepWorking()
    {
        var result = await ResultAsync("zaline curado");

        var sibling = result.GetProperty("sameActiveIngredient")[0];
        Assert.All(new[] { "id", "name", "form", "country", "status", "strengthText", "matchLevel" }, field => Assert.True(sibling.TryGetProperty(field, out _), field));
    }
}
