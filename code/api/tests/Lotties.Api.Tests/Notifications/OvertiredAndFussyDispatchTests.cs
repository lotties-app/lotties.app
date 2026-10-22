using Lotties.Application.Push;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// The overtired and fussy pattern heads-ups end to end (São Paulo, 2026-01-10). Overtired: naps on the 9th give five
/// daytime awake stretches of 100-140 minutes (usual limit 2h10); a nap ending at 13:00 on the 10th starts a stretch
/// whose limit is 15:10, so the heads-up goes once at 14:55. Fussy: spells around 18:00 on the six days before give
/// the usual window 17:30-18:30, so the heads-up goes at 17:00. Codes only, generic text.
/// </summary>
public sealed class OvertiredAndFussyDispatchTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private static DateTimeOffset NinthAt(int hour, int minute = 0) => SaoPaulo(hour, minute).AddDays(-1);

    private async Task<Family> SeedFamilyAsync(bool overtired = false, bool fussy = false)
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedSettingsAsync(family.OwnerId, "America/Sao_Paulo");
        await _host.SeedPreferencesAsync(family.BabyId, family.OwnerId, doseDue: false, overtiredWarning: overtired, fussyPattern: fussy);
        await _host.SeedSubscriptionAsync(family.OwnerId);
        return family;
    }

    private async Task<Family> SeedAwakeStretchAsync()
    {
        var family = await SeedFamilyAsync(overtired: true);
        var naps = new[] { (NinthAt(6), 60), (NinthAt(8, 40), 30), (NinthAt(11), 30), (NinthAt(13, 30), 30), (NinthAt(16, 10), 30), (NinthAt(19), 30), (SaoPaulo(12), 60) };
        foreach (var (start, minutes) in naps)
        {
            await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.SleepId, start, start.AddMinutes(minutes), """{"kind":"nap"}""");
        }

        return family;
    }

    [Fact]
    public async Task RunOnceAsync_AwakeNearTheUsualLimit_SendsOneOvertiredHeadsUp()
    {
        var family = await SeedAwakeStretchAsync();

        var early = await _host.RunAsync(SaoPaulo(14, 54));
        var due = await _host.RunAsync(SaoPaulo(14, 55));
        var next = await _host.RunAsync(SaoPaulo(15, 0));

        Assert.Equal((0, 1, 0), (early.Planned, due.Sent, next.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal("overtired_warning", push.Payload.GetProperty("kind").GetString());
        Assert.Equal(family.BabyId.ToString(), push.Payload.GetProperty("babyId").GetString());
        Assert.Equal("2026-01-10T18:10:00Z", push.Payload.GetProperty("at").GetString());
        Assert.False(push.Payload.TryGetProperty("names", out _));
        Assert.Equal(NotificationUrgency.Normal, push.Message.Urgency);
        Assert.Equal(TimeSpan.FromMinutes(45), push.Message.TimeToLive);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal($"overtired:{family.BabyId:N}:202601101600", delivery.BaseKey.Value);
    }

    [Fact]
    public async Task RunOnceAsync_OvertiredRetry_ShowsTheLimitAgain()
    {
        await SeedAwakeStretchAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);
        await _host.RunAsync(SaoPaulo(14, 55));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var retried = await _host.RunAsync(SaoPaulo(14, 56));

        Assert.Equal(1, retried.Retried);
        Assert.Equal(["2026-01-10T18:10:00Z", "2026-01-10T18:10:00Z"], _host.Sender.Sent.Select(push => push.Payload.GetProperty("at").GetString()));
    }

    [Fact]
    public async Task RunOnceAsync_NapStartedBeforeTheHeadsUp_SendsNothing()
    {
        var family = await SeedAwakeStretchAsync();
        await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.SleepId, SaoPaulo(14, 40), null, """{"kind":"nap"}""");

        var result = await _host.RunAsync(SaoPaulo(14, 55));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_OvertiredKindOff_SendsNothing()
    {
        var family = await SeedFamilyAsync(fussy: true);
        await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.SleepId, SaoPaulo(12), SaoPaulo(13), """{"kind":"nap"}""");

        var result = await _host.RunAsync(SaoPaulo(14, 55));

        Assert.Equal(0, result.Planned);
    }

    private async Task<Family> SeedFussyPatternAsync()
    {
        var family = await SeedFamilyAsync(fussy: true);
        foreach (var daysAgo in Enumerable.Range(1, 6))
        {
            var start = SaoPaulo(18, 0).AddDays(-daysAgo);
            await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.FussyId, start, start.AddMinutes(40), """{"intensity":"moderate"}""");
        }

        return family;
    }

    [Fact]
    public async Task RunOnceAsync_FussyPatternAndKindOn_SendsOneHeadsUpThirtyMinutesBeforeTheWindow()
    {
        var family = await SeedFussyPatternAsync();

        var early = await _host.RunAsync(SaoPaulo(16, 59));
        var due = await _host.RunAsync(SaoPaulo(17, 0));
        var next = await _host.RunAsync(SaoPaulo(17, 5));

        Assert.Equal((0, 1, 0), (early.Planned, due.Sent, next.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        Assert.Equal("fussy_pattern", push.Payload.GetProperty("kind").GetString());
        Assert.Equal("2026-01-10T20:30:00Z", push.Payload.GetProperty("at").GetString());
        Assert.Equal(TimeSpan.FromMinutes(105), push.Message.TimeToLive);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal($"fussy:{family.BabyId:N}:20260110", delivery.BaseKey.Value);
    }

    [Fact]
    public async Task RunOnceAsync_FussySpellLoggedBeforeTheHeadsUp_SendsNothing()
    {
        var family = await SeedFussyPatternAsync();
        await _host.SeedTimedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.FussyId, SaoPaulo(16, 50), null);

        var result = await _host.RunAsync(SaoPaulo(17, 0));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }
}
