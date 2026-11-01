using Lotties.Application.Push;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Domain.Vaccinations;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// Vaccine reminders end to end with the shipped schedule (São Paulo, 2026-01-10). The seeded baby is born that day, so
/// the public birth doses (BCG, hepatitis B) are due today and the reminders go at 09:00 local, one per dose, to Owners
/// and Parents who turned the switch on. Codes only: never a record's clinic, lot or notes.
/// </summary>
public sealed class VaccineReminderDispatchTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task OptInAsync(Guid babyId, Guid userId, bool showNames = false, bool vaccineReminders = true)
    {
        await _host.SeedSettingsAsync(userId, "America/Sao_Paulo", showNames: showNames);
        await _host.SeedPreferencesAsync(babyId, userId, doseDue: false, appointmentReminders: false, vaccineReminders: vaccineReminders);
        await _host.SeedSubscriptionAsync(userId);
    }

    [Fact]
    public async Task RunOnceAsync_BirthDosesDue_SendsOneReminderPerDoseAtNine()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family.BabyId, family.OwnerId);

        var early = await _host.RunAsync(SaoPaulo(8, 59));
        var due = await _host.RunAsync(SaoPaulo(9, 0));
        var next = await _host.RunAsync(SaoPaulo(9, 1));

        Assert.Equal((0, 2, 0), (early.Planned, due.Sent, next.Planned));
        Assert.Equal(["bcg-1", "hepatite-b-1"], _host.Sender.Sent.Select(push => push.Payload.GetProperty("doseId").GetString()).Order(StringComparer.Ordinal));
        var push = _host.Sender.Sent[0];
        Assert.Equal(("vaccine_due", family.BabyId.ToString(), "2026-01-10T12:00:00Z", "pt-BR"), (push.Payload.GetProperty("kind").GetString(), push.Payload.GetProperty("babyId").GetString(), push.Payload.GetProperty("at").GetString(), push.Payload.GetProperty("lang").GetString()));
        Assert.False(push.Payload.TryGetProperty("names", out _));
        Assert.Equal((NotificationUrgency.Normal, TimeSpan.FromHours(48)), (push.Message.Urgency, push.Message.TimeToLive));
        Assert.Contains($"vaccine:{family.BabyId:N}:bcg-1:1", (await _host.DeliveriesAsync()).Select(delivery => delivery.BaseKey.Value));
    }

    [Fact]
    public async Task RunOnceAsync_ShowNames_SendsTheVaccineNameInTheDeviceLanguage()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family.BabyId, family.OwnerId, showNames: true);

        await _host.RunAsync(SaoPaulo(9, 0));

        var names = _host.Sender.Sent.Select(push => push.Payload.GetProperty("names")).ToArray();
        Assert.All(names, name => Assert.Equal("Lia", name.GetProperty("baby").GetString()));
        Assert.Equal(["BCG", "Hepatite B"], names.Select(name => name.GetProperty("vaccine").GetString()).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task RunOnceAsync_GivenDosesSwitchOffAndReadOnlyRoles_GetNothing()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Parent);
        await OptInAsync(family.BabyId, family.OwnerId, vaccineReminders: false);
        await OptInAsync(family.BabyId, family.UserOf(BabyRole.Caregiver));
        await OptInAsync(family.BabyId, family.UserOf(BabyRole.Viewer));
        await OptInAsync(family.BabyId, family.UserOf(BabyRole.Parent));
        var given = new DateOnly(2026, 1, 10);
        await _host.SeedAsync(
            Vaccination.Create(Guid.NewGuid(), family.BabyId, VaccinationTerms.Create("bcg", "bcg-1", null, "Dose única", given, VaccineNetwork.Public, "UBS Centro", "L1", null, "secret note"), family.OwnerId, SaoPaulo(8)));

        var result = await _host.RunAsync(SaoPaulo(9, 0));

        Assert.Equal(1, result.Sent);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal((family.UserOf(BabyRole.Parent), $"vaccine:{family.BabyId:N}:hepatite-b-1:1"), (delivery.UserId, delivery.BaseKey.Value));
        Assert.DoesNotContain("UBS Centro", _host.Sender.Sent[0].Message.Payload, StringComparison.Ordinal);
        Assert.DoesNotContain("secret note", _host.Sender.Sent[0].Message.Payload, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RunOnceAsync_Retry_RebuildsTheDoseFromTheKey()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInAsync(family.BabyId, family.OwnerId);
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);
        await _host.RunAsync(SaoPaulo(9, 0));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var retried = await _host.RunAsync(SaoPaulo(9, 1));

        Assert.Equal(2, retried.Retried);
        Assert.Equal(["bcg-1", "hepatite-b-1"], _host.Sender.Sent.TakeLast(2).Select(push => push.Payload.GetProperty("doseId").GetString()).Order(StringComparer.Ordinal));
        Assert.All(_host.Sender.Sent.TakeLast(2), push => Assert.Equal("vaccine_due", push.Payload.GetProperty("kind").GetString()));
    }
}
