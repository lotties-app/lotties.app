using BabyRoutine.Infrastructure.Persistence;
using BabyRoutine.Infrastructure.Persistence.AutoMigration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Infrastructure;

public static class DatabaseMigrationServiceCollectionExtensions
{
    /// <summary>
    /// Registers the opt-in startup migration: <see cref="DatabaseMigrationSettings"/> (read lazily from
    /// <c>Database:AutoMigrate</c>), the advisory-locked <see cref="IDatabaseMigrator"/> connecting with
    /// <paramref name="migratorOptions"/> (separate from the runtime app role) and <see cref="StartupDatabaseMigration"/>.
    /// Nothing connects to the database until <see cref="StartupDatabaseMigration.RunAsync"/> runs with the flag on.
    /// </summary>
    public static IServiceCollection AddDatabaseMigration(this IServiceCollection services, DatabaseOptions migratorOptions)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(migratorOptions);
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton(provider => DatabaseMigrationSettings.FromConfiguration(provider.GetRequiredService<IConfiguration>()));
        services.AddSingleton<IDatabaseMigrator>(provider => new NpgsqlDatabaseMigrator(
            new NpgsqlMigrationSessionFactory(migratorOptions),
            provider.GetRequiredService<DatabaseMigrationSettings>(),
            provider.GetRequiredService<TimeProvider>(),
            provider.GetRequiredService<ILogger<NpgsqlDatabaseMigrator>>()));
        services.AddSingleton<StartupDatabaseMigration>();
        return services;
    }
}
