using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Predictions;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>
/// The diaper heads-ups (docs/design/09-push-notifications.md section 2.8): wet 10 minutes before the expected wet diaper,
/// dirty after a feed at the lower lag or 5 minutes before the expected one from the gaps; caps of 3 a day per kind and
/// 60 minutes between any two.
/// </summary>
public sealed class NotificationPlannerDiaperTests
{
    private static readonly NotificationRecipient WetParent = Recipient(doseDue: false, diaperWet: true);
    private static readonly NotificationRecipient DirtyParent = Recipient(doseDue: false, diaperDirty: true);
    private static readonly NotificationRecipient BothParent = Recipient(doseDue: false, diaperWet: true, diaperDirty: true);

    /// <summary>The latest wet diaper at 12:00 São Paulo, usual gap 2h30 (2h10-2h50): expected 14:30, heads-up at 14:20.</summary>
    private static readonly DateTimeOffset WetAnchor = At(12, 0);

    private static readonly NotificationKey WetKey = NotificationKey.ForDiaperWet(BabyId, WetAnchor);

    private static DiaperGapPrediction Gap(DateTimeOffset anchor, int medianMinutes) =>
        new(anchor, TimeSpan.FromMinutes(medianMinutes - 20), TimeSpan.FromMinutes(medianMinutes), TimeSpan.FromMinutes(medianMinutes + 20), 20, 19, PredictionConfidence.Medium);

    private static DiaperPrediction Wet(DateTimeOffset? anchor = null, int medianMinutes = 150) =>
        new(Gap(anchor ?? WetAnchor, medianMinutes), null, null);

    /// <summary>Dirty diapers from the gaps: the latest at <paramref name="lastDirty"/>, usual gap 8h.</summary>
    private static DirtyDiaperPrediction DirtyGap(DateTimeOffset lastDirty) => new(Gap(lastDirty, 480), null, lastDirty);

    /// <summary>The lag after feeds 30/35/40 min, the latest feed ended at <paramref name="feedEnd"/>.</summary>
    private static DiaperFeedLag Lag(DateTimeOffset feedEnd) =>
        new(TimeSpan.FromMinutes(30), TimeSpan.FromMinutes(35), TimeSpan.FromMinutes(40), 9, PredictionConfidence.Medium, feedEnd, TimeSpan.FromHours(3));

    private static SentHeadsUp Sent(NotificationKind kind, DateTimeOffset at, Guid? userId = null, Guid? babyId = null) =>
        new(userId ?? MomId, babyId ?? BabyId, kind, kind == NotificationKind.DiaperWetHeadsUp ? NotificationKey.ForDiaperWet(BabyId, at.AddHours(-2)) : NotificationKey.ForDiaperDirty(BabyId, at.AddHours(-2)), at);

    private static NotificationPlan PlanDiapers(
        DateTimeOffset now,
        DiaperPrediction? diapers = null,
        NotificationRecipient? recipient = null,
        IReadOnlyCollection<SentHeadsUp>? sent = null,
        params DeliveredNotification[] delivered) =>
        Plan(now, [recipient ?? WetParent], [], null, delivered, diapers: diapers ?? Wet(), sentHeadsUps: sent);

    [Fact]
    public void Plan_TenMinutesBeforeTheExpectedWetDiaper_PlansOneKeyedByTheAnchor()
    {
        var plan = PlanDiapers(At(14, 20));

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"wet:{BabyId:N}:202603021500", planned.BaseKey.Value);
        Assert.Equal((NotificationKind.DiaperWetHeadsUp, NotificationUrgency.Normal, At(14, 20)), (planned.Kind, planned.Urgency, planned.DueAt));
        Assert.Equal(new NotificationContent(BabyId, null, At(14, 30), null), planned.Content);
        Assert.Equal(TimeSpan.FromMinutes(40), planned.TimeToLive);
        Assert.Equal("diaper_wet_headsup", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_BeforeTheSendTime_PlansNothing()
    {
        var plan = PlanDiapers(At(14, 19));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Theory]
    [InlineData(15, true)]
    [InlineData(16, false)]
    public void Plan_StaleCutoff_IsFifteenMinutesAfterTheSendTime(int minutesAfterSend, bool planned)
    {
        var plan = PlanDiapers(At(14, 20).AddMinutes(minutesAfterSend));

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(!planned, plan.Skipped.Any(skipped => skipped.Reason == NotificationSkipReason.Stale));
    }

    [Fact]
    public void Plan_FromThirtyMinutesAfterTheExpectedTime_IsNoLongerACandidate()
    {
        var plan = PlanDiapers(At(15, 0));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_AlreadyClaimedForTheAnchor_PlansItOnlyOnce()
    {
        var plan = PlanDiapers(At(14, 25), delivered: new DeliveredNotification(MomId, WetKey));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_WetDiaperLoggedSince_MovesTheAnchorSoNothingIsDueYet()
    {
        var plan = PlanDiapers(At(14, 20), Wet(anchor: At(14, 5)));

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
        var later = Assert.Single(PlanDiapers(At(16, 25), Wet(anchor: At(14, 5))).Notifications);
        Assert.Equal(NotificationKey.ForDiaperWet(BabyId, At(14, 5)), later.BaseKey);
    }

    [Fact]
    public void Plan_InsideQuietHours_IsDropped()
    {
        var plan = PlanDiapers(At(22, 20), Wet(anchor: At(20, 0)));

        Assert.Empty(plan.Notifications);
        Assert.Equal([(MomId, NotificationSkipReason.QuietHours)], plan.Skipped.Select(skipped => (skipped.UserId, skipped.Reason)));
    }

    [Fact]
    public void Plan_KindOffViewerOrNoPrediction_PlansNothing()
    {
        var off = PlanDiapers(At(14, 20), recipient: DirtyParent);
        var viewer = PlanDiapers(At(14, 20), recipient: Recipient(role: BabyRole.Viewer, doseDue: false, diaperWet: true));
        var notLoaded = Plan(At(14, 20), [WetParent], []);
        var nothing = PlanDiapers(At(14, 20), DiaperPrediction.None);

        Assert.All(new[] { off, viewer, notLoaded, nothing }, plan => Assert.Empty(plan.Notifications));
    }

    [Fact]
    public void Plan_DirtyFromTheGaps_FiveMinutesBeforeTheExpectedTime()
    {
        var diapers = new DiaperPrediction(null, DirtyGap(At(8, 0)), null);

        var plan = PlanDiapers(At(15, 55), diapers, DirtyParent);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal((NotificationKind.DiaperDirtyHeadsUp, NotificationKey.ForDiaperDirty(BabyId, At(8, 0))), (planned.Kind, planned.BaseKey));
        Assert.Equal((At(15, 55), At(16, 0), TimeSpan.FromMinutes(35)), (planned.DueAt, planned.Content.At, planned.TimeToLive));
        Assert.Equal("diaper_dirty_headsup", NotificationCodes.Of(planned.Kind));
    }

    [Fact]
    public void Plan_DirtyAfterARecentFeed_AtTheLowerLagKeyedByTheFeedEnd()
    {
        var diapers = new DiaperPrediction(null, new DirtyDiaperPrediction(Gap(At(8, 0), 480), Lag(At(14, 0)), At(8, 0)), null);

        var early = PlanDiapers(At(14, 29), diapers, DirtyParent);
        var plan = PlanDiapers(At(14, 30), diapers, DirtyParent);

        Assert.Empty(early.Notifications);
        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"dirty:{BabyId:N}:202603021700", planned.BaseKey.Value);
        Assert.Equal((At(14, 30), At(14, 35), TimeSpan.FromMinutes(35)), (planned.DueAt, planned.Content.At, planned.TimeToLive));
    }

    [Fact]
    public void Plan_DirtyLoggedAfterTheFeed_FallsBackToTheGaps()
    {
        var diapers = new DiaperPrediction(null, new DirtyDiaperPrediction(Gap(At(14, 10), 480), Lag(At(14, 0)), At(14, 10)), null);

        var plan = PlanDiapers(At(14, 30), diapers, DirtyParent);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_ThreeWetHeadsUpsToday_HitTheDailyCap()
    {
        var three = new[] { Sent(NotificationKind.DiaperWetHeadsUp, At(7, 0)), Sent(NotificationKind.DiaperWetHeadsUp, At(9, 30)), Sent(NotificationKind.DiaperWetHeadsUp, At(12, 0)) };
        var yesterday = new[] { Sent(NotificationKind.DiaperWetHeadsUp, At(20, 0, day: 1)), three[1], three[2] };
        var dirty = new[] { three[0], three[1], Sent(NotificationKind.DiaperDirtyHeadsUp, At(12, 0)) };

        var capped = PlanDiapers(At(14, 20), sent: three);
        var fromYesterday = PlanDiapers(At(14, 20), sent: yesterday);
        var otherKind = PlanDiapers(At(14, 20), sent: dirty);

        Assert.Empty(capped.Notifications);
        Assert.Equal(NotificationSkipReason.DailyCap, Assert.Single(capped.Skipped).Reason);
        Assert.Single(fromYesterday.Notifications);
        Assert.Single(otherKind.Notifications);
        Assert.Equal("daily_cap", NotificationCodes.Of(NotificationSkipReason.DailyCap));
    }

    [Theory]
    [InlineData(45, false)]
    [InlineData(60, true)]
    public void Plan_AnyDiaperHeadsUpWithinTheLastHour_HoldsTheNextOne(int minutesAgo, bool planned)
    {
        var sent = new[] { Sent(NotificationKind.DiaperDirtyHeadsUp, At(14, 20).AddMinutes(-minutesAgo)) };

        var plan = PlanDiapers(At(14, 20), sent: sent);

        Assert.Equal(planned, plan.Notifications.Count == 1);
        Assert.Equal(!planned, plan.Skipped.Any(skipped => skipped.Reason == NotificationSkipReason.Spacing));
    }

    [Fact]
    public void Plan_HeadsUpsOfAnotherUserOrBaby_DoNotCount()
    {
        var others = new[] { Sent(NotificationKind.DiaperWetHeadsUp, At(14, 0), userId: DadId), Sent(NotificationKind.DiaperWetHeadsUp, At(14, 0), babyId: Guid.NewGuid()) };

        var plan = PlanDiapers(At(14, 20), sent: others);

        Assert.Single(plan.Notifications);
    }

    [Fact]
    public void Plan_WetAndDirtyDueInTheSameTick_SendsOnlyTheEarlierOne()
    {
        var tie = new DiaperPrediction(Gap(WetAnchor, 150), DirtyGap(At(6, 25)), null);
        var dirtyFirst = new DiaperPrediction(Gap(WetAnchor, 150), new DirtyDiaperPrediction(Gap(At(6, 25), 480), Lag(At(13, 45)), At(6, 25)), null);

        var tied = PlanDiapers(At(14, 21), tie, BothParent);
        var earlier = PlanDiapers(At(14, 21), dirtyFirst, BothParent);

        // Wet and dirty (from the gaps) were both due at 14:20: on a tie the wet heads-up goes. After a feed ending
        // at 13:45 the dirty one was due at 14:15, so it goes and the wet one waits.
        Assert.Equal(NotificationKind.DiaperWetHeadsUp, Assert.Single(tied.Notifications).Kind);
        Assert.Equal((NotificationKind.DiaperDirtyHeadsUp, NotificationSkipReason.Spacing), (Assert.Single(tied.Skipped).Kind, tied.Skipped[0].Reason));
        Assert.Equal(NotificationKind.DiaperDirtyHeadsUp, Assert.Single(earlier.Notifications).Kind);
        Assert.Equal(NotificationKind.DiaperWetHeadsUp, Assert.Single(earlier.Skipped).Kind);
    }

    [Fact]
    public void Key_Diapers_RoundTripAndAreNotDoses()
    {
        var wet = NotificationKey.From(WetKey.Snoozed(1).Value);
        var dirty = NotificationKey.From(NotificationKey.ForDiaperDirty(BabyId, At(14, 0)).Value);

        Assert.Equal(WetKey, wet.Base);
        Assert.False(wet.TryGetDose(out _, out _));
        Assert.StartsWith("dirty:", dirty.Value, StringComparison.Ordinal);
    }
}
