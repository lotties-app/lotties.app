using BabyRoutine.Api.Configuration;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Authentication;

/// <summary>Fails startup when OIDC settings are missing outside Development and Testing, or when the authority is not a URL.</summary>
internal sealed class AuthOptionsValidator(IHostEnvironment environment) : IValidateOptions<AuthOptions>
{
    public const string MissingSettingsMessage =
        "OIDC is not configured: set Auth:Authority (env AUTH_AUTHORITY) and Auth:Audience (env AUTH_AUDIENCE).";

    public const string InvalidAuthorityMessage = "Auth:Authority (env AUTH_AUTHORITY) must be an absolute http(s) URL.";

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
    }

    private static bool IsHttpUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
}
