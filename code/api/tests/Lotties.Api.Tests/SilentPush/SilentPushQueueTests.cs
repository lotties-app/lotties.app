using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.SilentPush;
using Lotties.Domain.EventTypes;
using Lotties.Domain.SilentPush;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.SilentPush;

/// <summary>The per-instance batches (docs/design/37b-widget-silent-push.md section 4.3) and the signal while silent pushes are off.</summary>
public sealed class SilentPushQueueTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 11, 9, 0, 0, TimeSpan.Zero);
    private static readonly SilentPushTiming Timing = new(TimeSpan.FromSeconds(20), TimeSpan.FromMinutes(5));
    private static readonly SilentPushOrigin Mom = new(Guid.NewGuid(), Guid.NewGuid());

    [Fact]
    public void TakeDue_BeforeTheDebounce_TakesNothing()
    {
        var queue = new SilentPushQueue();
        queue.Add(Guid.NewGuid(), Mom, Now);

        Assert.Empty(queue.TakeDue(Now.AddSeconds(19), Timing));
        Assert.Equal(1, queue.PendingCount);
    }

    [Fact]
    public void TakeDue_ABurst_IsOneBatchDueAtTheFirstChangePlusTheDebounce()
    {
        var queue = new SilentPushQueue();
        var babyId = Guid.NewGuid();
        queue.Add(babyId, Mom, Now);
        queue.Add(babyId, Mom, Now.AddSeconds(15));

        var due = queue.TakeDue(Now.AddSeconds(20), Timing);

        var batch = Assert.Single(due);
        Assert.Equal((babyId, Now, Mom), (batch.BabyId, batch.FirstChangeAt, batch.SoleOrigin));
        Assert.Equal(0, queue.PendingCount);
    }

    [Fact]
    public void TakeDue_AChangeDuringTheInterval_WaitsForItsEnd()
    {
        var queue = new SilentPushQueue();
        var babyId = Guid.NewGuid();
        queue.Add(babyId, Mom, Now);
        queue.TakeDue(Now.AddSeconds(20), Timing);
        queue.Add(babyId, Mom, Now.AddMinutes(1));

        var early = queue.TakeDue(Now.AddMinutes(5), Timing);
        var onTime = queue.TakeDue(Now.AddMinutes(5).AddSeconds(20), Timing);

        Assert.Empty(early);
        Assert.Single(onTime);
    }

    [Fact]
    public void TakeDue_OtherBabies_AreIndependent()
    {
        var queue = new SilentPushQueue();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        queue.Add(first, Mom, Now);
        queue.TakeDue(Now.AddSeconds(20), Timing);
        queue.Add(second, Mom, Now.AddSeconds(30));

        Assert.Single(queue.TakeDue(Now.AddSeconds(50), Timing), batch => batch.BabyId == second);
    }

    [Fact]
    public async Task Signal_WhileOff_QueuesNothing()
    {
        using var off = SilentPushApiHost.Off();
        var baby = await off.Factory.SeedBabyAsync();
        var body = new { typeId = BuiltInEventTypes.FeedingId, startedAt = Now, payload = new { method = "bottle", amount = 90 } };

        (await off.ClientFor(baby.OwnerSubject).PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/events/{Guid.NewGuid()}", body)).EnsureSuccessStatusCode();

        Assert.Equal(0, off.Host.Services.GetRequiredService<SilentPushQueue>().PendingCount);
    }
}
