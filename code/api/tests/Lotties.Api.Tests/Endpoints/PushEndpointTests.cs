using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Push;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>Push device, settings and preference routes with push configured and a fake sender.</summary>
public sealed class PushEndpointTests(PushApiHost host) : IClassFixture<PushApiHost>
{
    private const string SubscriptionsPath = "/api/v1/push/subscriptions";
    private const string SettingsPath = "/api/v1/push/settings";
    private const string PreferencesPath = "/api/v1/push/preferences";

    private ApiFactory Factory => host.Factory;

    private static string BabyPreferencesPath(Guid babyId) => $"/api/v1/babies/{babyId}/notification-preferences";

    private static object PreferencesBody(bool doseDue = true, int doseLead = 5, bool napWindow = false, int napLead = 10) =>
        new { doseDue, doseLeadMinutes = doseLead, napWindow, napLeadMinutes = napLead };

    private static object SettingsBody(string? timeZone = "America/Sao_Paulo", string start = "21:30", string end = "06:45") => new
    {
        timeZone,
        quietHours = new { enabled = true, start, end },
        quietIncludesMedicine = true,
        showNames = false,
    };

    private async Task<(string Subject, HttpClient Client)> NewUserAsync()
    {
        var baby = await Factory.SeedBabyAsync();
        return (baby.OwnerSubject, host.ClientFor(baby.OwnerSubject));
    }

    private static async Task<PushSubscriptionResponse> SubscribeAsync(HttpClient client, string endpoint, string locale = "pt-BR") =>
        await (await client.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody(endpoint, locale))).ReadAsync<PushSubscriptionResponse>();

    private Task<PushSubscription> StoredAsync(Guid subscriptionId) =>
        Factory.QueryAsync(context => context.PushSubscriptions.AsNoTracking().SingleAsync(subscription => subscription.Id == subscriptionId));

    [Fact]
    public async Task GetConfig_PushConfigured_ReturnsEnabledAndPublicKey()
    {
        var (_, client) = await NewUserAsync();

        var config = await (await client.GetAsync("/api/v1/push/config")).ReadAsync<PushConfigResponse>();

        Assert.True(config.Enabled);
        Assert.Equal(host.Vapid.PublicKey, config.PublicKey);
    }

    [Theory]
    [InlineData("/api/v1/push/config")]
    [InlineData(SubscriptionsPath)]
    [InlineData(SettingsPath)]
    [InlineData(PreferencesPath)]
    public async Task UserRoutes_Anonymous_Return401(string path)
    {
        var response = await host.AnonymousClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Subscribe_New_Returns201WithDeviceAndNeverTheEndpointOrKeys()
    {
        var (_, client) = await NewUserAsync();

        var response = await client.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody(PushTestData.NewEndpoint()));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("fcm.googleapis.com", body, StringComparison.Ordinal);
        Assert.DoesNotContain(PushTestData.P256dh, body, StringComparison.Ordinal);
        var device = JsonSerializer.Deserialize<PushSubscriptionResponse>(body, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(("Chrome on Android", "pt-BR"), (device.DeviceLabel, device.Locale));
    }

    [Fact]
    public async Task Subscribe_SameEndpointAgain_Returns200RefreshesAndKeepsOneRow()
    {
        var (_, client) = await NewUserAsync();
        var endpoint = PushTestData.NewEndpoint();
        var first = await SubscribeAsync(client, endpoint);

        var response = await client.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody(endpoint, locale: "fr", deviceLabel: "Firefox"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var refreshed = await response.ReadAsync<PushSubscriptionResponse>();
        Assert.Equal((first.Id, "en", "Firefox"), (refreshed.Id, refreshed.Locale, refreshed.DeviceLabel));
        Assert.Equal(1, await Factory.QueryAsync(context => context.PushSubscriptions.CountAsync(subscription => subscription.EndpointHash == PushEndpoint.HashOf(endpoint))));
    }

    [Fact]
    public async Task Subscribe_HostNotOnAllowlist_Returns422()
    {
        var (_, client) = await NewUserAsync();

        var response = await client.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody("https://internal.example.test/push"));

        await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "push_endpoint_not_allowed");
    }

    [Theory]
    [InlineData("http://fcm.googleapis.com/fcm/send/x", null, "endpoint")]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/x", null, "endpoint")]
    [InlineData("https://user@fcm.googleapis.com/fcm/send/x", null, "endpoint")]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", "AAAA", "keys.p256dh")]
    public async Task Subscribe_InvalidEndpointOrKeys_Returns400WithField(string endpoint, string? p256dh, string field)
    {
        var (_, client) = await NewUserAsync();

        var response = await client.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody(endpoint, p256dh: p256dh));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Subscribe_EndpointOfAnotherUser_TransfersItAndCancelsTheirPendingDeliveries()
    {
        var (_, previous) = await NewUserAsync();
        var (nextSubject, next) = await NewUserAsync();
        var endpoint = PushTestData.NewEndpoint();
        var device = await SubscribeAsync(previous, endpoint);
        var pending = await SeedDeliveryAsync(device.Id, (await StoredAsync(device.Id)).UserId, DateTimeOffset.UtcNow);

        var response = await next.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody(endpoint));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(await Factory.UserIdAsync(nextSubject), (await StoredAsync(device.Id)).UserId);
        Assert.Equal(DeliveryStatus.Cancelled, await DeliveryStatusAsync(pending.Delivery.Id));
        Assert.Empty(await (await previous.GetAsync(SubscriptionsPath)).ReadAsync<List<PushSubscriptionResponse>>());
    }

    [Fact]
    public async Task Subscribe_RevokedDevice_IsActiveAgain()
    {
        var (_, client) = await NewUserAsync();
        var endpoint = PushTestData.NewEndpoint();
        var device = await SubscribeAsync(client, endpoint);
        await client.DeleteAsync($"{SubscriptionsPath}/{device.Id}");

        await SubscribeAsync(client, endpoint);

        Assert.False((await StoredAsync(device.Id)).IsRevoked);
    }

    [Fact]
    public async Task Subscribe_EleventhDevice_RevokesTheLeastRecentlySeenAsInactive()
    {
        var (_, client) = await NewUserAsync();
        var devices = new List<PushSubscriptionResponse>();
        for (var index = 0; index < NotificationRules.DefaultMaxSubscriptionsPerUser + 1; index++)
        {
            devices.Add(await SubscribeAsync(client, PushTestData.NewEndpoint()));
        }

        var active = await (await client.GetAsync(SubscriptionsPath)).ReadAsync<List<PushSubscriptionResponse>>();

        Assert.Equal(NotificationRules.DefaultMaxSubscriptionsPerUser, active.Count);
        var oldest = await StoredAsync(devices[0].Id);
        Assert.Equal(SubscriptionRevokeReason.Inactive, oldest.RevokedReason);
    }

    [Fact]
    public async Task RevokeByEndpoint_OwnDevice_RevokesAsUser()
    {
        var (_, client) = await NewUserAsync();
        var endpoint = PushTestData.NewEndpoint();
        var device = await SubscribeAsync(client, endpoint);

        var response = await client.PostAsJsonAsync($"{SubscriptionsPath}/revoke", new { endpoint });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(SubscriptionRevokeReason.User, (await StoredAsync(device.Id)).RevokedReason);
    }

    [Fact]
    public async Task RevokeByEndpoint_AnotherUsersOrUnknownEndpoint_Returns204AndChangesNothing()
    {
        var (_, owner) = await NewUserAsync();
        var (_, stranger) = await NewUserAsync();
        var endpoint = PushTestData.NewEndpoint();
        var device = await SubscribeAsync(owner, endpoint);

        var foreign = await stranger.PostAsJsonAsync($"{SubscriptionsPath}/revoke", new { endpoint });
        var unknown = await stranger.PostAsJsonAsync($"{SubscriptionsPath}/revoke", new { endpoint = PushTestData.NewEndpoint() });

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (foreign.StatusCode, unknown.StatusCode));
        Assert.False((await StoredAsync(device.Id)).IsRevoked);
    }

    [Fact]
    public async Task Delete_OwnDevice_Returns204AndIsIdempotent()
    {
        var (_, client) = await NewUserAsync();
        var device = await SubscribeAsync(client, PushTestData.NewEndpoint());

        var first = await client.DeleteAsync($"{SubscriptionsPath}/{device.Id}");
        var second = await client.DeleteAsync($"{SubscriptionsPath}/{device.Id}");

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (first.StatusCode, second.StatusCode));
        Assert.Equal(SubscriptionRevokeReason.User, (await StoredAsync(device.Id)).RevokedReason);
    }

    [Fact]
    public async Task Delete_AnotherUsersDevice_IsANoOp()
    {
        var (_, owner) = await NewUserAsync();
        var (_, stranger) = await NewUserAsync();
        var device = await SubscribeAsync(owner, PushTestData.NewEndpoint());

        var response = await stranger.DeleteAsync($"{SubscriptionsPath}/{device.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False((await StoredAsync(device.Id)).IsRevoked);
    }

    [Fact]
    public async Task List_ReturnsOnlyTheCallersActiveDevices()
    {
        var (_, client) = await NewUserAsync();
        var (_, other) = await NewUserAsync();
        var kept = await SubscribeAsync(client, PushTestData.NewEndpoint());
        var removed = await SubscribeAsync(client, PushTestData.NewEndpoint());
        await SubscribeAsync(other, PushTestData.NewEndpoint());
        await client.DeleteAsync($"{SubscriptionsPath}/{removed.Id}");

        var devices = await (await client.GetAsync(SubscriptionsPath)).ReadAsync<List<PushSubscriptionResponse>>();

        Assert.Equal(new[] { kept.Id }, devices.Select(device => device.Id));
    }

    [Fact]
    public async Task GetSettings_BeforeFirstPut_ReturnsDefaultsWithoutTimeZone()
    {
        var (_, client) = await NewUserAsync();

        var settings = await (await client.GetAsync(SettingsPath)).ReadAsync<NotificationSettingsDto>();

        Assert.Null(settings.TimeZone);
        Assert.Equal((true, "22:00", "07:00"), (settings.QuietHours!.Enabled, settings.QuietHours.Start, settings.QuietHours.End));
        Assert.False(settings.QuietIncludesMedicine || settings.ShowNames);
    }

    [Fact]
    public async Task PutSettings_StoresTheFullStateAndGetReturnsIt()
    {
        var (_, client) = await NewUserAsync();

        var put = await client.PutAsJsonAsync(SettingsPath, SettingsBody());
        await client.PutAsJsonAsync(SettingsPath, SettingsBody(start: "22:15"));
        var settings = await (await client.GetAsync(SettingsPath)).ReadAsync<NotificationSettingsDto>();

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(("America/Sao_Paulo", "22:15", "06:45", true), (settings.TimeZone, settings.QuietHours!.Start, settings.QuietHours.End, settings.QuietIncludesMedicine));
    }

    [Theory]
    [InlineData("Mars/Olympus", "21:30", "06:45", "timeZone")]
    [InlineData(null, "21:30", "06:45", "timeZone")]
    [InlineData("America/Sao_Paulo", "7am", "06:45", "quietHours.start")]
    [InlineData("America/Sao_Paulo", "06:45", "06:45", "quietHours.end")]
    public async Task PutSettings_Invalid_Returns400WithField(string? timeZone, string start, string end, string field)
    {
        var (_, client) = await NewUserAsync();

        var response = await client.PutAsJsonAsync(SettingsPath, SettingsBody(timeZone, start, end));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task GetPreferences_ListsEveryBabyWithCanReceiveFalseForViewers()
    {
        var mine = await Factory.SeedBabyAsync(BabyRole.Viewer);
        var watched = await Factory.SeedBabyAsync(BabyRole.Viewer);
        var subject = mine.OwnerSubject;
        await AddMemberAsync(watched.BabyId, await Factory.UserIdAsync(subject), BabyRole.Viewer);
        var client = host.ClientFor(subject);
        await client.PutAsJsonAsync(BabyPreferencesPath(mine.BabyId), PreferencesBody());

        var preferences = await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>();

        var own = Assert.Single(preferences, item => item.BabyId == mine.BabyId);
        var viewed = Assert.Single(preferences, item => item.BabyId == watched.BabyId);
        Assert.Equal((true, true, 5, false, 10), (own.CanReceive, own.DoseDue, own.DoseLeadMinutes, own.NapWindow, own.NapLeadMinutes));
        Assert.Equal((false, false, 0, false, 10), (viewed.CanReceive, viewed.DoseDue, viewed.DoseLeadMinutes, viewed.NapWindow, viewed.NapLeadMinutes));
    }

    [Fact]
    public async Task PutPreferences_Parent_Returns200AndStoresTheState()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));

        await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody());
        var response = await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody(doseDue: false, doseLead: 15, napWindow: true, napLead: 20));

        var stored = await response.ReadAsync<BabyNotificationPreferencesResponse>();
        Assert.Equal((baby.BabyId, true, false, 15, true, 20), (stored.BabyId, stored.CanReceive, stored.DoseDue, stored.DoseLeadMinutes, stored.NapWindow, stored.NapLeadMinutes));
        Assert.Equal(1, await Factory.QueryAsync(context => context.BabyNotificationPreferences.CountAsync(row => row.BabyId == baby.BabyId)));
    }

    [Fact]
    public async Task PutPreferences_BellyPainPattern_IsStoredListedAndTurnedOffOnlyWhenSentFalse()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));

        var on = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { doseDue = false, doseLeadMinutes = 0, napWindow = false, napLeadMinutes = 10, bellyPainPattern = true }))
            .ReadAsync<BabyNotificationPreferencesResponse>();
        var listed = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);
        var kept = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody(doseDue: false))).ReadAsync<BabyNotificationPreferencesResponse>();
        var off = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { bellyPainPattern = false })).ReadAsync<BabyNotificationPreferencesResponse>();

        Assert.True(on.BellyPainPattern);
        Assert.True(listed.BellyPainPattern);
        Assert.True(kept.BellyPainPattern);
        Assert.False(off.BellyPainPattern);
        Assert.False(await Factory.QueryAsync(context => context.BabyNotificationPreferences.AnyAsync(row => row.BabyId == baby.BabyId && row.BellyPainPattern)));
    }

    [Fact]
    public async Task PutPreferences_OvertiredAndFussy_AreStoredListedAndOffByDefault()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));
        var before = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);

        var on = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { overtiredWarning = true, fussyPattern = true })).ReadAsync<BabyNotificationPreferencesResponse>();
        var listed = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);

        Assert.Equal((false, false), (before.OvertiredWarning, before.FussyPattern));
        Assert.Equal((true, true, false, 0, false, 10, false), (on.OvertiredWarning, on.FussyPattern, on.DoseDue, on.DoseLeadMinutes, on.NapWindow, on.NapLeadMinutes, on.BellyPainPattern));
        Assert.Equal((true, true), (listed.OvertiredWarning, listed.FussyPattern));
        Assert.True(await Factory.QueryAsync(context => context.BabyNotificationPreferences.AnyAsync(row => row.BabyId == baby.BabyId && row.OvertiredWarning && row.FussyPattern)));
    }

    [Fact]
    public async Task PutPreferences_DoctorSuggestions_AreOffByDefaultStoredAndKeptByOlderClients()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));
        var before = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);

        var on = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { doctorSuggestions = true })).ReadAsync<BabyNotificationPreferencesResponse>();
        var olderClient = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { napWindow = true })).ReadAsync<BabyNotificationPreferencesResponse>();

        Assert.False(before.DoctorSuggestions);
        Assert.Equal((true, false), (on.DoctorSuggestions, on.DoseDue));
        Assert.Equal((true, true), (olderClient.DoctorSuggestions, olderClient.NapWindow));
        Assert.True(await Factory.QueryAsync(context => context.BabyNotificationPreferences.AnyAsync(row => row.BabyId == baby.BabyId && row.DoctorSuggestions)));
    }

    [Fact]
    public async Task PutPreferences_AppointmentReminders_AreOnByDefaultTurnOffAndStayAcrossOlderClients()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));
        var before = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);
        var viewer = Assert.Single(await (await host.ClientFor(baby.SubjectOf(BabyRole.Viewer)).GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);

        var firstPut = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { doseDue = true })).ReadAsync<BabyNotificationPreferencesResponse>();
        var off = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { appointmentReminders = false })).ReadAsync<BabyNotificationPreferencesResponse>();
        var olderClient = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { napWindow = true })).ReadAsync<BabyNotificationPreferencesResponse>();

        Assert.Equal((true, false), (before.AppointmentReminders, viewer.AppointmentReminders));
        Assert.Equal((true, true), (firstPut.AppointmentReminders, firstPut.DoseDue));
        Assert.False(off.AppointmentReminders);
        Assert.Equal((false, true), (olderClient.AppointmentReminders, olderClient.NapWindow));
        Assert.True(await Factory.QueryAsync(context => context.BabyNotificationPreferences.AnyAsync(row => row.BabyId == baby.BabyId && !row.AppointmentReminders && row.NapWindow)));
    }

    [Fact]
    public async Task PutPreferences_DiaperHeadsUps_AreStoredListedOffByDefaultAndKeptByOlderClients()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));
        var before = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);

        var on = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { diaperWetHeadsUp = true, diaperDirtyHeadsUp = true, fussyPattern = true })).ReadAsync<BabyNotificationPreferencesResponse>();
        var olderClient = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { doseDue = true, doseLeadMinutes = 5, napWindow = false, napLeadMinutes = 10, bellyPainPattern = false, overtiredWarning = false, fussyPattern = false })).ReadAsync<BabyNotificationPreferencesResponse>();
        var dirtyOff = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { diaperDirtyHeadsUp = false })).ReadAsync<BabyNotificationPreferencesResponse>();
        var listed = Assert.Single(await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>(), item => item.BabyId == baby.BabyId);

        Assert.Equal((false, false), (before.DiaperWetHeadsUp, before.DiaperDirtyHeadsUp));
        Assert.Equal((true, true, true, false), (on.DiaperWetHeadsUp, on.DiaperDirtyHeadsUp, on.FussyPattern, on.DoseDue));
        Assert.Equal((true, true, true, false), (olderClient.DiaperWetHeadsUp, olderClient.DiaperDirtyHeadsUp, olderClient.DoseDue, olderClient.FussyPattern));
        Assert.Equal((true, false), (dirtyOff.DiaperWetHeadsUp, dirtyOff.DiaperDirtyHeadsUp));
        Assert.Equal((true, false), (listed.DiaperWetHeadsUp, listed.DiaperDirtyHeadsUp));
        Assert.True(await Factory.QueryAsync(context => context.BabyNotificationPreferences.AnyAsync(row => row.BabyId == baby.BabyId && row.DiaperWetHeadsUp && !row.DiaperDirtyHeadsUp)));
    }

    [Fact]
    public async Task PutPreferences_OmittedFields_KeepEveryStoredKind()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));
        var all = new { doseDue = true, doseLeadMinutes = 15, napWindow = true, napLeadMinutes = 20, bellyPainPattern = true, overtiredWarning = true, fussyPattern = true };
        await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), all);

        var empty = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { })).ReadAsync<BabyNotificationPreferencesResponse>();
        var olderClient = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody(doseDue: true, doseLead: 15, napWindow: true, napLead: 20))).ReadAsync<BabyNotificationPreferencesResponse>();
        var oneOff = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { napWindow = false, fussyPattern = (bool?)null })).ReadAsync<BabyNotificationPreferencesResponse>();

        Assert.Equal((true, 15, true, 20, true, true, true), Flags(empty));
        Assert.Equal((true, 15, true, 20, true, true, true), Flags(olderClient));
        Assert.Equal((true, 15, false, 20, true, true, true), Flags(oneOff));
    }

    [Fact]
    public async Task PutPreferences_FirstPutWithSomeFields_MergesIntoTheDefaults()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Parent));

        var stored = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { napWindow = true })).ReadAsync<BabyNotificationPreferencesResponse>();

        Assert.Equal((false, 0, true, 10, false, false, false), Flags(stored));
    }

    [Fact]
    public async Task PutPreferences_MergedLeadOutsideTheAllowedSet_Returns400()
    {
        var baby = await Factory.SeedBabyAsync();

        var response = await host.ClientFor(baby.OwnerSubject).PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), new { napLeadMinutes = 15 });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("napLeadMinutes", problem.GetProperty("field").GetString());
    }

    private static (bool, int, bool, int, bool, bool, bool) Flags(BabyNotificationPreferencesResponse preferences) =>
        (preferences.DoseDue, preferences.DoseLeadMinutes, preferences.NapWindow, preferences.NapLeadMinutes, preferences.BellyPainPattern, preferences.OvertiredWarning, preferences.FussyPattern);

    [Fact]
    public async Task PutPreferences_Caregiver_StoresOnlyTheirOwnRowAndCanReceive()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Caregiver);
        var client = host.ClientFor(baby.SubjectOf(BabyRole.Caregiver));

        var stored = await (await client.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody())).ReadAsync<BabyNotificationPreferencesResponse>();
        var listed = await (await client.GetAsync(PreferencesPath)).ReadAsync<List<BabyNotificationPreferencesResponse>>();

        var caregiverId = await Factory.UserIdAsync(baby.SubjectOf(BabyRole.Caregiver));
        Assert.Equal((true, true), (stored.CanReceive, stored.DoseDue));
        Assert.True(Assert.Single(listed).CanReceive);
        var owners = await Factory.QueryAsync(context => context.BabyNotificationPreferences.Where(row => row.BabyId == baby.BabyId).Select(row => row.UserId).ToListAsync());
        Assert.Equal([caregiverId], owners);
    }

    [Fact]
    public async Task PutPreferences_Viewer_Returns403()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Viewer);

        var response = await host.ClientFor(baby.SubjectOf(BabyRole.Viewer)).PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task PutPreferences_NotAMember_Returns403()
    {
        var baby = await Factory.SeedBabyAsync();
        var (_, stranger) = await NewUserAsync();

        var response = await stranger.PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(10, 10, "doseLeadMinutes")]
    [InlineData(5, 15, "napLeadMinutes")]
    public async Task PutPreferences_LeadOutsideTheAllowedSet_Returns400(int doseLead, int napLead, string field)
    {
        var baby = await Factory.SeedBabyAsync();

        var response = await host.ClientFor(baby.OwnerSubject).PutAsJsonAsync(BabyPreferencesPath(baby.BabyId), PreferencesBody(doseLead: doseLead, napLead: napLead));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    internal static PlannedNotification DosePlan(Guid userId, Guid babyId, DateTimeOffset dueAt)
    {
        var key = NotificationKey.ForDose(Guid.NewGuid(), dueAt);
        return new PlannedNotification(
            userId, NotificationKind.DoseDue, babyId, key, key, dueAt, NotificationRules.DoseTimeToLive, NotificationUrgency.High, new NotificationContent(babyId, null, dueAt, null));
    }

    private async Task<IssuedDelivery> SeedDeliveryAsync(Guid subscriptionId, Guid userId, DateTimeOffset dueAt)
    {
        var issued = NotificationDelivery.Claim(Guid.NewGuid(), subscriptionId, DosePlan(userId, Guid.NewGuid(), dueAt), dueAt);
        await Factory.SeedAsync(context =>
        {
            context.NotificationDeliveries.Add(issued.Delivery);
            return Task.CompletedTask;
        });
        return issued;
    }

    private Task<DeliveryStatus> DeliveryStatusAsync(Guid deliveryId) =>
        Factory.QueryAsync(context => context.NotificationDeliveries.Where(delivery => delivery.Id == deliveryId).Select(delivery => delivery.Status).SingleAsync());

    private async Task AddMemberAsync(Guid babyId, Guid userId, BabyRole role)
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var babies = scope.ServiceProvider.GetRequiredService<IBabyRepository>();
        var baby = await babies.FindAsync(babyId);
        baby!.AddMember(userId, role, TestUsers.Now);
        await babies.SaveChangesAsync();
    }
}
