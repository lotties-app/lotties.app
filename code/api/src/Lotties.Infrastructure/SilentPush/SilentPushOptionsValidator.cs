using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.SilentPush;

/// <summary>
/// Fails startup on an unusable <see cref="SilentPushOptions"/>: an out-of-range setting, a channel with some but not all
/// credentials, a key that does not parse, a key file naming another token host, or silent pushes on with no channel.
/// Messages name the setting, never its value.
/// </summary>
internal sealed class SilentPushOptionsValidator : IValidateOptions<SilentPushOptions>
{
    public ValidateOptionsResult Validate(string? name, SilentPushOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = SettingFailures(options)
            .Concat(ApnsFailures(options.Apns))
            .Concat(FcmFailures(options.Fcm))
            .Concat(ChannelFailures(options))
            .ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static IEnumerable<string> SettingFailures(SilentPushOptions options)
    {
        var checks = new (string Setting, bool IsValid)[]
        {
            ($"SilentPush:DebounceSeconds must be between 0 and {SilentPushOptions.MaxDebounceSeconds}.", options.DebounceSeconds is >= 0 and <= SilentPushOptions.MaxDebounceSeconds),
            ($"SilentPush:MinIntervalSeconds must be between 0 and {SilentPushOptions.MaxMinIntervalSeconds}.", options.MinIntervalSeconds is >= 0 and <= SilentPushOptions.MaxMinIntervalSeconds),
            ($"SilentPush:WorkerTickSeconds must be between 1 and {SilentPushOptions.MaxWorkerTickSeconds}.", options.WorkerTickSeconds is >= 1 and <= SilentPushOptions.MaxWorkerTickSeconds),
            ("SilentPush:MaxDevicesPerUser must be positive.", options.MaxDevicesPerUser > 0),
            ("SilentPush:SendTimeoutSeconds must be positive.", options.SendTimeoutSeconds > 0),
            ("SilentPush:MaxConcurrentSends must be positive.", options.MaxConcurrentSends > 0),
            ("SilentPush:FcmPriority must be normal or high.", options.FcmPriority?.Trim() is SilentPushOptions.NormalPriority or SilentPushOptions.HighPriority),
            ("SilentPush:Apns:BundleId must be set.", !string.IsNullOrWhiteSpace(options.Apns.BundleId)),
        };
        return checks.Where(check => !check.IsValid).Select(check => check.Setting);
    }

    private static IEnumerable<string> ApnsFailures(SilentPushApnsOptions apns)
    {
        if (!apns.IsAnySet)
        {
            return [];
        }

        if (!apns.IsConfigured)
        {
            return [$"APNs needs all of {SilentPushEnvironmentVariables.ApnsKeyId}, {SilentPushEnvironmentVariables.ApnsTeamId} and {SilentPushEnvironmentVariables.ApnsPrivateKey}, or none of them."];
        }

        using var key = ApnsSigningKey.TryCreate(apns, out var problem);
        return problem is null ? [] : [problem];
    }

    private static IEnumerable<string> FcmFailures(SilentPushFcmOptions fcm)
    {
        if (!fcm.IsAnySet)
        {
            return [];
        }

        if (!fcm.IsConfigured)
        {
            return [$"FCM needs both {SilentPushEnvironmentVariables.FcmProjectId} and {SilentPushEnvironmentVariables.FcmServiceAccount}, or none of them."];
        }

        using var account = GoogleServiceAccount.TryCreate(fcm, out var problem);
        return problem is null ? [] : [problem];
    }

    private static IEnumerable<string> ChannelFailures(SilentPushOptions options) =>
        options.Enabled && !options.Apns.IsConfigured && !options.Fcm.IsConfigured
            ? [$"{SilentPushEnvironmentVariables.Enabled} is on but neither APNs ({SilentPushEnvironmentVariables.ApnsKeyId}, ...) nor FCM ({SilentPushEnvironmentVariables.FcmProjectId}, ...) is configured."]
            : [];
}
