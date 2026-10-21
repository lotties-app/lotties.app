using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Application.Push;

public static class PushApplicationServiceCollectionExtensions
{
    /// <summary>
    /// Registers the push notification use cases behind the HTTP endpoints (devices, settings, preferences, test send,
    /// snooze/dismiss). The host must register <see cref="IPushConfiguration"/>, <see cref="IPushSender"/>, the
    /// <see cref="Domain.Notifications.PushEndpointAllowlist"/> and the notification repositories.
    /// </summary>
    public static IServiceCollection AddPushNotifications(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddScoped<IPushSubscriptionService, PushSubscriptionService>();
        services.AddScoped<INotificationPreferencesService, NotificationPreferencesService>();
        services.AddScoped<IPushTestService, PushTestService>();
        services.AddScoped<INotificationActionService, NotificationActionService>();
        return services;
    }
}
