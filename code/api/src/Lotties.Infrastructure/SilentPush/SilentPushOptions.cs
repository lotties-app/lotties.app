namespace Lotties.Infrastructure.SilentPush;

/// <summary>
/// Configuration section <c>SilentPush</c> (docs/design/37b-widget-silent-push.md section 4.6). Off by default; a channel
/// is configured when all its credentials are set (env <c>PUSH_APNS_*</c>, <c>PUSH_FCM_*</c>, see
/// <see cref="SilentPushEnvironmentVariables"/>). Validated at startup by <see cref="SilentPushOptionsValidator"/>.
/// </summary>
public sealed class SilentPushOptions
{
    public const string SectionName = "SilentPush";
    public const int MaxDebounceSeconds = 300;
    public const int MaxMinIntervalSeconds = 3600;
    public const int MaxWorkerTickSeconds = 60;
    public const string NormalPriority = "normal";
    public const string HighPriority = "high";

    /// <summary>The master switch: off means no route works, no change is queued and no worker runs.</summary>
    public bool Enabled { get; set; }

    /// <summary>A batch is due this long after its first change (0 to 300).</summary>
    public int DebounceSeconds { get; set; } = 20;

    /// <summary>At most one push per baby in this time (0 to 3600).</summary>
    public int MinIntervalSeconds { get; set; } = 300;

    /// <summary>How often the worker looks for due batches (1 to 60).</summary>
    public int WorkerTickSeconds { get; set; } = 5;

    /// <summary>Whether the background worker runs (tests set it false and drive ticks directly).</summary>
    public bool WorkerEnabled { get; set; } = true;

    public int MaxDevicesPerUser { get; set; } = 10;

    /// <summary>HTTP timeout of one send (and of one OAuth token exchange).</summary>
    public int SendTimeoutSeconds { get; set; } = 10;

    public int MaxConcurrentSends { get; set; } = 8;

    /// <summary>The FCM Android priority, <c>normal</c> (default: waits for Doze maintenance windows) or <c>high</c>.</summary>
    public string FcmPriority { get; set; } = NormalPriority;

    public SilentPushApnsOptions Apns { get; set; } = new();

    public SilentPushFcmOptions Fcm { get; set; } = new();

    public override string ToString() => "[silent push options]";
}

/// <summary>The APNs token-based connection: the auth key (<c>.p8</c>) and its ids. Secret: env only, never logged.</summary>
public sealed class SilentPushApnsOptions
{
    public const string DefaultBundleId = "app.lotties.app";

    public string? KeyId { get; set; }

    public string? TeamId { get; set; }

    /// <summary>The <c>.p8</c> file's text (PEM PKCS#8 P-256 key) or its base64.</summary>
    public string? PrivateKey { get; set; }

    /// <summary>The app's bundle id, the <c>apns-topic</c>.</summary>
    public string BundleId { get; set; } = DefaultBundleId;

    public bool IsConfigured => IsSet(KeyId) && IsSet(TeamId) && IsSet(PrivateKey);

    public bool IsAnySet => IsSet(KeyId) || IsSet(TeamId) || IsSet(PrivateKey);

    public override string ToString() => "[apns options]";

    private static bool IsSet(string? value) => !string.IsNullOrWhiteSpace(value);
}

/// <summary>The FCM HTTP v1 connection: the Firebase project and a service-account key. Secret: env only, never logged.</summary>
public sealed class SilentPushFcmOptions
{
    public string? ProjectId { get; set; }

    /// <summary>The service-account key file (JSON) or its base64.</summary>
    public string? ServiceAccountJson { get; set; }

    public bool IsConfigured => IsSet(ProjectId) && IsSet(ServiceAccountJson);

    public bool IsAnySet => IsSet(ProjectId) || IsSet(ServiceAccountJson);

    public override string ToString() => "[fcm options]";

    private static bool IsSet(string? value) => !string.IsNullOrWhiteSpace(value);
}

/// <summary>The flat environment variables of silent push and the configuration keys they map to (added to the Api host's aliases).</summary>
public static class SilentPushEnvironmentVariables
{
    public const string Enabled = "SILENT_PUSH_ENABLED";
    public const string ApnsKeyId = "PUSH_APNS_KEY_ID";
    public const string ApnsTeamId = "PUSH_APNS_TEAM_ID";
    public const string ApnsPrivateKey = "PUSH_APNS_KEY_P8";
    public const string ApnsBundleId = "PUSH_APNS_BUNDLE_ID";
    public const string FcmProjectId = "PUSH_FCM_PROJECT_ID";
    public const string FcmServiceAccount = "PUSH_FCM_SERVICE_ACCOUNT_JSON";

    public static readonly IReadOnlyDictionary<string, string> VariableToKey = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [Enabled] = $"{SilentPushOptions.SectionName}:Enabled",
        [ApnsKeyId] = $"{SilentPushOptions.SectionName}:Apns:KeyId",
        [ApnsTeamId] = $"{SilentPushOptions.SectionName}:Apns:TeamId",
        [ApnsPrivateKey] = $"{SilentPushOptions.SectionName}:Apns:PrivateKey",
        [ApnsBundleId] = $"{SilentPushOptions.SectionName}:Apns:BundleId",
        [FcmProjectId] = $"{SilentPushOptions.SectionName}:Fcm:ProjectId",
        [FcmServiceAccount] = $"{SilentPushOptions.SectionName}:Fcm:ServiceAccountJson",
    };
}
