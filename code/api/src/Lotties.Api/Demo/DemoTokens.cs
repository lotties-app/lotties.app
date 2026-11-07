using System.Security.Claims;
using System.Text;
using Lotties.Api.Authentication;
using Lotties.Application.Demo;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Lotties.Api.Demo;

/// <summary>Names and shape of the demo bearer token (docs/design/45-try-it-demo.md section 3).</summary>
public static class DemoTokens
{
    public const string SchemeName = "Demo";
    public const string Audience = "lotties-demo";

    internal static SymmetricSecurityKey KeyOf(DemoOptions options) => new(Encoding.UTF8.GetBytes(options.SigningKey!));
}

/// <summary>Signs demo tokens: HS256, issuer <see cref="User.DemoIssuer"/>, audience <see cref="DemoTokens.Audience"/>, <c>sub</c> = the demo subject, <c>exp</c> = the account's expiry.</summary>
internal sealed class DemoTokenIssuer(DemoOptions options, TimeProvider time) : IDemoTokenIssuer
{
    public string Issue(User demoUser)
    {
        ArgumentNullException.ThrowIfNull(demoUser);
        if (!demoUser.IsDemo || demoUser.DemoExpiresAt is not { } expires)
        {
            throw new ArgumentException("Not a demo user.", nameof(demoUser));
        }

        var now = time.GetUtcNow();
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = User.DemoIssuer,
            Audience = DemoTokens.Audience,
            Subject = new ClaimsIdentity([new Claim(OidcClaims.Subject, demoUser.Subject)]),
            NotBefore = now.UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            SigningCredentials = new SigningCredentials(DemoTokens.KeyOf(options), SecurityAlgorithms.HmacSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}

/// <summary>Validation of the <see cref="DemoTokens.SchemeName"/> scheme: only tokens this API signed for a demo account.</summary>
internal sealed class ConfigureDemoJwtBearerOptions(DemoOptions demo) : IConfigureNamedOptions<JwtBearerOptions>
{
    public void Configure(string? name, JwtBearerOptions options)
    {
        if (name != DemoTokens.SchemeName)
        {
            return;
        }

        options.MapInboundClaims = false;
        options.RequireHttpsMetadata = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = User.DemoIssuer,
            ValidateAudience = true,
            ValidAudience = DemoTokens.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            RequireSignedTokens = true,
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = OidcClaims.Name,

            // Demo off: a key nobody has, so nothing validates.
            IssuerSigningKey = demo.IsEnabled ? DemoTokens.KeyOf(demo) : new SymmetricSecurityKey(RandomBytes()),
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                if (string.IsNullOrWhiteSpace(context.Principal?.FindFirst(OidcClaims.Subject)?.Value))
                {
                    context.Fail(ConfigureJwtBearerOptions.MissingSubjectMessage);
                }

                return Task.CompletedTask;
            },
        };
    }

    public void Configure(JwtBearerOptions options) => Configure(DemoTokens.SchemeName, options);

    private static byte[] RandomBytes() => System.Security.Cryptography.RandomNumberGenerator.GetBytes(DemoOptions.MinSigningKeyBytes);
}

/// <summary>
/// Makes the API's default bearer scheme hand a token over to the demo scheme when (and only when) the unverified <c>iss</c> is the demo
/// issuer and the demo is on. The demo scheme then does the real validation; the OIDC scheme never sees the token. A real token cannot use
/// this: it is validated against the configured authority, and the demo scheme accepts only tokens signed with <c>Demo:SigningKey</c>.
/// </summary>
internal sealed class SelectDemoScheme(DemoOptions demo) : IPostConfigureOptions<JwtBearerOptions>
{
    public void PostConfigure(string? name, JwtBearerOptions options)
    {
        if (name != JwtBearerDefaults.AuthenticationScheme)
        {
            return;
        }

        options.ForwardDefaultSelector = context => IsDemoToken(context.Request.Headers.Authorization.ToString()) ? DemoTokens.SchemeName : null;
    }

    private bool IsDemoToken(string authorization)
    {
        const string prefix = "Bearer ";
        if (!demo.IsEnabled || !authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var token = authorization[prefix.Length..].Trim();
        var handler = new JsonWebTokenHandler();
        return handler.CanReadToken(token) && handler.ReadJsonWebToken(token).Issuer == User.DemoIssuer;
    }
}
