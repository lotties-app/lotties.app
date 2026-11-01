using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.AutoMigration;

/// <summary>
/// The opt-in migration step the Api host runs after building and before starting (so before the push scheduler and
/// before serving). Does nothing unless <see cref="DatabaseMigrationSettings.AutoMigrate"/> is set, and skips a host
/// whose runtime <see cref="LottiesDbContext"/> is not PostgreSQL (the SQLite test host creates its own schema).
/// A failure is logged and rethrown so the API never serves a half-migrated schema.
/// </summary>
public sealed class StartupDatabaseMigration
{
    private readonly DatabaseMigrationSettings _settings;
    private readonly IDatabaseMigrator _migrator;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<StartupDatabaseMigration> _logger;

    public StartupDatabaseMigration(DatabaseMigrationSettings settings, IDatabaseMigrator migrator, IServiceScopeFactory scopes, ILogger<StartupDatabaseMigration> logger)
    {
        _settings = settings ?? throw new ArgumentNullException(nameof(settings));
        _migrator = migrator ?? throw new ArgumentNullException(nameof(migrator));
        _scopes = scopes ?? throw new ArgumentNullException(nameof(scopes));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (!_settings.AutoMigrate)
        {
            _logger.LogInformation("Automatic database migration is off ({Variable} is not true); apply migrations with dotnet ef", DatabaseMigrationSettings.AutoMigrateVariable);
            return;
        }

        var provider = RuntimeDatabaseProvider();
        if (!IsPostgres(provider))
        {
            _logger.LogWarning("Automatic database migration skipped: the runtime database provider {Provider} is not PostgreSQL", provider);
            return;
        }

        await MigrateOrFailAsync(cancellationToken);
    }

    private async Task MigrateOrFailAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _migrator.MigrateAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogCritical(exception, "Automatic database migration failed; the API will not start");
            throw;
        }
    }

    private string? RuntimeDatabaseProvider()
    {
        using var scope = _scopes.CreateScope();
        return scope.ServiceProvider.GetRequiredService<LottiesDbContext>().Database.ProviderName;
    }

    private static bool IsPostgres(string? provider) =>
        string.Equals(provider, typeof(NpgsqlDbContextOptionsBuilderExtensions).Assembly.GetName().Name, StringComparison.Ordinal);
}
