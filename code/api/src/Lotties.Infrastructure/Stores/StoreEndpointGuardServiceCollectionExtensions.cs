using Lotties.Application.Stores;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

public static class StoreEndpointGuardServiceCollectionExtensions
{
    /// <summary>
    /// Binds and validates (at startup) <see cref="StoreEndpointGuardOptions"/> from the <c>StoreEndpointGuard</c> section and
    /// registers the egress guard of user-owned databases, the system resolver and the pinned data source factory
    /// (docs/design/47-bring-your-own-database.md section 3.2). Binding sets public settings only: the loopback test seam
    /// cannot come from configuration.
    /// </summary>
    public static IServiceCollection AddStoreEndpointGuard(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<StoreEndpointGuardOptions>().Bind(configuration.GetSection(StoreEndpointGuardOptions.SectionName)).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<StoreEndpointGuardOptions>, StoreEndpointGuardOptionsValidator>());
        services.TryAddSingleton<IHostResolver, SystemHostResolver>();
        services.TryAddSingleton<IStoreEndpointGuard, StoreEndpointGuard>();
        services.TryAddSingleton<PinnedStoreDataSourceFactory>();
        return services;
    }
}
