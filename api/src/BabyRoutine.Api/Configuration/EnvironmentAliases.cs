namespace BabyRoutine.Api.Configuration;

/// <summary>Maps the flat environment variable names used by docker compose onto configuration keys.</summary>
internal static class EnvironmentAliases
{
    public static readonly IReadOnlyDictionary<string, string> VariableToKey = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["AUTH_AUTHORITY"] = "Auth:Authority",
        ["AUTH_AUDIENCE"] = "Auth:Audience",
        ["CORS_ALLOWED_ORIGINS"] = "Cors:AllowedOrigins",
    };

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
