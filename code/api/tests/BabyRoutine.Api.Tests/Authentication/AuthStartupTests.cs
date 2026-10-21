using System.Net;
using BabyRoutine.Api.Authentication;
using BabyRoutine.Api.Tests.Support;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Tests.Authentication;

public sealed class AuthStartupTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Authority = "https://issuer.example.test/";
    private const string Audience = "https://api.example.test";

    [Fact]
    public void Start_ProductionWithoutAuthSettings_FailsWithClearMessage()
    {
        using var production = InEnvironment("Production", authority: string.Empty, audience: string.Empty);

        var exception = Assert.Throws<OptionsValidationException>(() => production.CreateClient());

        Assert.Contains(AuthOptionsValidator.MissingSettingsMessage, exception.Failures);
    }

    [Fact]
    public void Start_InvalidAuthority_Fails()
    {
        using var production = InEnvironment("Production", authority: "not-a-url", audience: Audience);

        var exception = Assert.Throws<OptionsValidationException>(() => production.CreateClient());

        Assert.Contains(AuthOptionsValidator.InvalidAuthorityMessage, exception.Failures);
    }

    [Fact]
    public async Task Start_ProductionWithAuthSettings_StartsAndConfiguresJwtBearer()
    {
        using var production = InEnvironment("Production", Authority, Audience);

        var response = await production.CreateClient().GetAsync("/health");

        var jwt = production.Services.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>().Get(JwtBearerDefaults.AuthenticationScheme);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Authority, jwt.Authority);
        Assert.Equal(Audience, jwt.Audience);
        Assert.False(jwt.MapInboundClaims);
    }

    [Fact]
    public async Task Start_DevelopmentWithoutAuthSettings_Starts()
    {
        using var development = InEnvironment("Development", authority: string.Empty, audience: string.Empty);

        var response = await development.CreateClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private WebApplicationFactory<Program> InEnvironment(string environment, string authority, string audience) =>
        factory.WithWebHostBuilder(builder => builder
            .UseEnvironment(environment)
            .UseSetting("Auth:Authority", authority)
            .UseSetting("Auth:Audience", audience));
}
