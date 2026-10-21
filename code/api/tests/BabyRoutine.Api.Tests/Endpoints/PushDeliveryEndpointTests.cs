using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BabyRoutine.Api.Limits;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Push;
using BabyRoutine.Domain.Notifications;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Api.Tests.Endpoints;

/// <summary>Test sends and the anonymous snooze/dismiss route, with push configured and a fake sender.</summary>
public sealed class PushDeliveryEndpointTests(PushApiHost host) : IClassFixture<PushApiHost>
{
    private const string SubscriptionsPath = "/api/v1/push/subscriptions";
    private const string TestPath = "/api/v1/push/test";

    private ApiFactory Factory => host.Factory;

    private static string ActionsPath(Guid deliveryId) => $"/api/v1/push/deliveries/{deliveryId}/actions";

    private async Task<Owner> NewOwnerAsync()
    {
        var baby = await Factory.SeedBabyAsync();
        return new Owner(baby.BabyId, await Factory.UserIdAsync(baby.OwnerSubject), host.ClientFor(baby.OwnerSubject));
    }

    private static async Task<PushSubscriptionResponse> SubscribeAsync(HttpClient client, string endpoint) =>
        await (await client.PostAsJsonAsync(SubscriptionsPath, PushTestData.SubscriptionBody(endpoint))).ReadAsync<PushSubscriptionResponse>();

    [Fact]
    public async Task Test_AllDevices_SendsToEachAndAppliesTheAnswers()
    {
        var owner = await NewOwnerAsync();
        var (phone, laptop) = (PushTestData.NewEndpoint(), PushTestData.NewEndpoint());
        var phoneDevice = await SubscribeAsync(owner.Client, phone);
        var laptopDevice = await SubscribeAsync(owner.Client, laptop);
        host.Sender.Answer(laptop, PushSendResult.FromStatusCode(410));

        var response = await owner.Client.PostAsJsonAsync(TestPath, new { });

        var results = (await response.ReadAsync<PushTestResponse>()).Results.ToDictionary(result => result.SubscriptionId, result => result.Status);
        Assert.Equal("sent", results[phoneDevice.Id]);
        Assert.Equal("gone", results[laptopDevice.Id]);
        var laptopStored = await Factory.QueryAsync(context => context.PushSubscriptions.AsNoTracking().SingleAsync(row => row.Id == laptopDevice.Id));
        Assert.Equal(SubscriptionRevokeReason.Gone, laptopStored.RevokedReason);
        var statuses = await Factory.QueryAsync(context => context.NotificationDeliveries
            .Where(delivery => delivery.UserId == owner.UserId).Select(delivery => delivery.Status).ToListAsync());
        Assert.Equal(new[] { DeliveryStatus.Sent, DeliveryStatus.Gone }, statuses.Order());
    }

    [Fact]
    public async Task Test_WithEndpoint_SendsOnlyToThatDeviceAMinimalPayload()
    {
        var owner = await NewOwnerAsync();
        var (phone, laptop) = (PushTestData.NewEndpoint(), PushTestData.NewEndpoint());
        await SubscribeAsync(owner.Client, phone);
        await SubscribeAsync(owner.Client, laptop);

        var response = await owner.Client.PostAsJsonAsync(TestPath, new { endpoint = phone });

        Assert.Single((await response.ReadAsync<PushTestResponse>()).Results);
        Assert.Empty(host.Sender.SentTo(laptop));
        var message = Assert.Single(host.Sender.SentTo(phone));
        using var payload = JsonDocument.Parse(message.Payload);
        var root = payload.RootElement;
        Assert.Equal((1, "test", "pt-BR"), (root.GetProperty("v").GetInt32(), root.GetProperty("kind").GetString(), root.GetProperty("lang").GetString()));
        Assert.EndsWith("Z", root.GetProperty("at").GetString(), StringComparison.Ordinal);
        Assert.False(root.TryGetProperty("token", out _) || root.TryGetProperty("babyId", out _) || root.TryGetProperty("names", out _));
        Assert.Equal(NotificationRules.TestTimeToLive, message.TimeToLive);
    }

    [Fact]
    public async Task Test_MoreThanTheTestLimitPerMinute_Returns429()
    {
        var owner = await NewOwnerAsync();
        var permits = new RequestLimitsOptions().PushTestPermitsPerMinute;
        for (var attempt = 0; attempt < permits; attempt++)
        {
            Assert.Equal(HttpStatusCode.OK, (await owner.Client.PostAsJsonAsync(TestPath, new { })).StatusCode);
        }

        var rejected = await owner.Client.PostAsJsonAsync(TestPath, new { });

        await rejected.AssertProblemAsync(HttpStatusCode.TooManyRequests, "rate_limited");
    }

    [Fact]
    public async Task Action_Snooze_Anonymous_Returns204AndStoresTheSnooze()
    {
        var owner = await NewOwnerAsync();
        var issued = await SeedDeliveryAsync(owner, DateTimeOffset.UtcNow);

        var response = await host.AnonymousClient().PostAsJsonAsync(ActionsPath(issued.Delivery.Id), new { action = "snooze", token = issued.ActionToken!.Value.Value });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var action = await ActionAsync(owner.UserId, issued.Delivery.BaseKey);
        Assert.Equal((NotificationActionKind.Snoozed, (short)1, owner.BabyId), (action.Action, action.SnoozeCount, action.BabyId));
    }

    [Fact]
    public async Task Action_FourthSnooze_Returns409()
    {
        var owner = await NewOwnerAsync();
        var issued = await SeedDeliveryAsync(owner, DateTimeOffset.UtcNow);
        var body = new { action = "snooze", token = issued.ActionToken!.Value.Value };
        for (var snooze = 0; snooze < NotificationRules.MaxSnoozes; snooze++)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await host.AnonymousClient().PostAsJsonAsync(ActionsPath(issued.Delivery.Id), body)).StatusCode);
        }

        var response = await host.AnonymousClient().PostAsJsonAsync(ActionsPath(issued.Delivery.Id), body);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "snooze_limit_reached");
    }

    [Fact]
    public async Task Action_Dismiss_StoresItAndCancelsPendingSnoozeResends()
    {
        var owner = await NewOwnerAsync();
        var issued = await SeedDeliveryAsync(owner, DateTimeOffset.UtcNow);
        var resend = await SeedResendAsync(issued.Delivery, owner);

        var response = await host.AnonymousClient().PostAsJsonAsync(ActionsPath(issued.Delivery.Id), new { action = "dismiss", token = issued.ActionToken!.Value.Value });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(NotificationActionKind.Dismissed, (await ActionAsync(owner.UserId, issued.Delivery.BaseKey)).Action);
        var status = await Factory.QueryAsync(context => context.NotificationDeliveries.Where(delivery => delivery.Id == resend.Id).Select(delivery => delivery.Status).SingleAsync());
        Assert.Equal(DeliveryStatus.Cancelled, status);
    }

    [Fact]
    public async Task Action_WrongTokenUnknownDeliveryOrTooLate_AllReturn404()
    {
        var owner = await NewOwnerAsync();
        var current = await SeedDeliveryAsync(owner, DateTimeOffset.UtcNow);
        var old = await SeedDeliveryAsync(owner, DateTimeOffset.UtcNow - NotificationRules.ActionWindow - TimeSpan.FromMinutes(5));
        var client = host.AnonymousClient();

        var responses = new[]
        {
            await client.PostAsJsonAsync(ActionsPath(current.Delivery.Id), new { action = "snooze", token = NotificationActionToken.Generate().Value }),
            await client.PostAsJsonAsync(ActionsPath(current.Delivery.Id), new { action = "snooze" }),
            await client.PostAsJsonAsync(ActionsPath(Guid.NewGuid()), new { action = "snooze", token = current.ActionToken!.Value.Value }),
            await client.PostAsJsonAsync(ActionsPath(old.Delivery.Id), new { action = "snooze", token = old.ActionToken!.Value.Value }),
        };

        foreach (var response in responses)
        {
            await response.AssertProblemAsync(HttpStatusCode.NotFound, "notification_action_not_found");
        }
    }

    [Fact]
    public async Task Action_UnknownAction_Returns400()
    {
        var owner = await NewOwnerAsync();
        var issued = await SeedDeliveryAsync(owner, DateTimeOffset.UtcNow);

        var response = await host.AnonymousClient().PostAsJsonAsync(ActionsPath(issued.Delivery.Id), new { action = "log", token = issued.ActionToken!.Value.Value });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("action", problem.GetProperty("field").GetString());
    }

    private async Task<IssuedDelivery> SeedDeliveryAsync(Owner owner, DateTimeOffset dueAt)
    {
        var device = await SubscribeAsync(owner.Client, PushTestData.NewEndpoint());
        var issued = NotificationDelivery.Claim(Guid.NewGuid(), device.Id, PushEndpointTests.DosePlan(owner.UserId, owner.BabyId, dueAt), dueAt);
        await Factory.SeedAsync(context =>
        {
            context.NotificationDeliveries.Add(issued.Delivery);
            return Task.CompletedTask;
        });
        return issued;
    }

    private async Task<NotificationDelivery> SeedResendAsync(NotificationDelivery original, Owner owner)
    {
        var plan = new PlannedNotification(
            owner.UserId,
            NotificationKind.DoseDue,
            owner.BabyId,
            original.BaseKey,
            original.BaseKey.Snoozed(1),
            original.DueAt,
            NotificationRules.DoseTimeToLive,
            NotificationUrgency.High,
            new NotificationContent(owner.BabyId, null, original.DueAt, null));
        var resend = NotificationDelivery.Claim(Guid.NewGuid(), original.SubscriptionId, plan, original.DueAt).Delivery;
        await Factory.SeedAsync(context =>
        {
            context.NotificationDeliveries.Add(resend);
            return Task.CompletedTask;
        });
        return resend;
    }

    private Task<NotificationAction> ActionAsync(Guid userId, NotificationKey baseKey) =>
        Factory.QueryAsync(context => context.NotificationActions.AsNoTracking().SingleAsync(action => action.UserId == userId && action.BaseKey == baseKey));

    private sealed record Owner(Guid BabyId, Guid UserId, HttpClient Client);
}

/// <summary>Push routes on a server without VAPID keys: only the config read works.</summary>
public sealed class PushNotConfiguredEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task GetConfig_NotConfigured_ReturnsDisabledWithoutKey()
    {
        var baby = await factory.SeedBabyAsync();

        var config = await (await factory.CreateClientFor(baby.OwnerSubject).GetAsync("/api/v1/push/config")).ReadAsync<PushConfigResponse>();

        Assert.False(config.Enabled);
        Assert.Null(config.PublicKey);
    }

    [Fact]
    public async Task OtherRoutes_NotConfigured_Return409()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClientFor(baby.OwnerSubject);

        var responses = new[]
        {
            await client.PostAsJsonAsync("/api/v1/push/subscriptions", PushTestData.SubscriptionBody(PushTestData.NewEndpoint())),
            await client.GetAsync("/api/v1/push/subscriptions"),
            await client.GetAsync("/api/v1/push/settings"),
            await client.GetAsync("/api/v1/push/preferences"),
            await client.PostAsJsonAsync("/api/v1/push/test", new { }),
            await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/notification-preferences", new { doseDue = true, doseLeadMinutes = 0, napWindow = false, napLeadMinutes = 10 }),
            await factory.CreateClient().PostAsJsonAsync($"/api/v1/push/deliveries/{Guid.NewGuid()}/actions", new { action = "snooze", token = "x" }),
        };

        foreach (var response in responses)
        {
            await response.AssertProblemAsync(HttpStatusCode.Conflict, "push_not_configured");
        }
    }
}

/// <summary>The push rate limit policies with low limits.</summary>
public sealed class PushRateLimitTests
{
    [Fact]
    public async Task Actions_MoreThanTheLimitPerAddress_Returns429()
    {
        using var host = PushApiHost.With(("RequestLimits:PushActionPermitsPerMinute", "2"));
        var client = host.AnonymousClient();
        var path = $"/api/v1/push/deliveries/{Guid.NewGuid()}/actions";

        var accepted = new[] { await client.PostAsJsonAsync(path, new { action = "snooze" }), await client.PostAsJsonAsync(path, new { action = "snooze" }) };
        var rejected = await client.PostAsJsonAsync(path, new { action = "snooze" });

        Assert.All(accepted, response => Assert.Equal(HttpStatusCode.NotFound, response.StatusCode));
        await rejected.AssertProblemAsync(HttpStatusCode.TooManyRequests, "rate_limited");
        Assert.NotNull(rejected.Headers.RetryAfter);
    }

    [Fact]
    public async Task Writes_MoreThanTheWriteLimitPerUser_Returns429()
    {
        using var host = PushApiHost.With(("RequestLimits:PushWritePermitsPerMinute", "2"));
        var baby = await host.Factory.SeedBabyAsync();
        var client = host.ClientFor(baby.OwnerSubject);
        var body = new { timeZone = "Europe/Lisbon", quietHours = new { enabled = false, start = "22:00", end = "07:00" }, quietIncludesMedicine = false, showNames = false };

        var accepted = new[] { await client.PutAsJsonAsync("/api/v1/push/settings", body), await client.PutAsJsonAsync("/api/v1/push/settings", body) };
        var rejected = await client.PutAsJsonAsync("/api/v1/push/settings", body);

        Assert.All(accepted, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        await rejected.AssertProblemAsync(HttpStatusCode.TooManyRequests, "rate_limited");
    }
}
