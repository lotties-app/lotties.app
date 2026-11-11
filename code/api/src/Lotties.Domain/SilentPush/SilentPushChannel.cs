namespace Lotties.Domain.SilentPush;

/// <summary>The push service that wakes one app install for a silent push (docs/design/37b-widget-silent-push.md section 4.1).</summary>
public enum SilentPushChannel
{
    /// <summary>Apple Push Notification service (the iOS app).</summary>
    Apns,

    /// <summary>Firebase Cloud Messaging (the Android app).</summary>
    Fcm,
}

/// <summary>
/// The APNs environment a device token belongs to (a token works in one only): TestFlight and App Store builds are
/// <see cref="Production"/>, a build run from Xcode is <see cref="Sandbox"/>.
/// </summary>
public enum ApnsEnvironment
{
    Production,
    Sandbox,
}

/// <summary>The stable wire and storage codes of the silent push enums.</summary>
public static class SilentPushCodes
{
    public static string Of(SilentPushChannel channel) => channel switch
    {
        SilentPushChannel.Apns => "apns",
        SilentPushChannel.Fcm => "fcm",
        _ => throw new ArgumentOutOfRangeException(nameof(channel), channel, "Unknown silent push channel."),
    };

    public static string Of(ApnsEnvironment environment) => environment switch
    {
        ApnsEnvironment.Production => "production",
        ApnsEnvironment.Sandbox => "sandbox",
        _ => throw new ArgumentOutOfRangeException(nameof(environment), environment, "Unknown APNs environment."),
    };

    public static bool TryParse(string? code, out SilentPushChannel channel)
    {
        channel = Enum.GetValues<SilentPushChannel>().FirstOrDefault(candidate => Of(candidate) == code);
        return code is not null && Of(channel) == code;
    }

    public static bool TryParse(string? code, out ApnsEnvironment environment)
    {
        environment = Enum.GetValues<ApnsEnvironment>().FirstOrDefault(candidate => Of(candidate) == code);
        return code is not null && Of(environment) == code;
    }
}
