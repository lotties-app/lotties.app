using Lotties.Api.Configuration;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Authentication;

/// <summary>
/// Fails startup when OIDC settings are missing outside Development and Testing, when the authority is not a URL, or
/// when only one of the two admin client settings is set.
/// </summary>
internal sealed class AuthOptionsValidator(IHostEnvironment environment) : IValidateOptions<AuthOptions>
{
    public const string MissingSettingsMessage =
        "OIDC is not configured: set Auth:Authority (env AUTH_AUTHORITY) and Auth:Audience (env AUTH_AUDIENCE).";

    public const string InvalidAuthorityMessage = "Auth:Authority (env AUTH_AUTHORITY) must be an absolute http(s) URL.";

    /// <summary>One of the two admin client settings without the other would silently keep sign-in accounts on deletion.</summary>
    public const string HalfAdminClientMessage =
        "Set both Auth:AdminClientId and Auth:AdminClientSecret (env AUTH_ADMIN_CLIENT_ID / AUTH_ADMIN_CLIENT_SECRET) for account deletion at Keycloak, or neither.";

    public ValidateOptionsResult Validate(string? name, AuthOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = CollectFailures(options).ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private IEnumerable<string> CollectFailures(AuthOptions options)
    {
        if (!options.IsConfigured && !environment.AllowsMissingAuth())
        {
            yield return MissingSettingsMessage;
        }

        if (!string.IsNullOrWhiteSpace(options.Authority) && !IsHttpUrl(options.Authority))
        {
            yield return InvalidAuthorityMessage;
        }

        if (string.IsNullOrWhiteSpace(options.AdminClientId) != string.IsNullOrWhiteSpace(options.AdminClientSecret))
        {
            yield return HalfAdminClientMessage;
        }
    }

    private static bool IsHttpUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
}
