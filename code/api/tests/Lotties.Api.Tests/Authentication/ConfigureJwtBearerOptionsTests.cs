using System.Security.Claims;
using Lotties.Api.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Authentication;

public sealed class ConfigureJwtBearerOptionsTests
{
    private static readonly AuthOptions Settings = new()
    {
        Authority = " https://issuer.example.test/ ",
        Audience = "api",
        RequireHttpsMetadata = false,
    };

    [Fact]
    public void Configure_BearerScheme_AppliesProviderNeutralSettings()
    {
        var options = new JwtBearerOptions();

        new ConfigureJwtBearerOptions(Options.Create(Settings)).Configure(JwtBearerDefaults.AuthenticationScheme, options);

        Assert.Equal("https://issuer.example.test/", options.Authority);
        Assert.Equal("api", options.Audience);
        Assert.False(options.RequireHttpsMetadata);
        Assert.False(options.MapInboundClaims);
        Assert.Equal(OidcClaims.Name, options.TokenValidationParameters.NameClaimType);
    }

    [Fact]
    public void Configure_OtherScheme_LeavesOptionsUntouched()
    {
        var options = new JwtBearerOptions();

        new ConfigureJwtBearerOptions(Options.Create(Settings)).Configure("Other", options);

        Assert.Null(options.Authority);
    }

    [Fact]
    public async Task OnTokenValidated_TokenWithoutSubject_FailsAuthentication()
    {
        var context = await ValidateTokenAsync(new ClaimsPrincipal(new ClaimsIdentity([new Claim(OidcClaims.Name, "Ana")], "jwt")));

        Assert.NotNull(context.Result?.Failure);
    }

    [Fact]
    public async Task OnTokenValidated_TokenWithSubject_DoesNotFail()
    {
        var context = await ValidateTokenAsync(new ClaimsPrincipal(new ClaimsIdentity([new Claim(OidcClaims.Subject, "sub")], "jwt")));

        Assert.Null(context.Result);
    }

    [Theory]
    [InlineData("Bearer lbk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", true)]
    [InlineData("bearer lbk_x", true)]
    [InlineData("Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig", false)]
    [InlineData("", false)]
    public async Task OnMessageReceived_BoardKey_IsSkippedWithoutFailing(string authorization, bool skipped)
    {
        var options = new JwtBearerOptions();
        new ConfigureJwtBearerOptions(Options.Create(Settings)).Configure(options);
        var http = new DefaultHttpContext();
        http.Request.Headers.Authorization = authorization;
        var scheme = new AuthenticationScheme(JwtBearerDefaults.AuthenticationScheme, null, typeof(JwtBearerHandler));
        var context = new MessageReceivedContext(http, scheme, options);

        await options.Events.MessageReceived(context);

        Assert.Equal(skipped, context.Result is { None: true });
        Assert.Null(context.Result?.Failure);
    }

    private static async Task<TokenValidatedContext> ValidateTokenAsync(ClaimsPrincipal principal)
    {
        var options = new JwtBearerOptions();
        new ConfigureJwtBearerOptions(Options.Create(Settings)).Configure(options);
        var scheme = new AuthenticationScheme(JwtBearerDefaults.AuthenticationScheme, null, typeof(JwtBearerHandler));
        var context = new TokenValidatedContext(new DefaultHttpContext(), scheme, options) { Principal = principal };
        await options.Events.TokenValidated(context);
        return context;
    }
}
