using Lotties.Domain.Notifications;

namespace Lotties.Infrastructure.Push;

/// <summary>
/// Configuration section <c>Push</c> (docs/design/09-push-notifications.md section 9). Push is enabled only when all
/// three <see cref="Vapid"/> values are set (env <c>PUSH_VAPID_*</c>, see <see cref="PushEnvironmentVariables"/>);
/// validated at startup by <see cref="PushOptionsValidator"/>.
/// </summary>
public sealed class PushOptions
{
    public const string SectionName = "Push";
    public const int MinTickSeconds = 15;
    public const int MaxTickSeconds = 300;

    public PushVapidOptions Vapid { get; set; } = new();

    /// <summary>Scheduler polling interval, 15 to 300 seconds.</summary>
    public int TickSeconds { get; set; } = 60;

    /// <summary>Whether the background scheduler runs (tests set it false and drive ticks directly).</summary>
    public bool SchedulerEnabled { get; set; } = true;

    /// <summary>Push service hosts the server may POST to; empty means <see cref="PushEndpointAllowlist.DefaultHosts"/>.</summary>
    public string[] AllowedEndpointHosts { get; set; } = [];

    public int MaxSubscriptionsPerUser { get; set; } = 10;

    /// <summary>HTTP timeout of one send to a push service.</summary>
    public int SendTimeoutSeconds { get; set; } = 10;

    public int MaxConcurrentSends { get; set; } = 8;

    /// <summary>Whether push is configured (all three VAPID values set); otherwise the feature is off.</summary>
    public bool IsEnabled => Vapid.IsConfigured;

    /// <summary>The allowlist entries in effect: the configured ones, or the defaults when none are configured.</summary>
    public IReadOnlyList<string> EffectiveAllowedEndpointHosts =>
        AllowedEndpointHosts.Length == 0 ? PushEndpointAllowlist.DefaultHosts : AllowedEndpointHosts;
}

/// <summary>The VAPID (RFC 8292) application server identity: base64url raw P-256 keys and the operator contact.</summary>
public sealed class PushVapidOptions
{
    /// <summary>Uncompressed P-256 public key (65 bytes) as base64url; the browser's <c>applicationServerKey</c>.</summary>
    public string? PublicKey { get; set; }

    /// <summary>P-256 private scalar (32 bytes) as base64url. Secret: env only, never logged.</summary>
    public string? PrivateKey { get; set; }

    /// <summary><c>mailto:</c> address or <c>https:</c> URL of the operator.</summary>
    public string? Subject { get; set; }

    public bool IsConfigured => IsSet(PublicKey) && IsSet(PrivateKey) && IsSet(Subject);

    /// <summary>Whether at least one value is set (all set = enabled; some set = invalid configuration).</summary>
    public bool IsAnySet => IsSet(PublicKey) || IsSet(PrivateKey) || IsSet(Subject);

    public override string ToString() => "[vapid options]";

    private static bool IsSet(string? value) => !string.IsNullOrWhiteSpace(value);
}
