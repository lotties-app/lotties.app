using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Notifications;

/// <summary>The <c>doctor_suggestion</c> push (docs/design/16-doctor-access.md section 10.4).</summary>
public sealed class NotificationPlannerDoctorSuggestionTests
{
    private static readonly Guid DoctorId = Guid.NewGuid();

    private static NotificationRecipient Member(Guid userId, BabyRole role = BabyRole.Parent, bool on = true, QuietHours? quietHours = null, bool showNames = false) =>
        Recipient(userId, role, doseDue: false, appointmentReminders: false, doctorSuggestions: on, quietHours: quietHours, showNames: showNames);

    private static DoctorSuggestion Proposal(DateTimeOffset createdAt, Guid? id = null) =>
        new(id ?? Guid.NewGuid(), DoctorSuggestionSource.Proposal, DoctorId, createdAt);

    private static DoctorSuggestion Recommendation(DateTimeOffset createdAt, params Guid[] readBy) =>
        new(Guid.NewGuid(), DoctorSuggestionSource.Recommendation, DoctorId, createdAt, readBy);

    [Fact]
    public void Plan_NewProposal_RemindsOwnersAndParentsWithTheSwitchOnOnly()
    {
        var caregiverId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var offId = Guid.NewGuid();
        var suggestion = Proposal(At(10));
        var recipients = new[]
        {
            Member(MomId, BabyRole.Owner),
            Member(DadId, BabyRole.Parent),
            Member(caregiverId, BabyRole.Caregiver),
            Member(viewerId, BabyRole.Viewer),
            Member(DoctorId, BabyRole.Doctor),
            Member(offId, BabyRole.Parent, on: false),
        };

        var plan = Plan(At(10, 1), recipients, [], doctorSuggestions: [suggestion]);

        Assert.Equal(new[] { MomId, DadId }.Order(), plan.Notifications.Select(planned => planned.UserId).Order());
        Assert.All(plan.Notifications, planned => Assert.Equal(NotificationKind.DoctorSuggestion, planned.Kind));
        Assert.All(plan.Notifications, planned => Assert.Equal($"proposal:{suggestion.Id:N}", planned.DedupeKey.Value));
    }

    [Fact]
    public void Plan_Proposal_CarriesIdsOnlyAndLivesUntil24HoursAfterItWasSent()
    {
        var suggestion = Proposal(At(10));

        var planned = Assert.Single(Plan(At(10, 5), [Member(MomId)], [], doctorSuggestions: [suggestion]).Notifications);

        Assert.Equal((At(10), TimeSpan.FromHours(24), NotificationUrgency.Normal), (planned.DueAt, planned.TimeToLive, planned.Urgency));
        Assert.Equal((suggestion.Id, (Guid?)null, (Guid?)null, BabyId), (planned.Content.ProposalId!.Value, planned.Content.NoteId, planned.Content.PrescriptionId, planned.Content.BabyId!.Value));
        Assert.Null(planned.Content.Names);
    }

    [Fact]
    public void Plan_Recommendation_KeyedByTheNoteAndSkippedForWhoAlreadyReadIt()
    {
        var suggestion = Recommendation(At(10), DadId);

        var plan = Plan(At(10, 5), [Member(MomId), Member(DadId)], [], doctorSuggestions: [suggestion]);

        var planned = Assert.Single(plan.Notifications);
        Assert.Equal((MomId, $"recommendation:{suggestion.Id:N}", suggestion.Id), (planned.UserId, planned.DedupeKey.Value, planned.Content.NoteId!.Value));
    }

    [Fact]
    public void Plan_TheAuthor_IsNeverARecipientEvenAsAParent()
    {
        var plan = Plan(At(10, 5), [Member(DoctorId, BabyRole.Parent)], [], doctorSuggestions: [Proposal(At(10))]);

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_SwitchOffByDefault_PlansNothing()
    {
        var recipient = Recipient(MomId, BabyRole.Owner);

        var plan = Plan(At(10, 5), [recipient], [], doctorSuggestions: [Proposal(At(10))]);

        Assert.False(ReminderPreferences.Default.DoctorSuggestions);
        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_AlreadyClaimed_IsNotPlannedAgain()
    {
        var suggestion = Proposal(At(10));
        var delivered = new DeliveredNotification(MomId, NotificationKey.ForDoctorSuggestion(DoctorSuggestionSource.Proposal, suggestion.Id));

        var plan = Plan(At(10, 30), [Member(MomId)], [], delivered: [delivered], doctorSuggestions: [suggestion]);

        Assert.Empty(plan.Notifications);
    }

    [Fact]
    public void Plan_InsideQuietHours_WaitsAndGoesAfterThem()
    {
        var suggestion = Proposal(At(23));
        var recipient = Member(MomId);

        var night = Plan(At(23, 5), [recipient], [], doctorSuggestions: [suggestion]);
        var morning = Plan(At(7, 1, day: 3), [recipient], [], doctorSuggestions: [suggestion]);

        Assert.Empty(night.Notifications);
        Assert.Equal(NotificationSkipReason.QuietHours, Assert.Single(night.Skipped).Reason);
        var planned = Assert.Single(morning.Notifications);
        Assert.Equal(At(23) + TimeSpan.FromHours(24), planned.DueAt + planned.TimeToLive);
    }

    [Fact]
    public void Plan_OlderThan24Hours_IsNotPlanned()
    {
        var plan = Plan(At(10, 1, day: 3), [Member(MomId)], [], doctorSuggestions: [Proposal(At(10))]);

        Assert.Empty(plan.Notifications);
        Assert.Empty(plan.Skipped);
    }

    [Fact]
    public void Plan_ShowNames_CarriesTheBabyNameOnly()
    {
        var names = new NotificationNameSource("Lia", new Dictionary<Guid, string> { [Guid.NewGuid()] = "Paracetamol" });

        var planned = Assert.Single(Plan(At(10, 5), [Member(MomId, showNames: true)], [], names: names, doctorSuggestions: [Proposal(At(10))]).Notifications);

        Assert.Equal(("Lia", (string?)null), (planned.Content.Names!.Baby, planned.Content.Names.Medication));
    }

    [Theory]
    [InlineData(BabyRole.Owner, true)]
    [InlineData(BabyRole.Parent, true)]
    [InlineData(BabyRole.Caregiver, false)]
    [InlineData(BabyRole.Viewer, false)]
    [InlineData(BabyRole.Doctor, false)]
    public void CanReceiveDoctorSuggestions_OwnersAndParentsOnly(BabyRole role, bool expected)
    {
        Assert.Equal(expected, NotificationRules.CanReceiveDoctorSuggestions(role));
    }

    [Fact]
    public void Key_DoctorSuggestion_RoundTripsForTheRetry()
    {
        var id = Guid.NewGuid();
        var key = NotificationKey.From($"recommendation:{id:N}:s1");

        Assert.True(key.TryGetDoctorSuggestion(out var source, out var parsed));
        Assert.Equal((DoctorSuggestionSource.Recommendation, id), (source, parsed));
        Assert.False(NotificationKey.ForNap(BabyId, At(10)).TryGetDoctorSuggestion(out _, out _));
    }
}
