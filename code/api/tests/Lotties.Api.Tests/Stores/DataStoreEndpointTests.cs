using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Stores;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The Owner's data-store routes (docs/design/47-bring-your-own-database.md, task T6) on a host with the feature on, an allowlist and
/// no network (<see cref="StoresApiFactory"/>): status, save (guard, seal, pending), test, remove, the move routes' first checks (the
/// moves themselves are <see cref="DataStoreMoveEndpointTests"/>),
/// the BYO consent, the hourly rate limits, and that no typed field ever comes back in a response or reaches a log line.
/// </summary>
public sealed class DataStoreEndpointTests(StoresApiFactory factory) : IClassFixture<StoresApiFactory>
{
    private const string Host = "db-sentinel-host.example.com";
    private const string MigratorHost = "direct-sentinel-host.example.com";
    private const string AppUser = "app_sentinel_user";
    private const string MigratorUser = "migrator_sentinel_user";
    private const string Database = "sentinel_database";
    private const string AppPassword = "Pw;Options=-c x=1;'\"Sentinel-App-Secret";
    private const string MigratorPassword = "Mg=Sentinel;Migrator Secret";

    private static readonly string[] Sentinels = [Host, MigratorHost, AppUser, MigratorUser, Database, AppPassword, MigratorPassword, "Sentinel-App-Secret", "Migrator Secret", FakeStoreHostResolver.PublicAddress.ToString()];

    [Fact]
    public async Task Get_HostedBabyWithoutStore_IsHostedAndNoStore()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: false);

        var status = await (await client.GetAsync(Route(baby))).ReadAsync<DataStoreStatusResponse>();

        Assert.Equal(("hosted", null), (status.Kind, status.Store));
    }

    [Fact]
    public async Task Get_NotOnTheAllowlist_Is404()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).GetAsync(Route(baby));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Put_NotOnTheAllowlist_Is404AndSavesNothing()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsync(Route(baby), Body());

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False(await StoreExistsForAsync(baby.OwnerSubject));
    }

    [Fact]
    public async Task Put_ParentOfAnAllowlistedOwnersBaby_Is403()
    {
        var (_, baby) = await AllowedOwnerAsync(consent: true, BabyRole.Parent);

        var response = await factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent)).PutAsync(Route(baby), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Put_WithoutTheByoConsent_Is403ByoConsentRequired()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: false);

        var response = await client.PutAsync(Route(baby), Body());

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "byo_consent_required");
        Assert.False(await StoreExistsForAsync(baby.OwnerSubject));
    }

    [Fact]
    public async Task Put_ValidDetails_SealsThemAndAnswersPendingWithoutAnyField()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var response = await client.PutAsync(Route(baby), Body());

        var text = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var status = JsonSerializer.Deserialize<DataStoreStatusResponse>(text, JsonSerializerOptions.Web)!;
        Assert.Equal(("hosted", "pending", "Example Cloud", true), (status.Kind, status.Store!.State, status.Store.ProviderLabel, status.Store.HasDescriptor));
        AssertHoldsNoSentinel(text);
        var sealedBytes = await SealedDescriptorOfAsync(baby.OwnerSubject);
        AssertHoldsNoSentinel(Encoding.UTF8.GetString(sealedBytes));
        AssertHoldsNoSentinel(Encoding.Unicode.GetString(sealedBytes));
    }

    [Fact]
    public async Task Put_ThenGet_ShowsTheStoreStatusOnly()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());

        var response = await client.GetAsync(Route(baby));

        var text = await response.Content.ReadAsStringAsync();
        var status = JsonSerializer.Deserialize<DataStoreStatusResponse>(text, JsonSerializerOptions.Web)!;
        Assert.Equal(("pending", null, null), (status.Store!.State, status.Store.LastCheckResult, status.Store.SchemaVersion));
        AssertHoldsNoSentinel(text);
    }

    [Fact]
    public async Task Put_Twice_ReplacesTheDescriptorOfTheSameStoreAndForgetsTheLastTest()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        await client.PostAsync(Route(baby, "/test"), null);
        var first = await SealedDescriptorOfAsync(baby.OwnerSubject);

        var status = await (await client.PutAsync(Route(baby), Body(providerLabel: "Other Cloud"))).ReadAsync<DataStoreStatusResponse>();

        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        Assert.Equal(1, await factory.QueryAsync(context => context.DataStores.CountAsync(store => store.OwnerUserId == ownerId)));
        Assert.Equal(("Other Cloud", null, null), (status.Store!.ProviderLabel, status.Store.LastCheckResult, status.Store.LastCheckedAt));
        Assert.NotEqual(first, await SealedDescriptorOfAsync(baby.OwnerSubject));
    }

    [Theory]
    [InlineData("db.lab-internal-db.com", 5432, "endpoint_blocked_address")]
    [InlineData("10.0.0.7", 5432, "endpoint_blocked_address")]
    [InlineData("localhost", 5432, "endpoint_invalid_host")]
    [InlineData("db.example.com", 22, "endpoint_port_not_allowed")]
    public async Task Put_EndpointTheGuardRefuses_Is422WithItsCodeAndSavesNothing(string host, int port, string code)
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var response = await client.PutAsync(Route(baby), Body(host: host, port: port));

        var problem = await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, code);
        Assert.DoesNotContain(host, problem.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("10.1.2.3", problem.GetRawText(), StringComparison.Ordinal);
        Assert.False(await StoreExistsForAsync(baby.OwnerSubject));
    }

    [Fact]
    public async Task Put_UserNameWithASeparator_Is422InvalidFieldNamingTheFieldOnly()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var response = await client.PutAsync(Route(baby), Body(appUser: "app;Include Error Detail=true"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("app.username", problem.GetProperty("field").GetString());
        Assert.DoesNotContain("Include Error Detail", problem.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Put_MissingMigrator_Is400NamingTheField()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var response = await client.PutAsync(Route(baby), JsonContent.Create(new { providerLabel = "x", app = new { host = Host, port = 5432, database = Database, username = AppUser, password = AppPassword } }));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("migrator", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Test_WithoutASavedStore_Is409StoreNotConfigured()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var response = await client.PostAsync(Route(baby, "/test"), null);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_not_configured");
    }

    [Fact]
    public async Task Test_StoreAnswersOk_ReturnsOkAndRecordsTheCheck()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        factory.Tester.Result = StoreCheckResult.Ok;

        var result = await (await client.PostAsync(Route(baby, "/test"), null)).ReadAsync<DataStoreTestResponse>();

        var status = await (await client.GetAsync(Route(baby))).ReadAsync<DataStoreStatusResponse>();
        Assert.Equal((true, "ok"), (result.Ok, result.Result));
        Assert.Equal(("ok", "pending"), (status.Store!.LastCheckResult, status.Store.State));
        Assert.NotNull(status.Store.LastCheckedAt);
    }

    [Fact]
    public async Task Test_RoleTooPowerful_ReturnsTheCodeAndTheFindings()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        factory.Tester.Result = new StoreCheckResult("store_role_too_powerful", [StoreRoleFinding.SuperuserLike, StoreRoleFinding.CreatesInPublic]);

        try
        {
            var result = await (await client.PostAsync(Route(baby, "/test"), null)).ReadAsync<DataStoreTestResponse>();

            Assert.Equal((false, "store_role_too_powerful"), (result.Ok, result.Result));
            Assert.Equal(["superuser_like", "creates_in_public"], result.Findings);
        }
        finally
        {
            factory.Tester.Result = StoreCheckResult.Ok;
        }
    }

    [Fact]
    public async Task Test_StoreDown_Is503WithRetryAfterAndRecordsTheCode()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        factory.Tester.Result = StoreCheckResult.Of(StoreFailureClass.PausedOrUnreachable);

        try
        {
            var response = await client.PostAsync(Route(baby, "/test"), null);

            await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_paused_or_unreachable");
            Assert.NotNull(response.Headers.RetryAfter);
            var status = await (await client.GetAsync(Route(baby))).ReadAsync<DataStoreStatusResponse>();
            Assert.Equal("store_paused_or_unreachable", status.Store!.LastCheckResult);
        }
        finally
        {
            factory.Tester.Result = StoreCheckResult.Ok;
        }
    }

    [Fact]
    public async Task Test_CredentialsRejected_Is200WithTheCode()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        factory.Tester.Result = StoreCheckResult.Of(StoreFailureClass.CredentialsRejected);

        try
        {
            var result = await (await client.PostAsync(Route(baby, "/test"), null)).ReadAsync<DataStoreTestResponse>();

            Assert.Equal((false, "store_credentials_rejected"), (result.Ok, result.Result));
        }
        finally
        {
            factory.Tester.Result = StoreCheckResult.Ok;
        }
    }

    [Fact]
    public async Task Put_SimultaneousFirstSaves_CreateOneStore()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => client.PutAsync(Route(baby), Body())));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var ids = await factory.QueryAsync(context => context.DataStores.Where(store => store.OwnerUserId == ownerId).Select(store => store.Id).ToListAsync());
        Assert.Equal([DataStore.FirstStoreIdOf(ownerId)], ids);
    }

    [Fact]
    public async Task TryAdd_FirstStoreOfAnOwnerAddedTwice_TheSecondIsRefusedWithoutAnError()
    {
        var (_, baby) = await AllowedOwnerAsync(consent: false);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);

        var first = await TryAddFirstStoreAsync(ownerId);
        var second = await TryAddFirstStoreAsync(ownerId);

        Assert.Equal((true, false), (first, second));
    }

    [Fact]
    public async Task Test_SixthInAnHour_Is429RateLimited()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        for (var attempt = 0; attempt < 5; attempt++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsync(Route(baby, "/test"), null)).StatusCode);
        }

        var response = await client.PostAsync(Route(baby, "/test"), null);

        await response.AssertProblemAsync(HttpStatusCode.TooManyRequests, "rate_limited");
        Assert.True(response.Headers.RetryAfter is not null);
    }

    [Fact]
    public async Task Put_EleventhInAnHour_Is429RateLimited()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        for (var attempt = 0; attempt < 10; attempt++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.PutAsync(Route(baby), Body())).StatusCode);
        }

        var response = await client.PutAsync(Route(baby), Body());

        await response.AssertProblemAsync(HttpStatusCode.TooManyRequests, "rate_limited");
    }

    [Fact]
    public async Task Delete_HostedBabyWithAStore_RemovesTheStore()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());

        var response = await client.DeleteAsync(Route(baby));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False(await StoreExistsForAsync(baby.OwnerSubject));
    }

    [Fact]
    public async Task PutAndDelete_ForgetWhatTheProcessKnowsAboutTheStore()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var storeId = await factory.QueryAsync(context => context.DataStores.Where(store => store.OwnerUserId == ownerId).Select(store => store.Id).SingleAsync());
        await client.PutAsync(Route(baby), Body());

        await client.DeleteAsync(Route(baby));

        Assert.Equal(3, factory.Health.Forgotten.Count(id => id == storeId));
    }

    [Fact]
    public async Task Delete_WithoutAStore_Is204()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: false);

        var response = await client.DeleteAsync(Route(baby));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Delete_BabyStillInTheStore_Is409StoreInUseAndKeepsIt()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await factory.AssignStoreAsync(baby.BabyId, await factory.UserIdAsync(baby.OwnerSubject), Guid.NewGuid());

        var response = await client.DeleteAsync(Route(baby));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_in_use");
        Assert.True(await StoreExistsForAsync(baby.OwnerSubject));
    }

    [Fact]
    public async Task Get_BabyInItsOwnersStore_IsOwnWithTheStoreStatus()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await factory.AssignStoreAsync(baby.BabyId, await factory.UserIdAsync(baby.OwnerSubject), Guid.NewGuid());

        var status = await (await client.GetAsync(Route(baby))).ReadAsync<DataStoreStatusResponse>();

        Assert.Equal(("own", "pending", false), (status.Kind, status.Store!.State, status.Store.HasDescriptor));
    }

    [Fact]
    public async Task Put_BabyInAnotherAccountsStore_Is403StoreNotOwned()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true, BabyRole.Parent);
        await factory.AssignStoreAsync(baby.BabyId, await factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent)), Guid.NewGuid());

        var response = await client.PutAsync(Route(baby), Body());

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "store_not_owned");
    }

    [Fact]
    public async Task MoveIn_WithoutASavedStore_Is409StoreNotConfigured()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        var response = await client.PostAsync(Route(baby, "/move-in"), null);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_not_configured");
    }

    [Fact]
    public async Task MoveIn_WithoutTheByoConsent_Is403()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: false);

        var response = await client.PostAsync(Route(baby, "/move-in"), null);

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "byo_consent_required");
    }

    [Fact]
    public async Task MoveIn_SavedStoreNotReachable_Is503AndMoveOutOfAHostedBabyIs409()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);
        await client.PutAsync(Route(baby), Body());

        var moveIn = await client.PostAsync(Route(baby, "/move-in"), null);
        var moveOut = await client.PostAsync(Route(baby, "/move-out"), null);

        await moveIn.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        await moveOut.AssertProblemAsync(HttpStatusCode.Conflict, "store_move_not_needed");
    }

    [Fact]
    public async Task EveryRoute_WithoutTheCoreConsent_Is403ConsentRequired()
    {
        factory.GrantConsentToNewUsers = false;
        (HttpClient Client, SeededBaby Baby) owner;
        try
        {
            owner = await AllowedOwnerAsync(consent: false);
        }
        finally
        {
            factory.GrantConsentToNewUsers = true;
        }

        var response = await owner.Client.GetAsync(Route(owner.Baby));

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "consent_required");
    }

    [Fact]
    public async Task SaveTestGetAndRefusals_NeverLogATypedField()
    {
        var (client, baby) = await AllowedOwnerAsync(consent: true);

        await client.PutAsync(Route(baby), Body());
        await client.PostAsync(Route(baby, "/test"), null);
        await client.GetAsync(Route(baby));
        await client.PutAsync(Route(baby), Body(host: "db" + FakeStoreHostResolver.PrivateSuffix));
        await client.PutAsync(Route(baby), Body(appUser: AppUser + ";x=1"));
        await client.PutAsync(Route(baby), new StringContent("{\"app\": {\"password\": \"" + AppPassword.Replace("\"", "\\\"", StringComparison.Ordinal) + "\", \"port\": \"not-a-number\"}}", Encoding.UTF8, "application/json"));

        Assert.Contains(factory.Logs.Lines, line => line.Contains("Saved a new descriptor for data store", StringComparison.Ordinal));
        Assert.Contains(factory.Logs.Lines, line => line.Contains("Connection test of data store", StringComparison.Ordinal));
        var leaked = factory.Logs.Lines.Where(line => Sentinels.Any(sentinel => line.Contains(sentinel, StringComparison.Ordinal))).ToArray();
        Assert.True(leaked.Length == 0, "Log lines with a typed field: " + string.Join(" || ", leaked));
    }

    private static string Route(SeededBaby baby, string suffix = "") => $"/api/v1/babies/{baby.BabyId}/data-store{suffix}";

    private static JsonContent Body(string host = Host, int port = 6543, string appUser = AppUser, string providerLabel = "Example Cloud") =>
        JsonContent.Create(new
        {
            providerLabel,
            app = new { host, port, database = Database, username = appUser, password = AppPassword },
            migrator = new { host = MigratorHost, port = 5432, username = MigratorUser, password = MigratorPassword },
            tls = new { sslMode = "verify_full" },
        });

    private static void AssertHoldsNoSentinel(string text)
    {
        foreach (var sentinel in Sentinels)
        {
            Assert.DoesNotContain(sentinel, text, StringComparison.Ordinal);
        }
    }

    private async Task<(HttpClient Client, SeededBaby Baby)> AllowedOwnerAsync(bool consent, params BabyRole[] memberRoles)
    {
        var subject = factory.TakeAllowedSubject();
        var baby = await factory.SeedBabyOwnedByAsync(subject, memberRoles);
        if (consent)
        {
            await factory.GrantByoConsentAsync(subject);
        }

        return (factory.CreateClientFor(subject), baby);
    }

    private async Task<bool> TryAddFirstStoreAsync(Guid ownerId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var stores = scope.ServiceProvider.GetRequiredService<IDataStoreRepository>();
        return await stores.TryAddAsync(DataStore.Create(DataStore.FirstStoreIdOf(ownerId), ownerId, TestUsers.Now));
    }

    private async Task<bool> StoreExistsForAsync(string subject)
    {
        var ownerId = await factory.UserIdAsync(subject);
        return await factory.QueryAsync(context => context.DataStores.AnyAsync(store => store.OwnerUserId == ownerId));
    }

    private async Task<byte[]> SealedDescriptorOfAsync(string subject)
    {
        var ownerId = await factory.UserIdAsync(subject);
        return await factory.QueryAsync(context => context.DataStores.Where(store => store.OwnerUserId == ownerId).Select(store => store.SealedDescriptor!).SingleAsync());
    }
}

/// <summary>With <c>Stores:Enabled</c> off (the default host) every data-store route answers a bare 404 to everyone, before any 401 or 403.</summary>
public sealed class DataStoreEndpointsFlagOffTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    public static TheoryData<string, string> Routes() => new()
    {
        { "GET", string.Empty },
        { "PUT", string.Empty },
        { "DELETE", string.Empty },
        { "POST", "/test" },
        { "POST", "/move-in" },
        { "POST", "/move-out" },
    };

    [Fact]
    public void Services_FlagOff_TheDataStoreServiceStillResolves()
    {
        using var scope = factory.Services.CreateScope();

        Assert.NotNull(scope.ServiceProvider.GetRequiredService<IDataStoreService>());
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task Route_FlagOff_Is404ForOwnerParentAndAnonymous(string method, string suffix)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var path = $"/api/v1/babies/{baby.BabyId}/data-store{suffix}";

        var statuses = new List<HttpStatusCode>();
        foreach (var client in new[] { factory.CreateClientFor(baby.OwnerSubject), factory.CreateClientFor(baby.SubjectOf(BabyRole.Parent)), factory.CreateClient() })
        {
            var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = method is "PUT" or "POST" ? JsonContent.Create(new { }) : null };
            statuses.Add((await client.SendAsync(request)).StatusCode);
        }

        Assert.All(statuses, status => Assert.Equal(HttpStatusCode.NotFound, status));
        Assert.Equal(0, await factory.QueryAsync(context => context.DataStores.CountAsync()));
    }
}
