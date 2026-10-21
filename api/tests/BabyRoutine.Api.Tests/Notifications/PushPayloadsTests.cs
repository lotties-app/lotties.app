using System.Text;
using BabyRoutine.Application.Notifications.Dispatching;
using BabyRoutine.Domain.Notifications;

namespace BabyRoutine.Api.Tests.Notifications;

/// <summary>Pins the payload to what the service worker parses (web/src/pwa/sw/payload.ts).</summary>
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
