using Lotties.Application.Stores;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

public static class StoreCredentialsServiceCollectionExtensions
{
    /// <summary>
    /// When <c>Stores:Enabled</c> is true: binds and validates (at startup) <see cref="StoreCredentialsOptions"/> and
    /// registers <see cref="IKeyWrapper"/> (the configured key-encryption keys) and <see cref="IStoreCredentials"/>, both
    /// singletons. When it is false or absent (the default) it registers nothing, so no key is needed.
    /// </summary>
    public static IServiceCollection AddStoreCredentials(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        var section = configuration.GetSection(StoreCredentialsOptions.SectionName);
        if (!section.GetValue<bool>(nameof(StoreCredentialsOptions.Enabled)))
        {
            return services;
        }

        services.AddOptions<StoreCredentialsOptions>().Bind(section).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<StoreCredentialsOptions>, StoreCredentialsOptionsValidator>());
        services.TryAddSingleton<IKeyWrapper, ConfiguredKeyWrapper>();
        services.TryAddSingleton<IStoreCredentials, StoreCredentials>();
        return services;
    }
}
