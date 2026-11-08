using Lotties.Application.Stores;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores.Migration;

public static class StoreMigratorServiceCollectionExtensions
{
    /// <summary>
    /// When <c>Stores:Enabled</c> is true: binds and validates (at startup) <see cref="StoreMigratorOptions"/> (<c>Stores:Migrator</c>)
    /// and <see cref="ExternalDataStoreOptions"/> (<c>Stores:DataSources</c>), and registers the store migrator (task T5) with what it
    /// needs: the egress guard and pinned data sources (task T4), the <c>data_stores</c> rows, the sealed-descriptor connection source (it
    /// needs <see cref="IStoreCredentials"/>, registered by <c>AddStoreCredentials</c> under the same flag), the descriptor checks and the
    /// connection test of the owner's data-store routes (task T6), and the production external stores (<see cref="ExternalDataStores"/>,
    /// which replaces the routing's <see cref="IExternalDataStores"/> without any store). When the flag is off or absent (the default) it
    /// registers nothing: the routing keeps the <see cref="IStoreMigrator"/> that refuses every store and the
    /// <see cref="IExternalDataStores"/> that opens none (both registered by <c>AddInfrastructure</c>).
    /// </summary>
    public static IServiceCollection AddStoreMigrator(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        if (!configuration.GetSection(StoreRoutingOptions.SectionName).GetValue<bool>(nameof(StoreRoutingOptions.Enabled)))
        {
            return services;
        }

        services.AddOptions<StoreMigratorOptions>().Bind(configuration.GetSection(StoreMigratorOptions.SectionName)).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<StoreMigratorOptions>, StoreMigratorOptionsValidator>());
        services.AddOptions<ExternalDataStoreOptions>().Bind(configuration.GetSection(ExternalDataStoreOptions.SectionName)).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<ExternalDataStoreOptions>, ExternalDataStoreOptionsValidator>());
        services.AddStoreEndpointGuard(configuration);
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IDataStoreRows, EfDataStoreRows>();
        services.TryAddSingleton<IStoreConnectionSource, SealedStoreConnectionSource>();
        services.TryAddSingleton<IStoreMigrationSessionFactory>(provider => new NpgsqlStoreMigrationSessionFactory(provider.GetRequiredService<IStoreConnectionSource>()));
        services.Replace(ServiceDescriptor.Singleton<IStoreMigrator, StoreMigrator>());
        services.Replace(ServiceDescriptor.Singleton<IExternalDataStores, ExternalDataStores>());
        services.TryAddSingleton<IStoreDescriptorGuard, StoreDescriptorGuard>();
        services.TryAddSingleton<IStoreConnectionTester, StoreConnectionTester>();
        return services;
    }
}
