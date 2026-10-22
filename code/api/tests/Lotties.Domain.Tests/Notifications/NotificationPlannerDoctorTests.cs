using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>A Doctor never receives baby reminders, whatever preferences a row may hold (docs/design/16-doctor-access.md).</summary>
public sealed class NotificationPlannerDoctorTests
{
    private static readonly Guid DoctorId = Guid.NewGuid();

    private static NotificationRecipient Doctor() => Recipient(
        DoctorId,
        role: BabyRole.Doctor,
        doseDue: true,
        napWindow: true,
        bellyPainPattern: true,
        overtiredWarning: true,
        fussyPattern: true,
        diaperWet: true,
        diaperDirty: true);

    [Fact]
    public void CanReceive_Doctor_IsFalse()
    {
        Assert.False(NotificationRules.CanReceive(BabyRole.Doctor));
    }

    [Fact]
    public void Plan_DoseDueWithADoctorAndAParent_RemindsOnlyTheParent()
    {
        var prescription = AtTimes(Guid.NewGuid(), ["08:00"]);
        var now = At(8);

        var plan = Plan(now, [Doctor(), Recipient(MomId)], [State(Statuses([prescription], now))]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(MomId, planned.UserId);
        Assert.DoesNotContain(plan.Skipped, skipped => skipped.UserId == DoctorId);
    }

    [Fact]
    public void Plan_BellyPainPatternForADoctorOnly_PlansNothing()
    {
        var plan = Plan(At(17, 0), [Doctor()], [], bellyPain: [BellyState(BellyPattern(new TimeOnly(17, 30)))]);

        Assert.Empty(plan.Notifications);
    }
}
