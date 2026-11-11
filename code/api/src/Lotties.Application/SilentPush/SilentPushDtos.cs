using Lotties.Domain.Exceptions;
using Lotties.Domain.SilentPush;

namespace Lotties.Application.SilentPush;

/// <summary>Body of <c>POST /push/devices</c>: the push service's token of this app install.</summary>
public sealed record RegisterSilentPushDeviceRequest
{
    private const string ChannelField = "channel";
    private const string EnvironmentField = "apnsEnvironment";

    /// <summary><c>apns</c> or <c>fcm</c>.</summary>
    public string? Channel { get; init; }

    public string? Token { get; init; }

    /// <summary><c>production</c> or <c>sandbox</c>, for an APNs token only.</summary>
    public string? ApnsEnvironment { get; init; }

    /// <summary>The channel; 400 <c>validation_failed</c> (field <c>channel</c>) when it is missing or unknown.</summary>
    public SilentPushChannel ParsedChannel() =>
        SilentPushCodes.TryParse(Channel, out SilentPushChannel channel)
            ? channel
            : throw new DomainValidationException(ChannelField, "channel must be apns or fcm.");

    /// <summary>The APNs environment, or <c>null</c> when none was sent; 400 (field <c>apnsEnvironment</c>) when it is unknown.</summary>
    public ApnsEnvironment? ParsedApnsEnvironment() => ApnsEnvironment switch
    {
        null => null,
        _ when SilentPushCodes.TryParse(ApnsEnvironment, out ApnsEnvironment environment) => environment,
        _ => throw new DomainValidationException(EnvironmentField, "apnsEnvironment must be production or sandbox."),
    };
}

/// <summary>
/// <c>GET /push/silent/status?channel=</c>: whether the app may ask the phone for a push token of that channel
/// (docs/design/37b-widget-silent-push.md section 5.4). Only the boolean: no host, key, credential or setting.
/// </summary>
public sealed record SilentPushStatusResponse(bool Enabled)
{
    private const string ChannelField = "channel";

    /// <summary>The channel of the query; 400 <c>validation_failed</c> (field <c>channel</c>) when it is missing or unknown.</summary>
    public static SilentPushChannel ParseChannel(string? channel) =>
        SilentPushCodes.TryParse(channel, out SilentPushChannel parsed)
            ? parsed
            : throw new DomainValidationException(ChannelField, "channel must be apns or fcm.");
}

/// <summary>One of the caller's registered devices. The token is never returned.</summary>
public sealed record SilentPushDeviceResponse
{
    public Guid Id { get; init; }

    public string Channel { get; init; } = string.Empty;

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset LastSeenAt { get; init; }

    public static implicit operator SilentPushDeviceResponse(SilentPushDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        return new SilentPushDeviceResponse
        {
            Id = device.Id,
            Channel = SilentPushCodes.Of(device.Channel),
            CreatedAt = device.CreatedAt,
            LastSeenAt = device.LastSeenAt,
        };
    }
}

/// <summary>The device after <c>POST /push/devices</c> and whether it was new (201) or refreshed (200).</summary>
public sealed record RegisterSilentPushDeviceResult(SilentPushDeviceResponse Device, bool Created);
