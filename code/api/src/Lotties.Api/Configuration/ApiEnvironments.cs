namespace Lotties.Api.Configuration;

internal static class ApiEnvironments
{
    /// <summary>Environment used by the integration tests.</summary>
    public const string Testing = "Testing";

    /// <summary>Whether the API may start without OIDC settings (requests then fail authentication).</summary>
    public static bool AllowsMissingAuth(this IHostEnvironment environment) =>
        environment.IsDevelopment() || environment.IsEnvironment(Testing);
}
