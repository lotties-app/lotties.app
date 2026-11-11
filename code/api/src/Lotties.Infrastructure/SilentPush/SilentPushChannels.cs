using Lotties.Application.SilentPush;
using Lotties.Domain.SilentPush;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.SilentPush;

/// <summary>
/// The credentials of each channel, built once from the validated options (<c>null</c> for a channel without them or while
/// silent pushes are off), and each channel's throttle of configuration-error logs. Singleton; owns and disposes the keys.
/// </summary>
internal sealed class SilentPushChannels : IDisposable
{
    private readonly ApnsSigningKey? _apnsKey;
    private readonly GoogleServiceAccount? _googleAccount;

    public SilentPushChannels(IOptions<SilentPushOptions> options, IHttpClientFactory httpClients, TimeProvider time, ILoggerFactory loggers)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(loggers);
        var value = options.Value;
        _apnsKey = value.Enabled && value.Apns.IsConfigured ? ApnsSigningKey.TryCreate(value.Apns, out _) : null;
        _googleAccount = value.Enabled && value.Fcm.IsConfigured ? GoogleServiceAccount.TryCreate(value.Fcm, out _) : null;
        ApnsToken = _apnsKey is null ? null : new ApnsProviderToken(_apnsKey, time);
        FcmToken = _googleAccount is null ? null : new GoogleAccessTokenSource(_googleAccount, httpClients, time, loggers.CreateLogger<GoogleAccessTokenSource>());
        ApnsErrors = new HourlyErrorLog(time);
        FcmErrors = new HourlyErrorLog(time);
    }

    public ApnsProviderToken? ApnsToken { get; }

    public GoogleAccessTokenSource? FcmToken { get; }

    public HourlyErrorLog ApnsErrors { get; }

    public HourlyErrorLog FcmErrors { get; }

    public void Dispose()
    {
        FcmToken?.Dispose();
        _googleAccount?.Dispose();
        _apnsKey?.Dispose();
    }
}

/// <summary><see cref="ISilentPushConfiguration"/> read from the validated <see cref="SilentPushOptions"/>.</summary>
internal sealed class SilentPushOptionsConfiguration(IOptions<SilentPushOptions> options) : ISilentPushConfiguration
{
    public bool IsEnabled => options.Value.Enabled;

    public int MaxDevicesPerUser => options.Value.MaxDevicesPerUser;

    public SilentPushTiming Timing => new(TimeSpan.FromSeconds(options.Value.DebounceSeconds), TimeSpan.FromSeconds(options.Value.MinIntervalSeconds));

    public bool Accepts(SilentPushChannel channel) => IsEnabled && channel switch
    {
        SilentPushChannel.Apns => options.Value.Apns.IsConfigured,
        SilentPushChannel.Fcm => options.Value.Fcm.IsConfigured,
        _ => false,
    };
}
