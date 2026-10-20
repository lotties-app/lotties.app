using BabyRoutine.Api.Tests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BabyRoutine.Api.Tests.Cors;

public sealed class CorsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string AllowedOrigin = "http://localhost:5173";

    [Fact]
    public async Task Preflight_AllowedOrigin_ReturnsAllowOriginHeader()
    {
        using var configured = WithAllowedOrigins($"{AllowedOrigin}, https://app.example.test/");

        var response = await configured.CreateClient().SendAsync(Preflight(AllowedOrigin));

        Assert.True(response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values));
        Assert.Equal(AllowedOrigin, Assert.Single(values));
    }

    [Fact]
    public async Task Preflight_OriginWithTrailingSlashInConfig_IsAllowed()
    {
        using var configured = WithAllowedOrigins($"{AllowedOrigin}, https://app.example.test/");

        var response = await configured.CreateClient().SendAsync(Preflight("https://app.example.test"));

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Preflight_UnlistedOrigin_ReturnsNoAllowOriginHeader()
    {
        using var configured = WithAllowedOrigins(AllowedOrigin);

        var response = await configured.CreateClient().SendAsync(Preflight("https://evil.example.test"));

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    private WebApplicationFactory<Program> WithAllowedOrigins(string origins) =>
        factory.WithWebHostBuilder(builder => builder.UseSetting("Cors:AllowedOrigins", origins));

    private static HttpRequestMessage Preflight(string origin)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/me");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "authorization");
        return request;
    }
}
