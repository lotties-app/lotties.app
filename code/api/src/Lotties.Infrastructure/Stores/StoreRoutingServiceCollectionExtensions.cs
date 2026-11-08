using Lotties.Application.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Infrastructure.Stores;

public static class StoreRoutingServiceCollectionExtensions
{
    /// <summary>
    /// Registers the data store routing (docs/design/47-bring-your-own-database.md section 3.6) with the flag off: the scoped
    /// <see cref="IStoreScope"/> every data-plane repository goes through, the scoped <see cref="IStoreResolver"/>, the built-in
    /// store and, unless one is registered already, <see cref="IExternalDataStores"/> without any store and an
    /// <see cref="IStoreMigrator"/> that refuses every store (<c>AddStoreMigrator</c> replaces it when <c>Stores:Enabled</c> is on).
    /// Called by <c>AddInfrastructure</c>; <see cref="AddDataStoreRouting"/> binds the flag.
    /// </summary>
    internal static IServiceCollection AddStoreScope(this IServiceCollection services)
    {
        services.AddOptions<StoreRoutingOptions>();
        services.TryAddSingleton<IExternalDataStores, NoExternalDataStores>();
        services.TryAddSingleton<IStoreMigrator, DisabledStoreMigrator>();
        services.AddScoped<BuiltInDataStore>();
        services.AddScoped<IStoreResolver, StoreResolver>();
        services.AddScoped<StoreScope>();
        services.AddScoped<IStoreScope>(provider => provider.GetRequiredService<StoreScope>());
        return services;
    }

    /// <summary>Binds <see cref="StoreRoutingOptions"/> to configuration section <c>Stores</c> (<c>Stores:Enabled</c>, off by default).</summary>
    public static IServiceCollection AddDataStoreRouting(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<StoreRoutingOptions>().Bind(configuration.GetSection(StoreRoutingOptions.SectionName));
        return services;
    }
}
