using Lotties.Api.Tests.Support;
using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Infrastructure.Catalog.Official;

namespace Lotties.Api.Tests.Catalog;

/// <summary>
/// The pool of products with the same ingredients is capped (50 rows): the ones with the searched product's strength and
/// form are loaded first, so an equivalent product is never lost behind many alphabetically earlier ones.
/// </summary>
public sealed class AlternativePoolEndpointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AlternativePoolEndpointTests(ApiFactory factory)
    {
        _factory = factory;
        var rows = Enumerable.Range(1, 60).Select(index => OfficialImports.Row($"PIRAX {index:00}", $"1992{index:05}", "dipirona")).Append(OfficialImports.Row("QUIRAX EQUIVALENTE", "199299999", "dipirona")).ToArray();
        var presentations = Enumerable.Range(1, 60).Select(index => OfficialImports.Presentation($"1992{index:05}0010", "1000 MG COM CT BL AL X 10")).Append(OfficialImports.Presentation("1992999990010", "500 MG COM CT BL AL X 10")).ToArray();
        var plan = OfficialImports.Plan(rows, presentations)
            .WithCurated(OfficialImports.Curated("rapirax-tablet", "Rapirax Curado", ProductForm.Tablet, "dipirona") with { Strengths = [new CuratedStrength("dipirona", "500", "mg")] });
        OfficialImports.ImportAsync(factory, plan).GetAwaiter().GetResult();
    }

    [Fact]
    public async Task Search_EquivalentProductBeyondTheCapOfTheSamePool_IsStillListedFirst()
    {
        var response = await _factory.CreateClientFor(TestUsers.NewSubject()).GetAsync("/api/v1/catalog/products?q=rapirax&limit=5");
        var result = (await response.ReadAsync<System.Text.Json.JsonElement>()).EnumerateArray().First();

        var first = result.GetProperty("sameActiveIngredient")[0];
        Assert.Equal(("Quirax Equivalente", "equivalent"), (first.GetProperty("name").GetString(), first.GetProperty("matchLevel").GetString()));
        Assert.All(result.GetProperty("sameActiveIngredient").EnumerateArray().Skip(1), sibling => Assert.Equal("differentStrength", sibling.GetProperty("matchLevel").GetString()));
    }
}
