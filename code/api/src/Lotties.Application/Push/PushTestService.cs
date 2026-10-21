using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Application.Notifications;
using Lotties.Application.Users;
using Lotties.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Push;

/// <summary>Sends a <c>test</c> notification to the caller's devices, synchronously.</summary>
public interface IPushTestService
{
    /// <summary>
    /// Sends to the caller's active device with <see cref="PushTestRequest.Endpoint"/>, or to all of them without it.
    /// Each send is logged as a delivery and its answer applied to the device (gone and invalid devices are revoked).
    /// </summary>
    Task<PushTestResponse> SendAsync(PushTestRequest request, CancellationToken cancellationToken = default);
}

internal sealed class PushTestService : IPushTestService
{
    private const string SentStatus = "sent";
    private const string GoneStatus = "gone";
    private const string FailedStatus = "failed";
    private const int PayloadVersion = 1;

    private static readonly JsonSerializerOptions PayloadJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly IPushSubscriptionRepository _subscriptions;
    private readonly INotificationDeliveryRepository _deliveries;
    private readonly IPushSender _sender;
    private readonly IPushConfiguration _configuration;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<PushTestService> _logger;

    public PushTestService(
        IPushSubscriptionRepository subscriptions,
        INotificationDeliveryRepository deliveries,
        IPushSender sender,
        IPushConfiguration configuration,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<PushTestService> logger)
    {
        _subscriptions = subscriptions ?? throw new ArgumentNullException(nameof(subscriptions));
        _deliveries = deliveries ?? throw new ArgumentNullException(nameof(deliveries));
        _sender = sender ?? throw new ArgumentNullException(nameof(sender));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<PushTestResponse> SendAsync(PushTestRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        _configuration.EnsureEnabled();
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var targets = Targets(await _subscriptions.ListActiveForUserAsync(user.Id, cancellationToken), request.Endpoint, now);
        var claims = await ClaimAllAsync(user.Id, targets, now, cancellationToken);
        var answers = await Task.WhenAll(claims.Select(claim => _sender.SendAsync(PushTarget.From(claim.Subscription), claim.Message, cancellationToken)));
        var results = claims.Zip(answers, (claim, answer) => Record(claim, answer, _timeProvider.GetUtcNow())).ToArray();
        await _deliveries.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Test push for user {UserId}: {SentCount} of {DeviceCount} devices sent", user.Id, results.Count(result => result.Status == SentStatus), results.Length);
        return new PushTestResponse(results);
    }

    private static IReadOnlyList<PushSubscription> Targets(IReadOnlyList<PushSubscription> active, string? endpoint, DateTimeOffset now)
    {
        var hash = string.IsNullOrEmpty(endpoint) ? null : PushEndpoint.HashOf(endpoint);
        return active.Where(subscription => subscription.IsActiveAt(now) && (hash is null || subscription.EndpointHash == hash)).ToArray();
    }

    private async Task<IReadOnlyList<TestClaim>> ClaimAllAsync(Guid userId, IReadOnlyList<PushSubscription> targets, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var claims = new List<TestClaim>(targets.Count);
        foreach (var subscription in targets)
        {
            claims.Add(await ClaimAsync(userId, subscription, now, cancellationToken));
        }

        return claims;
    }

    private async Task<TestClaim> ClaimAsync(Guid userId, PushSubscription subscription, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var deliveryId = Guid.NewGuid();
        var key = NotificationKey.ForTest(deliveryId);
        var planned = new PlannedNotification(
            userId, NotificationKind.Test, null, key, key, now, NotificationRules.TestTimeToLive, NotificationUrgency.Normal, new NotificationContent(null, null, now, null));
        var delivery = NotificationDelivery.Claim(deliveryId, subscription.Id, planned, now).Delivery;
        if (!await _deliveries.TryClaimAsync(delivery, cancellationToken))
        {
            throw new InvalidOperationException($"Test delivery {deliveryId} could not be claimed although its key is new.");
        }

        var message = PushMessage.Create(Payload(delivery, subscription.Locale, now), key, NotificationRules.TestTimeToLive, NotificationUrgency.Normal);
        return new TestClaim(subscription, delivery, message);
    }

    private PushTestResult Record(TestClaim claim, PushSendResult answer, DateTimeOffset now)
    {
        if (answer.Status == PushSendStatus.EndpointNotAllowed)
        {
            claim.Delivery.Cancel();
            _logger.LogWarning("Test push {DeliveryId} not sent: device {SubscriptionId} is outside the endpoint allowlist", claim.Delivery.Id, claim.Subscription.Id);
            return new PushTestResult(claim.Subscription.Id, FailedStatus);
        }

        var outcome = claim.Delivery.RecordAttempt(answer.StatusCode, answer.RetryAfter, now);
        ApplyToSubscription(claim.Subscription, outcome, now);
        _logger.LogDebug("Test push {DeliveryId} to device {SubscriptionId}: {StatusCode}", claim.Delivery.Id, claim.Subscription.Id, answer.StatusCode);
        return new PushTestResult(claim.Subscription.Id, StatusOf(outcome));
    }

    private static void ApplyToSubscription(PushSubscription subscription, DeliveryAttemptOutcome outcome, DateTimeOffset now)
    {
        Action<DateTimeOffset> apply = outcome switch
        {
            DeliveryAttemptOutcome.Sent => subscription.RecordSuccess,
            DeliveryAttemptOutcome.Gone => at => subscription.Revoke(SubscriptionRevokeReason.Gone, at),
            DeliveryAttemptOutcome.Invalid => at => subscription.Revoke(SubscriptionRevokeReason.Invalid, at),
            _ => subscription.RecordFailure,
        };
        apply(now);
    }

    private static string StatusOf(DeliveryAttemptOutcome outcome) => outcome switch
    {
        DeliveryAttemptOutcome.Sent => SentStatus,
        DeliveryAttemptOutcome.Gone => GoneStatus,
        _ => FailedStatus,
    };

    private static string Payload(NotificationDelivery delivery, NotificationLocale locale, DateTimeOffset at) =>
        JsonSerializer.Serialize(
            new TestPayload(PayloadVersion, delivery.Id, NotificationCodes.Of(NotificationKind.Test), at.UtcDateTime, locale.Value),
            PayloadJson);

    private sealed record TestClaim(PushSubscription Subscription, NotificationDelivery Delivery, PushMessage Message);

    /// <summary>The <c>test</c> payload (design section 8): no baby, no names, no action token.</summary>
    private sealed record TestPayload(int V, Guid Id, string Kind, DateTime At, string Lang);
}
