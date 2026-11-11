using Lotties.Application.SilentPush;
using Lotties.Infrastructure.Persistence.Repositories;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.SilentPush;

public static class SilentPushServiceCollectionExtensions
{
    /// <summary>
    /// Silent pushes for the widgets (docs/design/37b-widget-silent-push.md): binds and validates (at startup)
    /// <see cref="SilentPushOptions"/> from the <c>SilentPush</c> section, replaces the application's off-by-default
    /// <see cref="ISilentPushConfiguration"/>, registers the device repository, the APNs and FCM senders behind
    /// <see cref="ISilentPushSender"/> (HTTP clients without request logging: an APNs token is in the URL), the dispatcher,
    /// the <see cref="ISilentPushTick"/> and the <see cref="SilentPushWorker"/> host. Nothing sends while
    /// <c>SilentPush:Enabled</c> is false. Needs <c>AddApplication()</c> and <c>AddInfrastructure(...)</c>.
    /// </summary>
    public static IServiceCollection AddSilentPush(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<SilentPushOptions>().Bind(configuration.GetSection(SilentPushOptions.SectionName)).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<SilentPushOptions>, SilentPushOptionsValidator>());
        services.TryAddSingleton(TimeProvider.System);
        services.AddSilentPushApplication();
        services.Replace(ServiceDescriptor.Singleton<ISilentPushConfiguration, SilentPushOptionsConfiguration>());
        services.AddScoped<ISilentPushDeviceRepository, EfSilentPushDeviceRepository>();
        services.TryAddSingleton<SilentPushChannels>();
        services.TryAddSingleton(provider => new SilentPushDispatchSettings(provider.GetRequiredService<IOptions<SilentPushOptions>>().Value.MaxConcurrentSends));
        AddSenders(services);
        services.AddSilentPushDispatch();
        services.TryAddSingleton<ISilentPushTick, SilentPushTickRunner>();
        services.AddHostedService<SilentPushWorker>();
        return services;
    }

    private static void AddSenders(IServiceCollection services)
    {
        services.AddHttpClient<ApnsSilentPushSender>(ConfigureTimeout)
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
            {
                // Apple asks for few, long-lived HTTP/2 connections.
                PooledConnectionLifetime = TimeSpan.FromHours(1),
                EnableMultipleHttp2Connections = true,
            })
            .RemoveAllLoggers();
        services.AddHttpClient<FcmSilentPushSender>(ConfigureTimeout).RemoveAllLoggers();
        services.AddHttpClient(GoogleAccessTokenSource.HttpClientName, ConfigureTimeout).RemoveAllLoggers();
        services.AddTransient<IChannelSilentPushSender>(provider => provider.GetRequiredService<ApnsSilentPushSender>());
        services.AddTransient<IChannelSilentPushSender>(provider => provider.GetRequiredService<FcmSilentPushSender>());
        services.TryAddTransient<ISilentPushSender, DispatchingSilentPushSender>();
    }

    private static void ConfigureTimeout(IServiceProvider provider, HttpClient client)
    {
        client.Timeout = TimeSpan.FromSeconds(provider.GetRequiredService<IOptions<SilentPushOptions>>().Value.SendTimeoutSeconds);
    }
}
