using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Authentication;

/// <summary>
/// Applies <see cref="AuthOptions"/> to the JWT bearer scheme, and identically to the account-linking scheme
/// (<see cref="AccountLinkTokens"/>: the same issuer, audience, signing keys, lifetime and <c>sub</c> rules; only where the
/// token is read from differs). Provider-neutral: only issuer and audience come from config.
/// </summary>
internal sealed class ConfigureJwtBearerOptions(IOptions<AuthOptions> authOptions) : IConfigureNamedOptions<JwtBearerOptions>
{
    public const string MissingSubjectMessage = "The access token has no sub claim.";

    public void Configure(string? name, JwtBearerOptions options)
    {
        if (name == AccountLinkTokens.SchemeName)
        {
            Configure(options);
            options.Events.OnMessageReceived = AccountLinkTokens.ReadFromRequestItems;
            return;
        }

        if (name != JwtBearerDefaults.AuthenticationScheme)
        {
            return;
        }

        Configure(options);
    }

    public void Configure(JwtBearerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var settings = authOptions.Value;
        options.Authority = NullIfBlank(settings.Authority);
        options.Audience = NullIfBlank(settings.Audience);
        options.RequireHttpsMetadata = settings.RequireHttpsMetadata;
        options.MapInboundClaims = false;
        options.TokenValidationParameters.NameClaimType = OidcClaims.Name;
        options.Events = new JwtBearerEvents { OnMessageReceived = SkipBoardKeys, OnTokenValidated = RejectTokenWithoutSubject };
    }

    /// <summary>
    /// A project board API key (<c>Bearer lbk_...</c>, docs/design/36-project-board.md section 4.2) is not a JWT: the scheme
    /// steps aside (no result) instead of failing it, so the key never reaches token validation or its logs; the board
    /// guard authenticates it with its own scheme.
    /// </summary>
    private static Task SkipBoardKeys(MessageReceivedContext context)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            && Lotties.Domain.Board.BoardKeySecret.HasMarker(authorization["Bearer ".Length..].Trim()))
        {
            context.NoResult();
        }

        return Task.CompletedTask;
    }

    private static Task RejectTokenWithoutSubject(TokenValidatedContext context)
    {
        if (string.IsNullOrWhiteSpace(context.Principal?.FindFirst(OidcClaims.Subject)?.Value))
        {
            context.Fail(MissingSubjectMessage);
        }

        return Task.CompletedTask;
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
