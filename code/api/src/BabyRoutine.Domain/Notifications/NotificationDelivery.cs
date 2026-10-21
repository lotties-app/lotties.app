using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>Where a delivery is in its life.</summary>
public enum DeliveryStatus
{
    /// <summary>Claimed; waiting for its (next) send attempt.</summary>
    Pending,

    Sent,

    /// <summary>Gave up: attempts exhausted, a rejected request or a bug (413).</summary>
    Failed,

    /// <summary>Its time to live passed before it could be sent.</summary>
    Expired,

    /// <summary>The push service says the subscription no longer exists (404/410).</summary>
    Gone,

    /// <summary>Withdrawn before sending (subscription transferred or revoked).</summary>
    Cancelled,
}

/// <summary>What one send attempt's push-service answer means (see <see cref="NotificationDelivery.RecordAttempt"/>).</summary>
public enum DeliveryAttemptOutcome
{
    /// <summary>2xx: delivered to the push service.</summary>
    Sent,

    /// <summary>404/410: revoke the subscription as gone.</summary>
    Gone,

    /// <summary>400/403: revoke the subscription as invalid (VAPID or key mismatch).</summary>
    Invalid,

    /// <summary>Not retryable (413 and other client errors), or the last retryable attempt failed.</summary>
    Failed,

    /// <summary>429, 5xx, timeout or network error: try again later.</summary>
    Retry,
}

/// <summary>A newly claimed delivery and the plain action token to put in its payload (absent for tests).</summary>
public sealed record IssuedDelivery(NotificationDelivery Delivery, NotificationActionToken? ActionToken);

/// <summary>
/// One planned notification for one subscription: the delivery log row and the idempotency claim (unique per
/// subscription and <see cref="DedupeKey"/>). Its id is the payload <c>id</c>. Only the hash of the action token is kept.
/// </summary>
public sealed class NotificationDelivery
{
    private NotificationDelivery()
    {
    }

    private NotificationDelivery(Guid id, Guid subscriptionId, PlannedNotification planned, DateTimeOffset now)
    {
        Id = id;
        SubscriptionId = subscriptionId;
        UserId = planned.UserId;
        BabyId = planned.BabyId;
        Kind = planned.Kind;
        BaseKey = planned.BaseKey;
        DedupeKey = planned.DedupeKey;
        DueAt = UtcTime.Normalize(planned.DueAt);
        ExpiresAt = UtcTime.Normalize(planned.DueAt + planned.TimeToLive);
        Status = DeliveryStatus.Pending;
        NextAttemptAt = now;
        CreatedAt = now;
    }

    public Guid Id { get; private set; }

    public Guid SubscriptionId { get; private set; }

    public Guid UserId { get; private set; }

    public Guid? BabyId { get; private set; }

    public NotificationKind Kind { get; private set; }

    public NotificationKey BaseKey { get; private set; }

    public NotificationKey DedupeKey { get; private set; }

    public DateTimeOffset DueAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DeliveryStatus Status { get; private set; }

    public short Attempts { get; private set; }

    public DateTimeOffset? NextAttemptAt { get; private set; }

    public short? LastStatusCode { get; private set; }

    public NotificationActionToken? ActionTokenHash { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? SentAt { get; private set; }

    /// <summary>
    /// Claims <paramref name="planned"/> for one subscription: <see cref="DeliveryStatus.Pending"/>, no attempts, due for
    /// sending now, and (except for tests) a new action token whose plain value is returned once.
    /// </summary>
    public static IssuedDelivery Claim(Guid deliveryId, Guid subscriptionId, PlannedNotification planned, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(planned);
        var delivery = new NotificationDelivery(Ids.Required(deliveryId, nameof(deliveryId)), Ids.Required(subscriptionId, nameof(subscriptionId)), planned, UtcTime.Normalize(now));
        var token = planned.Kind == NotificationKind.Test ? (NotificationActionToken?)null : NotificationActionToken.Generate();
        delivery.ActionTokenHash = token?.Hash();
        return new IssuedDelivery(delivery, token);
    }

    /// <summary>Whether the retry pass should send it now.</summary>
    public bool IsDueForAttemptAt(DateTimeOffset now) =>
        Status == DeliveryStatus.Pending
        && Attempts < NotificationRules.MaxAttempts
        && NextAttemptAt is { } next && next <= now
        && ExpiresAt > now;

    /// <summary>
    /// Records a send attempt: <paramref name="statusCode"/> is the push service's HTTP status, or <c>null</c> for a
    /// timeout or network error. Retryable failures wait for <paramref name="retryAfter"/> (or 1, then 4 minutes) until
    /// <see cref="NotificationRules.MaxAttempts"/> attempts, then fail. The caller applies the outcome to the subscription.
    /// </summary>
    public DeliveryAttemptOutcome RecordAttempt(int? statusCode, TimeSpan? retryAfter, DateTimeOffset now)
    {
        EnsurePending();
        Attempts++;
        LastStatusCode = statusCode is { } code ? (short)code : null;
        var outcome = OutcomeOf(statusCode, Attempts);
        Status = StatusAfter(outcome);
        SentAt = outcome == DeliveryAttemptOutcome.Sent ? UtcTime.Normalize(now) : SentAt;
        NextAttemptAt = outcome == DeliveryAttemptOutcome.Retry ? UtcTime.Normalize(now + (retryAfter ?? NotificationRules.RetryDelayAfter(Attempts))) : null;
        return outcome;
    }

    /// <summary>
    /// The send was refused before reaching a push service (the endpoint's host is no longer on the allowlist): the
    /// delivery fails without counting an attempt and the outcome is <see cref="DeliveryAttemptOutcome.Invalid"/>, so the
    /// caller revokes the subscription.
    /// </summary>
    public DeliveryAttemptOutcome RecordRefused()
    {
        EnsurePending();
        LastStatusCode = null;
        Status = DeliveryStatus.Failed;
        NextAttemptAt = null;
        return DeliveryAttemptOutcome.Invalid;
    }

    /// <summary>
    /// A new action token for a re-send of a pending delivery (only the hash is stored, so a retry cannot repeat the
    /// earlier plain token); the earlier token stops working. <c>null</c>, changing nothing, for tests (they carry no token).
    /// </summary>
    public NotificationActionToken? ReissueActionToken()
    {
        EnsurePending();
        if (Kind == NotificationKind.Test)
        {
            return null;
        }

        var token = NotificationActionToken.Generate();
        ActionTokenHash = token.Hash();
        return token;
    }

    /// <summary>A pending delivery past its time to live becomes <see cref="DeliveryStatus.Expired"/>; returns whether it did.</summary>
    public bool ExpireIfPastTimeToLive(DateTimeOffset now)
    {
        if (Status != DeliveryStatus.Pending || ExpiresAt > now)
        {
            return false;
        }

        Status = DeliveryStatus.Expired;
        NextAttemptAt = null;
        return true;
    }

    /// <summary>Withdraws a pending delivery (subscription transferred or revoked); other statuses are kept.</summary>
    public void Cancel()
    {
        if (Status != DeliveryStatus.Pending)
        {
            return;
        }

        Status = DeliveryStatus.Cancelled;
        NextAttemptAt = null;
    }

    /// <summary>
    /// Checks a snooze/dismiss request: the delivery must carry an action token equal to <paramref name="plainToken"/>
    /// and the request must come at most <see cref="NotificationRules.ActionWindow"/> after <see cref="DueAt"/>;
    /// otherwise <see cref="NotificationActionNotFoundException"/> (one error for every case).
    /// </summary>
    public void EnsureActionAllowed(string? plainToken, DateTimeOffset now)
    {
        var valid = ActionTokenHash is { } stored
            && NotificationActionToken.TryFrom(plainToken, out var token)
            && stored.FixedTimeEquals(token.Hash())
            && now <= DueAt + NotificationRules.ActionWindow;
        if (!valid)
        {
            throw new NotificationActionNotFoundException(Id);
        }
    }

    private void EnsurePending()
    {
        if (Status != DeliveryStatus.Pending)
        {
            throw new InvalidOperationException($"Delivery {Id} is {Status}; only pending deliveries can be sent.");
        }
    }

    private static DeliveryAttemptOutcome OutcomeOf(int? statusCode, int attempts) => statusCode switch
    {
        >= 200 and < 300 => DeliveryAttemptOutcome.Sent,
        404 or 410 => DeliveryAttemptOutcome.Gone,
        400 or 403 => DeliveryAttemptOutcome.Invalid,
        null or 429 or >= 500 when attempts < NotificationRules.MaxAttempts => DeliveryAttemptOutcome.Retry,
        _ => DeliveryAttemptOutcome.Failed,
    };

    private static DeliveryStatus StatusAfter(DeliveryAttemptOutcome outcome) => outcome switch
    {
        DeliveryAttemptOutcome.Sent => DeliveryStatus.Sent,
        DeliveryAttemptOutcome.Gone => DeliveryStatus.Gone,
        DeliveryAttemptOutcome.Retry => DeliveryStatus.Pending,
        _ => DeliveryStatus.Failed,
    };
}
