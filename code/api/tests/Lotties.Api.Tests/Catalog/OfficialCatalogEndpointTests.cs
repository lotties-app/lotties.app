using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Catalog;
using Lotties.Infrastructure.Persistence.Seed;

namespace Lotties.Api.Tests.Catalog;

/// <summary>
/// Search by brand or ingredient, ambiguous names and the "products with this ingredient" page over an imported official
/// list plus curated products (synthetic rows, imported idempotently before each test; nothing is retired).
/// </summary>
public sealed class OfficialCatalogEndpointTests : IClassFixture<ApiFactory>
{
    private const string ProductsPath = "/api/v1/catalog/products";
    private readonly ApiFactory _factory;

    public OfficialCatalogEndpointTests(ApiFactory factory)
    {
        _factory = factory;
        var plan = OfficialImports.Plan(
            [
                OfficialImports.Row("LUFTAL", "173900009", "simeticona", "Inativo"),
                OfficialImports.Row("MYLICON", "157211209", "simeticona"),
                OfficialImports.Row("SIMETICONA", "113430133", "simeticona"),
                OfficialImports.Row("ESPASMO FLATOL", "167730170", "simeticona, metilbrometo de homatropina"),
                OfficialImports.Row("NOVALGINA", "186200018", "dipirona monoidratada"),
                OfficialImports.Row("SORINE", "105730050", "cloridrato de nafazolina"),
                OfficialImports.Row("SORINE", string.Empty, string.Empty),
            ],
            OfficialImports.Presentation("1739000090031", "75 MG ML EMU OR CT FR PLAS OPC GOT X 15 ML"),
            OfficialImports.Presentation("1572112090011", "75 MG/ML EMU OR CT FR GOT X 15 ML"),
            OfficialImports.Presentation("1057300500024", "0,5 MG/ML SOL NAS CT FR GOT PLAS TRANS X 30 ML"))
            .WithCurated(
                OfficialImports.Curated("luftal-drops", "Luftal", ProductForm.Drops, "simeticona"),
                OfficialImports.Curated("flygas-drops", "Flygas", ProductForm.Drops, "simeticona"),
                OfficialImports.Curated("sorine-saline-spray", "Sorine Solução Nasal Salina", ProductForm.Spray, "cloreto de sódio"));
        OfficialImports.ImportAsync(factory, plan).GetAwaiter().GetResult();
        var community = new { name = "Aerogasol Comunitario", form = "drops", country = "BR", substances = new[] { new { substanceId = MedicationCatalogSeed.Simethicone.Id } } };
        User().PostAsJsonAsync(ProductsPath, community).GetAwaiter().GetResult().Dispose();
    }

    private HttpClient User() => _factory.CreateClientFor(TestUsers.NewSubject());

    private async Task<JsonElement> SearchAsync(string query) => await (await User().GetAsync($"{ProductsPath}?q={Uri.EscapeDataString(query)}&limit=20")).ReadAsync<JsonElement>();

    private static IEnumerable<string> Names(JsonElement results, string matchedBy) =>
        results.EnumerateArray().Where(result => result.GetProperty("matchedBy").GetString() == matchedBy).Select(result => result.GetProperty("product").GetProperty("name").GetString()!);

    [Fact]
    public async Task Search_Brand_ReturnsTheCuratedProductWithSiblingsInTheSameFormFirstThenOfficialFirst()
    {
        var results = await SearchAsync("luftal");

        var luftal = Assert.Single(results.EnumerateArray()).GetProperty("product");
        Assert.Equal(("Luftal", "curated", "curated", false), (luftal.GetProperty("name").GetString(), luftal.GetProperty("status").GetString(), luftal.GetProperty("source").GetString(), luftal.GetProperty("inactive").GetBoolean()));
        var siblings = results[0].GetProperty("sameActiveIngredient").EnumerateArray().Select(sibling => (sibling.GetProperty("name").GetString(), sibling.GetProperty("status").GetString())).ToArray();
        // Same form (drops) first, official before curated before community; "Simeticona" has no known form (other), so it comes after.
        Assert.Equal([("Mylicon", "official"), ("Flygas", "curated"), ("Aerogasol Comunitario", "community"), ("Simeticona", "official")], siblings);
    }

    [Fact]
    public async Task Search_AmbiguousName_ReturnsEveryVariantTogetherWithItsIngredients()
    {
        var results = await SearchAsync("sorine");

        var products = results.EnumerateArray().Select(result => result.GetProperty("product")).ToArray();
        var variants = products.Where(product => product.GetProperty("ambiguousName").GetString() == "Sorine").ToArray();
        Assert.Equal(["Sorine (cloridrato de nafazolina)", "Sorine (princípio ativo não informado)"], variants.Select(variant => variant.GetProperty("name").GetString()));
        Assert.Equal([1, 0], variants.Select(variant => variant.GetProperty("substances").GetArrayLength()));
        Assert.Equal("naphazoline", variants[0].GetProperty("substances")[0].GetProperty("key").GetString());
        var saline = products.Single(product => product.GetProperty("name").GetString() == "Sorine Solução Nasal Salina");
        Assert.Equal(("curated", JsonValueKind.Null), (saline.GetProperty("status").GetString(), saline.GetProperty("ambiguousName").ValueKind));
    }

    [Fact]
    public async Task Search_ForOneVariant_StillListsTheOtherVariantsNextToIt()
    {
        var results = await SearchAsync("sorine (princ");

        Assert.Equal(["Sorine (princípio ativo não informado)", "Sorine (cloridrato de nafazolina)"], Names(results, "name").Take(2));
    }

    [Theory]
    [InlineData("simeticona")]
    [InlineData("SIMETHICONE")]
    [InlineData("simethicon")]
    public async Task Search_Ingredient_ListsTheProductsContainingIt(string query)
    {
        var results = await SearchAsync(query);

        Assert.Equal(["Aerogasol Comunitario", "Espasmo Flatol", "Flygas", "Luftal", "Mylicon"], Names(results, "substance").Where(name => name != "Simeticona").Order());
    }

    [Fact]
    public async Task Search_PortugueseSaltName_FindsTheBaseSubstance()
    {
        var results = await SearchAsync("dipirona");

        Assert.Contains("Novalgina", Names(results, "substance"));
    }

    [Fact]
    public async Task SubstanceProducts_PagesOfficialThenCuratedThenCommunity()
    {
        var client = User();

        var first = await (await client.GetAsync($"/api/v1/catalog/substances/{MedicationCatalogSeed.Simethicone.Id}/products?limit=2")).ReadAsync<JsonElement>();
        var rest = await (await client.GetAsync($"/api/v1/catalog/substances/{MedicationCatalogSeed.Simethicone.Id}/products?offset=2&limit=50")).ReadAsync<JsonElement>();

        var names = first.GetProperty("items").EnumerateArray().Concat(rest.GetProperty("items").EnumerateArray()).Select(item => item.GetProperty("name").GetString()).ToArray();
        Assert.Equal(("simethicone", 6, 0, 2), (first.GetProperty("substance").GetProperty("key").GetString(), first.GetProperty("total").GetInt32(), first.GetProperty("offset").GetInt32(), first.GetProperty("limit").GetInt32()));
        Assert.Equal(["Espasmo Flatol", "Mylicon", "Simeticona", "Flygas", "Luftal", "Aerogasol Comunitario"], names);
    }

    [Fact]
    public async Task SubstanceProducts_UnknownSubstance_Returns404()
    {
        var response = await User().GetAsync($"/api/v1/catalog/substances/{Guid.NewGuid()}/products");

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "substance_not_found");
    }

    [Theory]
    [InlineData("?limit=0")]
    [InlineData("?limit=51")]
    [InlineData("?offset=-1")]
    public async Task SubstanceProducts_InvalidPage_Returns400(string query)
    {
        var response = await User().GetAsync($"/api/v1/catalog/substances/{MedicationCatalogSeed.Simethicone.Id}/products{query}");

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task SubstanceProducts_Anonymous_Returns401()
    {
        var response = await _factory.CreateClient().GetAsync($"/api/v1/catalog/substances/{MedicationCatalogSeed.Simethicone.Id}/products");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
