using System.Security.Claims;
using BabyRoutine.Api.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Tests.Authentication;

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
