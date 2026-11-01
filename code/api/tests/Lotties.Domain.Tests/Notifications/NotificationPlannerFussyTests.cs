using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Patterns;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationPlannerFussyTests
{
    private static readonly NotificationRecipient FussyParent = Recipient(doseDue: false, fussyPattern: true);

    /// <summary>Usual fussy window 17:30-18:30 (São Paulo): the heads-up goes at 17:00.</summary>
    private static readonly TimeOfDayPattern Evening = BellyPattern(new TimeOnly(17, 30));

    private static readonly NotificationKey MarchSecond = NotificationKey.ForFussy(BabyId, new DateOnly(2026, 3, 2));

    private static NotificationPlan PlanFussy(
        DateTimeOffset now,
        TimeOfDayPattern? pattern = null,
        DateTimeOffset? lastLoggedAt = null,
        NotificationRecipient? recipient = null,
        params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? FussyParent], [], null, delivered, fussy: [FussyState(pattern ?? Evening, lastLoggedAt)]);

    [Fact]
    public void Plan_PatternExists_PlansThirtyMinutesBeforeTheWindowKeyedByLocalDate()
    {
        var plan = PlanFussy(At(17, 0));

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"fussy:{BabyId:N}:20260302", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.FussyPattern, NotificationUrgency.Normal), (planned.Kind, planned.Urgency));
        Assert.Equal(At(17, 0), planned.DueAt);
        Assert.Equal(new NotificationContent(BabyId, null, At(17, 30), null), planned.Content);
        Assert.Equal(TimeSpan.FromMinutes(105), planned.TimeToLive);
        Assert.Equal("fussy_pattern", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_BeforeTheSendTimeOrAlreadyClaimed_PlansNothing()
    {
        var early = PlanFussy(At(16, 59));
        var claimed = PlanFussy(At(17, 5), delivered: new DeliveredNotification(MomId, MarchSecond));

        Assert.Empty(early.Notifications);
        Assert.Empty(claimed.Notifications);
        Assert.Empty(claimed.Skipped);
    }

    [Theory]
    [InlineData(16, 44, true)]
    [InlineData(16, 45, false)]
    [InlineData(17, 2, false)]
    public void Plan_FussySpellLoggedFromFortyFiveMinutesBefore_SkipsTheDay(int hour, int minute, bool planned)
    {
        var plan = PlanFussy(At(17, 5), lastLoggedAt: At(hour, minute));

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_InsideQuietHours_IsDropped()
    {
        var late = BellyPattern(new TimeOnly(22, 40));

        var plan = PlanFussy(At(22, 10), late);

        Assert.Empty(plan.Notifications);
        Assert.Equal([(MomId, NotificationSkipReason.QuietHours)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Theory]
    [InlineData(30, true)]
    [InlineData(31, false)]
    public void Plan_StaleCutoff_IsThirtyMinutesAfterTheSendTime(int minutesAfterSend, bool planned)
    {
        var plan = PlanFussy(At(17, 0).AddMinutes(minutesAfterSend));

        Assert.Equal(planned, plan.Notifications.Count == 1);
    }

    [Fact]
    public void Plan_KindOffViewerNoZoneOrNoPattern_PlansNothing()
    {
        var off = PlanFussy(At(17, 0), recipient: Recipient(doseDue: false, bellyPainPattern: true));
        var viewer = PlanFussy(At(17, 0), recipient: Recipient(role: BabyRole.Viewer, doseDue: false, fussyPattern: true));
        var noZone = PlanFussy(At(17, 0), recipient: Recipient(doseDue: false, fussyPattern: true, withoutZone: true));
        var noPattern = Plan(At(17, 0), [FussyParent], [], fussy: [FussyState(null)]);

        Assert.All(new[] { off, viewer, noZone, noPattern }, plan => Assert.Empty(plan.Notifications));
    }

    [Fact]
    public void Plan_BellyPainAndFussyPatternsOn_PlansEachKindOnItsOwnKey()
    {
        var recipient = Recipient(doseDue: false, bellyPainPattern: true, fussyPattern: true);

        var plan = Plan(At(17, 0), [recipient], [], bellyPain: [BellyState(Evening)], fussy: [FussyState(Evening, lastLoggedAt: At(16, 50))]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(NotificationKind.BellyPainPattern, planned.Kind);
    }

    [Fact]
    public void Plan_OnlyTheBellyPainStateLoaded_DoesNotPlanAFussyHeadsUp()
    {
        var plan = Plan(At(17, 0), [FussyParent], [], bellyPain: [BellyState(Evening)]);

        Assert.Empty(plan.Notifications);
    }
}
