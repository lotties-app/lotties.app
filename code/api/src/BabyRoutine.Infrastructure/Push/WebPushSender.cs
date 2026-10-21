using System.Net.Http.Headers;
using BabyRoutine.Application.Push;
using BabyRoutine.Domain.Notifications;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using LibPushMessage = Lib.Net.Http.WebPush.PushMessage;
using LibPushSubscription = Lib.Net.Http.WebPush.PushSubscription;
using PushMessage = BabyRoutine.Application.Push.PushMessage;

namespace BabyRoutine.Infrastructure.Push;

/// <summary>
/// <see cref="IPushSender"/> on <c>Lib.Net.Http.WebPush</c>: RFC 8291 <c>aes128gcm</c> encryption and VAPID
/// (RFC 8292, <c>vapid</c> scheme) over a typed <see cref="HttpClient"/>. The library's own 429 retry is off (the
/// scheduler owns retries). The endpoint allowlist is re-checked before every send. Endpoints, keys and payloads are
/// never logged.
/// </summary>
internal sealed partial class WebPushSender(
    HttpClient httpClient,
    IOptions<PushOptions> options,
    PushEndpointAllowlist allowlist,
    TimeProvider timeProvider,
    ILogger<WebPushSender> logger) : IPushSender
{
    /// <summary>The library hides the success status; push services answer 201 Created.</summary>
    private const int AcceptedStatusCode = 201;

    public async Task<PushSendResult> SendAsync(PushTarget target, PushMessage message, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(message);
        var vapid = EnsureConfigured(options.Value.Vapid);
        if (!allowlist.Allows(target.Endpoint))
        {
            LogEndpointNotAllowed(logger, target.Endpoint.Host);
            return PushSendResult.EndpointNotAllowed();
        }

        using var authentication = new VapidAuthentication(vapid.PublicKey!.Trim(), vapid.PrivateKey!.Trim()) { Subject = vapid.Subject!.Trim() };
        var result = await DeliverAsync(CreateClient(authentication), target, message, cancellationToken);
        LogSent(logger, target.Endpoint.Host, result.StatusCode, result.Status);
        return result;
    }

    private async Task<PushSendResult> DeliverAsync(PushServiceClient client, PushTarget target, PushMessage message, CancellationToken cancellationToken)
    {
        try
        {
            await client.RequestPushMessageDeliveryAsync(ToSubscription(target), ToMessage(message), cancellationToken);
            return PushSendResult.FromStatusCode(AcceptedStatusCode);
        }
        catch (PushServiceClientException exception)
        {
            return PushSendResult.FromStatusCode((int)exception.StatusCode, RetryAfterOf(exception.Headers));
        }
        catch (HttpRequestException)
        {
            return PushSendResult.NoResponse();
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return PushSendResult.NoResponse();
        }
    }

    private PushServiceClient CreateClient(VapidAuthentication authentication) =>
        new(httpClient)
        {
            DefaultAuthentication = authentication,
            DefaultAuthenticationScheme = VapidAuthenticationScheme.Vapid,
            DefaultTimeToLive = (int)NotificationRules.TestTimeToLive.TotalSeconds,
            AutoRetryAfter = false,
        };

    private static PushVapidOptions EnsureConfigured(PushVapidOptions vapid) =>
        vapid.IsConfigured ? vapid : throw new InvalidOperationException("Push is not configured (PUSH_VAPID_* unset); check PushOptions.IsEnabled first.");

    private static LibPushSubscription ToSubscription(PushTarget target)
    {
        var subscription = new LibPushSubscription { Endpoint = target.Endpoint.Value };
        subscription.SetKey(PushEncryptionKeyName.P256DH, target.Keys.P256dh);
        subscription.SetKey(PushEncryptionKeyName.Auth, target.Keys.Auth);
        return subscription;
    }

    private static LibPushMessage ToMessage(PushMessage message) =>
        new(message.Payload)
        {
            Topic = message.Topic,
            TimeToLive = (int)Math.Ceiling(message.TimeToLive.TotalSeconds),
            Urgency = message.Urgency == NotificationUrgency.High ? PushMessageUrgency.High : PushMessageUrgency.Normal,
        };

    private TimeSpan? RetryAfterOf(HttpResponseHeaders? headers) => headers?.RetryAfter switch
    {
        { Delta: { } delta } => delta,
        { Date: { } date } => Max(date - timeProvider.GetUtcNow(), TimeSpan.Zero),
        _ => null,
    };

    private static TimeSpan Max(TimeSpan left, TimeSpan right) => left > right ? left : right;

    [LoggerMessage(Level = LogLevel.Warning, Message = "Push not sent: host {PushServiceHost} is not on Push:AllowedEndpointHosts")]
    private static partial void LogEndpointNotAllowed(ILogger logger, string pushServiceHost);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Push to {PushServiceHost} answered {StatusCode} ({SendStatus})")]
    private static partial void LogSent(ILogger logger, string pushServiceHost, int? statusCode, PushSendStatus sendStatus);
}
