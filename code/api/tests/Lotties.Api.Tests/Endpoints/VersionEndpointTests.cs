using System.Net;
using System.Text.Json;
using Lotties.Api.Configuration;
using Lotties.Api.Tests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>GET /version</c>: anonymous, only name/version/commit/builtAt from the deploy's stamp (APP_VERSION, APP_COMMIT,
/// APP_BUILD_TIME), cacheable for a few seconds, counted by the global rate limiter; <c>dev</c> without a stamp.
/// </summary>
public sealed class VersionEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = "/api/v1/version";

    [Fact]
    public async Task Get_Stamped_ReturnsTheReleaseToAnAnonymousCaller()
    {
        using var stamped = factory.WithWebHostBuilder(builder => builder
            .UseSetting(BuildStamp.VersionKey, "v0.1.38")
            .UseSetting(BuildStamp.CommitKey, "ABC1234")
            .UseSetting(BuildStamp.BuildTimeKey, "2026-10-24T10:00:00Z"));

        var response = await stamped.CreateClient().GetAsync(Path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((true, TimeSpan.FromSeconds(10)), (response.Headers.CacheControl?.Public, response.Headers.CacheControl?.MaxAge));
        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal(["name", "version", "commit", "builtAt"], body.EnumerateObject().Select(property => property.Name));
        Assert.Equal("lotties-api", body.GetProperty("name").GetString());
        Assert.Equal("0.1.38", body.GetProperty("version").GetString());
        Assert.Equal("abc1234", body.GetProperty("commit").GetString());
        Assert.Equal(new DateTimeOffset(2026, 10, 24, 10, 0, 0, TimeSpan.Zero), body.GetProperty("builtAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Get_NotStamped_ReturnsDev()
    {
        var response = await factory.CreateClient().GetAsync(Path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal("dev", body.GetProperty("version").GetString());
        Assert.Equal(string.Empty, body.GetProperty("commit").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("builtAt").ValueKind);
    }

    [Fact]
    public void Endpoint_IsNotExemptFromTheGlobalRateLimiter()
    {
        var endpoint = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Single(route => route.RoutePattern.RawText == Path);

        Assert.Null(endpoint.Metadata.GetMetadata<DisableRateLimitingAttribute>());
    }

    [Theory]
    [InlineData("0.1.38", "0.1.38")]
    [InlineData(" V1.2.3 ", "1.2.3")]
    [InlineData("1.2.3-rc.1", "1.2.3-rc.1")]
    [InlineData("", "dev")]
    [InlineData("latest", "dev")]
    [InlineData("1.2.3; rm -rf /", "dev")]
    public void FromConfiguration_Version_IsAReleaseOrDev(string value, string expected)
    {
        var stamp = BuildStamp.FromConfiguration(Configuration((BuildStamp.VersionKey, value)));

        Assert.Equal(expected, stamp.Version);
    }

    [Theory]
    [InlineData("abc1234", "abc1234")]
    [InlineData("not-a-commit", "")]
    [InlineData("abc", "")]
    public void FromConfiguration_Commit_IsHexOrEmpty(string value, string expected)
    {
        var stamp = BuildStamp.FromConfiguration(Configuration((BuildStamp.CommitKey, value)));

        Assert.Equal(expected, stamp.Commit);
    }

    [Fact]
    public void FromConfiguration_BadBuildTime_IsNull()
    {
        var stamp = BuildStamp.FromConfiguration(Configuration((BuildStamp.BuildTimeKey, "yesterday")));

        Assert.Null(stamp.BuiltAt);
    }

    private static IConfiguration Configuration(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value)))
            .Build();
}
