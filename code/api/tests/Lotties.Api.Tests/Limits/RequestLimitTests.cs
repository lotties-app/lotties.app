using System.Net;
using System.Net.Http.Json;
using System.Text;
using Lotties.Api.Errors;
using Lotties.Api.Limits;
using Lotties.Api.Tests.Support;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Limits;

public sealed class RequestLimitTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly RequestLimitsOptions Defaults = new();

    [Fact]
    public async Task PutEvent_BodyAboveOneMegabyte_Returns413Problem()
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"typeId":"{{BuiltInEventTypes.SleepId}}","startedAt":"2026-01-10T08:00:00Z","notes":"{{new string('n', (int)Defaults.MaxRequestBodyBytes)}}"}""";

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsync(EventPath(baby.BabyId), Json(json));

        var problem = await response.AssertProblemAsync(HttpStatusCode.RequestEntityTooLarge, RequestBodyLimitMiddleware.ErrorCode);
        Assert.Equal(Defaults.MaxRequestBodyBytes, problem.GetProperty(RequestBodyLimitMiddleware.MaxBytesExtension).GetInt64());
    }

    [Fact]
    public async Task PutEvent_BodyBelowLimit_ReachesTheEndpoint()
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"typeId":"{{BuiltInEventTypes.SleepId}}","startedAt":"2026-01-10T08:00:00Z","notes":"{{new string('n', 900 * 1024)}}"}""";

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsync(EventPath(baby.BabyId), Json(json));

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task ImportPreview_BodyAboveImportLimit_Returns413Problem()
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"logsCsv":"{{new string('x', (int)Defaults.ImportMaxRequestBodyBytes)}}"}""";

        var response = await factory.CreateClientFor(baby.OwnerSubject).PostAsync(PreviewPath(baby.BabyId), Json(json));

        var problem = await response.AssertProblemAsync(HttpStatusCode.RequestEntityTooLarge, RequestBodyLimitMiddleware.ErrorCode);
        Assert.Equal(Defaults.ImportMaxRequestBodyBytes, problem.GetProperty(RequestBodyLimitMiddleware.MaxBytesExtension).GetInt64());
    }

    [Fact]
    public async Task ImportPreview_BodyAboveGeneralLimitButWithinImportLimit_IsAccepted()
    {
        var baby = await factory.SeedBabyAsync();
        var csv = "start,end,category\\n" + string.Concat(Enumerable.Repeat("2025-09-01T08:00:00Z,2025-09-01T08:00:00Z,UNKNOWN\\n", 30_000));
        var json = $$"""{"logsCsv":"{{csv}}"}""";

        var response = await factory.CreateClientFor(baby.OwnerSubject).PostAsync(PreviewPath(baby.BabyId), Json(json));

        Assert.True(json.Length > Defaults.MaxRequestBodyBytes);
        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "import_too_many_rows");
    }

    [Fact]
    public async Task ImportPreview_MoreThanImportPermitsPerMinute_Returns429ProblemWithRetryAfter()
    {
        using var limited = WithSettings(("RequestLimits:ImportPermitsPerMinute", "2"));
        var baby = await factory.SeedBabyAsync();
        var client = ClientFor(limited, baby.OwnerSubject);

        var accepted = new[] { await PreviewAsync(client, baby.BabyId), await PreviewAsync(client, baby.BabyId) };
        var rejected = await PreviewAsync(client, baby.BabyId);

        Assert.All(accepted, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        await rejected.AssertProblemAsync(HttpStatusCode.TooManyRequests, UserRateLimits.ErrorCode);
        Assert.True(int.Parse(rejected.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture) > 0);
    }

    [Fact]
    public async Task ImportPreview_RateLimitIsPerUser()
    {
        using var limited = WithSettings(("RequestLimits:ImportPermitsPerMinute", "1"));
        var first = await factory.SeedBabyAsync();
        var second = await factory.SeedBabyAsync();
        await PreviewAsync(ClientFor(limited, first.OwnerSubject), first.BabyId);

        var otherUser = await PreviewAsync(ClientFor(limited, second.OwnerSubject), second.BabyId);

        Assert.Equal(HttpStatusCode.OK, otherUser.StatusCode);
    }

    [Fact]
    public async Task AnyEndpoint_MoreThanPermitsPerMinute_Returns429AndHealthIsNotLimited()
    {
        using var limited = WithSettings(("RequestLimits:PermitsPerMinute", "3"));
        var client = ClientFor(limited, TestUsers.NewSubject());
        for (var request = 0; request < 3; request++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/babies")).StatusCode);
        }

        var rejected = await client.GetAsync("/api/v1/babies");
        var health = await client.GetAsync("/health");

        await rejected.AssertProblemAsync(HttpStatusCode.TooManyRequests, UserRateLimits.ErrorCode);
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    }

    [Fact]
    public void Timeouts_DefaultAndImportPoliciesComeFromOptions()
    {
        var timeouts = factory.Services.GetRequiredService<IOptions<RequestTimeoutOptions>>().Value;

        Assert.Equal(TimeSpan.FromSeconds(Defaults.RequestTimeoutSeconds), timeouts.DefaultPolicy?.Timeout);
        Assert.Equal(TimeSpan.FromSeconds(Defaults.ImportRequestTimeoutSeconds), timeouts.Policies[RequestLimitPolicies.Import].Timeout);
    }

    [Fact]
    public void ImportEndpoints_UseImportTimeoutAndRateLimitPolicies()
    {
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .Where(endpoint => endpoint.Metadata.GetMetadata<ImportRequestLimitsMetadata>() is not null)
            .ToArray();

        Assert.Equal(2, endpoints.Length);
        Assert.All(endpoints, endpoint => Assert.Equal(RequestLimitPolicies.Import, endpoint.Metadata.GetMetadata<RequestTimeoutAttribute>()?.PolicyName));
        Assert.All(endpoints, endpoint => Assert.Equal(RequestLimitPolicies.Import, endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute>()?.PolicyName));
    }

    [Fact]
    public void OptionsValidator_NonPositiveLimit_Fails()
    {
        var result = new RequestLimitsOptionsValidator().Validate(null, new RequestLimitsOptions { PermitsPerMinute = 0, ImportMaxRequestBodyBytes = -1 });

        Assert.True(result.Failed);
        Assert.Contains("RequestLimits:PermitsPerMinute", result.FailureMessage, StringComparison.Ordinal);
        Assert.Contains("RequestLimits:ImportMaxRequestBodyBytes", result.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void OptionsValidator_Defaults_Succeed()
    {
        Assert.True(new RequestLimitsOptionsValidator().Validate(null, Defaults).Succeeded);
    }

    private static string EventPath(Guid babyId) => $"/api/v1/babies/{babyId}/events/{Guid.NewGuid()}";

    private static string PreviewPath(Guid babyId) => $"/api/v1/babies/{babyId}/import/napper/preview";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static Task<HttpResponseMessage> PreviewAsync(HttpClient client, Guid babyId) =>
        client.PostAsJsonAsync(PreviewPath(babyId), new { logsCsv = "start,end,category\n2025-09-01T08:00:00Z,2025-09-01T08:00:00Z,CHANGED_DIAPER\n" });

    private static HttpClient ClientFor(WebApplicationFactory<Program> host, string subject)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }

    /// <summary>The API on the same test database with some settings overridden.</summary>
    private WebApplicationFactory<Program> WithSettings(params (string Key, string Value)[] settings) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(settings.Select(setting => KeyValuePair.Create(setting.Key, (string?)setting.Value)))));
}
