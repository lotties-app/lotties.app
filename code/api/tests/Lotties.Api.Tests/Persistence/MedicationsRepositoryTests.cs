using Lotties.Api.Tests.Support;
using Lotties.Domain.Catalog;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Measurements;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Persistence;

/// <summary>Catalog, prescription-history and weight queries against the SQLite test database (provider-neutral predicates).</summary>
public sealed class MedicationsRepositoryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<Guid> SeedUserAsync()
    {
        var user = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Parent", TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            return Task.CompletedTask;
        });
        return user.Id;
    }

    /// <summary>The repository in a scope of its own, with <paramref name="babyIds"/> bound for the data-plane ones.</summary>
    private async Task<TResult> WithAsync<TRepository, TResult>(Func<TRepository, Task<TResult>> action, params Guid[] babyIds)
        where TRepository : notnull
    {
        await using var scope = await factory.CreateScopeForAsync(babyIds);
        return await action(scope.ServiceProvider.GetRequiredService<TRepository>());
    }

    private static Product Community(string name, Guid userId) =>
        Product.CreateCommunity(name, ProductForm.Drops, CountryCode.From("BR"), [], new HashSet<Guid>(), userId, TestUsers.Now);

    [Fact]
    public async Task TryAddProductAsync_SameNormalizedNameFormAndCountry_LosesToTheUniqueIndex()
    {
        var userId = await SeedUserAsync();
        Assert.True(await WithAsync<ICatalogRepository, bool>(catalog => catalog.TryAddProductAsync(Community("Raciclon", userId))));

        var second = await WithAsync<ICatalogRepository, bool>(catalog => catalog.TryAddProductAsync(Community("RACICLONN", userId)));

        Assert.False(second);
        Assert.Equal(1, await factory.QueryAsync(context => context.Products.CountAsync(product => product.NormalizedName == "raciclon")));
    }

    [Fact]
    public async Task FindNameCandidatesAsync_LoadsPrefixAndTypoBucketsOnly()
    {
        var userId = await SeedUserAsync();
        await factory.SeedAsync(context =>
        {
            context.Products.AddRange(Community("Kapratol", userId), Community("Kapratol Forte", userId), Community("Kepratol", userId), Community("Zapratox", userId), Community("Kazzzzzzzzzzzzzz", userId));
            return Task.CompletedTask;
        });

        var candidates = await WithAsync<ICatalogRepository, IReadOnlyList<Product>>(catalog => catalog.FindNameCandidatesAsync(CatalogQuery.From("kapratol").CandidateFilter, 50));

        Assert.Equal(["Kapratol", "Kapratol Forte", "Kepratol"], candidates.Select(product => product.Name).Order());
    }

    [Fact]
    public async Task ListDosesAsync_ReadsOnlyLiveMedicationEventsSinceTheBound()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var medicationId = Guid.NewGuid();
        var payload = EventPayload.From($$"""{"medications":[{"medicationId":"{{medicationId}}","name":"A"},{"medicationId":"{{medicationId}}","name":"B"}]}""");
        var recent = Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.MedicationId, ownerId, TestUsers.Now, TestUsers.Now, payload, null, TestUsers.Now);
        var old = Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.MedicationId, ownerId, TestUsers.Now.AddDays(-20), TestUsers.Now.AddDays(-20), payload, null, TestUsers.Now);
        var deleted = Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.MedicationId, ownerId, TestUsers.Now, TestUsers.Now, payload, null, TestUsers.Now);
        deleted.SoftDelete(TestUsers.Now);
        var otherType = Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.BellyPainId, ownerId, TestUsers.Now, TestUsers.Now, EventPayload.From("""{"intensity":3}"""), null, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(recent, old, deleted, otherType);
            return Task.CompletedTask;
        });

        var doses = await WithAsync<IMedicationDoseHistoryRepository, IReadOnlyList<MedicationDose>>(history => history.ListDosesAsync(baby.BabyId, TestUsers.Now.AddDays(-9)), baby.BabyId);

        Assert.Equal(2, doses.Count);
        Assert.All(doses, dose => Assert.Equal((TestUsers.Now, medicationId), (dose.GivenAt, dose.MedicationId!.Value)));
    }

    [Fact]
    public async Task FindLatestWithWeightAsync_SkipsMeasurementsWithoutWeight()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var day = DateOnly.FromDateTime(TestUsers.Now.UtcDateTime);
        await factory.SeedAsync(context =>
        {
            context.Measurements.AddRange(
                Measurement.Create(Guid.NewGuid(), baby.BabyId, day.AddDays(-10), 4.2m, null, null, null, ownerId, TestUsers.Now),
                Measurement.Create(Guid.NewGuid(), baby.BabyId, day.AddDays(-3), 4.6m, null, null, null, ownerId, TestUsers.Now),
                Measurement.Create(Guid.NewGuid(), baby.BabyId, day, null, 55m, null, null, ownerId, TestUsers.Now));
            return Task.CompletedTask;
        });

        var latest = await WithAsync<IMeasurementRepository, Measurement?>(measurements => measurements.FindLatestWithWeightAsync(baby.BabyId), baby.BabyId);

        Assert.Equal((4.6m, day.AddDays(-3)), (latest!.WeightKg!.Value, latest.Date));
    }
}
