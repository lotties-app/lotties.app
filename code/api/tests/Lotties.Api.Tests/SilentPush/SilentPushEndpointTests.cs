using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.SilentPush;
using Lotties.Domain.Notifications;
using Lotties.Domain.SilentPush;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.SilentPush;

/// <summary>
/// <c>GET /push/silent/status</c>, <c>POST /push/devices</c> and <c>DELETE /push/devices/{id}</c>
/// (docs/design/37b-widget-silent-push.md sections 4.1 and 5.4).
/// </summary>
public sealed class SilentPushEndpointTests(SilentPushApiHost host) : IClassFixture<SilentPushApiHost>
{
    private const string DevicesPath = "/api/v1/push/devices";
    private const string StatusPath = "/api/v1/push/silent/status";

    private ApiFactory Factory => host.Factory;

    private async Task<(Guid UserId, HttpClient Client)> NewUserAsync()
    {
        var baby = await Factory.SeedBabyAsync();
        return (await Factory.UserIdAsync(baby.OwnerSubject), host.ClientFor(baby.OwnerSubject));
    }

    private Task<SilentPushDevice> StoredAsync(Guid deviceId) =>
        Factory.QueryAsync(context => context.SilentPushDevices.AsNoTracking().SingleAsync(device => device.Id == deviceId));

    [Fact]
    public async Task Register_NewApnsToken_Returns201WithoutTheToken()
    {
        var (userId, client) = await NewUserAsync();
        var token = SilentPushTestData.NewApnsToken();

        var response = await client.PostAsJsonAsync(DevicesPath, SilentPushTestData.ApnsBody(token, "sandbox"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(token, body, StringComparison.Ordinal);
        var device = await response.ReadAsync<SilentPushDeviceResponse>();
        Assert.Equal("apns", device.Channel);
        Assert.Equal($"{DevicesPath}/{device.Id}", response.Headers.Location?.OriginalString);
        var stored = await StoredAsync(device.Id);
        Assert.Equal((userId, token, ApnsEnvironment.Sandbox), (stored.UserId, stored.Token, stored.ApnsEnvironment));
    }

    [Fact]
    public async Task Register_SameTokenAgain_Returns200WithTheSameDevice()
    {
        var (_, client) = await NewUserAsync();
        var token = SilentPushTestData.NewFcmToken();
        var first = await (await client.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(token))).ReadAsync<SilentPushDeviceResponse>();

        var again = await client.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(token));

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(first.Id, (await again.ReadAsync<SilentPushDeviceResponse>()).Id);
    }

    [Fact]
    public async Task Register_TokenOfAnotherUser_MovesTheDevice()
    {
        var (_, first) = await NewUserAsync();
        var (secondId, second) = await NewUserAsync();
        var token = SilentPushTestData.NewApnsToken();
        var registered = await (await first.PostAsJsonAsync(DevicesPath, SilentPushTestData.ApnsBody(token))).ReadAsync<SilentPushDeviceResponse>();

        var moved = await second.PostAsJsonAsync(DevicesPath, SilentPushTestData.ApnsBody(token));

        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        Assert.Equal(secondId, (await StoredAsync(registered.Id)).UserId);
    }

    [Fact]
    public async Task Register_BeyondTheCap_RevokesTheLeastRecentlySeen()
    {
        var (_, client) = await NewUserAsync();
        var ids = new List<Guid>();
        for (var index = 0; index < 4; index++)
        {
            ids.Add((await (await client.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(SilentPushTestData.NewFcmToken()))).ReadAsync<SilentPushDeviceResponse>()).Id);
        }

        var oldest = await StoredAsync(ids[0]);

        Assert.Equal(SubscriptionRevokeReason.Inactive, oldest.RevokedReason);
        Assert.False((await StoredAsync(ids[3])).IsRevoked);
    }

    [Theory]
    [InlineData("""{"channel":"webpush","token":"0123456789abcdef0123456789abcdef"}""", "channel")]
    [InlineData("""{"token":"0123456789abcdef0123456789abcdef"}""", "channel")]
    [InlineData("""{"channel":"apns","token":"not-hex-not-hex-not-hex-not-hex-xx","apnsEnvironment":"production"}""", "token")]
    [InlineData("""{"channel":"apns","token":"0123456789abcdef0123456789abcdef"}""", "apnsEnvironment")]
    [InlineData("""{"channel":"apns","token":"0123456789abcdef0123456789abcdef","apnsEnvironment":"staging"}""", "apnsEnvironment")]
    [InlineData("""{"channel":"fcm","token":"0123456789abcdef0123456789abcdef","apnsEnvironment":"production"}""", "apnsEnvironment")]
    [InlineData("""{"channel":"fcm","token":"short"}""", "token")]
    public async Task Register_InvalidBody_Returns400NamingTheField(string json, string field)
    {
        var (_, client) = await NewUserAsync();

        var response = await client.PostAsync(DevicesPath, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Unregister_RevokesTheCallersDevice()
    {
        var (_, client) = await NewUserAsync();
        var device = await (await client.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(SilentPushTestData.NewFcmToken()))).ReadAsync<SilentPushDeviceResponse>();

        var response = await client.DeleteAsync($"{DevicesPath}/{device.Id}");
        var again = await client.DeleteAsync($"{DevicesPath}/{device.Id}");

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (response.StatusCode, again.StatusCode));
        Assert.Equal(SubscriptionRevokeReason.User, (await StoredAsync(device.Id)).RevokedReason);
    }

    [Fact]
    public async Task Unregister_AnotherUsersDevice_IsANoOp()
    {
        var (_, owner) = await NewUserAsync();
        var (_, stranger) = await NewUserAsync();
        var device = await (await owner.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(SilentPushTestData.NewFcmToken()))).ReadAsync<SilentPushDeviceResponse>();

        var response = await stranger.DeleteAsync($"{DevicesPath}/{device.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False((await StoredAsync(device.Id)).IsRevoked);
    }

    [Theory]
    [InlineData("apns")]
    [InlineData("fcm")]
    public async Task Status_SilentPushOn_SaysEnabledAndNothingElse(string channel)
    {
        var (_, client) = await NewUserAsync();

        var response = await client.GetAsync($"{StatusPath}?channel={channel}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("""{"enabled":true}""", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("apns")]
    [InlineData("fcm")]
    public async Task Status_SilentPushOff_SaysNotEnabled(string channel)
    {
        using var off = SilentPushApiHost.Off();
        var baby = await off.Factory.SeedBabyAsync();
        var client = off.ClientFor(baby.OwnerSubject);

        var response = await client.GetAsync($"{StatusPath}?channel={channel}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("""{"enabled":false}""", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("?channel=webpush")]
    [InlineData("?channel=FCM")]
    public async Task Status_MissingOrUnknownChannel_Returns400(string query)
    {
        var (_, client) = await NewUserAsync();

        var response = await client.GetAsync(StatusPath + query);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("channel", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Routes_Anonymous_Return401()
    {
        var anonymous = host.Host.CreateClient();

        var status = await anonymous.GetAsync($"{StatusPath}?channel=fcm");
        var register = await anonymous.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(SilentPushTestData.NewFcmToken()));
        var unregister = await anonymous.DeleteAsync($"{DevicesPath}/{Guid.NewGuid()}");

        Assert.Equal(
            (HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized),
            (status.StatusCode, register.StatusCode, unregister.StatusCode));
    }

    [Fact]
    public async Task Routes_SilentPushOff_Return409()
    {
        using var off = SilentPushApiHost.Off();
        var baby = await off.Factory.SeedBabyAsync();
        var client = off.ClientFor(baby.OwnerSubject);

        var register = await client.PostAsJsonAsync(DevicesPath, SilentPushTestData.FcmBody(SilentPushTestData.NewFcmToken()));
        var unregister = await client.DeleteAsync($"{DevicesPath}/{Guid.NewGuid()}");

        await register.AssertProblemAsync(HttpStatusCode.Conflict, "silent_push_not_configured");
        await unregister.AssertProblemAsync(HttpStatusCode.Conflict, "silent_push_not_configured");
    }
}
