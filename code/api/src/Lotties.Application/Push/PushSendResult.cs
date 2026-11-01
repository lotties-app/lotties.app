namespace Lotties.Application.Push;

/// <summary>What one push-service answer means for the subscription and the delivery (design section 8, "Responses").</summary>
public enum PushSendStatus
{
    /// <summary>2xx: accepted by the push service.</summary>
    Sent,

    /// <summary>404/410: the subscription no longer exists; revoke it as <c>gone</c>.</summary>
    SubscriptionGone,

    /// <summary>400/403: VAPID or key mismatch; revoke it as <c>invalid</c>.</summary>
    SubscriptionInvalid,

    /// <summary>429, 5xx, timeout or network error: try again later (see <see cref="PushSendResult.RetryAfter"/>).</summary>
    Retryable,

    /// <summary>Any other answer (e.g. 413): not retryable; a bug or a rejected request.</summary>
    Failed,

    /// <summary>The endpoint's host is not on the configured allowlist; nothing was sent.</summary>
    EndpointNotAllowed,
}

/// <summary>
/// The outcome of one send: the push service's HTTP status (<c>null</c> when no answer arrived: timeout, network error,
/// or nothing sent), the <c>Retry-After</c> it asked for, and the classification.
/// </summary>
public sealed record PushSendResult(int? StatusCode, TimeSpan? RetryAfter, PushSendStatus Status)
{
    /// <summary>Classifies an HTTP answer from the push service.</summary>
    public static PushSendResult FromStatusCode(int statusCode, TimeSpan? retryAfter = null) =>
        new(statusCode, retryAfter, Classify(statusCode));

    /// <summary>No answer: timeout or network failure; retryable.</summary>
    public static PushSendResult NoResponse() => new(null, null, PushSendStatus.Retryable);

    /// <summary>The SSRF guard refused the endpoint before sending.</summary>
    public static PushSendResult EndpointNotAllowed() => new(null, null, PushSendStatus.EndpointNotAllowed);

    private static PushSendStatus Classify(int statusCode) => statusCode switch
    {
        >= 200 and < 300 => PushSendStatus.Sent,
        404 or 410 => PushSendStatus.SubscriptionGone,
        400 or 403 => PushSendStatus.SubscriptionInvalid,
        429 or >= 500 => PushSendStatus.Retryable,
        _ => PushSendStatus.Failed,
    };
}
