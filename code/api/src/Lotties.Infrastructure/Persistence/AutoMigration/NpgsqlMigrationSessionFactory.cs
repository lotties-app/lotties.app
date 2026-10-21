using Npgsql;

namespace Lotties.Infrastructure.Persistence.AutoMigration;

/// <summary>Opens <see cref="NpgsqlMigrationSession"/>s with the migrator <see cref="DatabaseOptions"/> (not the runtime app role).</summary>
internal sealed class NpgsqlMigrationSessionFactory : IMigrationSessionFactory
{
    internal const string ApplicationName = "babyroutine-migrator";

    private readonly DatabaseOptions _migratorOptions;

    public NpgsqlMigrationSessionFactory(DatabaseOptions migratorOptions)
    {
        _migratorOptions = migratorOptions ?? throw new ArgumentNullException(nameof(migratorOptions));
    }

    public string Target => $"'{_migratorOptions.Name}' on {_migratorOptions.Host}:{_migratorOptions.Port}";

    public async Task<IMigrationSession> OpenAsync(CancellationToken cancellationToken = default) =>
        await NpgsqlMigrationSession.OpenAsync(BuildConnectionString(_migratorOptions), cancellationToken);

    /// <summary>Unpooled, so a session lock never survives in a pooled connection.</summary>
    internal static string BuildConnectionString(DatabaseOptions options) => new NpgsqlConnectionStringBuilder(options.ToConnectionString())
    {
        Pooling = false,
        ApplicationName = ApplicationName,
    }.ConnectionString;
}
