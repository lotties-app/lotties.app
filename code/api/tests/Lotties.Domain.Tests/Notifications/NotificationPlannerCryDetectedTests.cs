using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>The <c>cry_detected</c> push (docs/design/31-cry-detector-spike.md section 8, docs/design/09-push-notifications.md section 2.12).</summary>
public sealed class NotificationPlannerCryDetectedTests
{
    private static NotificationRecipient Member(Guid userId, BabyRole role = BabyRole.Parent, bool on = true, QuietHours? quietHours = null, bool showNames = false) =>
        Recipient(userId, role, doseDue: false, appointmentReminders: false, cryDetected: on, quietHours: quietHours, showNames: showNames);

    private static DetectedCrySpell Spell(DateTimeOffset startedAt, DateTimeOffset? endedAt = null, Guid? id = null) =>
        new(id ?? Guid.NewGuid(), startedAt, endedAt);

    [Fact]
    public void Plan_NewMonitorSpell_AlertsTheMembersWhoReceiveBabyRemindersWithTheSwitchOn()
    {
        var caregiverId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var doctorId = Guid.NewGuid();
        var offId = Guid.NewGuid();
        var spell = Spell(At(14, 32));
        var recipients = new[]
        {
            Member(MomId, BabyRole.Owner),
            Member(DadId, BabyRole.Parent),
            Member(caregiverId, BabyRole.Caregiver),
            Member(viewerId, BabyRole.Viewer),
            Member(doctorId, BabyRole.Doctor),
            Member(offId, BabyRole.Parent, on: false),
        };

        var plan = Plan(At(14, 33), recipients, [], crySpells: [spell]);

        Assert.Equal(new[] { MomId, DadId, caregiverId }.Order(), plan.Notifications.Select(planned => planned.UserId).Order());
        Assert.All(plan.Notifications, planned => Assert.Equal((NotificationKind.CryDetected, $"cry:{spell.EventId:N}"), (planned.Kind, planned.DedupeKey.Value)));
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_Spell_SentAtItsStartWithTheTimeOnlyHighUrgencyAndTwentyMinutesToLive()
    {
        var spell = Spell(At(14, 32));

        var planned = Assert.Single(Plan(At(14, 33), [Member(MomId)], [], crySpells: [spell]).Notifications);

        Assert.Equal((At(14, 32), TimeSpan.FromMinutes(20), NotificationUrgency.High), (planned.DueAt, planned.TimeToLive, planned.Urgency));
        Assert.Equal((BabyId, At(14, 32)), (planned.Content.BabyId!.Value, planned.Content.At));
        Assert.Equal(((Guid?)null, (Guid?)null, (string?)null), (planned.Content.PrescriptionId, planned.Content.AppointmentId, planned.Content.VaccineDoseId));
        Assert.Null(planned.Content.Names);
        Assert.False(planned.IsResend);
    }

    [Fact]
    public void Plan_SwitchOffByDefault_PlansNothing()
    {
        var plan = Plan(At(14, 33), [Recipient(MomId, BabyRole.Owner)], [], crySpells: [Spell(At(14, 32))]);

        Assert.False(ReminderPreferences.Default.CryDetected);
        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(9, true)]
    [InlineData(10, true)]
    [InlineData(11, false)]
    [InlineData(45, false)]
    public void Plan_ASpellOlderThanTenMinutes_IsStaleAndNeverSent(int minutesAgo, bool sent)
    {
        var spell = Spell(At(14, 0).AddMinutes(-minutesAgo));

        var plan = Plan(At(14, 0), [Member(MomId)], [], crySpells: [spell]);

        Assert.Equal(sent, plan.Notifications.Count == 1);
        Assert.Equal(sent ? Array.Empty<NotificationSkipReason>() : [NotificationSkipReason.Stale], plan.Skipped.Select(skipped => skipped.Reason));
    }

    [Fact]
    public void Plan_ASpellThatStartsLaterThanNow_WaitsForItsStart()
    {
        var plan = Plan(At(14, 0), [Member(MomId)], [], crySpells: [Spell(At(14, 1))]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_AShortSpellAlreadyEndedWithinTheCutoff_StillAlertsOnce()
    {
        var plan = Plan(At(14, 6), [Member(MomId)], [], crySpells: [Spell(At(14, 0), At(14, 4))]);

        Assert.Single(plan.Notifications);
    }

    [Fact]
    public void Plan_AlreadyClaimed_TheEndOfTheSpellNeverNotifiesAgain()
    {
        var id = Guid.NewGuid();
        var delivered = new[] { new DeliveredNotification(MomId, NotificationKey.ForCryDetected(id)) };

        var running = Plan(At(14, 2), [Member(MomId)], [], delivered: delivered, crySpells: [Spell(At(14, 0), id: id)]);
        var ended = Plan(At(14, 6), [Member(MomId)], [], delivered: delivered, crySpells: [Spell(At(14, 0), At(14, 5), id)]);

        Assert.Empty(running.Notifications);
        Assert.Empty(ended.Notifications);
        Assert.Empty(ended.Skipped);
    }

    [Fact]
    public void Plan_ASpellStartingWhileAnEarlierOneIsGoing_IsTheSameEpisodeAndSendsNothing()
    {
        var first = Spell(At(13, 50));
        var second = Spell(At(14, 1));

        var plan = Plan(At(14, 2), [Member(MomId)], [], crySpells: [first, second]);

        Assert.Equal([NotificationSkipReason.Stale], plan.Skipped.Select(skipped => skipped.Reason));
        Assert.Equal($"cry:{first.EventId:N}", Assert.Single(plan.Skipped).DedupeKey.Value);
        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_TwoMonitorsStartingTogether_OneAlert()
    {
        var first = Spell(At(14, 0));
        var second = Spell(At(14, 0).AddSeconds(40));
        var tie = Spell(At(14, 0));

        var plan = Plan(At(14, 1), [Member(MomId)], [], crySpells: [second, tie, first]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal($"cry:{(first.EventId.CompareTo(tie.EventId) < 0 ? first : tie).EventId:N}", planned.DedupeKey.Value);
    }

    [Fact]
    public void Plan_ANewSpellAfterTheEarlierOneEnded_IsANewEpisode()
    {
        var earlier = Spell(At(13, 55), At(13, 58));
        var later = Spell(At(14, 1));
        var delivered = new[] { new DeliveredNotification(MomId, NotificationKey.ForCryDetected(earlier.EventId)) };

        var plan = Plan(At(14, 2), [Member(MomId)], [], delivered: delivered, crySpells: [earlier, later]);

        Assert.Equal($"cry:{later.EventId:N}", Assert.Single(plan.Notifications).DedupeKey.Value);
    }

    [Fact]
    public void Plan_InsideQuietHours_IsStillDelivered()
    {
        var plan = Plan(At(23, 31), [Member(MomId, quietHours: QuietHours.Default)], [], crySpells: [Spell(At(23, 30))]);

        Assert.Single(plan.Notifications);
    }

    [Fact]
    public void Plan_ShowNames_AddsOnlyTheBabyName()
    {
        var names = new NotificationNameSource("Lia", new Dictionary<Guid, string>());

        var named = Assert.Single(Plan(At(14, 1), [Member(MomId, showNames: true)], [], names: names, crySpells: [Spell(At(14, 0))]).Notifications);
        var generic = Assert.Single(Plan(At(14, 1), [Member(DadId)], [], names: names, crySpells: [Spell(At(14, 0))]).Notifications);

        Assert.Equal(("Lia", (string?)null), (named.Content.Names!.Baby, named.Content.Names.Medication));
        Assert.Null(generic.Content.Names);
    }

    [Fact]
    public void Plan_NoSpells_PlansNothing()
    {
        Assert.Empty(Plan(At(14, 1), [Member(MomId)], []).Notifications);
    }
}
