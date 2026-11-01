using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>The domain pieces the scheduler's retry pass relies on: key parsing, refused sends and token re-issue.</summary>
public sealed class NotificationRetrySupportTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 2, 18, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TryGetDose_DoseKeyAndItsSnoozeResend_ReturnPrescriptionAndUtcSlot()
    {
        var prescriptionId = Guid.NewGuid();
        var slot = new DateTimeOffset(2026, 3, 2, 18, 30, 0, TimeSpan.FromHours(-3));
        var key = NotificationKey.ForDose(prescriptionId, slot);

        var found = key.Snoozed(2).TryGetDose(out var parsedId, out var parsedSlot);

        Assert.True(found);
        Assert.Equal(prescriptionId, parsedId);
        Assert.Equal(slot, parsedSlot);
        Assert.Equal(TimeSpan.Zero, parsedSlot.Offset);
        Assert.True(key.TryGetDose(out _, out _));
    }

    [Fact]
    public void TryGetDose_NapTestAndDefaultKeys_ReturnFalse()
    {
        Assert.False(NotificationKey.ForNap(Guid.NewGuid(), Now).TryGetDose(out var id, out var slot));
        Assert.Equal((Guid.Empty, default(DateTimeOffset)), (id, slot));
        Assert.False(NotificationKey.ForTest(Guid.NewGuid()).TryGetDose(out _, out _));
        Assert.False(default(NotificationKey).TryGetDose(out _, out _));
    }

    [Fact]
    public void SnoozeNumber_IsTheResendNumberOrNullForABaseKey()
    {
        var key = NotificationKey.ForDose(Guid.NewGuid(), Now);

        Assert.Null(key.SnoozeNumber);
        Assert.Equal(1, key.Snoozed(1).SnoozeNumber);
        Assert.Equal(3, key.Snoozed(3).SnoozeNumber);
    }

    [Fact]
    public void RecordRefused_PendingDelivery_FailsWithoutAnAttemptAndAsksToRevoke()
    {
        var delivery = Claim(NotificationKind.DoseDue);

        var outcome = delivery.RecordRefused();

        Assert.Equal(DeliveryAttemptOutcome.Invalid, outcome);
        Assert.Equal(DeliveryStatus.Failed, delivery.Status);
        Assert.Equal(0, delivery.Attempts);
        Assert.Null(delivery.NextAttemptAt);
        Assert.Null(delivery.LastStatusCode);
    }

    [Fact]
    public void RecordRefused_AlreadySent_Throws()
    {
        var delivery = Claim(NotificationKind.DoseDue);
        delivery.RecordAttempt(201, null, Now);

        Assert.Throws<InvalidOperationException>(() => delivery.RecordRefused());
    }

    [Fact]
    public void ReissueActionToken_ReplacesTheHashSoOnlyTheNewTokenWorks()
    {
        var issued = NotificationDelivery.Claim(Guid.NewGuid(), Guid.NewGuid(), Planned(NotificationKind.DoseDue), Now);
        var delivery = issued.Delivery;

        var reissued = delivery.ReissueActionToken();

        Assert.NotNull(reissued);
        Assert.Equal(reissued!.Value.Hash(), delivery.ActionTokenHash);
        delivery.EnsureActionAllowed(reissued.Value.Value, Now);
        Assert.Throws<NotificationActionNotFoundException>(() => delivery.EnsureActionAllowed(issued.ActionToken!.Value.Value, Now));
    }

    [Fact]
    public void ReissueActionToken_TestDelivery_ReturnsNullAndKeepsNoHash()
    {
        var delivery = Claim(NotificationKind.Test);

        Assert.Null(delivery.ReissueActionToken());
        Assert.Null(delivery.ActionTokenHash);
    }

    private static NotificationDelivery Claim(NotificationKind kind) =>
        NotificationDelivery.Claim(Guid.NewGuid(), Guid.NewGuid(), Planned(kind), Now).Delivery;

    private static PlannedNotification Planned(NotificationKind kind)
    {
        if (kind == NotificationKind.Test)
        {
            return NotificationPlanner.PlanTest(Guid.NewGuid(), Guid.NewGuid(), Now);
        }

        var prescriptionId = Guid.NewGuid();
        var babyId = Guid.NewGuid();
        var key = NotificationKey.ForDose(prescriptionId, Now);
        return new PlannedNotification(
            Guid.NewGuid(),
            kind,
            babyId,
            key,
            key,
            Now,
            NotificationRules.DoseTimeToLive,
            NotificationUrgency.High,
            new NotificationContent(babyId, prescriptionId, Now, null));
    }
}
