using System.Text;
using Lotties.Application.Notifications.Dispatching;
using Lotties.Domain.Notifications;

namespace Lotties.Api.Tests.Notifications;

/// <summary>Pins the payload to what the service worker parses (code/web/src/pwa/sw/payload.ts).</summary>
public sealed class PushPayloadsTests
{
    private static readonly Guid DeliveryId = Guid.Parse("0f8fad5b-d9cb-469f-a165-70867728950e");
    private static readonly Guid BabyId = Guid.Parse("7c9e6679-7425-40de-944b-e07fc1f90ae7");
    private static readonly Guid PrescriptionId = Guid.Parse("a8098c1a-f86e-11da-bd1a-00112444be1e");
    private static readonly DateTimeOffset Slot = new(2026, 10, 21, 18, 0, 0, TimeSpan.FromHours(-3));

    [Fact]
    public void Build_DoseWithTokenAndNames_MatchesTheWorkerContract()
    {
        var key = NotificationKey.ForDose(PrescriptionId, Slot);
        var token = NotificationActionToken.Generate();
        var content = new NotificationContent(BabyId, PrescriptionId, Slot, NotificationNames.Create("Lia", "Simeticona"));

        var payload = PushPayloads.Build(DeliveryId, NotificationKind.DoseDue, content, key, NotificationLocale.FromOrDefault("pt-BR"), token);

        Assert.Equal(
            "{\"v\":1,\"id\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"kind\":\"dose_due\",\"babyId\":\"7c9e6679-7425-40de-944b-e07fc1f90ae7\","
            + "\"rxId\":\"a8098c1a-f86e-11da-bd1a-00112444be1e\",\"at\":\"2026-10-21T21:00:00Z\",\"lang\":\"pt-BR\",\"token\":\"" + token.Value + "\","
            + "\"names\":{\"baby\":\"Lia\",\"medication\":\"Simeticona\"}}",
            payload);
    }

    [Fact]
    public void Build_SnoozeResendOfANapWithoutNames_AddsSnoozeAndOmitsRxIdAndNames()
    {
        var key = NotificationKey.ForNap(BabyId, Slot).Snoozed(2);

        var payload = PushPayloads.Build(DeliveryId, NotificationKind.NapWindow, new NotificationContent(BabyId, null, Slot, null), key, NotificationLocale.English, null);

        Assert.Equal(
            "{\"v\":1,\"id\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"kind\":\"nap_window\",\"babyId\":\"7c9e6679-7425-40de-944b-e07fc1f90ae7\","
            + "\"at\":\"2026-10-21T21:00:00Z\",\"lang\":\"en\",\"snooze\":2}",
            payload);
    }

    [Fact]
    public void Build_AppointmentReminder_CarriesTheAppointmentIdAndOffsetOnly()
    {
        var appointmentId = Guid.Parse("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
        var key = NotificationKey.ForAppointment(appointmentId, Slot, 120);
        var content = new NotificationContent(BabyId, null, Slot, NotificationNames.Create("Lia", null), appointmentId, 120);

        var payload = PushPayloads.Build(DeliveryId, NotificationKind.AppointmentReminder, content, key, NotificationLocale.FromOrDefault("pt-BR"), null);

        Assert.Equal(
            "{\"v\":1,\"id\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"kind\":\"appointment_reminder\",\"babyId\":\"7c9e6679-7425-40de-944b-e07fc1f90ae7\","
            + "\"apptId\":\"3f2504e0-4f89-41d3-9a0c-0305e82c3301\",\"offset\":120,\"at\":\"2026-10-21T21:00:00Z\",\"lang\":\"pt-BR\",\"names\":{\"baby\":\"Lia\"}}",
            payload);
    }

    [Fact]
    public void Build_Test_HasNoBabyNoTokenNoNames()
    {
        var planned = NotificationPlanner.PlanTest(Guid.NewGuid(), DeliveryId, Slot);

        var payload = PushPayloads.Build(DeliveryId, planned.Kind, planned.Content, planned.DedupeKey, NotificationLocale.English, null);

        Assert.Equal("{\"v\":1,\"id\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"kind\":\"test\",\"at\":\"2026-10-21T21:00:00Z\",\"lang\":\"en\"}", payload);
    }

    [Fact]
    public void Build_LongestNamesAndToken_StaysUnderOneKibibyte()
    {
        var names = NotificationNames.Create(new string('ç', 80), new string('ã', 80));
        var content = new NotificationContent(BabyId, PrescriptionId, Slot, names);
        var key = NotificationKey.ForDose(PrescriptionId, Slot).Snoozed(3);

        var payload = PushPayloads.Build(DeliveryId, NotificationKind.DoseDue, content, key, NotificationLocale.FromOrDefault("pt-BR"), NotificationActionToken.Generate());

        Assert.True(Encoding.UTF8.GetByteCount(payload) < 1024, $"payload is {Encoding.UTF8.GetByteCount(payload)} bytes");
    }
}
