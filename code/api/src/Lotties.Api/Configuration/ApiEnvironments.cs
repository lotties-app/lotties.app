namespace Lotties.Api.Configuration;

internal static class ApiEnvironments
{
    /// <summary>Environment used by the integration tests.</summary>
    public const string Testing = "Testing";

    /// <summary>Unauthenticated self-hosted mode: no OIDC, single synthetic local user, all requests auto-authenticated.</summary>
    public const string Local = "Local";

    /// <summary>Whether the API may start without OIDC settings. In Local mode requests succeed with a synthetic user; in Development/Testing they fail authentication.</summary>
    public static bool AllowsMissingAuth(this IHostEnvironment environment) =>
        environment.IsDevelopment() || environment.IsEnvironment(Testing) || environment.IsEnvironment(Local);

    /// <summary>Whether the API is running in unauthenticated local/self-hosted mode.</summary>
    public static bool IsLocalMode(this IHostEnvironment environment) =>
        environment.IsEnvironment(Local);
}
