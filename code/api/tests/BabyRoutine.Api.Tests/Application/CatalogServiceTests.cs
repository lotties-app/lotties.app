using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Catalog;
using BabyRoutine.Domain.Catalog;
using BabyRoutine.Domain.Users;
using Microsoft.Extensions.Logging.Abstractions;

namespace BabyRoutine.Api.Tests.Application;

public sealed class CatalogServiceTests
{
    private static readonly Substance Simethicone = Substance.Seed(Guid.NewGuid(), "simethicone", "Simethicone", "Simeticona", [], TestUsers.Now);
    private static readonly User Caller = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Parent", TestUsers.Now);

    private static CatalogService CreateService(FakeCatalogRepository repository) =>
        new(repository, new FakeCurrentUser(Caller), new FixedTimeProvider(TestUsers.Now), NullLogger<CatalogService>.Instance);

    private static CreateProductRequest Request(string name) => new()
    {
        Name = name,
        Form = ProductForm.Drops,
        Country = "BR",
        Substances = [new CreateProductSubstanceRequest { SubstanceId = Simethicone.Id }],
    };

    [Fact]
    public async Task CreateProductAsync_New_AddsACommunityProductOfTheCaller()
    {
        var repository = new FakeCatalogRepository([Simethicone]);

        var result = await CreateService(repository).CreateProductAsync(Request("Flygas"));

        Assert.True(result.Created);
        var added = Assert.Single(repository.Added);
        Assert.Equal((Caller.Id, ProductStatus.Community, "flygas"), (added.CreatedBy!.Value, added.Status, added.NormalizedName));
        Assert.Equal("Simeticona", Assert.Single(result.Product.Substances).NamePtBr);
    }

    [Fact]
    public async Task CreateProductAsync_ExistingDuplicate_ReturnsItWithoutAdding()
    {
        var existing = Product.CreateCommunity("Flygas", ProductForm.Drops, CountryCode.From("BR"), [], new HashSet<Guid>(), Guid.NewGuid(), TestUsers.Now);
        var repository = new FakeCatalogRepository([Simethicone]) { Duplicate = existing };

        var result = await CreateService(repository).CreateProductAsync(Request("FLYGASS"));

        Assert.False(result.Created);
        Assert.Equal(existing.Id, result.Product.Id);
        Assert.Empty(repository.Added);
    }

    [Fact]
    public async Task CreateProductAsync_LostConcurrentInsert_ReturnsTheWinner()
    {
        var winner = Product.CreateCommunity("Flygas", ProductForm.Drops, CountryCode.From("BR"), [], new HashSet<Guid>(), Guid.NewGuid(), TestUsers.Now);
        var repository = new FakeCatalogRepository([Simethicone]) { ConcurrentWinner = winner };

        var result = await CreateService(repository).CreateProductAsync(Request("Flygas"));

        Assert.Equal((false, winner.Id), (result.Created, result.Product.Id));
    }

    private sealed class FakeCatalogRepository(IReadOnlyList<Substance> substances) : ICatalogRepository
    {
        public Product? Duplicate { get; set; }

        public Product? ConcurrentWinner { get; init; }

        public List<Product> Added { get; } = [];

        public Task<IReadOnlyList<Substance>> ListSubstancesAsync(CancellationToken cancellationToken = default) => Task.FromResult(substances);

        public Task<Product?> FindProductAsync(Guid productId, CancellationToken cancellationToken = default) => Task.FromResult<Product?>(null);

        public Task<IReadOnlyList<Product>> FindProductsAsync(IReadOnlyCollection<Guid> productIds, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Product>>([]);

        public Task<IReadOnlyList<Product>> FindNameCandidatesAsync(ProductCandidateFilter filter, int take, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Product>>([]);

        public Task<IReadOnlyList<Product>> FindBySubstancesAsync(IReadOnlyCollection<Guid> substanceIds, int take, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Product>>([]);

        public Task<Product?> FindDuplicateAsync(string normalizedName, ProductForm form, CountryCode country, CancellationToken cancellationToken = default) => Task.FromResult(Duplicate);

        public Task<bool> TryAddProductAsync(Product product, CancellationToken cancellationToken = default)
        {
            if (ConcurrentWinner is not null)
            {
                Duplicate = ConcurrentWinner;
                return Task.FromResult(false);
            }

            Added.Add(product);
            return Task.FromResult(true);
        }
    }
}
