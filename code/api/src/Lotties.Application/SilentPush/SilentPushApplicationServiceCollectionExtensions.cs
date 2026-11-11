using Lotties.Domain.SilentPush;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Application.SilentPush;

public static class SilentPushApplicationServiceCollectionExtensions
{
    /// <summary>
    /// Registers the silent push use cases (docs/design/37b-widget-silent-push.md): the per-instance
    /// <see cref="SilentPushQueue"/>, the <see cref="ISilentPushSignal"/> the write paths call, the device routes' service
    /// and the device routes' service (part of <c>AddApplication()</c>). Safe without a host setup: the configuration
    /// defaults to off and the origin device to none. The host replaces <see cref="ISilentPushConfiguration"/> and
    /// <see cref="ICurrentPushDevice"/> and registers the repository.
    /// </summary>
    public static IServiceCollection AddSilentPushApplication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<SilentPushQueue>();
        services.TryAddSingleton<ISilentPushConfiguration, SilentPushOff>();
        services.TryAddScoped<ICurrentPushDevice, NoCurrentPushDevice>();
        services.TryAddScoped<ISilentPushSignal, SilentPushSignal>();
        services.TryAddScoped<ISilentPushDeviceService, SilentPushDeviceService>();
        return services;
    }

    /// <summary>
    /// Registers the <see cref="ISilentPushDispatcher"/> the worker runs. The host must register
    /// <see cref="ISilentPushSender"/>, <see cref="SilentPushDispatchSettings"/>, the repository and the consent service.
    /// </summary>
    public static IServiceCollection AddSilentPushDispatch(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddScoped<ISilentPushDispatcher, SilentPushDispatcher>();
        return services;
    }

    /// <summary>The default when the host configured nothing: off.</summary>
    private sealed class SilentPushOff : ISilentPushConfiguration
    {
        public bool IsEnabled => false;

        public int MaxDevicesPerUser => 1;

        public SilentPushTiming Timing { get; } = new(TimeSpan.Zero, TimeSpan.Zero);

        public bool Accepts(SilentPushChannel channel) => false;
    }
}
