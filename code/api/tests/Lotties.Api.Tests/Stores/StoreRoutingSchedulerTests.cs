using Lotties.Api.Tests.Notifications;
using Lotties.Api.Tests.Support;
using Lotties.Application.Notifications;
using Lotties.Application.Notifications.Dispatching;
using Lotties.Application.Stores;
using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Stores;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// Push reminders are not available for a baby whose records are in a family's own database in the first version
/// (docs/design/47-bring-your-own-database.md D9 and section 2.2, task T11). The push scheduler decides that by the baby's store
/// pointer in the control plane before any data-plane read: such a baby is never a candidate, and one that is (it moved after the
/// candidates were read) is skipped by its pointer. Its store is never opened: the external stores here throw on any attempt and
/// count it. Babies on the built-in store get their reminders as before.
/// </summary>
public sealed class StoreRoutingSchedulerTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();
    private readonly ThrowingDataStores _stores = new();
    private readonly ScriptedPushSender _sender = new();
    private readonly WebApplicationFactory<Program> _routed;

    public StoreRoutingSchedulerTests()
    {
        _routed = _host.AddInstance(_sender, RouteToThrowingStores);
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task RunOnceAsync_BabyOnAnExternalStore_GetsNoReminderAndItsStoreIsNeverOpened()
    {
        var hosted = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(hosted.BabyId, hosted.OwnerId, "18:00");
        var hostedPhone = await _host.SeedRecipientAsync(hosted.BabyId, hosted.OwnerId);
        var external = await _host.SeedFamilyAsync(BabyRole.Parent);
        await _host.SeedPrescriptionAsync(external.BabyId, external.OwnerId, "18:00");
        await SeedAppointmentTomorrowAsync(external);
        var externalPhone = await _host.SeedRecipientAsync(external.BabyId, external.OwnerId);
        await _host.SeedSettingsAsync(external.UserOf(BabyRole.Parent), "America/Sao_Paulo");
        var parentPhone = await _host.SeedSubscriptionAsync(external.UserOf(BabyRole.Parent));
        await AssignAsync(external);

        var result = await _routed.Services.GetRequiredService<INotificationTick>().RunOnceAsync(SaoPaulo(18, 0));

        Assert.Equal(1, result.Planned);
        Assert.Contains(_sender.Sent, push => push.IsFor(hostedPhone));
        Assert.DoesNotContain(_sender.Sent, push => push.IsFor(externalPhone) || push.IsFor(parentPhone));
        Assert.Equal(0, _stores.Attempts);
    }

    [Fact]
    public async Task RunOnceAsync_FlagOff_SkipsABabyOnAnExternalStoreEvenWithItsOldRowsInTheBuiltInDatabase()
    {
        var hosted = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(hosted.BabyId, hosted.OwnerId, "18:00");
        var hostedPhone = await _host.SeedRecipientAsync(hosted.BabyId, hosted.OwnerId);
        var external = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(external.BabyId, external.OwnerId, "18:00");
        await AssignAsync(external);
        var externalPhone = await _host.SeedRecipientAsync(external.BabyId, external.OwnerId);

        var result = await _host.RunAsync(SaoPaulo(18, 0));

        Assert.Equal(1, result.Planned);
        Assert.Contains(_host.Sender.Sent, push => push.IsFor(hostedPhone));
        Assert.DoesNotContain(_host.Sender.Sent, push => push.IsFor(externalPhone));
    }

    [Fact]
    public async Task RunOnceAsync_CandidateWhoseBabyMovedAfterTheCandidatesWereRead_IsSkippedByItsPointerWithoutOpeningTheStore()
    {
        var hosted = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(hosted.BabyId, hosted.OwnerId, "18:00");
        var hostedPhone = await _host.SeedRecipientAsync(hosted.BabyId, hosted.OwnerId);
        var moved = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(moved.BabyId, moved.OwnerId, "18:00");
        var movedPhone = await _host.SeedRecipientAsync(moved.BabyId, moved.OwnerId);
        await AssignAsync(moved);
        var stale = new NotificationCandidate(moved.BabyId, moved.OwnerId, BabyRole.Owner, ReminderPreferences.Default);
        var sender = new ScriptedPushSender();
        var racing = _host.AddInstance(sender, services =>
        {
            RouteToThrowingStores(services);
            services.AddStaleCandidate(stale);
        });

        var result = await racing.Services.GetRequiredService<INotificationTick>().RunOnceAsync(SaoPaulo(18, 0));

        Assert.Equal(1, result.Planned);
        Assert.Contains(sender.Sent, push => push.IsFor(hostedPhone));
        Assert.DoesNotContain(sender.Sent, push => push.IsFor(movedPhone));
        Assert.Equal(0, _stores.Attempts);
    }

    private void RouteToThrowingStores(IServiceCollection services)
    {
        services.Configure<StoreRoutingOptions>(options => options.Enabled = true);
        services.AddSingleton<IExternalDataStores>(_stores);
        services.AddSingleton<IStoreMigrator>(_stores);
    }

    private Task AssignAsync(Family family) => _host.Factory.AssignStoreAsync(family.BabyId, family.OwnerId, Guid.NewGuid());

    /// <summary>An upcoming appointment tomorrow: makes every member without stored preferences a default candidate.</summary>
    private Task SeedAppointmentTomorrowAsync(Family family)
    {
        var terms = AppointmentTerms.Create("Checkup", AppointmentType.Consultation, SaoPaulo(18, 0).AddDays(1), 30, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.Default);
        return _host.SeedAsync(Appointment.Create(Guid.NewGuid(), family.BabyId, terms, family.OwnerId, SaoPaulo(9)));
    }
}

/// <summary>
/// External stores that must never be opened: every lookup or migration attempt is counted and throws. The scheduler catches a
/// failing baby, so the count, not an exception, is what a test asserts.
/// </summary>
internal sealed class ThrowingDataStores : IExternalDataStores, IStoreMigrator
{
    private int _attempts;

    public int Attempts => Volatile.Read(ref _attempts);

    public ValueTask<IDataStore?> FindAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        ValueTask.FromException<IDataStore?>(Attempt());

    public Task EnsureReadyAsync(Guid storeId, CancellationToken cancellationToken = default) =>
        Task.FromException(Attempt());

    private InvalidOperationException Attempt()
    {
        Interlocked.Increment(ref _attempts);
        return new InvalidOperationException("An external store was opened.");
    }
}

/// <summary>Adds a stale candidate to what the real candidates query answers, as if the baby moved right after the query ran.</summary>
internal static class StaleCandidates
{
    public static void AddStaleCandidate(this IServiceCollection services, NotificationCandidate stale)
    {
        var real = services.Last(descriptor => descriptor.ServiceType == typeof(IBabyNotificationPreferencesRepository)).ImplementationType!;
        services.RemoveAll<IBabyNotificationPreferencesRepository>();
        services.AddScoped<IBabyNotificationPreferencesRepository>(provider =>
            new WithStaleCandidate((IBabyNotificationPreferencesRepository)ActivatorUtilities.CreateInstance(provider, real), stale));
    }

    private sealed class WithStaleCandidate(IBabyNotificationPreferencesRepository inner, NotificationCandidate stale) : IBabyNotificationPreferencesRepository
    {
        public Task<BabyNotificationPreferences?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
            inner.FindAsync(babyId, userId, cancellationToken);

        public Task<IReadOnlyList<BabyNotificationPreferences>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
            inner.ListForUserAsync(userId, cancellationToken);

        public async Task<IReadOnlyList<NotificationCandidate>> ListCandidatesAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            var candidates = await inner.ListCandidatesAsync(now, cancellationToken);
            Assert.DoesNotContain(candidates, candidate => candidate.BabyId == stale.BabyId);
            return [.. candidates, stale];
        }

        public Task<bool> TryAddAsync(BabyNotificationPreferences preferences, CancellationToken cancellationToken = default) =>
            inner.TryAddAsync(preferences, cancellationToken);

        public Task SaveChangesAsync(CancellationToken cancellationToken = default) => inner.SaveChangesAsync(cancellationToken);
    }
}
