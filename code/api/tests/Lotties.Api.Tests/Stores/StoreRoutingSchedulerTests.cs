using Lotties.Api.Tests.Notifications;
using Lotties.Api.Tests.Support;
using Lotties.Application.Notifications.Dispatching;
using Lotties.Domain.Medications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// The push scheduler is a job, not a request: its planning pass enters each candidate baby in the tick's store scope itself
/// (docs/design/47-bring-your-own-database.md section 2.2, task T2). A baby on an external store is planned from that store; a baby
/// whose store cannot be opened is skipped, never planned from what the built-in database still holds; the others are planned.
/// </summary>
public sealed class StoreRoutingSchedulerTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();
    private readonly SqliteDataStores _stores = new();
    private readonly ScriptedPushSender _sender = new();
    private readonly WebApplicationFactory<Program> _routed;

    public StoreRoutingSchedulerTests()
    {
        _routed = _host.AddInstance(_sender, services =>
        {
            services.Configure<StoreRoutingOptions>(options => options.Enabled = true);
            services.AddSingleton<IExternalDataStores>(_stores);
        });
    }

    public void Dispose()
    {
        _host.Dispose();
        _stores.Dispose();
    }

    [Fact]
    public async Task RunOnceAsync_PlansEachBabyFromItsOwnStoreAndSkipsAStoreThatCannotBeOpened()
    {
        var hosted = await _host.SeedFamilyAsync();
        await _host.SeedPrescriptionAsync(hosted.BabyId, hosted.OwnerId, "18:00");
        var hostedPhone = await _host.SeedRecipientAsync(hosted.BabyId, hosted.OwnerId);
        var external = await _host.SeedFamilyAsync();
        var storeId = _stores.Create();
        await AssignAsync(external, storeId);
        await SeedPrescriptionInStoreAsync(storeId, external);
        var externalPhone = await _host.SeedRecipientAsync(external.BabyId, external.OwnerId);
        var unreachable = await _host.SeedFamilyAsync();
        await AssignAsync(unreachable, Guid.NewGuid());
        await _host.SeedPrescriptionAsync(unreachable.BabyId, unreachable.OwnerId, "18:00");
        var unreachablePhone = await _host.SeedRecipientAsync(unreachable.BabyId, unreachable.OwnerId);

        var result = await _routed.Services.GetRequiredService<INotificationTick>().RunOnceAsync(SaoPaulo(18, 0));

        Assert.Equal(2, result.Planned);
        Assert.Contains(_sender.Sent, push => push.IsFor(hostedPhone));
        Assert.Contains(_sender.Sent, push => push.IsFor(externalPhone));
        Assert.DoesNotContain(_sender.Sent, push => push.IsFor(unreachablePhone));
    }

    /// <summary>A store row of the family's Owner and the baby's pointer to it.</summary>
    private Task AssignAsync(Family family, Guid storeId) =>
        _host.Factory.SeedAsync(async context =>
        {
            context.DataStores.Add(DataStore.Create(storeId, family.OwnerId, TestUsers.Now));
            var assignment = await context.BabyStoreAssignments.SingleAsync(row => row.BabyId == family.BabyId);
            assignment.MoveTo(DataStoreKey.External(storeId));
        });

    /// <summary>A scheduled 18:00 prescription written into the family's own store only.</summary>
    private Task SeedPrescriptionInStoreAsync(Guid storeId, Family family)
    {
        var created = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var medication = Medication.Create(family.BabyId, "Simeticona", null, null, false, created);
        var schedule = PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["18:00"]), null, null, null, null);
        var terms = PrescriptionTerms.Create(medication.Id, PrescriptionStatus.Active, DoseRule.Create(2, "drops", perKg: false, roundingStep: null), schedule, null, new DateOnly(2026, 1, 1), null, null, null);
        var prescription = Prescription.Create(Guid.NewGuid(), family.BabyId, terms, family.OwnerId, created);
        return _stores.QueryAsync(storeId, async context =>
        {
            context.Medications.Add(medication);
            context.Prescriptions.Add(prescription);
            return await context.SaveChangesAsync();
        });
    }
}
