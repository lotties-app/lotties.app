using Lotties.Application.Push;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// The belly pain pattern heads-up end to end: belly pain logged around 18:00 São Paulo on the six days before
/// 2026-01-10 gives the usual window 17:30-18:30, so the heads-up goes once at 17:00 (codes only, generic text).
/// </summary>
public sealed class BellyPainPatternDispatchTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task<Family> SeedPatternAsync()
    {
        var family = await _host.SeedFamilyAsync();
        foreach (var daysAgo in Enumerable.Range(1, 6))
        {
            await _host.SeedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.BellyPainId, SaoPaulo(18, 0).AddDays(-daysAgo), """{"intensity":3}""");
        }

        await _host.SeedSettingsAsync(family.OwnerId, "America/Sao_Paulo");
        await _host.SeedPreferencesAsync(family.BabyId, family.OwnerId, doseDue: false, bellyPainPattern: true);
        await _host.SeedSubscriptionAsync(family.OwnerId);
        return family;
    }

    [Fact]
    public async Task RunOnceAsync_PatternAndKindOn_SendsOneHeadsUpThirtyMinutesBeforeTheWindow()
    {
        var family = await SeedPatternAsync();

        var early = await _host.RunAsync(SaoPaulo(16, 59));
        var due = await _host.RunAsync(SaoPaulo(17, 0));
        var next = await _host.RunAsync(SaoPaulo(17, 5));

        Assert.Equal((0, 1, 0), (early.Planned, due.Sent, next.Planned));
        var push = Assert.Single(_host.Sender.Sent);
        var payload = push.Payload;
        Assert.Equal("belly_pain_pattern", payload.GetProperty("kind").GetString());
        Assert.Equal(family.BabyId.ToString(), payload.GetProperty("babyId").GetString());
        Assert.Equal("2026-01-10T20:30:00Z", payload.GetProperty("at").GetString());
        Assert.False(payload.TryGetProperty("rxId", out _));
        Assert.False(payload.TryGetProperty("names", out _));
        Assert.Equal(NotificationUrgency.Normal, push.Message.Urgency);
        Assert.Equal(TimeSpan.FromMinutes(105), push.Message.TimeToLive);
        var delivery = Assert.Single(await _host.DeliveriesAsync());
        Assert.Equal($"belly:{family.BabyId:N}:20260110", delivery.BaseKey.Value);
    }

    [Fact]
    public async Task RunOnceAsync_RetryAfterAFailedSend_ShowsTheWindowStartAgain()
    {
        await SeedPatternAsync();
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(503);
        await _host.RunAsync(SaoPaulo(17, 0));
        _host.Sender.Responder = _ => PushSendResult.FromStatusCode(201);

        var retried = await _host.RunAsync(SaoPaulo(17, 1));

        Assert.Equal(1, retried.Retried);
        Assert.Equal(["2026-01-10T20:30:00Z", "2026-01-10T20:30:00Z"], _host.Sender.Sent.Select(push => push.Payload.GetProperty("at").GetString()));
    }

    [Fact]
    public async Task RunOnceAsync_MassageLoggedBeforeTheHeadsUp_SendsNothing()
    {
        var family = await SeedPatternAsync();
        await _host.SeedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.BellyMassageId, SaoPaulo(16, 50));

        var result = await _host.RunAsync(SaoPaulo(17, 0));

        Assert.Equal(0, result.Planned);
        Assert.Empty(_host.Sender.Sent);
    }
}
