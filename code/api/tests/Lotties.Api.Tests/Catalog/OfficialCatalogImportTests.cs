using System.Net;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Catalog;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Catalog.Official;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Catalog;

/// <summary>Synthetic ANVISA rows and curated entries (never real downloads) and a helper that runs the importer against a test database.</summary>
internal static class OfficialImports
{
    public static AnvisaRegistrationRow Row(string name, string number, string ingredients, string status = "Ativo") => new(name, number, status, ingredients);

    public static CmedPresentationRow Presentation(string registration, string presentation) => new(registration, "X", presentation);

    public static CuratedProductEntry Curated(string id, string name, ProductForm form, params string[] ingredients) => new(id, name, form, ingredients, Reviewed: false, "test");

    public static OfficialCatalogPlan Plan(IReadOnlyList<AnvisaRegistrationRow> rows, params CmedPresentationRow[] presentations) =>
        OfficialCatalogPlanner.Plan(rows, presentations, CuratedSubstances.Dictionary());

    public static OfficialCatalogPlan WithCurated(this OfficialCatalogPlan plan, params CuratedProductEntry[] entries)
    {
        var curated = CuratedCatalogPlanner.Plan(entries, CuratedSubstances.Dictionary());
        return plan.With(curated.Products, curated.Substances);
    }

    public static async Task<OfficialImportResult> ImportAsync(ApiFactory factory, OfficialCatalogPlan plan, bool retireMissing = false, DateTimeOffset? now = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        var importer = new OfficialCatalogImporter(context, new FixedTimeProvider(now ?? TestUsers.Now), NullLogger<OfficialCatalogImporter>.Instance);
        return await importer.ImportAsync(plan, retireMissing ? OfficialImportOptions.Full : OfficialImportOptions.Partial);
    }

    public static Task<Product> ProductAsync(ApiFactory factory, string normalizedName) =>
        factory.QueryAsync(context => context.Products.Include(product => product.Substances).SingleAsync(product => product.NormalizedName == normalizedName));
}

/// <summary>The importer on SQLite: idempotent upserts, substance reuse, adoption rules, curated products (no retiring here).</summary>
public sealed class OfficialCatalogImportTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task ImportAsync_SamePlanTwice_AddsOnceThenChangesNothing()
    {
        var plan = OfficialImports.Plan(
            [OfficialImports.Row("QUIMERAL", "199000001", "simeticona"), OfficialImports.Row("QUIMERAL PLUS", "199000002", "simeticona, cloridrato de quimerona")],
            OfficialImports.Presentation("1990000010011", "75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML"),
            OfficialImports.Presentation("1990000010029", "40 MG COM CT BL AL X 20"))
            .WithCurated(OfficialImports.Curated("quimeral-curado-drops", "Quimeral Curado", ProductForm.Drops, "simeticona"));

        var first = await OfficialImports.ImportAsync(factory, plan);
        var second = await OfficialImports.ImportAsync(factory, plan);

        Assert.Equal((4, 1), (first.ProductsAdded, first.SubstancesAdded));
        Assert.Equal((0, 0, 0, 4, 0), (second.ProductsAdded, second.ProductsUpdated, second.SubstancesAdded, second.ProductsUnchanged, second.ProductsRetired));
        Assert.Equal(4, await factory.QueryAsync(context => context.Products.CountAsync(product => product.NormalizedName.StartsWith("quimeral"))));
        var curated = await OfficialImports.ProductAsync(factory, "quimeralcurado");
        Assert.Equal((ProductStatus.Curated, "curated", "quimeral-curado-drops", OfficialCatalogImporter.ProductId("curated", "quimeral-curado-drops")), (curated.Status, curated.Source, curated.ExternalRef, curated.Id));
    }

    [Fact]
    public async Task ImportAsync_CuratedAlias_IsMergedIntoItsProductOnceAndKeepsAnExistingRowId()
    {
        var target = OfficialImports.Curated("zelgas-gotas-drops", "Zelgas Gotas", ProductForm.Drops, "simeticona");
        var oldName = OfficialImports.Curated("zelgas-drops", "Zelgas", ProductForm.Drops, "simeticona");
        var before = OfficialImports.Plan([]).WithCurated(target, oldName);
        var after = OfficialImports.Plan([]).WithCurated(target, oldName with { AliasOf = "zelgas-gotas-drops" });

        await OfficialImports.ImportAsync(factory, before);
        var existing = await OfficialImports.ProductAsync(factory, "zelgas");
        var merged = await OfficialImports.ImportAsync(factory, after);
        var again = await OfficialImports.ImportAsync(factory, after);

        var alias = await OfficialImports.ProductAsync(factory, "zelgas");
        var product = await OfficialImports.ProductAsync(factory, "zelgasgotas");
        Assert.Null(existing.MergedIntoId);
        Assert.Equal((existing.Id, product.Id), (alias.Id, alias.MergedIntoId));
        Assert.Equal((1, 0, 0), (merged.AliasesMerged, merged.Skipped.Count, merged.ProductsUpdated));
        Assert.Equal((0, 0, 0), (again.AliasesMerged, again.Skipped.Count, again.ProductsUpdated));
    }

    [Fact]
    public async Task ImportAsync_NewCuratedAlias_IsAddedAlreadyMerged()
    {
        var plan = OfficialImports.Plan([]).WithCurated(
            OfficialImports.Curated("quelgas-gotas-drops", "Quelgas Gotas", ProductForm.Drops, "simeticona"),
            OfficialImports.Curated("quelgas-drops", "Quelgas", ProductForm.Drops, "simeticona") with { AliasOf = "quelgas-gotas-drops" });

        var result = await OfficialImports.ImportAsync(factory, plan);

        var alias = await OfficialImports.ProductAsync(factory, "quelgas");
        var product = await OfficialImports.ProductAsync(factory, "quelgasgotas");
        Assert.Equal((2, 1), (result.ProductsAdded, result.AliasesMerged));
        Assert.Equal(product.Id, alias.MergedIntoId);
    }

    [Fact]
    public async Task ImportAsync_ReusesSeededSubstancesAndUsesDeterministicIds()
    {
        var plan = OfficialImports.Plan([OfficialImports.Row("VORTALIX", "199000010", "dipirona monoidratada, cloridrato de vortalina")]);

        await OfficialImports.ImportAsync(factory, plan);

        var product = await OfficialImports.ProductAsync(factory, "vortalix");
        Assert.Equal((OfficialCatalogImporter.ProductId("anvisa", "vortalix:other"), ProductStatus.Official, "anvisa", "vortalix:other"), (product.Id, product.Status, product.Source, product.ExternalRef));
        Assert.Contains(MedicationCatalogSeed.Metamizole.Id, product.SubstanceIds);
        Assert.Contains(OfficialCatalogImporter.SubstanceId("cloridrato_de_vortalina"), product.SubstanceIds);
        var derived = await factory.QueryAsync(context => context.Substances.SingleAsync(substance => substance.Key == "cloridrato_de_vortalina"));
        Assert.Equal(("Cloridrato de Vortalina", "Cloridrato de Vortalina"), (derived.NameEn, derived.NamePtBr));
        Assert.Equal(1, await factory.QueryAsync(context => context.Substances.CountAsync(substance => substance.Key == "metamizole")));
    }

    [Fact]
    public async Task ImportAsync_CommunityProductWithTheSameKey_IsAdoptedKeepingItsId()
    {
        var community = await SeedCommunityAsync("Zelfagas", ProductForm.Drops);
        var plan = OfficialImports.Plan(
            [OfficialImports.Row("ZELFAGAS", "199000020", "simeticona")],
            OfficialImports.Presentation("1990000200011", "75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML"));

        var result = await OfficialImports.ImportAsync(factory, plan);

        Assert.Equal((1, 0), (result.ProductsAdopted, result.ProductsAdded));
        var adopted = await OfficialImports.ProductAsync(factory, "zelfagas");
        Assert.Equal((community.Id, ProductStatus.Official, "anvisa"), (adopted.Id, adopted.Status, adopted.Source));
        Assert.Equal([MedicationCatalogSeed.Simethicone.Id], adopted.SubstanceIds);
    }

    [Fact]
    public async Task ImportAsync_RecordWithoutIngredient_NeverTakesOverACommunityProduct()
    {
        var community = await SeedCommunityAsync("Brumasal", ProductForm.Other, MedicationCatalogSeed.Paracetamol.Id);
        var plan = OfficialImports.Plan([OfficialImports.Row("BRUMASAL", string.Empty, string.Empty)]);

        var result = await OfficialImports.ImportAsync(factory, plan);

        Assert.Equal((0, 0), (result.ProductsAdded, result.ProductsAdopted));
        Assert.Contains(result.Skipped, reason => reason.Contains("community product", StringComparison.Ordinal));
        var kept = await OfficialImports.ProductAsync(factory, "brumasal");
        Assert.Equal((community.Id, ProductStatus.Community, (string?)null), (kept.Id, kept.Status, kept.Source));
        Assert.Equal([MedicationCatalogSeed.Paracetamol.Id], kept.SubstanceIds);
    }

    [Fact]
    public async Task ImportAsync_CuratedNameUsedByAnOfficialProduct_IsSkippedAndTheOfficialOneStays()
    {
        var plan = OfficialImports.Plan([OfficialImports.Row("TRESGAS", "199000060", "simeticona")])
            .WithCurated(OfficialImports.Curated("tresgas-other", "Tresgas", ProductForm.Other, "cloreto de sódio"));

        var result = await OfficialImports.ImportAsync(factory, plan);

        Assert.Equal(1, result.ProductsAdded);
        Assert.Contains(result.Skipped, reason => reason.StartsWith("curated/tresgas-other", StringComparison.Ordinal));
        var stored = await OfficialImports.ProductAsync(factory, "tresgas");
        Assert.Equal("anvisa", stored.Source);
        Assert.Equal([MedicationCatalogSeed.Simethicone.Id], stored.SubstanceIds);
    }

    [Fact]
    public async Task ImportAsync_AmbiguousName_StoresEveryVariantWithItsIngredientsAndTheSharedName()
    {
        var plan = OfficialImports.Plan(
        [
            OfficialImports.Row("NASOLIX", "199000070", "cloridrato de nafazolina"),
            OfficialImports.Row("NASOLIX", string.Empty, string.Empty),
            OfficialImports.Row("NASOLIX", "199000071", "cloreto de sódio", "Inativo"),
        ]);

        await OfficialImports.ImportAsync(factory, plan);

        var variants = await factory.QueryAsync(context => context.Products.Include(product => product.Substances).Where(product => product.AmbiguousName == "Nasolix").OrderBy(product => product.NormalizedName).ToListAsync());
        Assert.Equal(["Nasolix (cloridrato de nafazolina)", "Nasolix (princípio ativo não informado)"], variants.Select(variant => variant.Name));
        Assert.Equal([1, 0], variants.Select(variant => variant.Substances.Count));
        Assert.False(await factory.QueryAsync(context => context.Products.AnyAsync(product => product.NormalizedName == "nasolix")));
    }

    [Fact]
    public async Task ImportAsync_ChangedIngredients_UpdatesTheLinks()
    {
        await OfficialImports.ImportAsync(factory, OfficialImports.Plan([OfficialImports.Row("TRANQUELIN", "199000030", "simeticona")]));

        var result = await OfficialImports.ImportAsync(factory, OfficialImports.Plan([OfficialImports.Row("TRANQUELIN", "199000030", "simeticona, paracetamol")]));

        Assert.Equal(1, result.ProductsUpdated);
        var product = await OfficialImports.ProductAsync(factory, "tranquelin");
        Assert.Equal(new[] { MedicationCatalogSeed.Simethicone.Id, MedicationCatalogSeed.Paracetamol.Id }.Order(), product.SubstanceIds.Order());
    }

    private async Task<Product> SeedCommunityAsync(string name, ProductForm form, params Guid[] substances)
    {
        var user = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Parent", TestUsers.Now);
        var ingredients = substances.Select(substance => new ProductIngredient(substance, null)).ToArray();
        var community = Product.CreateCommunity(name, form, CountryCode.From("BR"), ingredients, substances.ToHashSet(), user.Id, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            context.Products.Add(community);
            return Task.CompletedTask;
        });
        return community;
    }
}

/// <summary>Retiring needs its own database: it touches every imported product missing from the plan.</summary>
public sealed class OfficialCatalogRetireTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task ImportAsync_ProductLeftTheSource_IsRetiredNotDeletedAndComesBack()
    {
        var both = OfficialImports.Plan([OfficialImports.Row("LUMIRAX", "199000040", "simeticona"), OfficialImports.Row("NEBULAX", "199000041", "simeticona")]);
        var onlyLumirax = OfficialImports.Plan([OfficialImports.Row("LUMIRAX", "199000040", "simeticona")]);
        await OfficialImports.ImportAsync(factory, both, retireMissing: true);

        var partial = await OfficialImports.ImportAsync(factory, onlyLumirax, retireMissing: false);
        var retired = await OfficialImports.ImportAsync(factory, onlyLumirax, retireMissing: true, now: TestUsers.Now.AddDays(30));
        var nebulax = await OfficialImports.ProductAsync(factory, "nebulax");
        var back = await OfficialImports.ImportAsync(factory, both, retireMissing: true);

        Assert.Equal((0, 1), (partial.ProductsRetired, retired.ProductsRetired));
        Assert.Equal(TestUsers.Now.AddDays(30), nebulax.InactiveSince);
        Assert.Equal((1, 0), (back.ProductsUpdated, back.ProductsRetired));
        Assert.Null((await OfficialImports.ProductAsync(factory, "nebulax")).InactiveSince);
    }

    [Fact]
    public async Task ImportAsync_InactiveRowsDoNotReviveARetiredProduct()
    {
        await OfficialImports.ImportAsync(factory, OfficialImports.Plan([OfficialImports.Row("VELADRIN", "199000080", "simeticona")]), retireMissing: false);
        await OfficialImports.ImportAsync(factory, OfficialImports.Plan([OfficialImports.Row("LUMIRAX", "199000040", "simeticona"), OfficialImports.Row("NEBULAX", "199000041", "simeticona")]), retireMissing: true);

        await OfficialImports.ImportAsync(
            factory,
            OfficialImports.Plan([OfficialImports.Row("LUMIRAX", "199000040", "simeticona"), OfficialImports.Row("NEBULAX", "199000041", "simeticona"), OfficialImports.Row("VELADRIN", "199000080", "simeticona", "Inativo")]),
            retireMissing: true);

        Assert.NotNull((await OfficialImports.ProductAsync(factory, "veladrin")).InactiveSince);
    }

    [Fact]
    public async Task Search_RetiredProduct_IsNotOfferedButStaysReadable()
    {
        await OfficialImports.ImportAsync(factory, OfficialImports.Plan([OfficialImports.Row("ORBELIX", "199000050", "simeticona")]), retireMissing: false);
        var id = (await OfficialImports.ProductAsync(factory, "orbelix")).Id;
        await OfficialImports.ImportAsync(factory, OfficialImports.Plan([OfficialImports.Row("LUMIRAX", "199000040", "simeticona"), OfficialImports.Row("NEBULAX", "199000041", "simeticona")]), retireMissing: true);
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var search = await (await client.GetAsync("/api/v1/catalog/products?q=orbelix")).ReadAsync<JsonElement>();
        var read = await client.GetAsync($"/api/v1/catalog/products/{id}");

        Assert.Equal(0, search.GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.True((await read.ReadAsync<JsonElement>()).GetProperty("inactive").GetBoolean());
    }
}
