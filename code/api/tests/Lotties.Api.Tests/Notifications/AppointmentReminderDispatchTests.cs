using Lotties.Application.Push;
using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// Appointment reminders end to end (São Paulo, 2026-01-10). The appointment starts tomorrow at 15:30 with the default
/// offsets, so the "tomorrow" reminder goes once at 15:30 today. Members who never stored preferences get it (on by
/// default) once their device is opted in; codes only: never the title, the doctor or the notes.
/// </summary>
public sealed class AppointmentReminderDispatchTests : IDisposable
{
    private static readonly DateTimeOffset Start = SaoPaulo(15, 30).AddDays(1);

    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task<Appointment> SeedAppointmentAsync(Family family, AppointmentStatus status = AppointmentStatus.Upcoming)
    {
        var terms = AppointmentTerms.Create("Pediatrician Dr. Ana", AppointmentType.Consultation, Start, 30, "Clinic Central", "Dr. Ana", "Bring the card", null, status, AppointmentReminders.Default);
        var appointment = Appointment.Create(Guid.NewGuid(), family.BabyId, terms, family.OwnerId, SaoPaulo(9));
        await _host.SeedAsync(appointment);
        return appointment;
    }

    private async Task OptInDeviceAsync(Guid userId)
    {
        await _host.SeedSettingsAsync(userId, "America/Sao_Paulo");
        await _host.SeedSubscriptionAsync(userId);
    }

    [Fact]
    public async Task RunOnceAsync_MemberWithoutStoredPreferences_GetsTheDayBeforeReminderOnce()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInDeviceAsync(family.OwnerId);
        var appointment = await SeedAppointmentAsync(family);

        var early = await _host.RunAsync(SaoPaulo(15, 29));
        var due = await _host.RunAsync(SaoPaulo(15, 30));
        var next = await _host.RunAsync(SaoPaulo(15, 31));

        Assert.Equal((0, 1, 0), (early.Planned, due.Sent, next.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal("appointment_reminder", push.Payload.GetProperty("kind").GetString());
        Assert.Equal(appointment.Id.ToString(), push.Payload.GetProperty("apptId").GetString());
        Assert.Equal(1440, push.Payload.GetProperty("offset").GetInt32());
        Assert.Equal("2026-01-11T18:30:00Z", push.Payload.GetProperty("at").GetString());
        Assert.False(push.Payload.TryGetProperty("names", out _));
        Assert.DoesNotContain("Dr. Ana", push.Message.Payload, StringComparison.Ordinal);
        Assert.DoesNotContain("Pediatrician", push.Message.Payload, StringComparison.Ordinal);
        Assert.Equal((NotificationUrgency.Normal, TimeSpan.FromDays(1)), (push.Message.Urgency, push.Message.TimeToLive));
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal($"appt:{appointment.Id:N}:202601111830:1440", delivery.BaseKey.Value);
    }

    [Fact]
    public async Task RunOnceAsync_ReminderTurnedOffOrAppointmentCancelled_SendsNothing()
    {
        var off = await _host.SeedFamilyAsync();
        await OptInDeviceAsync(off.OwnerId);
        await _host.SeedPreferencesAsync(off.BabyId, off.OwnerId, doseDue: false, appointmentReminders: false);
        await SeedAppointmentAsync(off);
        var cancelled = await _host.SeedFamilyAsync();
        await OptInDeviceAsync(cancelled.OwnerId);
        await SeedAppointmentAsync(cancelled, AppointmentStatus.Cancelled);

        var result = await _host.RunAsync(SaoPaulo(15, 30));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_CaregiverGetsItViewerDoesNot()
    {
        var family = await _host.SeedFamilyAsync(BabyRole.Caregiver, BabyRole.Viewer);
        await OptInDeviceAsync(family.UserOf(BabyRole.Caregiver));
        await OptInDeviceAsync(family.UserOf(BabyRole.Viewer));
        await SeedAppointmentAsync(family);

        var result = await _host.RunAsync(SaoPaulo(15, 30));

        Assert.Equal(1, result.Sent);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal(family.UserOf(BabyRole.Caregiver), delivery.UserId);
    }

    [Fact]
    public async Task RunOnceAsync_Retry_RebuildsTheAppointmentAndOffsetFromTheKey()
    {
        var family = await _host.SeedFamilyAsync();
        await OptInDeviceAsync(family.OwnerId);
        var appointment = await SeedAppointmentAsync(family);
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);
        await _host.RunAsync(SaoPaulo(15, 30));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var retried = await _host.RunAsync(SaoPaulo(15, 31));

        Assert.Equal(1, retried.Retried);
        var push = _host.Sender.Sent[^1];
        Assert.Equal((appointment.Id.ToString(), 1440, "2026-01-11T18:30:00Z"), (push.Payload.GetProperty("apptId").GetString(), push.Payload.GetProperty("offset").GetInt32(), push.Payload.GetProperty("at").GetString()));
    }
}
