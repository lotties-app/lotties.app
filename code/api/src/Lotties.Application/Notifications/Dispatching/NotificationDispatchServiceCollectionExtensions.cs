using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Application.Notifications.Dispatching;

public static class NotificationDispatchServiceCollectionExtensions
{
    /// <summary>
    /// Registers the tick logic: <see cref="INotificationDispatcher"/> and its steps (scoped, one unit of work per tick),
    /// <see cref="PushMetrics"/> (singleton) and <see cref="NotificationDispatchSettings.Default"/> unless the host
    /// registered settings. Needs the notification and Domain repositories, an <c>IPushSender</c> and the
    /// <c>PredictionOptions</c> registered by <see cref="ApplicationServiceCollectionExtensions.AddApplication"/>.
    /// </summary>
    public static IServiceCollection AddNotificationDispatcher(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton(NotificationDispatchSettings.Default);
        services.TryAddSingleton<PushMetrics>();
        services.TryAddSingleton(Lotties.Domain.Predictions.PredictionOptions.Default);
        services.TryAddScoped<NotificationPlanInputLoader>();
        services.TryAddScoped<NotificationRetryPass>();
        services.TryAddScoped<NotificationPlanningPass>();
        services.TryAddScoped<NotificationClaimer>();
        services.TryAddScoped<PushBatchSender>();
        services.TryAddScoped<NotificationHousekeeping>();
        services.TryAddScoped<INotificationDispatcher, NotificationDispatcher>();
        return services;
    }
}
