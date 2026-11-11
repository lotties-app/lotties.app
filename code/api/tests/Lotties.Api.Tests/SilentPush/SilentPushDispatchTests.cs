using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.SilentPush;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using Lotties.Domain.SilentPush;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.SilentPush;

/// <summary>
/// From an event write to the pushes (docs/design/37b-widget-silent-push.md sections 4.2 to 4.5): who gets one, the
/// origin device skipped, a burst coalesced, outcomes recorded.
/// </summary>
public sealed class SilentPushDispatchTests(SilentPushApiHost host) : IClassFixture<SilentPushApiHost>
{
    private const string DevicesPath = "/api/v1/push/devices";
    private static readonly DateTimeOffset Start = new(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);

    private ApiFactory Factory => host.Factory;

    private static string EventPath(Guid babyId, Guid eventId) => $"/api/v1/babies/{babyId}/events/{eventId}";

    private static object Feed(string? notes = "bottle") => new
    {
        typeId = BuiltInEventTypes.FeedingId,
        startedAt = Start,
        payload = new { method = "bottle", amount = 120 },
        notes,
        updatedAt = DateTimeOffset.UtcNow,
    };

    private async Task<Guid> RegisterAsync(string subject)
    {
        var response = await host.ClientFor(subject).PostAsJsonAsync(DevicesPath, SilentPushTestData.ApnsBody(SilentPushTestData.NewApnsToken()));
        return (await response.ReadAsync<SilentPushDeviceResponse>()).Id;
    }

    private Task<SilentPushDevice> StoredAsync(Guid deviceId) =>
        Factory.QueryAsync(context => context.SilentPushDevices.AsNoTracking().SingleAsync(device => device.Id == deviceId));

    [Fact]
    public async Task EventWrite_PushesEveryOtherMembersDeviceButNotTheDoctorsOrTheWritersOwn()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var ownerPhone = await RegisterAsync(baby.OwnerSubject);
        var ownerTablet = await RegisterAsync(baby.OwnerSubject);
        var others = new[] { BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer };
        var otherDevices = new List<Guid>();
        foreach (var role in others)
        {
            otherDevices.Add(await RegisterAsync(baby.SubjectOf(role)));
        }

        var doctorDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Doctor));

        (await host.ClientFor(baby.OwnerSubject, ownerPhone).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.Equal(0, host.Sender.CountTo(ownerPhone));
        Assert.Equal(1, host.Sender.CountTo(ownerTablet));
        Assert.All(otherDevices, device => Assert.Equal(1, host.Sender.CountTo(device)));
        Assert.Equal(0, host.Sender.CountTo(doctorDevice));
    }

    [Fact]
    public async Task Burst_OfWrites_IsOnePushPerDevice()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));
        var owner = host.ClientFor(baby.OwnerSubject);

        for (var write = 0; write < 3; write++)
        {
            (await owner.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        }

        await host.RunPassAsync();
        await host.RunPassAsync();

        Assert.Equal(1, host.Sender.CountTo(parentDevice));
    }

    [Fact]
    public async Task WritesFromTwoDevicesInOneBatch_PushBoth()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var ownerDevice = await RegisterAsync(baby.OwnerSubject);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));

        (await host.ClientFor(baby.OwnerSubject, ownerDevice).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        (await host.ClientFor(baby.SubjectOf(BabyRole.Parent), parentDevice).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.Equal((1, 1), (host.Sender.CountTo(ownerDevice), host.Sender.CountTo(parentDevice)));
    }

    [Fact]
    public async Task OriginHeader_NamingAnotherUsersDevice_SkipsNothing()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));

        (await host.ClientFor(baby.OwnerSubject, parentDevice).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.Equal(1, host.Sender.CountTo(parentDevice));
    }

    [Fact]
    public async Task EditAndDelete_Push_IgnoredReplayDoesNot()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));
        var owner = host.ClientFor(baby.OwnerSubject);
        var eventId = Guid.NewGuid();
        var created = Feed();
        (await owner.PutAsJsonAsync(EventPath(baby.BabyId, eventId), created)).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        (await owner.PutAsJsonAsync(EventPath(baby.BabyId, eventId), created)).EnsureSuccessStatusCode();
        await host.RunPassAsync();
        var afterReplay = host.Sender.CountTo(parentDevice);
        (await owner.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Feed("edited"))).EnsureSuccessStatusCode();
        await host.RunPassAsync();
        var afterEdit = host.Sender.CountTo(parentDevice);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync(EventPath(baby.BabyId, eventId))).StatusCode);
        await host.RunPassAsync();

        Assert.Equal((1, 2, 3), (afterReplay, afterEdit, host.Sender.CountTo(parentDevice)));
    }

    [Fact]
    public async Task MemberWithoutCurrentConsent_GetsNoPush()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));
        var parentId = await Factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent));
        await Factory.QueryAsync(context => context.UserConsents.Where(row => row.UserId == parentId).ExecuteDeleteAsync());

        (await host.ClientFor(baby.OwnerSubject).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.Equal(0, host.Sender.CountTo(parentDevice));
    }

    [Fact]
    public async Task BabyOnAnExternalStore_GetsNoPush()
    {
        var baby = await Factory.SeedBabyAsync();
        var ownerTablet = await RegisterAsync(baby.OwnerSubject);
        var ownerId = await Factory.UserIdAsync(baby.OwnerSubject);
        await Factory.AssignStoreAsync(baby.BabyId, ownerId, Guid.NewGuid());
        host.Host.Services.GetRequiredService<SilentPushQueue>().Add(baby.BabyId, new SilentPushOrigin(ownerId, null), DateTimeOffset.UtcNow);

        await host.RunPassAsync();

        Assert.Equal(0, host.Sender.CountTo(ownerTablet));
    }

    [Theory]
    [InlineData(SilentPushOutcome.Gone, SubscriptionRevokeReason.Gone)]
    [InlineData(SilentPushOutcome.Invalid, SubscriptionRevokeReason.Invalid)]
    public async Task GoneOrInvalidAnswer_RevokesTheDeviceAndItGetsNoMorePushes(SilentPushOutcome answer, SubscriptionRevokeReason reason)
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));
        host.Sender.Answer(parentDevice, answer);
        var owner = host.ClientFor(baby.OwnerSubject);

        (await owner.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();
        (await owner.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.Equal(reason, (await StoredAsync(parentDevice)).RevokedReason);
        Assert.Equal(1, host.Sender.CountTo(parentDevice));
    }

    [Fact]
    public async Task SentAnswer_RecordsTheTime()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));

        (await host.ClientFor(baby.OwnerSubject).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.NotNull((await StoredAsync(parentDevice)).LastSentAt);
    }

    [Fact]
    public async Task UnregisteredDevice_GetsNoPush()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentDevice = await RegisterAsync(baby.SubjectOf(BabyRole.Parent));
        await host.ClientFor(baby.SubjectOf(BabyRole.Parent)).DeleteAsync($"{DevicesPath}/{parentDevice}");

        (await host.ClientFor(baby.OwnerSubject).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Feed())).EnsureSuccessStatusCode();
        await host.RunPassAsync();

        Assert.Equal(0, host.Sender.CountTo(parentDevice));
    }
}
