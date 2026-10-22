using Lotties.Application.Push;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// The diaper heads-ups end to end (São Paulo, 2026-01-10). Wet: wet diapers every 3 hours, the latest at 13:00, so
/// the next one is expected at 16:00 and the heads-up goes once at 15:50. Dirty: on the five days before, a dirty
/// diaper came 30 minutes after a feed ended; a feed ending at 15:30 today puts the dirty heads-up at 16:00, inside the
/// hour after the wet one. Codes only, generic text.
/// </summary>
public sealed class DiaperHeadsUpDispatchTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task<Family> SeedFamilyAsync(bool wet = false, bool dirty = false)
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedSettingsAsync(family.OwnerId, "America/Sao_Paulo");
        await _host.SeedPreferencesAsync(family.BabyId, family.OwnerId, doseDue: false, diaperWet: wet, diaperDirty: dirty);
        await _host.SeedSubscriptionAsync(family.OwnerId);
        return family;
    }

    private Task SeedDiaperAsync(Family family, DateTimeOffset at, string content) =>
        _host.SeedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.DiaperId, at, $$"""{"content":"{{content}}"}""");

    private async Task<Family> SeedWetDiapersAsync(bool dirty = false)
    {
        var family = await SeedFamilyAsync(wet: true, dirty: dirty);
        foreach (var index in Enumerable.Range(0, 16))
        {
            await SeedDiaperAsync(family, SaoPaulo(13).AddHours(-3 * index), "WET");
        }

        return family;
    }

    /// <summary>Feeds at 07:00-07:20 on the five days before, each followed by a dirty diaper at 07:50; a feed today ending at 15:30.</summary>
    private async Task SeedDirtyAfterFeedsAsync(Family family)
    {
        foreach (var daysAgo in Enumerable.Range(1, 5))
        {
            var feed = SaoPaulo(7).AddDays(-daysAgo);
            await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.FeedingId, feed, feed.AddMinutes(20), """{"method":"bottle"}""");
            await SeedDiaperAsync(family, feed.AddMinutes(50), "DIRTY");
        }

        await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.FeedingId, SaoPaulo(15, 10), SaoPaulo(15, 30), """{"method":"bottle"}""");
    }

    [Fact]
    public async Task RunOnceAsync_WetDiaperExpectedSoon_SendsOneHeadsUpTenMinutesBefore()
    {
        var family = await SeedWetDiapersAsync();

        var early = await _host.RunAsync(SaoPaulo(15, 49));
        var due = await _host.RunAsync(SaoPaulo(15, 50));
        var next = await _host.RunAsync(SaoPaulo(15, 55));

        Assert.Equal((0, 1, 0), (early.Planned, due.Sent, next.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal("diaper_wet_headsup", push.Payload.GetProperty("kind").GetString());
        Assert.Equal(family.BabyId.ToString(), push.Payload.GetProperty("babyId").GetString());
        Assert.Equal("2026-01-10T19:00:00Z", push.Payload.GetProperty("at").GetString());
        Assert.False(push.Payload.TryGetProperty("names", out _));
        Assert.Equal((NotificationUrgency.Normal, TimeSpan.FromMinutes(40)), (push.Message.Urgency, push.Message.TimeToLive));
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal($"wet:{family.BabyId:N}:202601101600", delivery.BaseKey.Value);
    }

    [Fact]
    public async Task RunOnceAsync_WetDiaperLoggedBeforeTheHeadsUp_SendsNothing()
    {
        var family = await SeedWetDiapersAsync();
        await SeedDiaperAsync(family, SaoPaulo(15, 30), "MIXED");

        var result = await _host.RunAsync(SaoPaulo(15, 50));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_WetRetry_ShowsTheExpectedTimeAgain()
    {
        await SeedWetDiapersAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);
        await _host.RunAsync(SaoPaulo(15, 50));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var retried = await _host.RunAsync(SaoPaulo(15, 51));

        Assert.Equal(1, retried.Retried);
        Assert.Equal(["2026-01-10T19:00:00Z", "2026-01-10T19:00:00Z"], _host.Sender.Sent.Select(push => push.Payload.GetProperty("at").GetString()));
    }

    [Fact]
    public async Task RunOnceAsync_DirtyAfterAFeedWithinTheHourAfterTheWetOne_IsHeldBack()
    {
        var family = await SeedWetDiapersAsync(dirty: true);
        await SeedDirtyAfterFeedsAsync(family);

        await _host.RunAsync(SaoPaulo(15, 50));
        var dirty = await _host.RunAsync(SaoPaulo(16, 0));
        await _host.RunAsync(SaoPaulo(16, 10));

        Assert.Equal(0, dirty.Planned);
        Assert.Equal(["diaper_wet_headsup"], _host.Sender.Sent.Select(push => push.Payload.GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task RunOnceAsync_FailedWetHeadsUp_DoesNotCountTowardTheSpacing()
    {
        var family = await SeedWetDiapersAsync(dirty: true);
        await SeedDirtyAfterFeedsAsync(family);
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(413);
        await _host.RunAsync(SaoPaulo(15, 50));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var dirty = await _host.RunAsync(SaoPaulo(16, 0));

        Assert.Equal(1, dirty.Sent);
        var push = _host.Sender.Sent[^1];
        Assert.Equal(("diaper_dirty_headsup", "2026-01-10T19:00:00Z"), (push.Payload.GetProperty("kind").GetString(), push.Payload.GetProperty("at").GetString()));
        Assert.Contains(await _host.DeliveriesAsync(), delivery => delivery.BaseKey.Value == $"dirty:{family.BabyId:N}:202601101830");
    }

    [Fact]
    public async Task RunOnceAsync_DiaperKindsOff_SendNothing()
    {
        var family = await SeedFamilyAsync();
        foreach (var index in Enumerable.Range(0, 16))
        {
            await SeedDiaperAsync(family, SaoPaulo(13).AddHours(-3 * index), "WET");
        }

        var result = await _host.RunAsync(SaoPaulo(15, 50));

        Assert.Equal(0, result.Planned);
    }
}
