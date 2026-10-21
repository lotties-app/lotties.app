using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Notifications;
using static BabyRoutine.Domain.Tests.Notifications.NotificationFixtures;

namespace BabyRoutine.Domain.Tests.Notifications;

public sealed class NotificationEntityTests
{
    private static readonly DateTimeOffset Now = TestClock.Now;

    private static PushSubscription Subscription(Guid? userId = null, DateTimeOffset? at = null, DateTimeOffset? expiresAt = null) =>
        PushSubscription.Create(userId ?? MomId, FcmEndpoint(Guid.NewGuid().ToString("N")), Keys(), NotificationLocale.FromOrDefault("pt-BR"), " Chrome on Android ", expiresAt, at ?? Now);

    private static PlannedNotification Planned(NotificationKind kind = NotificationKind.DoseDue)
    {
        var key = kind == NotificationKind.Test ? NotificationKey.ForTest(Guid.NewGuid()) : NotificationKey.ForDose(Guid.NewGuid(), Now);
        return new PlannedNotification(MomId, kind, Guid.NewGuid(), key, key, Now, TimeSpan.FromMinutes(90), NotificationUrgency.High, new NotificationContent(null, null, Now, null));
    }

    private static NotificationDelivery Claimed(out NotificationActionToken? token, NotificationKind kind = NotificationKind.DoseDue)
    {
        var issued = NotificationDelivery.Claim(Guid.NewGuid(), Guid.NewGuid(), Planned(kind), Now);
        token = issued.ActionToken;
        return issued.Delivery;
    }

    [Fact]
    public void PushSubscription_Create_KeepsTheEndpointHashAndTrimsTheLabel()
    {
        var subscription = Subscription();

        Assert.Equal(subscription.Endpoint.Hash, subscription.EndpointHash);
        Assert.Equal(("Chrome on Android", "pt-BR"), (subscription.DeviceLabel, subscription.Locale.Value));
        Assert.Equal((Now, Now, 0), (subscription.CreatedAt, subscription.LastSeenAt, subscription.ConsecutiveFailures));
        Assert.True(subscription.IsActiveAt(Now));
        Assert.NotEqual(Guid.Empty, subscription.Id);
    }

    [Fact]
    public void PushSubscription_LabelTooLong_Rejected()
    {
        var create = () => PushSubscription.Create(MomId, FcmEndpoint(), Keys(), NotificationLocale.English, new string('x', 61), null, Now);

        Assert.Equal("deviceLabel", Assert.Throws<DomainValidationException>(create).Field);
    }

    [Fact]
    public void PushSubscription_RefreshBySameUser_UnrevokesAndBumpsLastSeen()
    {
        var subscription = Subscription();
        subscription.Revoke(SubscriptionRevokeReason.User, Now);

        var transferred = subscription.Refresh(MomId, Keys(), NotificationLocale.English, null, null, Now.AddHours(1));

        Assert.False(transferred);
        Assert.Equal((false, (SubscriptionRevokeReason?)null, Now.AddHours(1)), (subscription.IsRevoked, subscription.RevokedReason, subscription.LastSeenAt));
        Assert.Equal("en", subscription.Locale.Value);
    }

    [Fact]
    public void PushSubscription_RefreshByAnotherUser_TransfersTheDevice()
    {
        var subscription = Subscription();
        subscription.RecordFailure(Now);

        var transferred = subscription.Refresh(DadId, Keys(), NotificationLocale.English, "Laptop", null, Now.AddHours(1));

        Assert.True(transferred);
        Assert.Equal((DadId, 0), (subscription.UserId, subscription.ConsecutiveFailures));
    }

    [Fact]
    public void PushSubscription_Revoke_IsIdempotentAndKeepsTheFirstReason()
    {
        var subscription = Subscription();

        subscription.Revoke(SubscriptionRevokeReason.Gone, Now);
        subscription.Revoke(SubscriptionRevokeReason.User, Now.AddHours(1));

        Assert.Equal((Now, SubscriptionRevokeReason.Gone), (subscription.RevokedAt!.Value, subscription.RevokedReason!.Value));
        Assert.False(subscription.IsActiveAt(Now));
    }

    [Fact]
    public void PushSubscription_TenConsecutiveFailures_RevokesAsInvalid()
    {
        var subscription = Subscription();

        Enumerable.Range(0, 9).ToList().ForEach(_ => subscription.RecordFailure(Now));
        var afterNine = subscription.IsRevoked;
        subscription.RecordFailure(Now);

        Assert.False(afterNine);
        Assert.Equal(SubscriptionRevokeReason.Invalid, subscription.RevokedReason);
    }

    [Fact]
    public void PushSubscription_Success_ResetsFailures()
    {
        var subscription = Subscription();
        subscription.RecordFailure(Now);

        subscription.RecordSuccess(Now.AddMinutes(1));

        Assert.Equal((0, Now.AddMinutes(1)), (subscription.ConsecutiveFailures, subscription.LastSuccessAt!.Value));
    }

    [Fact]
    public void PushSubscription_ExpirationTime_EndsActivity()
    {
        var subscription = Subscription(expiresAt: Now.AddHours(1));

        Assert.True(subscription.IsActiveAt(Now));
        Assert.False(subscription.IsActiveAt(Now.AddHours(1)));
    }

    [Fact]
    public void PushSubscription_BeyondCap_PicksTheLeastRecentlySeen()
    {
        var subscriptions = Enumerable.Range(0, 12).Select(minutes => Subscription(at: Now.AddMinutes(minutes))).ToArray();

        var evicted = PushSubscription.BeyondCap(subscriptions, NotificationRules.DefaultMaxSubscriptionsPerUser);

        Assert.Equal([subscriptions[1], subscriptions[0]], evicted);
        Assert.Empty(PushSubscription.BeyondCap(subscriptions[..10], 10));
    }

    [Fact]
    public void NotificationDelivery_Claim_PendingDueNowWithHashedToken()
    {
        var delivery = Claimed(out var token);

        Assert.Equal((DeliveryStatus.Pending, (short)0, Now, Now.AddMinutes(90)), (delivery.Status, delivery.Attempts, delivery.NextAttemptAt!.Value, delivery.ExpiresAt));
        Assert.NotNull(token);
        Assert.Equal(token!.Value.Hash(), delivery.ActionTokenHash);
        Assert.True(delivery.IsDueForAttemptAt(Now));
    }

    [Fact]
    public void NotificationDelivery_TestKind_HasNoActionToken()
    {
        var delivery = Claimed(out var token, NotificationKind.Test);

        Assert.Null(token);
        Assert.Null(delivery.ActionTokenHash);
        Assert.Throws<NotificationActionNotFoundException>(() => delivery.EnsureActionAllowed("anything-long-enough-token", Now));
    }

    [Theory]
    [InlineData(201, DeliveryAttemptOutcome.Sent, DeliveryStatus.Sent)]
    [InlineData(202, DeliveryAttemptOutcome.Sent, DeliveryStatus.Sent)]
    [InlineData(404, DeliveryAttemptOutcome.Gone, DeliveryStatus.Gone)]
    [InlineData(410, DeliveryAttemptOutcome.Gone, DeliveryStatus.Gone)]
    [InlineData(400, DeliveryAttemptOutcome.Invalid, DeliveryStatus.Failed)]
    [InlineData(403, DeliveryAttemptOutcome.Invalid, DeliveryStatus.Failed)]
    [InlineData(413, DeliveryAttemptOutcome.Failed, DeliveryStatus.Failed)]
    [InlineData(429, DeliveryAttemptOutcome.Retry, DeliveryStatus.Pending)]
    [InlineData(503, DeliveryAttemptOutcome.Retry, DeliveryStatus.Pending)]
    [InlineData(null, DeliveryAttemptOutcome.Retry, DeliveryStatus.Pending)]
    public void NotificationDelivery_RecordAttempt_MapsThePushServiceAnswer(int? statusCode, DeliveryAttemptOutcome outcome, DeliveryStatus status)
    {
        var delivery = Claimed(out _);

        var result = delivery.RecordAttempt(statusCode, null, Now);

        Assert.Equal((outcome, status, (short)1), (result, delivery.Status, delivery.Attempts));
        Assert.Equal(outcome == DeliveryAttemptOutcome.Sent ? Now : (DateTimeOffset?)null, delivery.SentAt);
    }

    [Fact]
    public void NotificationDelivery_Retries_WaitOneThenFourMinutesThenFail()
    {
        var delivery = Claimed(out _);

        delivery.RecordAttempt(500, null, Now);
        var firstRetry = delivery.NextAttemptAt;
        delivery.RecordAttempt(500, null, Now.AddMinutes(1));
        var secondRetry = delivery.NextAttemptAt;
        var last = delivery.RecordAttempt(500, null, Now.AddMinutes(5));

        Assert.Equal((Now.AddMinutes(1), Now.AddMinutes(5)), (firstRetry!.Value, secondRetry!.Value));
        Assert.Equal((DeliveryAttemptOutcome.Failed, DeliveryStatus.Failed, (DateTimeOffset?)null), (last, delivery.Status, delivery.NextAttemptAt));
        Assert.False(delivery.IsDueForAttemptAt(Now.AddMinutes(10)));
    }

    [Fact]
    public void NotificationDelivery_RetryAfter_IsHonoured()
    {
        var delivery = Claimed(out _);

        delivery.RecordAttempt(429, TimeSpan.FromSeconds(90), Now);

        Assert.Equal(Now.AddSeconds(90), delivery.NextAttemptAt);
        Assert.False(delivery.IsDueForAttemptAt(Now.AddSeconds(89)));
        Assert.True(delivery.IsDueForAttemptAt(Now.AddSeconds(90)));
    }

    [Fact]
    public void NotificationDelivery_PastTimeToLive_ExpiresAndIsNoLongerDue()
    {
        var delivery = Claimed(out _);

        Assert.False(delivery.ExpireIfPastTimeToLive(Now.AddMinutes(89)));
        Assert.False(delivery.IsDueForAttemptAt(Now.AddMinutes(90)));
        Assert.True(delivery.ExpireIfPastTimeToLive(Now.AddMinutes(90)));
        Assert.Equal(DeliveryStatus.Expired, delivery.Status);
    }

    [Fact]
    public void NotificationDelivery_Cancel_OnlyPending()
    {
        var pending = Claimed(out _);
        var sent = Claimed(out _);
        sent.RecordAttempt(201, null, Now);

        pending.Cancel();
        sent.Cancel();

        Assert.Equal((DeliveryStatus.Cancelled, DeliveryStatus.Sent), (pending.Status, sent.Status));
        Assert.Throws<InvalidOperationException>(() => pending.RecordAttempt(201, null, Now));
    }

    [Fact]
    public void NotificationDelivery_ActionToken_AcceptedWithin12HoursOnly()
    {
        var delivery = Claimed(out var token);
        var plain = token!.Value.Value;

        delivery.EnsureActionAllowed(plain, Now.AddHours(12));

        Assert.Throws<NotificationActionNotFoundException>(() => delivery.EnsureActionAllowed(plain, Now.AddHours(12).AddSeconds(1)));
        Assert.Throws<NotificationActionNotFoundException>(() => delivery.EnsureActionAllowed(NotificationActionToken.Generate().Value, Now));
        Assert.Throws<NotificationActionNotFoundException>(() => delivery.EnsureActionAllowed(null, Now));
        Assert.Equal("notification_action_not_found", Assert.Throws<NotificationActionNotFoundException>(() => delivery.EnsureActionAllowed("x", Now)).Code);
    }

    [Fact]
    public void NotificationAction_Snooze_CountsUpToThreeThenRefuses()
    {
        var key = NotificationKey.ForDose(Guid.NewGuid(), Now);
        var action = NotificationAction.Snooze(MomId, Guid.NewGuid(), key, Now);

        action.Snooze(Now.AddMinutes(30));
        action.Snooze(Now.AddMinutes(60));

        Assert.Equal((NotificationActionKind.Snoozed, (short)3, Now.AddMinutes(90)), (action.Action, action.SnoozeCount, action.SnoozedUntil!.Value));
        Assert.Equal(key.Snoozed(3), action.SnoozeResendKey);
        Assert.Equal("snooze_limit_reached", Assert.Throws<SnoozeLimitReachedException>(() => action.Snooze(Now.AddMinutes(90))).Code);
    }

    [Fact]
    public void NotificationAction_Dismiss_KeepsTheSnoozeCountAndCanBeSnoozedAgain()
    {
        var key = NotificationKey.ForDose(Guid.NewGuid(), Now);
        var action = NotificationAction.Snooze(MomId, Guid.NewGuid(), key, Now);

        action.Dismiss(Now.AddMinutes(5));
        action.Dismiss(Now.AddMinutes(6));
        var dismissed = (action.Action, action.SnoozeCount, action.UpdatedAt);
        action.Snooze(Now.AddMinutes(10));

        Assert.Equal((NotificationActionKind.Dismissed, (short)1, Now.AddMinutes(5)), dismissed);
        Assert.Equal((NotificationActionKind.Snoozed, (short)2), (action.Action, action.SnoozeCount));
    }

    [Fact]
    public void NotificationAction_SnoozeResendKey_IsRejectedAsBase()
    {
        var resend = NotificationKey.ForDose(Guid.NewGuid(), Now).Snoozed(1);

        Assert.Throws<DomainValidationException>(() => NotificationAction.Dismiss(MomId, Guid.NewGuid(), resend, Now));
        Assert.Null(NotificationAction.Dismiss(MomId, Guid.NewGuid(), resend.Base, Now).SnoozeResendKey);
    }

    [Fact]
    public void JobLease_TakenOnlyWhenExpiredOrAlreadyMine()
    {
        var lease = JobLease.Create(JobLease.PushSchedulerName, "node-a", Now, TimeSpan.FromMinutes(2));

        var otherWhileHeld = lease.TryAcquire("node-b", Now.AddMinutes(1), TimeSpan.FromMinutes(2));
        var renewedByMe = lease.TryAcquire("node-a", Now.AddMinutes(1), TimeSpan.FromMinutes(2));
        var otherAfterExpiry = lease.TryAcquire("node-b", Now.AddMinutes(3), TimeSpan.FromMinutes(2));

        Assert.Equal((false, true, true), (otherWhileHeld, renewedByMe, otherAfterExpiry));
        Assert.True(lease.IsHeldBy("node-b", Now.AddMinutes(4)));
        Assert.Equal(Now.AddMinutes(5), lease.LeaseUntil);
    }

    [Fact]
    public void UserNotificationSettings_ChangeWithEqualTerms_KeepsTheTimestamp()
    {
        var terms = new NotificationSettingsTerms(NotificationTimeZone.From("America/Sao_Paulo"), QuietHours.Default, false, false);
        var settings = UserNotificationSettings.Create(MomId, terms, Now);

        settings.Change(terms, Now.AddHours(1));
        var unchanged = settings.UpdatedAt;
        settings.Change(terms with { ShowNames = true }, Now.AddHours(2));

        Assert.Equal(Now, unchanged);
        Assert.Equal((true, Now.AddHours(2)), (settings.ShowNames, settings.UpdatedAt));
        Assert.Equal(QuietHours.Default, settings.QuietHours);
    }

    [Fact]
    public void BabyNotificationPreferences_StoresTheChoices()
    {
        var stored = BabyNotificationPreferences.Create(Guid.NewGuid(), MomId, ReminderPreferences.Create(true, 15, false, 20), Now);

        stored.Change(ReminderPreferences.Create(true, 15, false, 20), Now.AddHours(1));
        var unchanged = stored.UpdatedAt;
        stored.Change(ReminderPreferences.Create(false, 0, true, 10), Now.AddHours(2));

        Assert.Equal(Now, unchanged);
        Assert.Equal(ReminderPreferences.Create(false, 0, true, 10), stored.Preferences);
        Assert.Equal(((short)0, (short)10), (stored.DoseLeadMinutes, stored.NapLeadMinutes));
    }

    [Fact]
    public void NotificationRecipient_WithoutSettings_HasNoTimeZoneAndIsNotPlanned()
    {
        var recipient = NotificationRecipient.From(MomId, BabyRole.Parent, ReminderPreferences.Create(true, 0, true, 10), null, Now);

        Assert.Null(recipient.UtcOffset);
        Assert.Equal(QuietHours.Default, recipient.QuietHours);
    }
}
