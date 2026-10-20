using BabyRoutine.Application.Babies;
using BabyRoutine.Application.Users;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BabyRoutine.Application;

public static class ApplicationServiceCollectionExtensions
{
    /// <summary>
    /// Registers the application services and <see cref="TimeProvider.System"/>. The host must register
    /// <see cref="ICurrentUser"/> and the Domain repositories.
    /// </summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<IUserProvisioningService, UserProvisioningService>();
        services.AddScoped<IBabyAccessService, BabyAccessService>();
        return services;
    }
}
