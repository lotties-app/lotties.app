using Lotties.Application.Push;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// The scheduler end to end on the SQLite test database with a fake sender and explicit tick instants: dose slot
/// lifecycle, co-parents, time zones and quiet hours, snooze re-sends, crash recovery and housekeeping. Each test has
/// its own database. Times are São Paulo (UTC-3) on 2026-01-10 unless stated.
/// </summary>
public sealed class NotificationDispatcherTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task RunOnceAsync_DoseSlotDue_SendsOneGenericPushPerDeviceAndRecordsSent()
    {
        var family = await _host.SeedFamilyAsync();
        var prescription = await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        var phone = await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        var laptop = await _host.SeedSubscriptionAsync(family.OwnerId);

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.True(result.LeaseHeld);
        Assert.Equal((1, 2, 2), (result.Planned, result.Claimed, result.Sent));
        var sent = _host.Sender.Sent;
        Assert.Equal(2, sent.Count);
        Assert.Contains(sent, push => push.IsFor(phone));
        Assert.Contains(sent, push => push.IsFor(laptop));
        var payload = sent[0].Payload;
        Assert.Equal("dose_due", payload.GetProperty("kind").GetString());
        Assert.Equal(family.BabyId.ToString(), payload.GetProperty("babyId").GetString());
        Assert.Equal(prescription.PrescriptionId.ToString(), payload.GetProperty("rxId").GetString());
        Assert.Equal("2026-01-10T21:00:00Z", payload.GetProperty("at").GetString());
        Assert.Equal("pt-BR", payload.GetProperty("lang").GetString());
        Assert.True(payload.TryGetProperty("token", out _));
        Assert.False(payload.TryGetProperty("names", out _));
        Assert.Equal(NotificationUrgency.High, sent[0].Message.Urgency);
        Assert.Equal(PushMessage.TopicOf(prescription.KeyAt(SaoPaulo(18, 0))), sent[0].Message.Topic);
        Assert.Equal(NotificationRules.DoseTimeToLive, sent[0].Message.TimeToLive);
        var deliveries = await _host.DeliveriesAsync();
        Assert.All(deliveries, delivery => Assert.Equal((DeliveryStatus.Sent, (short)1), (delivery.Status, delivery.Attempts)));
        Assert.Equal(SaoPaulo(18, 0), (await _host.SubscriptionAsync(phone.Id)).LastSuccessAt);
    }

    [Fact]
    public async Task RunOnceAsync_NextTickForTheSameSlot_SendsNothingMore()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        await _host.RunAsync(SaoPaulo(18, 0));

        var next = await _host.RunAsync(SaoPaulo(18, 1));

        Assert.Equal((0, 0), (next.Planned, next.Sent));
        Assert.Single(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_DoseAlreadyLogged_SendsNothing()
    {
        var family = await _host.SeedFamilyAsync();
        var prescription = await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        await _host.SeedDoseAsync(family.BabyId, family.OwnerId, prescription.MedicationId, SaoPaulo(17, 55));

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_LeadTime_SendsBeforeTheSlotShowingTheSlotTime()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId, doseLead: 15);

        var early = await _host.RunAsync(SaoPaulo(17, 40));
        var due = await _host.RunAsync(SaoPaulo(17, 45));

        Assert.Equal(0, early.Sent);
        Assert.Equal(1, due.Sent);
        Assert.Equal("2026-01-10T21:00:00Z", _host.Sender.Sent.Single().Payload.GetProperty("at").GetString());
    }

    [Fact]
    public async Task RunOnceAsync_AfterDowntimePastTheStaleCutoff_DoesNotFireTheOldReminder()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);

        var result = await _host.RunAsync(SaoPaulo(18, 45));

        Assert.Equal(0, result.Sent);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_CoParentsOptedIn_EachGetsOneAndTheViewerNone()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Parent, BabyRole.Viewer);
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        var mom = await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        var dad = await _host.SeedRecipientAsync(family.BabyId, family.UserOf(BabyRole.Parent));
        var grandma = await _host.SeedRecipientAsync(family.BabyId, family.UserOf(BabyRole.Viewer));

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal(2, result.Sent);
        Assert.Single(_host.Sender.Sent, push => push.IsFor(mom));
        Assert.Single(_host.Sender.Sent, push => push.IsFor(dad));
        Assert.DoesNotContain(_host.Sender.Sent, push => push.IsFor(grandma));
    }

    [Fact]
    public async Task RunOnceAsync_RecipientsInDifferentZones_EachGetsTheSlotAtTheirLocalTime()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Parent);
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        var inSaoPaulo = await _host.SeedRecipientAsync(family.BabyId, family.OwnerId, "America/Sao_Paulo");
        var inLisbon = await _host.SeedRecipientAsync(family.BabyId, family.UserOf(BabyRole.Parent), "Europe/Lisbon");

        var lisbonEvening = await _host.RunAsync(new DateTimeOffset(2026, 1, 10, 18, 0, 0, TimeSpan.Zero));
        var saoPauloEvening = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal((1, 1), (lisbonEvening.Sent, saoPauloEvening.Sent));
        Assert.True(_host.Sender.Sent[0].IsFor(inLisbon));
        Assert.Equal("2026-01-10T18:00:00Z", _host.Sender.Sent[0].Payload.GetProperty("at").GetString());
        Assert.True(_host.Sender.Sent[1].IsFor(inSaoPaulo));
        Assert.Equal("2026-01-10T21:00:00Z", _host.Sender.Sent[1].Payload.GetProperty("at").GetString());
    }

    [Fact]
    public async Task RunOnceAsync_RecipientWithoutTimeZone_IsSkipped()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedPreferencesAsync(family.BabyId, family.OwnerId);
        await _host.SeedSubscriptionAsync(family.OwnerId);

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_QuietHours_SilenceMedicineOnlyForWhoAskedForIt()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Parent);
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        var evening = QuietHours.Create(true, new TimeOnly(17, 30), new TimeOnly(19, 0));
        var silenced = await _host.SeedRecipientAsync(family.BabyId, family.OwnerId, quietHours: evening, quietIncludesMedicine: true);
        var delivered = await _host.SeedRecipientAsync(family.BabyId, family.UserOf(BabyRole.Parent), quietHours: evening);

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal(1, result.Sent);
        Assert.True(_host.Sender.Sent.Single().IsFor(delivered));
        Assert.DoesNotContain(_host.Sender.Sent, push => push.IsFor(silenced));
    }

    [Fact]
    public async Task RunOnceAsync_QuietHoursAcrossMidnightInTheRecipientsZone_SilenceTheEarlyDose()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "06:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId, quietIncludesMedicine: true);

        var result = await _host.RunAsync(SaoPaulo(6, 0));

        Assert.Equal(0, result.Sent);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_ShowNamesOn_PayloadCarriesBabyAndMedicationNames()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId, showNames: true);

        await _host.RunAsync(SaoPaulo(18, 0));

        var names = _host.Sender.Sent.Single().Payload.GetProperty("names");
        Assert.Equal("Lia", names.GetProperty("baby").GetString());
        Assert.Equal("Simeticona", names.GetProperty("medication").GetString());
    }

    [Fact]
    public async Task RunOnceAsync_Snoozed_ResendsAtTheSnoozeEndWithSnoozeNumber()
    {
        var family = await _host.SeedFamilyAsync();
        var prescription = await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        await _host.RunAsync(SaoPaulo(18, 0));
        await _host.SeedAsync(NotificationAction.Snooze(family.OwnerId, family.BabyId, prescription.KeyAt(SaoPaulo(18, 0)), SaoPaulo(18, 5)));

        var during = await _host.RunAsync(SaoPaulo(18, 20));
        var after = await _host.RunAsync(SaoPaulo(18, 35));

        Assert.Equal((0, 1), (during.Sent, after.Sent));
        var resend = _host.Sender.Sent[1];
        Assert.Equal(1, resend.Payload.GetProperty("snooze").GetInt32());
        Assert.Equal(PushMessage.TopicOf(prescription.KeyAt(SaoPaulo(18, 0))), resend.Message.Topic);
        Assert.Contains(await _host.DeliveriesAsync(), delivery => delivery.DedupeKey == prescription.KeyAt(SaoPaulo(18, 0)).Snoozed(1));
    }

    [Fact]
    public async Task RunOnceAsync_CrashBetweenClaimAndSend_RetrySendsTheClaimWithAFreshToken()
    {
        var family = await _host.SeedFamilyAsync();
        var prescription = await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        var subscription = await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
        var key = prescription.KeyAt(SaoPaulo(18, 0));
        var planned = new PlannedNotification(family.OwnerId, NotificationKind.DoseDue, family.BabyId, key, key, SaoPaulo(18, 0), NotificationRules.DoseTimeToLive, NotificationUrgency.High, new NotificationContent(family.BabyId, prescription.PrescriptionId, SaoPaulo(18, 0), null));
        var claimed = NotificationDelivery.Claim(Guid.NewGuid(), subscription.Id, planned, SaoPaulo(18, 0));
        await _host.SeedAsync(claimed.Delivery);

        var result = await _host.RunAsync(SaoPaulo(18, 2));

        Assert.Equal((1, 0, 1), (result.Retried, result.Claimed, result.Sent));
        var payload = _host.Sender.Sent.Single().Payload;
        Assert.Equal(claimed.Delivery.Id.ToString(), payload.GetProperty("id").GetString());
        Assert.Equal(prescription.PrescriptionId.ToString(), payload.GetProperty("rxId").GetString());
        Assert.Equal("2026-01-10T21:00:00Z", payload.GetProperty("at").GetString());
        var token = payload.GetProperty("token").GetString();
        Assert.NotEqual(claimed.ActionToken!.Value.Value, token);
        var stored = (await _host.DeliveriesAsync()).Single();
        Assert.Equal(DeliveryStatus.Sent, stored.Status);
        stored.EnsureActionAllowed(token, SaoPaulo(18, 3));
    }

    [Fact]
    public async Task RunOnceAsync_Housekeeping_RunsOnTheFirstTickThenAtMostHourly()
    {
        var family = await _host.SeedFamilyAsync();
        var oldRevoked = await _host.SeedSubscriptionAsync(family.OwnerId);
        var expired = await _host.SeedSubscriptionAsync(family.OwnerId, expiresAt: SaoPaulo(8, 0));
        await _host.Factory.SeedAsync(async context =>
        {
            var stored = await context.PushSubscriptions.FindAsync(oldRevoked.Id);
            stored!.Revoke(SubscriptionRevokeReason.User, SaoPaulo(8, 0).AddDays(-40));
        });

        var first = await _host.RunAsync(SaoPaulo(12, 0));
        var second = await _host.RunAsync(SaoPaulo(12, 30));
        var third = await _host.RunAsync(SaoPaulo(13, 0));

        Assert.Equal((true, false, true), (first.HousekeepingRan, second.HousekeepingRan, third.HousekeepingRan));
        Assert.False(await _host.Factory.QueryAsync(context => context.PushSubscriptions.AnyAsync(stored => stored.Id == oldRevoked.Id)));
        Assert.Equal(SubscriptionRevokeReason.Gone, (await _host.SubscriptionAsync(expired.Id)).RevokedReason);
    }
}
