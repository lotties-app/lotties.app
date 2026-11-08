using Lotties.Application.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Lotties.Infrastructure.Stores.Migration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

public static class StoreRoutingServiceCollectionExtensions
{
    /// <summary>
    /// Registers the data store routing (docs/design/47-bring-your-own-database.md section 3.6) with the flag off: the scoped
    /// <see cref="IStoreScope"/> every data-plane repository goes through, the scoped <see cref="IStoreResolver"/>, the built-in
    /// store and, unless one is registered already, <see cref="IExternalDataStores"/> without any store and an
    /// <see cref="IStoreMigrator"/> that refuses every store (<c>AddStoreMigrator</c> replaces it when <c>Stores:Enabled</c> is on),
    /// and the failure handling of external stores (task T8): the per-store circuit breakers, the interceptor every external store's
    /// contexts carry and <see cref="IStoreHealth"/>. Called by <c>AddInfrastructure</c>; <see cref="AddDataStoreRouting"/> binds the
    /// flag and the breaker's options.
    /// </summary>
    internal static IServiceCollection AddStoreScope(this IServiceCollection services)
    {
        services.AddOptions<StoreRoutingOptions>();
        services.AddOptions<StoreCircuitBreakerOptions>();
        services.AddLogging();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<StoreCircuitBreakerOptions>, StoreCircuitBreakerOptionsValidator>());
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<StoreCircuitBreakers>();
        services.TryAddSingleton<StoreFailureInterceptors>();
        services.TryAddSingleton<IStoreHealth, StoreHealth>();
        services.TryAddSingleton<IExternalDataStores, NoExternalDataStores>();
        services.TryAddSingleton<IStoreMigrator, DisabledStoreMigrator>();
        services.AddScoped<BuiltInDataStore>();
        services.AddScoped<IStoreResolver, StoreResolver>();
        services.AddScoped<StoreScope>();
        services.AddScoped<IStoreScope>(provider => provider.GetRequiredService<StoreScope>());
        return services;
    }

    /// <summary>
    /// Binds <see cref="StoreRoutingOptions"/> to configuration section <c>Stores</c> (<c>Stores:Enabled</c>, off by default) and
    /// <see cref="StoreCircuitBreakerOptions"/> to <c>Stores:CircuitBreaker</c> (validated at startup).
    /// </summary>
    public static IServiceCollection AddDataStoreRouting(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<StoreRoutingOptions>().Bind(configuration.GetSection(StoreRoutingOptions.SectionName));
        services.AddOptions<StoreCircuitBreakerOptions>().Bind(configuration.GetSection(StoreCircuitBreakerOptions.SectionName)).ValidateOnStart();
        return services;
    }
}
