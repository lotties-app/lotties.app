using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Domain.Predictions;
using static BabyRoutine.Domain.Tests.Notifications.NotificationFixtures;
using static BabyRoutine.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace BabyRoutine.Domain.Tests.Notifications;

public sealed class NotificationPlannerNapTests
{
    private static readonly NotificationRecipient NapParent = Recipient(doseDue: false, napWindow: true);

    private static NotificationPlan PlanNap(DateTimeOffset now, PredictionSet predictions, NotificationRecipient? recipient = null, params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? NapParent], [State([], predictions)], delivered: delivered);

    [Fact]
    public void Plan_AwakeDayWindow_PlansAtEarliestMinusLeadKeyedByAnchor()
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 40));

        var plan = PlanNap(At(14, 10), window);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"nap:{BabyId:N}:202603021530", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.NapWindow, NotificationUrgency.Normal), (planned.Kind, planned.Urgency));
        Assert.Equal((At(14, 10), At(14, 20)), (planned.DueAt, planned.Content.At));
        Assert.Equal(new NotificationContent(BabyId, null, At(14, 20), null), planned.Content);
        Assert.Equal(TimeSpan.FromMinutes(60), planned.TimeToLive);
    }

    [Theory]
    [InlineData(0, 14, 19, false)]
    [InlineData(0, 14, 20, true)]
    [InlineData(10, 14, 9, false)]
    [InlineData(10, 14, 10, true)]
    [InlineData(20, 14, 0, true)]
    public void Plan_NapLead_SendsFromEarliestMinusLead(int lead, int hour, int minute, bool expected)
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 0));

        var plan = PlanNap(At(hour, minute), window, Recipient(doseDue: false, napWindow: true, napLead: lead));

        Assert.Equal(expected, plan.Notifications.Count == 1);
    }

    [Fact]
    public void Plan_CloseToLatest_TimeToLiveEndsAtLatest()
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(14, 40));

        var planned = Assert.Single(PlanNap(At(14, 25), window).Notifications);

        Assert.Equal(TimeSpan.FromMinutes(15), planned.TimeToLive);
    }

    [Theory]
    [InlineData(15, true)]
    [InlineData(16, false)]
    public void Plan_NapStaleCutoff_Is15Minutes(int minutesAfterSend, bool planned)
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(16, 0));

        var plan = PlanNap(At(14, 10).AddMinutes(minutesAfterSend), window);

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(!planned, plan.Skipped.Any(skipped => skipped.Reason == NotificationSkipReason.Stale));
    }

    [Fact]
    public void Plan_AfterLatest_PlansNothing()
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(14, 30));

        var plan = PlanNap(At(14, 30), window);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_LowConfidenceAsleepStartIntervalOrNight_PlansNothing()
    {
        var cases = new[]
        {
            (Now: At(14, 10), Window: NapWindow(At(12, 30), At(14, 20), At(15, 0), confidence: PredictionConfidence.Low)),
            (Now: At(14, 10), Window: NapWindow(At(12, 30), At(14, 20), At(15, 0), asleep: true)),
            (Now: At(14, 10), Window: NapWindow(At(12, 30), At(14, 20), At(15, 0), basis: PredictionBasis.StartInterval)),
            (Now: At(18, 50), Window: NapWindow(At(17, 30), At(19, 0), At(19, 40))),
        };

        var plans = cases.Select(item => PlanNap(item.Now, item.Window)).ToArray();

        Assert.All(plans, plan => Assert.Empty(plan.Notifications));
    }

    [Fact]
    public void Plan_HighConfidence_IsPlanned()
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 0), confidence: PredictionConfidence.High);

        Assert.Single(PlanNap(At(14, 10), window).Notifications);
    }

    [Fact]
    public void Plan_EstimateMovesWithinTheSameAwakeWindow_KeyStaysTheSame()
    {
        var first = NapWindow(At(12, 30), At(14, 20), At(15, 0));
        var moved = NapWindow(At(12, 30), At(14, 35), At(15, 10));
        var key = Assert.Single(PlanNap(At(14, 10), first).Notifications).DedupeKey;

        var later = PlanNap(At(14, 26), moved, null, new DeliveredNotification(MomId, key));

        Assert.Empty(later.Notifications);
        Assert.Empty(later.Skipped);
    }

    [Fact]
    public void Plan_QuietHours_NapDroppedEvenWhenMedicineIsDelivered()
    {
        var quietAfternoon = QuietHours.Create(true, new TimeOnly(13, 0), new TimeOnly(15, 0));
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 0));

        var plan = PlanNap(At(14, 10), window, Recipient(doseDue: false, napWindow: true, quietHours: quietAfternoon));

        Assert.Empty(plan.Notifications);
        Assert.Equal([NotificationSkipReason.QuietHours], plan.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_QuietHoursDisabled_NapPlanned()
    {
        var quietOff = QuietHours.Create(false, new TimeOnly(13, 0), new TimeOnly(15, 0));
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 0));

        var plan = PlanNap(At(14, 10), window, Recipient(doseDue: false, napWindow: true, quietHours: quietOff));

        Assert.Single(plan.Notifications);
    }

    [Fact]
    public void Plan_NapKindOff_PlansNothing()
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 0));

        var plan = PlanNap(At(14, 10), window, Recipient(doseDue: true, napWindow: false));

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_ShowNames_NapCarriesOnlyTheBabyName()
    {
        var window = NapWindow(At(12, 30), At(14, 20), At(15, 0));
        var names = new NotificationNameSource("Lia", new Dictionary<Guid, string>());

        var plan = Plan(At(14, 10), [Recipient(doseDue: false, napWindow: true, showNames: true)], [State([], window)], names: names);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal(("Lia", (string?)null), (planned.Content.Names!.Baby, planned.Content.Names.Medication));
    }

    [Fact]
    public void Plan_DaylightSavingStart_QuietHoursFollowTheZoneOffsetAtNow()
    {
        var newYork = NotificationTimeZone.From("America/New_York");
        var quietUntilEight = QuietHours.Create(true, new TimeOnly(22, 0), new TimeOnly(8, 0));
        var settings = UserNotificationSettings.Create(MomId, new NotificationSettingsTerms(newYork, quietUntilEight, false, false), At(0));
        var preferences = ReminderPreferences.Create(false, 0, true, 0);
        var beforeChange = new DateTimeOffset(2026, 3, 7, 12, 30, 0, TimeSpan.Zero);
        var afterChange = new DateTimeOffset(2026, 3, 9, 12, 30, 0, TimeSpan.Zero);

        var plans = new[] { beforeChange, afterChange }.Select(now =>
        {
            var recipient = NotificationRecipient.From(MomId, BabyRole.Parent, preferences, settings, now);
            var window = NapWindow(now.AddHours(-2), now, now.AddMinutes(40));
            return Plan(now, [recipient], [State([], window, recipient.UtcOffset)]);
        }).ToArray();

        Assert.Equal(TimeSpan.FromHours(-5), newYork.OffsetAt(beforeChange));
        Assert.Equal(TimeSpan.FromHours(-4), newYork.OffsetAt(afterChange));
        Assert.Equal([NotificationSkipReason.QuietHours], plans[0].Skipped.Select(skipped => skipped.Reason));
        Assert.Single(plans[1].Notifications);
    }
}
