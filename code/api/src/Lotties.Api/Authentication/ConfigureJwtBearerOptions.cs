using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Authentication;

/// <summary>Applies <see cref="AuthOptions"/> to the JWT bearer scheme. Provider-neutral: only issuer and audience come from config.</summary>
internal sealed class ConfigureJwtBearerOptions(IOptions<AuthOptions> authOptions) : IConfigureNamedOptions<JwtBearerOptions>
{
    public const string MissingSubjectMessage = "The access token has no sub claim.";

    public void Configure(string? name, JwtBearerOptions options)
    {
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
        options.Events = new JwtBearerEvents { OnTokenValidated = RejectTokenWithoutSubject };
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
