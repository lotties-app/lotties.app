using Lotties.Application.Notifications.Dispatching;
using Lotties.Infrastructure.Notifications;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure;

public static class NotificationSchedulerServiceCollectionExtensions
{
    /// <summary>
    /// Registers the push scheduler (design section 7): the dispatcher and its steps, <see cref="PushMetrics"/>,
    /// <see cref="NotificationDispatchSettings"/> from <c>Push:MaxConcurrentSends</c>, the singleton
    /// <see cref="INotificationTick"/> (this instance's lease holder) and the <see cref="PushSchedulerService"/> host,
    /// which does nothing unless push is configured and <c>Push:SchedulerEnabled</c> is true. Needs
    /// <c>AddApplication()</c>, <c>AddInfrastructure(...)</c>, <c>AddNotificationPersistence()</c> and
    /// <c>AddPush(configuration)</c> (options, <c>IPushSender</c>).
    /// </summary>
    public static IServiceCollection AddNotificationScheduler(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddOptions<PushOptions>();
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(provider => new NotificationDispatchSettings(provider.GetRequiredService<IOptions<PushOptions>>().Value.MaxConcurrentSends));
        services.AddNotificationDispatcher();
        services.TryAddSingleton<INotificationTick, NotificationTickRunner>();
        services.AddHostedService<PushSchedulerService>();
        return services;
    }
}
