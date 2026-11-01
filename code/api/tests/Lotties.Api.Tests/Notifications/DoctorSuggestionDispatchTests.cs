using Lotties.Application.Push;
using Lotties.Domain.Babies;
using Lotties.Domain.Notes;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// The <c>doctor_suggestion</c> push end to end (São Paulo, 2026-01-10; docs/design/16-doctor-access.md section 10.4):
/// Owners and Parents with the switch on and an opted-in device get one notification per new proposal or recommendation,
/// codes and ids only; the doctor, Caregivers and Viewers never; off by default; quiet hours delay it.
/// </summary>
public sealed class DoctorSuggestionDispatchTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task OptInAsync(Family family, Guid userId, bool on = true, bool showNames = false)
    {
        await _host.SeedSettingsAsync(userId, "America/Sao_Paulo", showNames: showNames);
        await _host.SeedPreferencesAsync(family.BabyId, userId, doseDue: false, appointmentReminders: false, doctorSuggestions: on);
        await _host.SeedSubscriptionAsync(userId);
    }

    private async Task<PrescriptionProposal> SeedProposalAsync(Family family, DateTimeOffset at)
    {
        var terms = ProposalTerms.Create(
            MedicationReference.Create(null, null, "Paracetamol drops"),
            DoseRule.Create(2, "drops", false, null),
            PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00"]), null, null, null, null),
            null,
            new DateOnly(2026, 1, 10),
            null,
            "Give after the morning feed.",
            null);
        var proposal = PrescriptionProposal.Create(Guid.NewGuid(), family.BabyId, terms, family.UserOf(BabyRole.Doctor), at, at);
        await _host.SeedAsync(proposal);
        return proposal;
    }

    private async Task<BabyNote> SeedRecommendationAsync(Family family, DateTimeOffset at)
    {
        var note = BabyNote.Create(Guid.NewGuid(), family.BabyId, NoteTerms.Create(NoteKind.Recommendation, NoteVisibility.Shared, "Offer water between feeds."), family.UserOf(BabyRole.Doctor), at);
        await _host.SeedAsync(note);
        return note;
    }

    [Fact]
    public async Task RunOnceAsync_NewProposal_ReachesTheParentOnceWithIdsOnly()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor);
        await OptInAsync(family, family.OwnerId);
        var proposal = await SeedProposalAsync(family, SaoPaulo(10));

        var first = await _host.RunAsync(SaoPaulo(10, 1));
        var again = await _host.RunAsync(SaoPaulo(10, 2));

        Assert.Equal((1, 0), (first.Sent, again.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal(("doctor_suggestion", proposal.Id.ToString(), family.BabyId.ToString()), (push.Payload.GetProperty("kind").GetString(), push.Payload.GetProperty("proposalId").GetString(), push.Payload.GetProperty("babyId").GetString()));
        Assert.False(push.Payload.TryGetProperty("noteId", out _));
        Assert.DoesNotContain("Paracetamol", push.Message.Payload, StringComparison.Ordinal);
        Assert.DoesNotContain("morning feed", push.Message.Payload, StringComparison.Ordinal);
        Assert.Equal(NotificationUrgency.Normal, push.Message.Urgency);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal(($"proposal:{proposal.Id:N}", SaoPaulo(10) + TimeSpan.FromHours(24)), (delivery.BaseKey.Value, delivery.ExpiresAt));
    }

    [Fact]
    public async Task RunOnceAsync_DoctorCaregiverAndViewer_AreNeverRecipients()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Parent);
        await OptInAsync(family, family.UserOf(BabyRole.Doctor));
        await OptInAsync(family, family.UserOf(BabyRole.Caregiver));
        await OptInAsync(family, family.UserOf(BabyRole.Viewer));
        await OptInAsync(family, family.UserOf(BabyRole.Parent));
        await SeedProposalAsync(family, SaoPaulo(10));

        await _host.RunAsync(SaoPaulo(10, 1));

        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal(family.UserOf(BabyRole.Parent), delivery.UserId);
    }

    [Fact]
    public async Task RunOnceAsync_SwitchOffByDefault_SendsNothing()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor);
        await _host.SeedSettingsAsync(family.OwnerId, "America/Sao_Paulo");
        await _host.SeedSubscriptionAsync(family.OwnerId);
        await SeedProposalAsync(family, SaoPaulo(10));

        var result = await _host.RunAsync(SaoPaulo(10, 1));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_RecommendationSentAtNight_WaitsForTheEndOfQuietHoursAndSkipsReaders()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor, BabyRole.Parent);
        await OptInAsync(family, family.OwnerId);
        await OptInAsync(family, family.UserOf(BabyRole.Parent));
        var note = await SeedRecommendationAsync(family, SaoPaulo(23));
        await _host.SeedAsync(NoteRead.Of(note, family.UserOf(BabyRole.Parent), SaoPaulo(23, 30)));

        var night = await _host.RunAsync(SaoPaulo(23, 5));
        var morning = await _host.RunAsync(SaoPaulo(7, 1).AddDays(1));

        Assert.Equal((0, 1), (night.Planned, morning.Sent));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal(note.Id.ToString(), push.Payload.GetProperty("noteId").GetString());
        Assert.DoesNotContain("water", push.Message.Payload, StringComparison.Ordinal);
        Assert.Equal(family.OwnerId, Assert.Single(await _host.DeliveriesAsync()).UserId);
    }

    [Fact]
    public async Task RunOnceAsync_DecidedProposal_IsNoLongerAnnounced()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor);
        await OptInAsync(family, family.OwnerId);
        var proposal = await SeedProposalAsync(family, SaoPaulo(23));
        await _host.Factory.SeedAsync(async context =>
        {
            var stored = await context.PrescriptionProposals.FindAsync(proposal.Id);
            stored!.Decline(family.OwnerId, null, SaoPaulo(23, 10));
        });

        var morning = await _host.RunAsync(SaoPaulo(7, 1).AddDays(1));

        Assert.Equal(0, morning.Planned);
    }

    [Fact]
    public async Task RunOnceAsync_Retry_RebuildsTheProposalFromTheKey()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor);
        await OptInAsync(family, family.OwnerId);
        var proposal = await SeedProposalAsync(family, SaoPaulo(10));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);
        await _host.RunAsync(SaoPaulo(10, 1));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var retried = await _host.RunAsync(SaoPaulo(10, 2));

        Assert.Equal(1, retried.Retried);
        var push = _host.Sender.Sent[^1];
        Assert.Equal((proposal.Id.ToString(), "2026-01-10T13:00:00Z"), (push.Payload.GetProperty("proposalId").GetString(), push.Payload.GetProperty("at").GetString()));
    }
}
