using Lotties.Application.Push;
using Lotties.Domain.Notifications;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>Push-service answers injected through the fake sender: revocations, retries with backoff, give-ups and sender faults.</summary>
public sealed class NotificationSendFailureTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Theory]
    [InlineData(410, SubscriptionRevokeReason.Gone, DeliveryStatus.Gone)]
    [InlineData(404, SubscriptionRevokeReason.Gone, DeliveryStatus.Gone)]
    [InlineData(400, SubscriptionRevokeReason.Invalid, DeliveryStatus.Failed)]
    [InlineData(403, SubscriptionRevokeReason.Invalid, DeliveryStatus.Failed)]
    public async Task RunOnceAsync_SubscriptionRejected_RevokesItAndSendsNothingMoreToIt(int statusCode, SubscriptionRevokeReason reason, DeliveryStatus status)
    {
        var subscription = await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(statusCode);

        await _host.RunAsync(SaoPaulo(18, 0));
        var later = await _host.RunAsync(SaoPaulo(18, 5));

        Assert.Equal(reason, (await _host.SubscriptionAsync(subscription.Id)).RevokedReason);
        Assert.Equal(status, (await _host.DeliveriesAsync()).Single().Status);
        Assert.Equal(0, later.Retried + later.Claimed);
        Assert.Single(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_EndpointNoLongerAllowed_FailsWithoutAttemptAndRevokesInvalid()
    {
        var subscription = await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => PushSendResult.EndpointNotAllowed();

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        var delivery = (await _host.DeliveriesAsync()).Single();
        Assert.Equal(1, result.Failed);
        Assert.Equal((DeliveryStatus.Failed, (short)0, (short?)null), (delivery.Status, delivery.Attempts, delivery.LastStatusCode));
        Assert.Equal(SubscriptionRevokeReason.Invalid, (await _host.SubscriptionAsync(subscription.Id)).RevokedReason);
    }

    [Fact]
    public async Task RunOnceAsync_TooManyRequestsWithRetryAfter_RetriesAtThatTimeWithANewToken()
    {
        var subscription = await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(429, TimeSpan.FromMinutes(2));
        var first = await _host.RunAsync(SaoPaulo(18, 0));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var tooEarly = await _host.RunAsync(SaoPaulo(18, 1));
        var retried = await _host.RunAsync(SaoPaulo(18, 2));

        Assert.Equal(1, first.Retrying);
        Assert.Equal(0, tooEarly.Retried);
        Assert.Equal((1, 1), (retried.Retried, retried.Sent));
        var tokens = _host.Sender.Sent.Select(push => push.Payload.GetProperty("token").GetString()).ToArray();
        Assert.Equal(2, tokens.Length);
        Assert.NotEqual(tokens[0], tokens[1]);
        var delivery = (await _host.DeliveriesAsync()).Single();
        Assert.Equal((DeliveryStatus.Sent, (short)2), (delivery.Status, delivery.Attempts));
        Assert.Equal(0, (await _host.SubscriptionAsync(subscription.Id)).ConsecutiveFailures);
    }

    [Fact]
    public async Task RunOnceAsync_ServerErrorsThreeTimes_BacksOffOneThenFourMinutesThenFails()
    {
        var subscription = await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);

        var attempts = new[]
        {
            await _host.RunAsync(SaoPaulo(18, 0)),
            await _host.RunAsync(SaoPaulo(18, 1)),
            await _host.RunAsync(SaoPaulo(18, 4)),
            await _host.RunAsync(SaoPaulo(18, 5)),
            await _host.RunAsync(SaoPaulo(18, 10)),
        };

        Assert.Equal([1, 1, 0, 1, 0], attempts.Select(result => result.Retrying + result.Failed));
        Assert.Equal(1, attempts[3].Failed);
        Assert.Equal(3, _host.Sender.Sent.Count);
        var delivery = (await _host.DeliveriesAsync()).Single();
        Assert.Equal((DeliveryStatus.Failed, (short)3, (short?)503), (delivery.Status, delivery.Attempts, delivery.LastStatusCode));
        var stored = await _host.SubscriptionAsync(subscription.Id);
        Assert.Equal(3, stored.ConsecutiveFailures);
        Assert.False(stored.IsRevoked);
    }

    [Fact]
    public async Task RunOnceAsync_SenderThrows_TreatedAsNoAnswerAndRetried()
    {
        await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => throw new HttpRequestException("connection reset");

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal(1, result.Retrying);
        var delivery = (await _host.DeliveriesAsync()).Single();
        Assert.Equal((DeliveryStatus.Pending, (short)1, (short?)null), (delivery.Status, delivery.Attempts, delivery.LastStatusCode));
        Assert.Equal(SaoPaulo(18, 1), delivery.NextAttemptAt);
    }

    [Fact]
    public async Task RunOnceAsync_PayloadTooLarge_FailsWithoutRetryAndKeepsTheSubscription()
    {
        var subscription = await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(413);

        await _host.RunAsync(SaoPaulo(18, 0));
        await _host.RunAsync(SaoPaulo(18, 5));

        Assert.Equal(DeliveryStatus.Failed, (await _host.DeliveriesAsync()).Single().Status);
        var stored = await _host.SubscriptionAsync(subscription.Id);
        Assert.Equal((1, false), (stored.ConsecutiveFailures, stored.IsRevoked));
        Assert.Single(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_GoneOnOneDevice_OtherDeviceStillReceives()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        var gone = await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        var working = await _host.SeedSubscriptionAsync(family.OwnerId);
        _host.Sender.Responder = push => PushSendResult.FromStatusCode(push.IsFor(gone) ? 410 : 201);

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal((1, 1), (result.Sent, result.Gone));
        Assert.Null((await _host.SubscriptionAsync(working.Id)).RevokedReason);
    }

    [Fact]
    public async Task RunOnceAsync_PendingRetryForARevokedSubscription_IsCancelled()
    {
        var subscription = await SeedDoseAtSixAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(500);
        await _host.RunAsync(SaoPaulo(18, 0));
        await _host.Factory.SeedAsync(async context =>
        {
            var stored = await context.PushSubscriptions.FindAsync(subscription.Id);
            stored!.Revoke(SubscriptionRevokeReason.User, SaoPaulo(18, 0));
        });

        var result = await _host.RunAsync(SaoPaulo(18, 1));

        Assert.Equal((1, 0), (result.Cancelled, result.Retried));
        Assert.Equal(DeliveryStatus.Cancelled, (await _host.DeliveriesAsync()).Single().Status);
    }

    private async Task<PushSubscription> SeedDoseAtSixAsync()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        return await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
    }
}
