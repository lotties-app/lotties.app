using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Application.SilentPush;
using Lotties.Domain.SilentPush;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.SilentPush;

/// <summary>Sends to one channel; registered only when that channel is configured.</summary>
internal interface IChannelSilentPushSender
{
    SilentPushChannel Channel { get; }

    /// <summary>Whether this channel's credentials are set (silent pushes on).</summary>
    bool IsConfigured { get; }

    Task<SilentPushOutcome> SendAsync(SilentPushTarget target, CancellationToken cancellationToken = default);
}

/// <summary>
/// <see cref="ISilentPushSender"/> over the channels (a <c>CanHandle</c> pick): the configured sender of the target's channel,
/// or <see cref="SilentPushOutcome.NotConfigured"/> without one (never an exception).
/// </summary>
internal sealed class DispatchingSilentPushSender(IEnumerable<IChannelSilentPushSender> senders, ILogger<DispatchingSilentPushSender> logger) : ISilentPushSender
{
    private readonly IReadOnlyList<IChannelSilentPushSender> _senders = senders.ToArray();

    public Task<SilentPushOutcome> SendAsync(SilentPushTarget target, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(target);
        var sender = _senders.FirstOrDefault(candidate => candidate.Channel == target.Channel && candidate.IsConfigured);
        if (sender is null)
        {
            logger.LogDebug("Silent push to device {DeviceId} not sent: its channel {Channel} is not configured", target.DeviceId, SilentPushCodes.Of(target.Channel));
            return Task.FromResult(SilentPushOutcome.NotConfigured);
        }

        return sender.SendAsync(target, cancellationToken);
    }
}

/// <summary>Logs a server configuration error at most once an hour per sender (every push would repeat it).</summary>
internal sealed class HourlyErrorLog(TimeProvider time)
{
    private static readonly TimeSpan Every = TimeSpan.FromHours(1);
    private readonly object _gate = new();
    private DateTimeOffset _lastAt = DateTimeOffset.MinValue;

    public bool ShouldLog()
    {
        lock (_gate)
        {
            var now = time.GetUtcNow();
            if (now - _lastAt < Every)
            {
                return false;
            }

            _lastAt = now;
            return true;
        }
    }
}

/// <summary>
/// APNs background push (docs/design/37b-widget-silent-push.md section 3): HTTP/2 POST to <c>/3/device/{token}</c> on the
/// device's environment, <c>apns-push-type: background</c>, priority 5, expiration one hour, the content-free
/// <see cref="Payload"/>. Never logs the token (the HTTP client of this sender has no request logging).
/// </summary>
internal sealed class ApnsSilentPushSender(HttpClient http, SilentPushChannels channels, IOptions<SilentPushOptions> options, TimeProvider time, ILogger<ApnsSilentPushSender> logger)
    : IChannelSilentPushSender
{
    public const string ProductionOrigin = "https://api.push.apple.com";
    public const string SandboxOrigin = "https://api.sandbox.push.apple.com";
    public const string Payload = """{"aps":{"content-available":1},"lotties":{"v":1,"t":"sync"}}""";
    public static readonly TimeSpan TimeToLive = TimeSpan.FromHours(1);
    private const int MaxReasonLength = 64;

    public SilentPushChannel Channel => SilentPushChannel.Apns;

    public bool IsConfigured => channels.ApnsToken is not null;

    private ApnsProviderToken Tokens => channels.ApnsToken ?? throw new InvalidOperationException("APNs is not configured.");

    /// <summary>What an APNs answer means (the status and its <c>reason</c>); only a token reason blames the device.</summary>
    public static SilentPushOutcome Classify(int status, string? reason) => (status, reason) switch
    {
        (200, _) => SilentPushOutcome.Sent,
        (410, _) => SilentPushOutcome.Gone,
        (400, "BadDeviceToken" or "DeviceTokenNotForTopic") => SilentPushOutcome.Invalid,
        (400 or 403 or 404 or 405 or 413, _) => SilentPushOutcome.ConfigurationError,
        (429, _) or (>= 500, _) => SilentPushOutcome.Retryable,
        _ => SilentPushOutcome.Failed,
    };

    public async Task<SilentPushOutcome> SendAsync(SilentPushTarget target, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(target);
        using var request = BuildRequest(target);
        using var response = await SilentPushHttp.TrySendAsync(http, request, logger, target, cancellationToken);
        return response is null ? SilentPushOutcome.Retryable : await ClassifyAsync(target, response, cancellationToken);
    }

    private HttpRequestMessage BuildRequest(SilentPushTarget target)
    {
        var origin = target.ApnsEnvironment == ApnsEnvironment.Sandbox ? SandboxOrigin : ProductionOrigin;
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri($"{origin}/3/device/{Uri.EscapeDataString(target.Token)}"))
        {
            Version = HttpVersion.Version20,
            VersionPolicy = HttpVersionPolicy.RequestVersionExact,
            Content = new StringContent(Payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("bearer", Tokens.Current());
        request.Headers.Add("apns-push-type", "background");
        request.Headers.Add("apns-priority", "5");
        request.Headers.Add("apns-topic", options.Value.Apns.BundleId.Trim());
        request.Headers.Add("apns-expiration", (time.GetUtcNow() + TimeToLive).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        return request;
    }

    private async Task<SilentPushOutcome> ClassifyAsync(SilentPushTarget target, HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var status = (int)response.StatusCode;
        var reason = response.IsSuccessStatusCode ? null : await ReadReasonAsync(response, cancellationToken);
        var outcome = Classify(status, reason);
        ForgetExpiredToken(reason);
        LogConfigurationError(outcome, status, reason);
        logger.LogDebug("APNs answered {StatusCode} {Reason} for device {DeviceId}", status, reason, target.DeviceId);
        return outcome;
    }

    private void ForgetExpiredToken(string? reason)
    {
        if (reason == "ExpiredProviderToken")
        {
            Tokens.Invalidate();
        }
    }

    private void LogConfigurationError(SilentPushOutcome outcome, int status, string? reason)
    {
        if (outcome == SilentPushOutcome.ConfigurationError && channels.ApnsErrors.ShouldLog())
        {
            logger.LogError("APNs refused a silent push with {StatusCode} {Reason}: check the APNs key, team id and bundle id", status, reason);
        }
    }

    private static async Task<string?> ReadReasonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var node = await SilentPushHttp.ReadJsonAsync(response, cancellationToken);
        var reason = node?["reason"]?.GetValueKind() == JsonValueKind.String ? node["reason"]!.GetValue<string>() : null;
        return reason is { Length: <= MaxReasonLength } ? reason : null;
    }
}

/// <summary>
/// FCM HTTP v1 data message (docs/design/37b-widget-silent-push.md section 3): no <c>notification</c> block, priority from
/// <c>SilentPush:FcmPriority</c>, TTL one hour, one constant collapse key. A 401 gets a new access token once.
/// </summary>
internal sealed class FcmSilentPushSender(HttpClient http, SilentPushChannels channels, IOptions<SilentPushOptions> options, ILogger<FcmSilentPushSender> logger)
    : IChannelSilentPushSender
{
    public const string Origin = "https://fcm.googleapis.com";
    public const string CollapseKey = "lotties-sync";
    private const int MaxCodeLength = 64;

    public SilentPushChannel Channel => SilentPushChannel.Fcm;

    public bool IsConfigured => channels.FcmToken is not null;

    private GoogleAccessTokenSource Tokens => channels.FcmToken ?? throw new InvalidOperationException("FCM is not configured.");

    /// <summary>
    /// What an FCM answer means: the status, the <c>FcmError.errorCode</c> and the message. An invalid argument blames the
    /// device only when the message is about the registration token (a bad payload must never revoke every device).
    /// </summary>
    public static SilentPushOutcome Classify(int status, string? errorCode, string? message) => (status, errorCode) switch
    {
        (200, _) => SilentPushOutcome.Sent,
        (_, "UNREGISTERED") => SilentPushOutcome.Gone,
        (403, "SENDER_ID_MISMATCH") => SilentPushOutcome.Invalid,
        (400, "INVALID_ARGUMENT") when message?.Contains("registration token", StringComparison.OrdinalIgnoreCase) == true => SilentPushOutcome.Invalid,
        (400 or 401 or 403 or 404, _) => SilentPushOutcome.ConfigurationError,
        (429, _) or (>= 500, _) => SilentPushOutcome.Retryable,
        _ => SilentPushOutcome.Failed,
    };

    public async Task<SilentPushOutcome> SendAsync(SilentPushTarget target, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(target);
        var first = await SendOnceAsync(target, cancellationToken);
        if (!first.Unauthorized)
        {
            return first.Outcome;
        }

        Tokens.Invalidate();
        var second = await SendOnceAsync(target, cancellationToken);
        return second.Unauthorized ? StillUnauthorized() : second.Outcome;
    }

    private async Task<FcmAnswer> SendOnceAsync(SilentPushTarget target, CancellationToken cancellationToken)
    {
        var token = await Tokens.GetAsync(cancellationToken);
        if (token.Value is null)
        {
            return FcmAnswer.Of(token.Failure);
        }

        using var request = BuildRequest(target, token.Value);
        using var response = await SilentPushHttp.TrySendAsync(http, request, logger, target, cancellationToken);
        return response is null ? FcmAnswer.Of(SilentPushOutcome.Retryable) : await AnswerAsync(response, cancellationToken);
    }

    private async Task<FcmAnswer> AnswerAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            return FcmAnswer.NotAuthorized;
        }

        var status = (int)response.StatusCode;
        var error = response.IsSuccessStatusCode ? null : await ReadErrorAsync(response, cancellationToken);
        var outcome = Classify(status, error?.Code, error?.Message);
        LogConfigurationError(outcome, status, error?.Code);
        return FcmAnswer.Of(outcome);
    }

    private SilentPushOutcome StillUnauthorized()
    {
        LogConfigurationError(SilentPushOutcome.ConfigurationError, (int)HttpStatusCode.Unauthorized, null);
        return SilentPushOutcome.ConfigurationError;
    }

    private HttpRequestMessage BuildRequest(SilentPushTarget target, string accessToken)
    {
        var message = new JsonObject
        {
            ["message"] = new JsonObject
            {
                ["token"] = target.Token,
                ["data"] = new JsonObject { ["lotties"] = "sync", ["v"] = "1" },
                ["android"] = new JsonObject
                {
                    ["priority"] = options.Value.FcmPriority.Trim() == SilentPushOptions.HighPriority ? "HIGH" : "NORMAL",
                    ["ttl"] = "3600s",
                    ["collapse_key"] = CollapseKey,
                },
            },
        };
        var projectId = Uri.EscapeDataString(options.Value.Fcm.ProjectId!.Trim());
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri($"{Origin}/v1/projects/{projectId}/messages:send"))
        {
            Content = new StringContent(message.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return request;
    }

    private void LogConfigurationError(SilentPushOutcome outcome, int status, string? errorCode)
    {
        if (outcome == SilentPushOutcome.ConfigurationError && channels.FcmErrors.ShouldLog())
        {
            logger.LogError("FCM refused a silent push with {StatusCode} {ErrorCode}: check the Firebase project id and the service account", status, errorCode);
        }
    }

    private static async Task<FcmError?> ReadErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var error = (await SilentPushHttp.ReadJsonAsync(response, cancellationToken))?["error"];
        var details = error?["details"] as JsonArray ?? [];
        var code = details.OfType<JsonObject>().Select(detail => detail["errorCode"]).OfType<JsonValue>().Select(value => value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null).FirstOrDefault(value => value is not null);
        var text = error?["message"] is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;
        return new FcmError(code is { Length: <= MaxCodeLength } ? code : null, text);
    }

    private sealed record FcmError(string? Code, string? Message);

    /// <summary>One send's answer: an outcome, or a 401 (the access token is refreshed once and the send repeated).</summary>
    private sealed record FcmAnswer(SilentPushOutcome Outcome, bool Unauthorized)
    {
        public static readonly FcmAnswer NotAuthorized = new(SilentPushOutcome.ConfigurationError, true);

        public static FcmAnswer Of(SilentPushOutcome outcome) => new(outcome, false);
    }
}

/// <summary>The HTTP steps both senders share: a send that turns a network failure or timeout into "no answer", and a bounded JSON read.</summary>
internal static class SilentPushHttp
{
    private const int MaxErrorBodyBytes = 16 * 1024;

    public static async Task<HttpResponseMessage?> TrySendAsync(HttpClient http, HttpRequestMessage request, ILogger logger, SilentPushTarget target, CancellationToken cancellationToken)
    {
        try
        {
            return await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException || (exception is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogWarning("Silent push to device {DeviceId} got no answer: {ErrorType}", target.DeviceId, exception.GetType().Name);
            return null;
        }
    }

    /// <summary>The body as JSON when it is small JSON, else <c>null</c> (a push service's error text is never logged).</summary>
    public static async Task<JsonNode?> ReadJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength is > MaxErrorBodyBytes)
        {
            return null;
        }

        try
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            return text.Length is > 0 and <= MaxErrorBodyBytes ? JsonNode.Parse(text) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
