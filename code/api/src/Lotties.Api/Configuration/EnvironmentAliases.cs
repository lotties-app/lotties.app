using Lotties.Infrastructure.Persistence.AutoMigration;
using Lotties.Infrastructure.Push;
using Lotties.Infrastructure.SilentPush;

namespace Lotties.Api.Configuration;

/// <summary>Maps the flat environment variable names used by docker compose onto configuration keys (push VAPID secrets, the silent push switch and APNs/FCM credentials, <c>DB_AUTO_MIGRATE</c> and the trusted proxy networks included).</summary>
internal static class EnvironmentAliases
{
    public static readonly IReadOnlyDictionary<string, string> VariableToKey = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["AUTH_AUTHORITY"] = "Auth:Authority",
        ["AUTH_AUDIENCE"] = "Auth:Audience",
        ["AUTH_ADMIN_CLIENT_ID"] = "Auth:AdminClientId",
        ["AUTH_ADMIN_CLIENT_SECRET"] = "Auth:AdminClientSecret",
        ["CORS_ALLOWED_ORIGINS"] = "Cors:AllowedOrigins",
        ["FORWARDED_HEADERS_TRUSTED_NETWORKS"] = "ForwardedHeaders:TrustedNetworks",
    }
    .Concat(PushEnvironmentVariables.VariableToKey)
    .Concat(SilentPushEnvironmentVariables.VariableToKey)
    .Concat(DatabaseMigrationSettings.VariableToKey)
    .ToDictionary(alias => alias.Key, alias => alias.Value, StringComparer.Ordinal);

    /// <summary>Adds the aliased variables that are set, overriding earlier sources such as appsettings.json.</summary>
    public static IConfigurationBuilder AddEnvironmentAliases(this IConfigurationBuilder builder, Func<string, string?> readVariable)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(readVariable);
        var values = VariableToKey
            .Select(alias => KeyValuePair.Create(alias.Value, readVariable(alias.Key)))
            .Where(pair => pair.Value is not null);
        return builder.AddInMemoryCollection(values);
    }
}
