using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Push;
using Lotties.Domain.Babies;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>A Doctor never receives baby reminders and cannot opt in (push configured).</summary>
public sealed class DoctorReminderEndpointTests(PushApiHost host) : IClassFixture<PushApiHost>
{
    [Fact]
    public async Task Reminders_Doctor_CannotReceiveOrOptIn()
    {
        var baby = await host.Factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = host.ClientFor(baby.SubjectOf(BabyRole.Doctor));

        var preferences = await (await doctor.GetAsync("/api/v1/push/preferences")).ReadAsync<List<BabyNotificationPreferencesResponse>>();
        var optIn = await doctor.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/notification-preferences", new { doseDue = true });

        var entry = Assert.Single(preferences, item => item.BabyId == baby.BabyId);
        Assert.False(entry.CanReceive);
        Assert.False(entry.DoseDue);
        Assert.Equal(HttpStatusCode.Forbidden, optIn.StatusCode);
    }
}
