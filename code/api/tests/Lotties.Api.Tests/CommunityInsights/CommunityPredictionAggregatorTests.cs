using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Predictions;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Entities;
using Lotties.Infrastructure.Predictions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>
/// <see cref="CommunityPredictionAggregator"/> (docs/design/33-privacy-audit.md section 20.1): it stays unwired, and if it is ever run
/// it reads only babies with a current community consent on the built-in store, never a demo, stores only cells of 20 babies from 20
/// families that no family dominates, removes cells that no longer qualify, and writes the labels the reader looks up. Every test
/// uses its own type key, so the cells of the tests sharing this database never mix.
/// </summary>
public sealed class CommunityPredictionAggregatorTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const int K = 20;
    private const string EngineVersion = "test-engine";
    private static readonly DateTimeOffset Now = TestUsers.Now;

    [Fact]
    public void Aggregator_AndItsReader_AreNotRegistered_AndNoHostedServiceRunsThem()
    {
        using var scope = factory.Services.CreateScope();

        Assert.Null(scope.ServiceProvider.GetService<ICommunityPredictionAggregator>());
        Assert.Null(scope.ServiceProvider.GetService<CommunityPredictionAggregator>());
        Assert.Null(scope.ServiceProvider.GetService<ICommunityPredictionAggregateRepository>());
        Assert.DoesNotContain(
            factory.Services.GetServices<IHostedService>(),
            service => service.GetType().Name.Contains("Prediction", StringComparison.Ordinal) && service.GetType().Name.Contains("Aggregat", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("UnderThreeMonths", "Night", AgeBand.UnderThreeMonths, DayPhase.Night, "0-3m", "night")]
    [InlineData("ThreeToSixMonths", "Day", AgeBand.ThreeToSixMonths, DayPhase.Day, "3-6m", "day")]
    [InlineData("TwelveMonthsPlus", null, AgeBand.TwelveMonthsPlus, null, "12m+", null)]
    public async Task Run_TwentyBabiesFromTwentyFamilies_StoresTheCellUnderTheReadersLabels_AndTheReaderFindsIt(
        string storedBand, string? storedPhase, AgeBand band, DayPhase? phase, string bandLabel, string? phaseLabel)
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K, storedBand: storedBand, storedPhase: storedPhase);

        await RunAsync();

        var row = Assert.Single(await RowsAsync(typeKey));
        Assert.Equal((bandLabel, phaseLabel, K, CommunityPredictionAggregator.TemporalBucketOf(Now)), (row.AgeBandLabel, row.Phase, row.Count, row.TemporalBucket));
        var read = await ReadAsync(band, typeKey, phase);
        Assert.NotNull(read);
        Assert.Equal((band, phase, K, EngineVersion), (read.AgeBand, read.Phase, read.Count, read.EngineVersion));
    }

    [Fact]
    public async Task Run_NineteenBabies_StoresNothing()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1, outcomesPerBaby: 5);

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
        Assert.Null(await ReadAsync(AgeBand.UnderThreeMonths, typeKey, DayPhase.Night));
    }

    [Fact]
    public async Task Run_BabyWithoutCommunityConsent_IsNotCounted()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1);
        await SeedBabiesAsync(typeKey, 1, consent: false);

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Fact]
    public async Task Run_AfterAWithdrawal_TheNextRunRemovesTheCellThatNoLongerQualifies()
    {
        var typeKey = NewTypeKey();
        var babies = await SeedBabiesAsync(typeKey, K);
        await RunAsync();
        Assert.Single(await RowsAsync(typeKey));

        var (babyId, ownerId) = babies[0];
        await factory.SeedAsync(context =>
        {
            context.CommunityConsents.Add(CommunityConsentEntry.Withdraw(babyId, ownerId, "test-policy", "en", Now.AddMinutes(1)));
            return Task.CompletedTask;
        });
        await RunAsync(Now.AddDays(7));

        Assert.Empty(await RowsAsync(typeKey));
        Assert.Null(await ReadAsync(AgeBand.UnderThreeMonths, typeKey, DayPhase.Night));
    }

    [Fact]
    public async Task Run_RemovesRowsOfEarlierRuns()
    {
        var typeKey = NewTypeKey();
        await factory.SeedAsync(context =>
        {
            context.CommunityPredictionAggregates.Add(new CommunityPredictionAggregateEntity
            {
                Id = Guid.NewGuid(),
                AgeBandLabel = "0-3m",
                TypeKey = typeKey,
                Phase = "night",
                TemporalBucket = "2025-W01",
                EngineVersion = EngineVersion,
                Count = 50,
                SumErrorMinutes = 500,
                SumSquaredError = 5000,
                GeneratedAtUtc = Now.AddYears(-1),
            });
            return Task.CompletedTask;
        });

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Fact]
    public async Task Run_DemoOwnersBaby_IsNotCounted()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1);
        await SeedBabiesAsync(typeKey, 1, ownerIssuer: User.DemoIssuer);

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Fact]
    public async Task Run_BabyWithADemoMember_IsNotCounted()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1);
        await SeedBabiesAsync(typeKey, 1, withDemoParent: true);

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Fact]
    public async Task Run_BabyOnHerOwnDatabase_IsNotCounted()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1);
        var (babyId, ownerId) = (await SeedBabiesAsync(typeKey, 1))[0];
        await factory.AssignStoreAsync(babyId, ownerId, Guid.NewGuid());

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Fact]
    public async Task Run_BabyMovingToHerOwnDatabase_IsNotCounted()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1);
        var (babyId, ownerId) = (await SeedBabiesAsync(typeKey, 1))[0];
        var storeId = Guid.NewGuid();
        await factory.SeedAsync(context =>
        {
            context.DataStores.Add(DataStore.Create(storeId, ownerId, Now));
            context.DataStoreMoves.Add(DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, "test-worker", Now, TimeSpan.FromMinutes(5)));
            return Task.CompletedTask;
        });

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Fact]
    public async Task Run_TwentyBabiesFromNineteenFamilies_StoresNothing()
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 2);
        await SeedBabiesAsync(typeKey, 2, sharedOwner: true);

        await RunAsync();

        Assert.Empty(await RowsAsync(typeKey));
    }

    [Theory]
    [InlineData(6, true)] // 6 of 25 outcomes = 24 %: no family over 25 %
    [InlineData(7, false)] // 7 of 26 outcomes = 27 %: one family dominates
    public async Task Run_OneFamilyGivingMoreThanAQuarterOfTheOutcomes_StoresNothing(int heavyFamilyOutcomes, bool stored)
    {
        var typeKey = NewTypeKey();
        await SeedBabiesAsync(typeKey, K - 1);
        await SeedBabiesAsync(typeKey, 1, outcomesPerBaby: heavyFamilyOutcomes);

        await RunAsync();

        Assert.Equal(stored ? 1 : 0, (await RowsAsync(typeKey)).Count);
    }

    private static string NewTypeKey() => $"t{Guid.NewGuid():N}";

    private async Task RunAsync(DateTimeOffset? at = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var aggregator = new CommunityPredictionAggregator(
            services.GetRequiredService<LottiesDbContext>(),
            services.GetRequiredService<ICommunityConsentRepository>(),
            new FixedTime(at ?? Now),
            NullLogger<CommunityPredictionAggregator>.Instance);
        await aggregator.AggregateAsync();
    }

    private Task<List<CommunityPredictionAggregateEntity>> RowsAsync(string typeKey) =>
        factory.QueryAsync(context => context.CommunityPredictionAggregates.AsNoTracking().Where(row => row.TypeKey == typeKey).ToListAsync());

    private Task<CommunityPredictionAggregate?> ReadAsync(AgeBand band, string typeKey, DayPhase? phase) =>
        factory.QueryAsync(context => new EfCommunityPredictionAggregateRepository(context).GetAggregateAsync(band, typeKey, phase));

    /// <summary>
    /// Seeds <paramref name="count"/> babies, each with its own Owner (or one Owner for all with <paramref name="sharedOwner"/>), a
    /// community consent unless told otherwise, and <paramref name="outcomesPerBaby"/> resolved outcomes of <paramref name="typeKey"/>.
    /// </summary>
    private async Task<IReadOnlyList<(Guid BabyId, Guid OwnerId)>> SeedBabiesAsync(
        string typeKey,
        int count,
        int outcomesPerBaby = 1,
        bool consent = true,
        string ownerIssuer = "https://issuer.test",
        bool withDemoParent = false,
        bool sharedOwner = false,
        string storedBand = "UnderThreeMonths",
        string? storedPhase = "Night")
    {
        var seeded = new List<(Guid BabyId, Guid OwnerId)>();
        await factory.SeedAsync(context =>
        {
            User? shared = null;
            for (var index = 0; index < count; index++)
            {
                var owner = sharedOwner && shared is not null ? shared : NewUser(ownerIssuer, "Owner");
                if (owner != shared)
                {
                    context.Users.Add(owner);
                }

                shared = owner;
                var baby = Baby.Create(null, DateOnly.FromDateTime(Now.UtcDateTime.AddMonths(-2)), owner.Id, Now);
                if (withDemoParent)
                {
                    var demo = NewUser(User.DemoIssuer, "Demo");
                    context.Users.Add(demo);
                    baby.AddMember(demo.Id, BabyRole.Parent, Now);
                }

                context.Babies.Add(baby);
                if (consent)
                {
                    context.CommunityConsents.Add(CommunityConsentEntry.Grant(baby.Id, owner.Id, CommunityConsentTexts.CurrentTextVersion, true, "test-policy", "en", Now));
                }

                for (var outcome = 0; outcome < outcomesPerBaby; outcome++)
                {
                    var anchor = Now.AddHours(-(outcome + 1) * 3);
                    context.PredictionOutcomes.Add(new PredictionOutcomeEntity
                    {
                        Id = Guid.NewGuid(),
                        BabyId = baby.Id,
                        TypeKey = typeKey,
                        PredictedAt = anchor,
                        AnchorAt = anchor,
                        ExpectedNextStart = anchor.AddHours(2),
                        ActualNextStart = anchor.AddHours(2).AddMinutes(10 + index),
                        ErrorMinutes = 10 + index,
                        EngineVersion = EngineVersion,
                        SampleCount = 5,
                        AgeBand = storedBand,
                        Phase = storedPhase,
                        Resolved = true,
                    });
                }

                seeded.Add((baby.Id, owner.Id));
            }

            return Task.CompletedTask;
        });
        return seeded;
    }

    private static User NewUser(string issuer, string name) =>
        issuer == User.DemoIssuer
            ? User.CreateDemo(TestUsers.NewSubject(), name, Now, Now.AddDays(1))
            : User.Create(issuer, TestUsers.NewSubject(), name, Now);

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
