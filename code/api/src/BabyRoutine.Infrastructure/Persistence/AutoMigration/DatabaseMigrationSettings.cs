using Microsoft.Extensions.Configuration;

namespace BabyRoutine.Infrastructure.Persistence.AutoMigration;

/// <summary>
/// Opt-in startup migration settings. <c>DB_AUTO_MIGRATE</c> (configuration key <c>Database:AutoMigrate</c>) is off
/// by default; the Api host adds <see cref="VariableToKey"/> to its environment aliases.
/// </summary>
public sealed record DatabaseMigrationSettings(bool AutoMigrate, TimeSpan LockTimeout, TimeSpan LockPollInterval)
{
    public const string AutoMigrateVariable = "DB_AUTO_MIGRATE";
    public const string AutoMigrateKey = "Database:AutoMigrate";

    /// <summary>How long a starting instance waits for another instance that holds the migration lock.</summary>
    public static readonly TimeSpan DefaultLockTimeout = TimeSpan.FromMinutes(5);

    public static readonly TimeSpan DefaultLockPollInterval = TimeSpan.FromSeconds(1);

    public static readonly IReadOnlyDictionary<string, string> VariableToKey = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [AutoMigrateVariable] = AutoMigrateKey,
    };

    /// <summary>Reads <see cref="AutoMigrateKey"/>; throws <see cref="FormatException"/> for a value that is not a boolean.</summary>
    public static DatabaseMigrationSettings FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return new DatabaseMigrationSettings(ParseAutoMigrate(configuration[AutoMigrateKey]), DefaultLockTimeout, DefaultLockPollInterval);
    }

    /// <summary>Missing or empty is false; <c>true</c>/<c>false</c> (any case) and <c>1</c>/<c>0</c> are accepted, anything else fails.</summary>
    public static bool ParseAutoMigrate(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        null or "" or "false" or "0" => false,
        "true" or "1" => true,
        _ => throw new FormatException($"{AutoMigrateVariable} must be 'true' or 'false' (got '{value}')."),
    };
}
