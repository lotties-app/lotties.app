using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Entities;
using Lotties.Infrastructure.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Stores;

/// <summary>The routing host of <see cref="StoreRoutingHost"/> with prediction accuracy tracking on.</summary>
public sealed class StorePredictionOutcomeHost : IDisposable
{
    private const string TestKeyId = "outcomes-test";

    public StorePredictionOutcomeHost()
    {
        Host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Stores:Enabled", "true");
            builder.UseSetting("Stores:CurrentKeyId", TestKeyId);
            builder.UseSetting($"Stores:KeyEncryptionKeys:{TestKeyId}", Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
            builder.UseSetting("PredictionOptions:AccuracyTrackingEnabled", "true");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IExternalDataStores>(Stores);
                services.AddSingleton<IStoreMigrator>(Stores);
            });
        });
        Stores.FailureInterceptors = storeId => Host.Services.GetRequiredService<StoreFailureInterceptors>().For(storeId);
    }

    public ApiFactory Factory { get; } = new();

    internal SqliteDataStores Stores { get; } = new();

    public WebApplicationFactory<Program> Host { get; }

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
        Stores.Dispose();
    }
}

/// <summary>
/// <c>prediction_outcomes</c> is a data table (docs/design/47-bring-your-own-database.md): the outcomes of a baby on the family's own
/// database are recorded and resolved there, by the background work that enters the baby in a scope of its own, and never in the
/// Lotties database.
/// </summary>
public sealed class StorePredictionOutcomeTests(StorePredictionOutcomeHost hosts) : IClassFixture<StorePredictionOutcomeHost>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;
    private static readonly TimeSpan Interval = TimeSpan.FromHours(3);

    [Fact]
    public async Task Predictions_BabyOnItsOwnStore_RecordsAndResolvesTheOutcomesThereOnly()
    {
        var (subject, ownerId, babyId, storeId) = await SeedBabyOnOwnStoreAsync();
        var owner = hosts.Host.ClientFor(subject);
        var last = DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.AddHours(-4).ToUnixTimeSeconds());
        // The history goes straight into her store: written through the API, each event's background resolution could race
        // with the outcome the predictions answer records.
        await hosts.Stores.QueryAsync(storeId, context =>
        {
            context.Events.AddRange(Enumerable.Range(0, 12)
                .Select(index => last - (Interval * index))
                .Select(start => Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.TummyTimeId, ownerId, start, start.AddMinutes(20), EventPayload.Empty, null, DateTimeOffset.UtcNow)));
            return context.SaveChangesAsync();
        });

        var response = await owner.GetAsync($"/api/v1/babies/{babyId}/predictions");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var pending = Assert.Single(await WaitForStoreOutcomesAsync(storeId, babyId, rows => rows.Count > 0));
        Assert.Equal(("tummy_time", false), (pending.TypeKey, pending.Resolved));

        var next = last + Interval + TimeSpan.FromMinutes(5);
        await PutTummyTimeAsync(owner, babyId, next);

        var resolved = Assert.Single(await WaitForStoreOutcomesAsync(storeId, babyId, rows => rows.All(row => row.Resolved)));
        Assert.Equal((pending.Id, true, next), (resolved.Id, resolved.Resolved, resolved.ActualNextStart!.Value));
        Assert.Empty(await hosts.Factory.QueryAsync(context => context.PredictionOutcomes.Where(row => row.BabyId == babyId).ToListAsync()));
    }

    private static async Task PutTummyTimeAsync(HttpClient client, Guid babyId, DateTimeOffset start)
    {
        var response = await client.PutAsJsonAsync($"/api/v1/babies/{babyId}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.TummyTimeId, startedAt = start, endedAt = start.AddMinutes(20), payload = new { } });
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    }

    private async Task<List<PredictionOutcomeEntity>> WaitForStoreOutcomesAsync(Guid storeId, Guid babyId, Func<List<PredictionOutcomeEntity>, bool> done)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
        while (true)
        {
            var rows = await hosts.Stores.QueryAsync(storeId, context => context.PredictionOutcomes.AsNoTracking().Where(row => row.BabyId == babyId).ToListAsync());
            if (done(rows) || DateTimeOffset.UtcNow > deadline)
            {
                return rows;
            }

            await Task.Delay(50);
        }
    }

    /// <summary>An Owner with one baby whose records are on a new store of hers.</summary>
    private async Task<(string Subject, Guid OwnerId, Guid BabyId, Guid StoreId)> SeedBabyOnOwnStoreAsync()
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", Now);
        var baby = Baby.Create("Baby", DateOnly.FromDateTime(Now.UtcDateTime.AddMonths(-2)), owner.Id, Now);
        await hosts.Factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        var storeId = hosts.Stores.Create();
        await hosts.Factory.AssignStoreAsync(baby.Id, owner.Id, storeId);
        return (owner.Subject, owner.Id, baby.Id, storeId);
    }
}
