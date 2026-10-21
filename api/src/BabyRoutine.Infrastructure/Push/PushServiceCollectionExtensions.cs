using BabyRoutine.Application.Push;
using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Infrastructure.Push;

public static class PushServiceCollectionExtensions
{
    /// <summary>
    /// Binds and validates (at startup) <see cref="PushOptions"/> from the <c>Push</c> section, registers the
    /// <see cref="PushEndpointAllowlist"/> in effect and <see cref="IPushSender"/> as a typed <see cref="HttpClient"/>
    /// with <c>Push:SendTimeoutSeconds</c>. Safe when push is not configured: nothing sends until
    /// <see cref="PushOptions.IsEnabled"/> is true.
    /// </summary>
    public static IServiceCollection AddPush(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<PushOptions>().Bind(configuration.GetSection(PushOptions.SectionName)).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<PushOptions>, PushOptionsValidator>());
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(provider => PushEndpointAllowlist.Create(provider.GetRequiredService<IOptions<PushOptions>>().Value.EffectiveAllowedEndpointHosts));
        services.AddHttpClient<IPushSender, WebPushSender>((provider, client) =>
            client.Timeout = TimeSpan.FromSeconds(provider.GetRequiredService<IOptions<PushOptions>>().Value.SendTimeoutSeconds));
        return services;
    }
}
