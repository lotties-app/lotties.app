using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// The <c>cry_detected</c> push end to end (São Paulo, 2026-01-10; docs/design/31-cry-detector-spike.md section 8): a
/// fussy spell the cry monitor started reaches the opted-in members who receive baby reminders once, at its start, codes
/// and the time only; off by default; a manual spell, a spell marked "Not crying" or one older than 10 minutes never.
/// </summary>
public sealed class CryDetectedDispatchTests : IDisposable
{
    private const string AutoDetected = """{"auto_detected":true}""";

    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task OptInAsync(Family family, Guid userId, bool on = true, bool showNames = false)
    {
        await _host.SeedSettingsAsync(userId, "America/Sao_Paulo", showNames: showNames);
        await _host.SeedPreferencesAsync(family.BabyId, userId, doseDue: false, appointmentReminders: false, cryDetected: on);
        await _host.SeedSubscriptionAsync(userId);
    }

    private async Task<Guid> SeedSpellAsync(Family family, DateTimeOffset startedAt, DateTimeOffset? endedAt = null, string payload = AutoDetected)
    {
        var id = Guid.NewGuid();
        await _host.SeedAsync(Event.Create(id, family.BabyId, BuiltInEventTypes.FussyId, family.OwnerId, startedAt, endedAt, EventPayload.From(payload), null, startedAt));
        return id;
    }

    [Fact]
    public async Task RunOnceAsync_MonitorSpell_ReachesTheOptedInMemberOnceWithTheTimeOnly()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family, family.OwnerId);
        var spellId = await SeedSpellAsync(family, SaoPaulo(14, 32));

        var first = await _host.RunAsync(SaoPaulo(14, 33));
        var again = await _host.RunAsync(SaoPaulo(14, 34));

        Assert.Equal((1, 0), (first.Sent, again.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal(("cry_detected", family.BabyId.ToString(), "2026-01-10T17:32:00Z"), (push.Payload.GetProperty("kind").GetString(), push.Payload.GetProperty("babyId").GetString(), push.Payload.GetProperty("at").GetString()));
        Assert.False(push.Payload.TryGetProperty("names", out _));
        Assert.False(push.Payload.TryGetProperty("rxId", out _));
        Assert.Equal(NotificationUrgency.High, push.Message.Urgency);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal(($"cry:{spellId:N}", SaoPaulo(14, 52)), (delivery.BaseKey.Value, delivery.ExpiresAt));
    }

    [Fact]
    public async Task RunOnceAsync_DoctorAndViewer_AreNeverRecipientsCaregiverAndParentAre()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Doctor, BabyRole.Viewer, BabyRole.Caregiver, BabyRole.Parent);
        foreach (var role in new[] { BabyRole.Doctor, BabyRole.Viewer, BabyRole.Caregiver, BabyRole.Parent })
        {
            await OptInAsync(family, family.UserOf(role));
        }

        await SeedSpellAsync(family, SaoPaulo(14, 32));

        var result = await _host.RunAsync(SaoPaulo(14, 33));

        Assert.Equal(2, result.Sent);
        var recipients = (await _host.DeliveriesAsync()).Select(delivery => delivery.UserId).Order().ToArray();
        Assert.Equal(new[] { family.UserOf(BabyRole.Caregiver), family.UserOf(BabyRole.Parent) }.Order(), recipients);
    }

    [Fact]
    public async Task RunOnceAsync_SwitchOff_SendsNothing()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family, family.OwnerId, on: false);
        await SeedSpellAsync(family, SaoPaulo(14, 32));

        var result = await _host.RunAsync(SaoPaulo(14, 33));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"auto_detected":false}""")]
    [InlineData("""{"auto_detected":true,"cry_confirmed":false}""")]
    public async Task RunOnceAsync_ManualSpellOrNotCrying_SendsNothing(string payload)
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family, family.OwnerId);
        await SeedSpellAsync(family, SaoPaulo(14, 32), payload: payload);

        var result = await _host.RunAsync(SaoPaulo(14, 33));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_SpellThatReachedTheServerTooLate_IsStale()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family, family.OwnerId);
        await SeedSpellAsync(family, SaoPaulo(14, 0));

        var result = await _host.RunAsync(SaoPaulo(14, 11));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_ConfirmedAndEndedSpell_StillAlertsAndASpellOverlappingItDoesNot()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family, family.OwnerId, showNames: true);
        var first = await SeedSpellAsync(family, SaoPaulo(14, 30), SaoPaulo(14, 36), """{"auto_detected":true,"cry_confirmed":true}""");
        await SeedSpellAsync(family, SaoPaulo(14, 31));

        var result = await _host.RunAsync(SaoPaulo(14, 37));

        Assert.Equal(1, result.Sent);
        var push = Assert.Single(_host.Sender.Sent);
        Assert.True(push.Payload.TryGetProperty("names", out var names));
        Assert.False(names.TryGetProperty("medication", out _));
        Assert.Equal($"cry:{first:N}", Assert.Single(await _host.DeliveriesAsync()).BaseKey.Value);
    }
}
