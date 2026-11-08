using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Demo;
using Lotties.Api.Tests.Support;
using Lotties.Application.Demo;
using Lotties.Domain.Consents;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Lotties.Api.Tests.Demo;

/// <summary>The try-it demo end to end (docs/design/45-try-it-demo.md) on the SQLite test host.</summary>
public sealed class DemoTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string SigningKey = "unit-test-demo-signing-key-0123456789-abcdef";
    private const string StartPath = "/api/v1/demo/start";

    private WebApplicationFactory<Program> DemoHost(int? maxLive = null, int? permitsPerHour = null, string? key = SigningKey) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (key is not null)
            {
                builder.UseSetting("Demo:SigningKey", key);
            }

            if (maxLive is { } max)
            {
                builder.UseSetting("Demo:MaxLiveAccounts", max.ToString());
            }

            if (permitsPerHour is { } permits)
            {
                builder.UseSetting("Demo:StartPermitsPerHour", permits.ToString());
            }
        });

    private static async Task<StartDemoResponse> StartAsync(HttpClient client, string? locale = null)
    {
        var response = await client.PostAsJsonAsync(StartPath, new { locale });
        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<StartDemoResponse>())!;
    }

    private static async Task<string?> CodeOfAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).TryGetProperty("code", out var code) ? code.GetString() : null;

    private static async Task<T> InScopeAsync<T>(WebApplicationFactory<Program> host, Func<LottiesDbContext, IServiceProvider, Task<T>> action)
    {
        await using var scope = host.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<LottiesDbContext>(), scope.ServiceProvider);
    }

    [Fact]
    public async Task Status_AndStart_AreOffWithoutASigningKey()
    {
        using var host = DemoHost(key: null);
        var client = host.CreateClient();

        var status = await client.GetFromJsonAsync<DemoStatusResponse>("/api/v1/demo");
        var start = await client.PostAsJsonAsync(StartPath, new { });

        Assert.False(status!.Enabled);
        Assert.Equal(HttpStatusCode.NotFound, start.StatusCode);
        Assert.Equal("demo_disabled", await CodeOfAsync(start));
    }

    [Fact]
    public async Task Start_CreatesTheAccountTheBabyAndTheSampleData()
    {
        using var host = DemoHost();
        var client = host.CreateClient();
        Assert.True((await client.GetFromJsonAsync<DemoStatusResponse>("/api/v1/demo"))!.Enabled);

        var started = await StartAsync(client, "pt-BR");

        Assert.Equal(3, started.LifetimeDays);
        Assert.InRange(started.ExpiresAt, DateTimeOffset.UtcNow.AddDays(3).AddMinutes(-2), DateTimeOffset.UtcNow.AddDays(3).AddMinutes(2));
        var token = new JsonWebTokenHandler().ReadJsonWebToken(started.AccessToken);
        Assert.Equal(User.DemoIssuer, token.Issuer);
        var (user, baby, events, measurements, consent) = await InScopeAsync(host, async (context, _) =>
        {
            var demoUser = await context.Users.SingleAsync(candidate => candidate.Subject == token.Subject);
            return (
                demoUser,
                await context.Babies.SingleAsync(candidate => candidate.Id == started.BabyId),
                await context.Events.IgnoreQueryFilters().CountAsync(candidate => candidate.BabyId == started.BabyId),
                await context.Measurements.IgnoreQueryFilters().CountAsync(candidate => candidate.BabyId == started.BabyId),
                await context.UserConsents.SingleAsync(candidate => candidate.UserId == demoUser.Id && candidate.Kind == ConsentKind.Core));
        });
        Assert.True(user.IsDemo);
        Assert.Equal(started.ExpiresAt, user.DemoExpiresAt!.Value, TimeSpan.FromSeconds(1));
        Assert.Equal("Bebê Demo", baby.Name);
        Assert.True(events > 100, $"expected about a week of events, got {events}");
        Assert.Equal(1, measurements);
        Assert.False(ConsentVersions.RequiresAcceptance(consent.Version));
    }

    [Fact]
    public async Task Start_RecordsTheDemoConsentCapacity_WhenNoTestConsentIsGranted()
    {
        factory.GrantConsentToNewUsers = false;
        try
        {
            using var host = DemoHost();
            var started = await StartAsync(host.CreateClient());
            var capacity = await InScopeAsync(host, (context, _) => context.UserConsents
                .Where(row => row.Kind == ConsentKind.Core && context.Babies.Any(baby => baby.Id == started.BabyId && baby.Members.Any(member => member.UserId == row.UserId)))
                .Select(row => row.Capacity)
                .SingleAsync());
            Assert.Equal(ConsentCapacity.Demo, capacity);
        }
        finally
        {
            factory.GrantConsentToNewUsers = true;
        }
    }

    [Fact]
    public async Task DemoToken_AuthenticatesThroughTheDefaultBearerScheme()
    {
        using var host = DemoHost();
        var started = await StartAsync(host.CreateClient());
        var subject = new JsonWebTokenHandler().ReadJsonWebToken(started.AccessToken).Subject;

        var result = await AuthenticateAsync(host, JwtBearerDefaults.AuthenticationScheme, started.AccessToken);

        Assert.True(result.Succeeded, result.Failure?.Message);
        Assert.Equal(subject, result.Principal!.FindFirst("sub")!.Value);
        Assert.Equal(User.DemoIssuer, result.Principal.FindFirst("iss")!.Value);
    }

    [Fact]
    public async Task DemoToken_IsRejected_WhenTamperedForgedOrExpired()
    {
        using var host = DemoHost();
        var started = await StartAsync(host.CreateClient());

        var tampered = started.AccessToken[..^3] + (started.AccessToken[^1] == 'A' ? "BBB" : "AAA");
        var otherKey = Mint(new SymmetricSecurityKey("another-signing-key-0123456789-abcdefghij"u8.ToArray()), DateTime.UtcNow.AddHours(1));
        var expired = Mint(new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(SigningKey)), DateTime.UtcNow.AddHours(-2), notBefore: DateTime.UtcNow.AddHours(-3));
        var unsigned = new JsonWebTokenHandler().CreateToken("{\"iss\":\"urn:lotties:demo\",\"aud\":\"lotties-demo\",\"sub\":\"x\",\"exp\":9999999999}");

        foreach (var token in new[] { tampered, otherKey, expired, unsigned })
        {
            var result = await AuthenticateAsync(host, JwtBearerDefaults.AuthenticationScheme, token);
            Assert.False(result.Succeeded);
        }
    }

    [Fact]
    public async Task DemoToken_IsNotAccepted_WhenTheDemoIsOff()
    {
        using var on = DemoHost();
        var started = await StartAsync(on.CreateClient());
        using var off = DemoHost(key: null);

        var result = await AuthenticateAsync(off, JwtBearerDefaults.AuthenticationScheme, started.AccessToken);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task Start_RefusesOverTheGlobalCap()
    {
        using var counter = DemoHost();
        var existing = await InScopeAsync(counter, (context, _) => context.Users.CountAsync(user => user.Issuer == User.DemoIssuer));
        using var capped = DemoHost(maxLive: existing + 1);
        var client = capped.CreateClient();

        await StartAsync(client);
        var refused = await client.PostAsJsonAsync(StartPath, new { });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        Assert.Equal("demo_capacity", await CodeOfAsync(refused));
    }

    [Fact]
    public async Task Start_IsRateLimitedPerAddress()
    {
        using var host = DemoHost(permitsPerHour: 2);
        var client = host.CreateClient();

        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(StartPath, new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(StartPath, new { })).StatusCode);
        var limited = await client.PostAsJsonAsync(StartPath, new { });

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("rate_limited", await CodeOfAsync(limited));
    }

    [Fact]
    public async Task DemoUser_CannotUseBlockedRoutes_ButCanUseTheRest()
    {
        using var host = DemoHost();
        var started = await StartAsync(host.CreateClient());
        var subject = new JsonWebTokenHandler().ReadJsonWebToken(started.AccessToken).Subject;
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        client.DefaultRequestHeaders.Add(TestAuthHandler.IssuerHeader, User.DemoIssuer);

        var secondBaby = await client.PostAsJsonAsync("/api/v1/babies", new { name = "Another", birthDate = "2026-01-01" });
        var invites = await client.GetAsync($"/api/v1/babies/{started.BabyId}/invites");
        var address = await client.GetAsync("/api/v1/address/search?q=rua");
        var babies = await client.GetAsync("/api/v1/babies");
        var events = await client.GetAsync($"/api/v1/babies/{started.BabyId}/events");

        Assert.Equal(HttpStatusCode.Forbidden, secondBaby.StatusCode);
        Assert.Equal("demo_not_available", await CodeOfAsync(secondBaby));
        Assert.Equal(HttpStatusCode.Forbidden, invites.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, address.StatusCode);
        Assert.Equal(HttpStatusCode.OK, babies.StatusCode);
        Assert.Equal(HttpStatusCode.OK, events.StatusCode);
    }

    [Fact]
    public async Task RealUser_IsNotBlocked()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var created = await client.PostAsJsonAsync("/api/v1/babies", new { name = "Mine", birthDate = "2026-01-01" });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
    }

    [Fact]
    public async Task DemoUser_CanDeleteTheAccountEarly()
    {
        using var host = DemoHost();
        var started = await StartAsync(host.CreateClient());
        var subject = new JsonWebTokenHandler().ReadJsonWebToken(started.AccessToken).Subject;
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        client.DefaultRequestHeaders.Add(TestAuthHandler.IssuerHeader, User.DemoIssuer);

        var deleted = await client.DeleteAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        Assert.False(await InScopeAsync(host, (context, _) => context.Babies.AnyAsync(baby => baby.Id == started.BabyId)));
    }

    [Fact]
    public async Task Cleanup_RemovesExpiredDemoAccountsAndEverythingTheyOwn_AndNothingElse()
    {
        using var host = DemoHost();
        var client = host.CreateClient();
        var expired = await StartAsync(client);
        var alive = await StartAsync(client);
        var realUser = await factory.SeedBabyAsync();
        await InScopeAsync(host, async (context, _) =>
        {
            var subject = new JsonWebTokenHandler().ReadJsonWebToken(expired.AccessToken).Subject;
            var user = await context.Users.SingleAsync(candidate => candidate.Subject == subject);
            context.Entry(user).Property(nameof(User.DemoExpiresAt)).CurrentValue = (DateTimeOffset?)DateTimeOffset.UtcNow.AddMinutes(-5);
            await context.SaveChangesAsync();
            return 0;
        });

        var first = await InScopeAsync(host, (_, services) => services.GetRequiredService<IDemoCleanup>().RunOnceAsync(DateTimeOffset.UtcNow));
        var second = await InScopeAsync(host, (_, services) => services.GetRequiredService<IDemoCleanup>().RunOnceAsync(DateTimeOffset.UtcNow));

        Assert.Equal(new DemoCleanupResult(1, 0), first);
        Assert.Equal(new DemoCleanupResult(0, 0), second);
        var subjectOfExpired = new JsonWebTokenHandler().ReadJsonWebToken(expired.AccessToken).Subject;
        Assert.False(await InScopeAsync(host, (context, _) => context.Users.AnyAsync(user => user.Subject == subjectOfExpired)));
        Assert.False(await InScopeAsync(host, (context, _) => context.Babies.AnyAsync(baby => baby.Id == expired.BabyId)));
        Assert.False(await InScopeAsync(host, (context, _) => context.Events.IgnoreQueryFilters().AnyAsync(row => row.BabyId == expired.BabyId)));
        Assert.True(await InScopeAsync(host, (context, _) => context.Babies.AnyAsync(baby => baby.Id == alive.BabyId)));
        Assert.True(await InScopeAsync(host, (context, _) => context.Babies.AnyAsync(baby => baby.Id == realUser.BabyId)));
    }

    [Fact]
    public async Task Cleanup_ExpiredDemoWhoseBabyPointsAtAnExternalStore_FailsClosedWithoutOpeningThatStore()
    {
        using var own = new ApiFactory();
        var stores = new Stores.ThrowingDataStores();
        using var host = own.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Demo:SigningKey", SigningKey);
            builder.UseSetting("Demo:CleanupMinutes", "0"); // the hosted run stays off: only the run below may see the account
            builder.ConfigureTestServices(services =>
            {
                services.Configure<Lotties.Infrastructure.Stores.StoreRoutingOptions>(options => options.Enabled = true);
                services.AddSingleton<Lotties.Infrastructure.Stores.IExternalDataStores>(stores);
                services.AddSingleton<Lotties.Application.Stores.IStoreMigrator>(stores);
            });
        });
        var expired = await StartAsync(host.CreateClient());
        var subject = new JsonWebTokenHandler().ReadJsonWebToken(expired.AccessToken).Subject;
        var userId = await InScopeAsync(host, (context, _) => context.Users.Where(candidate => candidate.Subject == subject).Select(user => user.Id).SingleAsync());
        await own.AssignStoreAsync(expired.BabyId, userId, Guid.NewGuid());
        await InScopeAsync(host, async (context, _) =>
        {
            var user = await context.Users.SingleAsync(candidate => candidate.Id == userId);
            context.Entry(user).Property(nameof(User.DemoExpiresAt)).CurrentValue = (DateTimeOffset?)DateTimeOffset.UtcNow.AddMinutes(-5);
            return await context.SaveChangesAsync();
        });

        var result = await InScopeAsync(host, (_, services) => services.GetRequiredService<IDemoCleanup>().RunOnceAsync(DateTimeOffset.UtcNow));

        Assert.Equal(new DemoCleanupResult(0, 1), result);
        Assert.Equal(0, stores.Attempts);
        Assert.True(await InScopeAsync(host, (context, _) => context.Babies.AnyAsync(baby => baby.Id == expired.BabyId)));
    }

    [Fact]
    public async Task EveryBlockedRouteKey_MatchesAMappedRoute()
    {
        using var host = DemoHost();
        var mapped = host.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(method => $"{method} {endpoint.RoutePattern.RawText}"))
            .ToHashSet(StringComparer.Ordinal);

        var stale = DemoBlockedRoutes.Keys.Where(key => !mapped.Contains(key)).Order().ToArray();

        Assert.True(stale.Length == 0, $"Blocked-in-demo keys that match no route: {string.Join(", ", stale)}");
        await Task.CompletedTask;
    }

    private static string Mint(SecurityKey key, DateTime expires, DateTime? notBefore = null) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = User.DemoIssuer,
            Audience = DemoTokens.Audience,
            Claims = new Dictionary<string, object> { ["sub"] = "forged" },
            NotBefore = notBefore,
            Expires = expires,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });

    private static async Task<AuthenticateResult> AuthenticateAsync(WebApplicationFactory<Program> host, string scheme, string token)
    {
        using var scope = host.Services.CreateScope();
        var context = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
        context.Request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token).ToString();
        return await context.AuthenticateAsync(scheme);
    }
}
