using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Infrastructure.Push;

/// <summary>
/// Fails startup on an unusable <see cref="PushOptions"/>: some but not all VAPID values set, an invalid or mismatched
/// key pair, an invalid subject, an out-of-range setting or a malformed allowlist entry. No VAPID values = push off.
/// </summary>
internal sealed class PushOptionsValidator : IValidateOptions<PushOptions>
{
    public ValidateOptionsResult Validate(string? name, PushOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = VapidFailures(options.Vapid)
            .Concat(SettingFailures(options))
            .Concat(AllowlistFailures(options.EffectiveAllowedEndpointHosts))
            .ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static IEnumerable<string> VapidFailures(PushVapidOptions vapid)
    {
        if (!vapid.IsAnySet)
        {
            return [];
        }

        if (!vapid.IsConfigured)
        {
            return [$"Push needs all of {PushEnvironmentVariables.PublicKey}, {PushEnvironmentVariables.PrivateKey} and {PushEnvironmentVariables.Subject}, or none of them."];
        }

        return new[] { VapidKeys.FindProblem(vapid.PublicKey!.Trim(), vapid.PrivateKey!.Trim()), SubjectProblem(vapid.Subject!.Trim()) }
            .OfType<string>();
    }

    private static string? SubjectProblem(string subject) =>
        Uri.TryCreate(subject, UriKind.Absolute, out var uri) && IsContact(uri)
            ? null
            : "Push:Vapid:Subject must be a mailto: address or an https: URL.";

    private static bool IsContact(Uri uri) =>
        (uri.Scheme == Uri.UriSchemeMailto && uri.AbsoluteUri.Contains('@'))
        || (uri.Scheme == Uri.UriSchemeHttps && !string.IsNullOrEmpty(uri.Host));

    private static IEnumerable<string> SettingFailures(PushOptions options)
    {
        var checks = new (string Setting, bool IsValid)[]
        {
            ($"Push:TickSeconds must be between {PushOptions.MinTickSeconds} and {PushOptions.MaxTickSeconds}.",
                options.TickSeconds is >= PushOptions.MinTickSeconds and <= PushOptions.MaxTickSeconds),
            ("Push:MaxSubscriptionsPerUser must be positive.", options.MaxSubscriptionsPerUser > 0),
            ("Push:SendTimeoutSeconds must be positive.", options.SendTimeoutSeconds > 0),
            ("Push:MaxConcurrentSends must be positive.", options.MaxConcurrentSends > 0),
        };
        return checks.Where(check => !check.IsValid).Select(check => check.Setting);
    }

    private static IEnumerable<string> AllowlistFailures(IReadOnlyList<string> hosts)
    {
        try
        {
            PushEndpointAllowlist.Create(hosts);
            return [];
        }
        catch (ArgumentException exception)
        {
            return [$"Push:AllowedEndpointHosts is invalid: {exception.Message}"];
        }
    }
}
