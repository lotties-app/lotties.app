using BabyRoutine.Application.Notifications;
using BabyRoutine.Infrastructure.Persistence.Repositories;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Infrastructure;

public static class NotificationPersistenceServiceCollectionExtensions
{
    /// <summary>
    /// Registers the push notification repositories (scoped). Needs the <see cref="Persistence.BabyRoutineDbContext"/>
    /// and unique-violation detection registered by <see cref="InfrastructureServiceCollectionExtensions.AddInfrastructure"/>.
    /// </summary>
    public static IServiceCollection AddNotificationPersistence(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddScoped<IPushSubscriptionRepository, EfPushSubscriptionRepository>();
        services.AddScoped<IUserNotificationSettingsRepository, EfUserNotificationSettingsRepository>();
        services.AddScoped<IBabyNotificationPreferencesRepository, EfBabyNotificationPreferencesRepository>();
        services.AddScoped<INotificationDeliveryRepository, EfNotificationDeliveryRepository>();
        services.AddScoped<INotificationActionRepository, EfNotificationActionRepository>();
        services.AddScoped<IJobLeaseRepository, EfJobLeaseRepository>();
        return services;
    }
}
