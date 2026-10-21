using BabyRoutine.Application.Notifications;
using BabyRoutine.Application.Notifications.Dispatching;
using BabyRoutine.Domain.Notifications;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using static BabyRoutine.Api.Tests.Notifications.SchedulerTestHost;

namespace BabyRoutine.Api.Tests.Notifications;

/// <summary>Two API instances (own lease holder and sender each) on one SQLite database.</summary>
public sealed class NotificationLeaseContentionTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task RunOnceAsync_TwoInstancesAtOnce_OnlyOnePlansAndEachDeviceGetsOnePush()
    {
        var subscription = await SeedDoseAtSixAsync();
        var otherSender = new ScriptedPushSender();
        var other = _host.AddInstance(otherSender);

        var results = await Task.WhenAll(_host.RunAsync(SaoPaulo(18, 0)), TickOf(other).RunOnceAsync(SaoPaulo(18, 0)));

        Assert.Single(results, result => result.LeaseHeld);
        var sent = _host.Sender.Sent.Concat(otherSender.Sent).ToArray();
        Assert.Single(sent);
        Assert.True(sent[0].IsFor(subscription));
        Assert.Single(await _host.DeliveriesAsync());
    }

    [Fact]
    public async Task RunOnceAsync_LeaseHeldByAnotherInstance_SkipsUntilItExpires()
    {
        await SeedDoseAtSixAsync();
        var otherSender = new ScriptedPushSender();
        var other = TickOf(_host.AddInstance(otherSender));
        Assert.NotEqual(_host.Tick.HolderId, other.HolderId);
        await _host.RunAsync(SaoPaulo(17, 59));

        var whileHeld = await other.RunOnceAsync(SaoPaulo(18, 0));
        var renewed = await _host.RunAsync(SaoPaulo(18, 0));
        var stillHeld = await other.RunOnceAsync(SaoPaulo(18, 1));
        var afterHolderStopped = await other.RunOnceAsync(SaoPaulo(18, 2));

        Assert.Equal(NotificationTickResult.LeaseNotHeld, whileHeld);
        Assert.Equal((true, 1), (renewed.LeaseHeld, renewed.Sent));
        Assert.False(stillHeld.LeaseHeld);
        Assert.True(afterHolderStopped.LeaseHeld);
        Assert.Empty(otherSender.Sent);
    }

    [Fact]
    public async Task RunOnceAsync_BothInstancesPlanTheSameReminder_TheUniqueClaimLetsOnlyOneSend()
    {
        await SeedDoseAtSixAsync();
        var otherSender = new ScriptedPushSender();
        var splitBrain = TickOf(_host.AddInstance(otherSender, services =>
        {
            services.RemoveAll<IJobLeaseRepository>();
            services.AddScoped<IJobLeaseRepository, AlwaysGrantedLease>();
            services.Decorate<INotificationDeliveryRepository>(inner => new BlindToEarlierClaims(inner));
        }));
        await _host.RunAsync(SaoPaulo(18, 0));

        var late = await splitBrain.RunOnceAsync(SaoPaulo(18, 0));

        Assert.Equal((true, 1, 0, 0), (late.LeaseHeld, late.Planned, late.Claimed, late.Sent));
        Assert.Empty(otherSender.Sent);
        Assert.Single(_host.Sender.Sent);
        Assert.Single(await _host.DeliveriesAsync());
    }

    private static INotificationTick TickOf(WebApplicationFactory<Program> instance) => instance.Services.GetRequiredService<INotificationTick>();

    private async Task<PushSubscription> SeedDoseAtSixAsync()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(family.BabyId, family.OwnerId, "18:00");
        return await _host.SeedRecipientAsync(family.BabyId, family.OwnerId);
    }

    /// <summary>A lease that never refuses (split brain: two instances plan at once).</summary>
    private sealed class AlwaysGrantedLease : IJobLeaseRepository
    {
        public Task<bool> TryAcquireAsync(string name, string holderId, DateTimeOffset now, TimeSpan duration, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);
    }

    /// <summary>Plans as if the other instance's claims were not committed yet; everything else is the real repository.</summary>
    private sealed class BlindToEarlierClaims(INotificationDeliveryRepository inner) : INotificationDeliveryRepository
    {
        public Task<bool> TryClaimAsync(NotificationDelivery delivery, CancellationToken cancellationToken = default) => inner.TryClaimAsync(delivery, cancellationToken);

        public Task<NotificationDelivery?> FindAsync(Guid deliveryId, CancellationToken cancellationToken = default) => inner.FindAsync(deliveryId, cancellationToken);

        public Task<IReadOnlyList<NotificationDelivery>> ListPendingDueAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default) =>
            inner.ListPendingDueAsync(now, limit, cancellationToken);

        public Task<IReadOnlyList<DeliveredNotification>> ListClaimedKeysAsync(IReadOnlyCollection<Guid> userIds, DateTimeOffset createdSince, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<DeliveredNotification>>([]);

        public Task<int> CancelPendingForSubscriptionAsync(Guid subscriptionId, CancellationToken cancellationToken = default) =>
            inner.CancelPendingForSubscriptionAsync(subscriptionId, cancellationToken);

        public Task<int> CancelPendingResendsAsync(Guid userId, NotificationKey baseKey, CancellationToken cancellationToken = default) =>
            inner.CancelPendingResendsAsync(userId, baseKey, cancellationToken);

        public Task<int> DeleteCreatedBeforeAsync(DateTimeOffset createdBefore, CancellationToken cancellationToken = default) =>
            inner.DeleteCreatedBeforeAsync(createdBefore, cancellationToken);

        public Task SaveChangesAsync(CancellationToken cancellationToken = default) => inner.SaveChangesAsync(cancellationToken);
    }
}

internal static class ServiceCollectionDecorations
{
    /// <summary>Replaces the last registration of <typeparamref name="TService"/> with a scoped decorator around it.</summary>
    public static void Decorate<TService>(this IServiceCollection services, Func<TService, TService> decorate)
        where TService : class
    {
        var original = services.Last(descriptor => descriptor.ServiceType == typeof(TService));
        services.Remove(original);
        services.AddScoped(provider => decorate((TService)ActivatorUtilities.CreateInstance(provider, original.ImplementationType!)));
    }
}
