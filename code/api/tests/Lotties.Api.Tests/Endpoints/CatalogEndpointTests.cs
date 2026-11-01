using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Infrastructure.Persistence.Seed;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// The shared catalog is instance-wide, so every test uses product names no other test uses (a test-specific word);
/// search tests assert on their own products only.
/// </summary>
public sealed class CatalogEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProductsPath = "/api/v1/catalog/products";
    private const string SubstancesPath = "/api/v1/catalog/substances";

    private static readonly Guid Simethicone = MedicationCatalogSeed.Simethicone.Id;
    private static readonly Guid Paracetamol = MedicationCatalogSeed.Paracetamol.Id;

    private HttpClient User() => factory.CreateClientFor(TestUsers.NewSubject());

    private static object Product(string name, string form = "drops", string country = "BR", params Guid[] substances) =>
        new { name, form, country, substances = substances.Select(id => new { substanceId = id }).ToArray() };

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private async Task<JsonElement> CreateAsync(HttpClient client, object body)
    {
        var response = await client.PostAsJsonAsync(ProductsPath, body);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await JsonAsync(response);
    }

    [Fact]
    public async Task Substances_Anyone_ListsTheSeededGenericNames()
    {
        var substances = await JsonAsync(await User().GetAsync(SubstancesPath));

        var simethicone = substances.EnumerateArray().Single(item => item.GetProperty("key").GetString() == "simethicone");
        Assert.Equal(6, substances.GetArrayLength());
        Assert.Equal(("Simethicone", "Simeticona"), (simethicone.GetProperty("nameEn").GetString(), simethicone.GetProperty("namePtBr").GetString()));
    }

    [Theory]
    [InlineData("dipirona", "metamizole")]
    [InlineData("acetaminofen", "paracetamol")]
    [InlineData("colecalc", "cholecalciferol")]
    public async Task Substances_Query_MatchesBothLanguagesSynonymsAndTypos(string query, string expectedKey)
    {
        var substances = await JsonAsync(await User().GetAsync($"{SubstancesPath}?q={query}"));

        Assert.Equal(expectedKey, substances.EnumerateArray().First().GetProperty("key").GetString());
    }

    [Fact]
    public async Task Catalog_Anonymous_Returns401()
    {
        var search = await factory.CreateClient().GetAsync($"{ProductsPath}?q=luftal");
        var create = await factory.CreateClient().PostAsJsonAsync(ProductsPath, Product("Anon"));

        Assert.Equal((HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized), (search.StatusCode, create.StatusCode));
    }

    [Theory]
    [InlineData("")]
    [InlineData("?q=a")]
    [InlineData("?q=lu&limit=0")]
    [InlineData("?q=lu&limit=21")]
    public async Task Search_InvalidQuery_Returns400(string query)
    {
        var response = await User().GetAsync($"{ProductsPath}{query}");

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Create_Valid_Returns201CommunityProductReadableById()
    {
        var created = await CreateAsync(User(), new
        {
            name = "  Quorvatil   Gotas ",
            form = "drops",
            country = "br",
            substances = new[] { new { substanceId = Simethicone, strength = (object)new { amount = 75, unit = "mg", perAmount = 1, perUnit = "mL" } } },
        });

        Assert.Equal(("Quorvatil Gotas", "drops", "BR", "community"), (created.GetProperty("name").GetString(), created.GetProperty("form").GetString(), created.GetProperty("country").GetString(), created.GetProperty("status").GetString()));
        var substance = created.GetProperty("substances")[0];
        Assert.Equal(("simethicone", "Simeticona", 75m), (substance.GetProperty("key").GetString(), substance.GetProperty("namePtBr").GetString(), substance.GetProperty("strength").GetProperty("amount").GetDecimal()));
        Assert.False(created.TryGetProperty("createdBy", out _));
        var read = await JsonAsync(await User().GetAsync($"{ProductsPath}/{created.GetProperty("id").GetGuid()}"));
        Assert.Equal("Quorvatil Gotas", read.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Create_SameNormalizedNameFormAndCountry_Returns409WithTheExistingProduct()
    {
        var first = await CreateAsync(User(), Product("Zentrafy", substances: Simethicone));

        var duplicate = await User().PostAsJsonAsync(ProductsPath, Product(" ZENTRÁFFY! ", substances: Paracetamol));

        var problem = await duplicate.AssertProblemAsync(HttpStatusCode.Conflict, "product_exists");
        Assert.Equal(first.GetProperty("id").GetGuid(), problem.GetProperty("product").GetProperty("id").GetGuid());
        Assert.Equal(1, await factory.QueryAsync(context => context.Products.CountAsync(product => product.NormalizedName == "zentrafy")));
    }

    [Fact]
    public async Task Create_SameNameOtherFormOrCountry_IsAnotherProduct()
    {
        await CreateAsync(User(), Product("Plorimex"));

        await CreateAsync(User(), Product("Plorimex", form: "syrup"));
        await CreateAsync(User(), Product("Plorimex", country: "PT"));

        Assert.Equal(3, await factory.QueryAsync(context => context.Products.CountAsync(product => product.NormalizedName == "plorimex")));
    }

    [Theory]
    [InlineData("spray")]
    [InlineData("ointment")]
    [InlineData("suppository")]
    [InlineData("inhaler")]
    public async Task Create_CountedUnitForm_Returns201WithTheForm(string form)
    {
        var created = await CreateAsync(User(), Product($"Nasorvex {form}", form: form));

        Assert.Equal(form, created.GetProperty("form").GetString());
        var read = await JsonAsync(await User().GetAsync($"{ProductsPath}/{created.GetProperty("id").GetGuid()}"));
        Assert.Equal(form, read.GetProperty("form").GetString());
    }

    [Fact]
    public async Task Create_UnknownSubstance_Returns422()
    {
        var unknown = Guid.NewGuid();

        var response = await User().PostAsJsonAsync(ProductsPath, Product("Trevabil", substances: unknown));

        var problem = await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "substance_not_found");
        Assert.Equal(unknown, problem.GetProperty("substanceIds")[0].GetGuid());
    }

    [Theory]
    [InlineData("""{"name":"x","form":"drops","country":"BR"}""")]
    [InlineData("""{"name":"Valid name","country":"BR"}""")]
    [InlineData("""{"name":"Valid name","form":"drops","country":"Brazil"}""")]
    [InlineData("""{"name":"Valid name","form":"capsule","country":"BR"}""")]
    [InlineData("""{"name":"Bad\u0007name","form":"drops","country":"BR"}""")]
    [InlineData("""{"name":"Valid name","form":"drops","country":"BR","substances":[{"substanceId":"2f468145-66a8-4fad-a6c1-45ce69aaeaa3","strength":{"amount":0,"unit":"mg"}}]}""")]
    public async Task Create_Invalid_Returns400(string json)
    {
        var response = await User().PostAsync(ProductsPath, new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_MoreThanCatalogWritePermitsPerMinute_Returns429()
    {
        using var limited = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection([KeyValuePair.Create("RequestLimits:CatalogWritePermitsPerMinute", (string?)"2")])));
        var client = limited.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, TestUsers.NewSubject());

        var statuses = new List<HttpStatusCode>();
        foreach (var name in new[] { "Limitona", "Limitorex", "Limitavix" })
        {
            statuses.Add((await client.PostAsJsonAsync(ProductsPath, Product(name))).StatusCode);
        }

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created, HttpStatusCode.TooManyRequests], statuses);
    }

    [Fact]
    public async Task Search_TypoPrefixAndSubstance_RanksAndListsSameActiveIngredient()
    {
        var client = User();
        var vexilor = await CreateAsync(client, Product("Vexilor", substances: Simethicone));
        var brontagas = await CreateAsync(client, Product("Brontagas", substances: Simethicone));
        await CreateAsync(client, Product("Vexilor Kids", substances: Paracetamol));

        var byTypo = await JsonAsync(await client.GetAsync($"{ProductsPath}?q=vexilr"));
        var byPrefix = await JsonAsync(await client.GetAsync($"{ProductsPath}?q=VEXI&limit=5"));
        var bySubstance = await JsonAsync(await client.GetAsync($"{ProductsPath}?q=simeticona&limit=20"));

        var typoMatch = byTypo[0];
        Assert.Equal((vexilor.GetProperty("id").GetGuid(), "name", 1), (typoMatch.GetProperty("product").GetProperty("id").GetGuid(), typoMatch.GetProperty("matchedBy").GetString(), typoMatch.GetProperty("distance").GetInt32()));
        Assert.Contains(typoMatch.GetProperty("sameActiveIngredient").EnumerateArray(), sibling => sibling.GetProperty("id").GetGuid() == brontagas.GetProperty("id").GetGuid());
        Assert.Equal(["Vexilor", "Vexilor Kids"], byPrefix.EnumerateArray().Select(item => item.GetProperty("product").GetProperty("name").GetString()));
        Assert.Contains(bySubstance.EnumerateArray(), item => item.GetProperty("product").GetProperty("name").GetString() == "Brontagas" && item.GetProperty("matchedBy").GetString() == "substance");
    }

    [Fact]
    public async Task Search_MergedProductName_FindsItsTargetAsAlias()
    {
        var client = User();
        var target = await CreateAsync(client, Product("Morvalix", substances: Simethicone));
        var duplicate = await CreateAsync(client, Product("Morvalyx Gotinhas", substances: Simethicone));
        await factory.SeedAsync(async context =>
        {
            var stored = await context.Products.SingleAsync(product => product.Id == duplicate.GetProperty("id").GetGuid());
            stored.MergeInto(await context.Products.SingleAsync(product => product.Id == target.GetProperty("id").GetGuid()));
        });

        var results = await JsonAsync(await client.GetAsync($"{ProductsPath}?q=morvalyx%20got"));

        var match = Assert.Single(results.EnumerateArray());
        Assert.Equal((target.GetProperty("id").GetGuid(), "alias"), (match.GetProperty("product").GetProperty("id").GetGuid(), match.GetProperty("matchedBy").GetString()));
    }

    [Fact]
    public async Task GetProduct_Unknown_Returns404()
    {
        var response = await User().GetAsync($"{ProductsPath}/{Guid.NewGuid()}");

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "product_not_found");
    }

    [Fact]
    public async Task MedicationLink_WithoutName_UsesTheProductNameAndReturnsProductId()
    {
        var baby = await factory.SeedBabyAsync();
        var product = await CreateAsync(User(), Product("Lumbrafix", substances: Simethicone));
        var productId = product.GetProperty("id").GetGuid();

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{Guid.NewGuid()}", new { productId, isUsual = true });

        var medication = await JsonAsync(response);
        Assert.Equal(("Lumbrafix", productId), (medication.GetProperty("name").GetString(), medication.GetProperty("productId").GetGuid()));
    }

    [Fact]
    public async Task MedicationLink_WithNickname_KeepsTheNickname()
    {
        var baby = await factory.SeedBabyAsync();
        var product = await CreateAsync(User(), Product("Gastrovel", substances: Simethicone));

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(
            $"/api/v1/babies/{baby.BabyId}/medications/{Guid.NewGuid()}",
            new { name = "Belly drops", productId = product.GetProperty("id").GetGuid(), isUsual = false });

        Assert.Equal("Belly drops", (await JsonAsync(response)).GetProperty("name").GetString());
    }

    [Fact]
    public async Task MedicationLink_UnknownProduct_Returns422()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{Guid.NewGuid()}", new { name = "X", productId = Guid.NewGuid() });

        var problem = await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "invalid_product_link");
        Assert.Equal("not_found", problem.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task MedicationLink_MergedProduct_Returns422WithTheTargetButReplaysOfAnExistingLinkStillWork()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var client = factory.CreateClientFor(baby.OwnerSubject);
        var target = await CreateAsync(User(), Product("Sorbanil"));
        var merged = await CreateAsync(User(), Product("Sorbanyl Plus"));
        var medicationPath = $"/api/v1/babies/{baby.BabyId}/medications/{Guid.NewGuid()}";
        var linked = new { name = "Mine", productId = merged.GetProperty("id").GetGuid() };
        await JsonAsync(await client.PutAsJsonAsync(medicationPath, linked));
        await factory.SeedAsync(async context =>
        {
            var stored = await context.Products.SingleAsync(product => product.Id == merged.GetProperty("id").GetGuid());
            stored.MergeInto(await context.Products.SingleAsync(product => product.Id == target.GetProperty("id").GetGuid()));
        });

        var replay = await client.PutAsJsonAsync(medicationPath, linked);
        var newLink = await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{Guid.NewGuid()}", linked);

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var problem = await newLink.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "invalid_product_link");
        Assert.Equal(("merged", target.GetProperty("id").GetGuid()), (problem.GetProperty("reason").GetString(), problem.GetProperty("mergedIntoId").GetGuid()));
    }
}
