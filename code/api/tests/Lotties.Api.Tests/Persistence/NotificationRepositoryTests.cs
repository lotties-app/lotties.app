using Lotties.Api.Tests.Support;
using Lotties.Application.Notifications;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure;
using Lotties.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Persistence;

/// <summary>
/// The test API host with the push notification repositories registered (the API wires them in a later task); same
/// throw-away SQLite database as <see cref="ApiFactory"/>.
/// </summary>
public sealed class NotificationPersistenceHost : IDisposable
{
    public NotificationPersistenceHost()
    {
        Factory = new ApiFactory();
        Host = Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddNotificationPersistence()));
    }

    internal ApiFactory Factory { get; }

    internal WebApplicationFactory<Program> Host { get; }

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
    }
}

/// <summary>Push notification repositories against the SQLite test database (same unique indexes and foreign keys as PostgreSQL).</summary>
public sealed class NotificationRepositoryTests(NotificationPersistenceHost host) : IClassFixture<NotificationPersistenceHost>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;
    private static readonly DateTimeOffset LongAgo = new(2020, 3, 1, 12, 0, 0, TimeSpan.Zero);

    private ApiFactory Factory => host.Factory;

    [Fact]
    public async Task SubscriptionTryAddAsync_RoundTripsEndpointKeysAndLocale()
    {
        var userId = await NewUserAsync();
        var subscription = NewSubscription(userId, Now);

        Assert.True(await WithAsync<IPushSubscriptionRepository, bool>(repository => repository.TryAddAsync(subscription)));
        var stored = await WithAsync<IPushSubscriptionRepository, PushSubscription?>(repository => repository.FindByEndpointHashAsync(subscription.EndpointHash));

        Assert.Equal(subscription.Endpoint.Value, stored!.Endpoint.Value);
        Assert.Equal(subscription.Keys, stored.Keys);
        Assert.Equal("pt-BR", stored.Locale.Value);
        Assert.Equal(userId, stored.UserId);
    }

    [Fact]
    public async Task SubscriptionTryAddAsync_SameEndpointSavedFirst_ReturnsFalseAndKeepsOneRow()
    {
        var userId = await NewUserAsync();
        var endpoint = NewEndpoint();
        await WithAsync<IPushSubscriptionRepository, bool>(repository => repository.TryAddAsync(NewSubscription(userId, Now, endpoint)));

        var added = await WithAsync<IPushSubscriptionRepository, bool>(repository => repository.TryAddAsync(NewSubscription(userId, Now, endpoint)));

        Assert.False(added);
        Assert.Equal(1, await Factory.QueryAsync(context => context.PushSubscriptions.CountAsync(stored => stored.EndpointHash == endpoint.Hash)));
    }

    [Fact]
    public async Task ListActiveForUserAsync_SkipsRevokedAndOtherUsers()
    {
        var userId = await NewUserAsync();
        var active = NewSubscription(userId, Now);
        var revoked = NewSubscription(userId, Now);
        revoked.Revoke(SubscriptionRevokeReason.User, Now);
        await SeedAsync(active, revoked, NewSubscription(await NewUserAsync(), Now));

        var listed = await WithAsync<IPushSubscriptionRepository, IReadOnlyList<PushSubscription>>(repository => repository.ListActiveForUserAsync(userId));

        Assert.Equal([active.Id], listed.Select(subscription => subscription.Id));
    }

    [Fact]
    public async Task Housekeeping_RevokesInactiveAndExpiredKeepingFirstReasonThenDeletesOldRevokedWithDeliveries()
    {
        var userId = await NewUserAsync();
        var stale = NewSubscription(userId, LongAgo);
        var expired = NewSubscription(userId, LongAgo.AddYears(1), expiresAt: LongAgo.AddYears(1).AddDays(1));
        var alreadyRevoked = NewSubscription(userId, LongAgo);
        alreadyRevoked.Revoke(SubscriptionRevokeReason.User, LongAgo);
        var delivery = Claim(alreadyRevoked, NewDosePlan(userId, Guid.NewGuid(), LongAgo), LongAgo);
        await SeedAsync(stale, expired, alreadyRevoked);
        await SeedAsync(delivery);
        var revokedAt = LongAgo.AddYears(1).AddDays(2);

        await WithAsync<IPushSubscriptionRepository, int>(repository => repository.RevokeNotSeenSinceAsync(LongAgo.AddDays(1), revokedAt));
        await WithAsync<IPushSubscriptionRepository, int>(repository => repository.RevokeExpiredAsync(revokedAt));
        var states = await Factory.QueryAsync(context => context.PushSubscriptions.AsNoTracking()
            .Where(subscription => subscription.UserId == userId)
            .ToDictionaryAsync(subscription => subscription.Id, subscription => subscription.RevokedReason));
        var deleted = await WithAsync<IPushSubscriptionRepository, int>(repository => repository.DeleteRevokedBeforeAsync(LongAgo.AddDays(1)));

        Assert.Equal(SubscriptionRevokeReason.Inactive, states[stale.Id]);
        Assert.Equal(SubscriptionRevokeReason.Gone, states[expired.Id]);
        Assert.Equal(SubscriptionRevokeReason.User, states[alreadyRevoked.Id]);
        Assert.Equal(1, deleted);
        Assert.False(await Factory.QueryAsync(context => context.NotificationDeliveries.AnyAsync(stored => stored.Id == delivery.Id)));
        Assert.True(await Factory.QueryAsync(context => context.PushSubscriptions.AnyAsync(stored => stored.Id == stale.Id)));
    }

    [Fact]
    public async Task DeliveryTryClaimAsync_SameSubscriptionAndDedupeKey_SecondClaimLosesOtherSubscriptionWins()
    {
        var userId = await NewUserAsync();
        var phone = NewSubscription(userId, Now);
        var laptop = NewSubscription(userId, Now);
        await SeedAsync(phone, laptop);
        var planned = NewDosePlan(userId, Guid.NewGuid(), Now);

        var first = await WithAsync<INotificationDeliveryRepository, bool>(repository => repository.TryClaimAsync(Claim(phone, planned, Now)));
        var second = await WithAsync<INotificationDeliveryRepository, bool>(repository => repository.TryClaimAsync(Claim(phone, planned, Now)));
        var otherDevice = await WithAsync<INotificationDeliveryRepository, bool>(repository => repository.TryClaimAsync(Claim(laptop, planned, Now)));

        Assert.True(first);
        Assert.False(second);
        Assert.True(otherDevice);
        Assert.Equal(2, await Factory.QueryAsync(context => context.NotificationDeliveries.CountAsync(stored => stored.UserId == userId)));
    }

    [Fact]
    public async Task DeliveryRoundTrip_StoresCodesAndTokenHash()
    {
        var userId = await NewUserAsync();
        var subscription = NewSubscription(userId, Now);
        await SeedAsync(subscription);
        var delivery = Claim(subscription, NewDosePlan(userId, Guid.NewGuid(), Now), Now);
        await WithAsync<INotificationDeliveryRepository, bool>(repository => repository.TryClaimAsync(delivery));

        var stored = await WithAsync<INotificationDeliveryRepository, NotificationDelivery?>(repository => repository.FindAsync(delivery.Id));
        var status = await Factory.QueryAsync(context => context.Database
            .SqlQuery<string>($"SELECT status AS \"Value\" FROM notification_deliveries WHERE dedupe_key = {delivery.DedupeKey.Value}")
            .SingleAsync());

        Assert.Equal("pending", status);
        Assert.Equal(delivery.ActionTokenHash, stored!.ActionTokenHash);
        Assert.Equal(delivery.DedupeKey, stored.DedupeKey);
        Assert.Equal(NotificationKind.DoseDue, stored.Kind);
    }

    [Fact]
    public async Task ListPendingDueAsync_ReturnsPendingWhoseNextAttemptHasCome()
    {
        var userId = await NewUserAsync();
        var subscription = NewSubscription(userId, Now);
        await SeedAsync(subscription);
        var due = Claim(subscription, NewDosePlan(userId, Guid.NewGuid(), Now), Now);
        var later = Claim(subscription, NewDosePlan(userId, Guid.NewGuid(), Now), Now.AddMinutes(10));
        var sent = Claim(subscription, NewDosePlan(userId, Guid.NewGuid(), Now), Now);
        sent.RecordAttempt(201, null, Now);
        await SeedAsync(due, later, sent);

        var pending = await WithAsync<INotificationDeliveryRepository, IReadOnlyList<NotificationDelivery>>(repository => repository.ListPendingDueAsync(Now.AddMinutes(1), 100));

        Assert.Contains(pending, delivery => delivery.Id == due.Id);
        Assert.DoesNotContain(pending, delivery => delivery.Id == later.Id || delivery.Id == sent.Id);
    }

    [Fact]
    public async Task CancelPendingResendsAsync_CancelsOnlyTheUsersPendingSnoozeResends()
    {
        var userId = await NewUserAsync();
        var subscription = NewSubscription(userId, Now);
        await SeedAsync(subscription);
        var original = NewDosePlan(userId, Guid.NewGuid(), Now);
        var first = Claim(subscription, original, Now);
        var resend = Claim(subscription, original with { DedupeKey = original.BaseKey.Snoozed(1) }, Now);
        await SeedAsync(first, resend);

        var cancelled = await WithAsync<INotificationDeliveryRepository, int>(repository => repository.CancelPendingResendsAsync(userId, original.BaseKey));

        Assert.Equal(1, cancelled);
        Assert.Equal(DeliveryStatus.Pending, await StatusAsync(first.Id));
        Assert.Equal(DeliveryStatus.Cancelled, await StatusAsync(resend.Id));
    }

    [Fact]
    public async Task CancelPendingForSubscriptionAsync_CancelsPendingAndKeepsSent()
    {
        var userId = await NewUserAsync();
        var subscription = NewSubscription(userId, Now);
        await SeedAsync(subscription);
        var pending = Claim(subscription, NewDosePlan(userId, Guid.NewGuid(), Now), Now);
        var sent = Claim(subscription, NewDosePlan(userId, Guid.NewGuid(), Now), Now);
        sent.RecordAttempt(201, null, Now);
        await SeedAsync(pending, sent);

        await WithAsync<INotificationDeliveryRepository, int>(repository => repository.CancelPendingForSubscriptionAsync(subscription.Id));

        Assert.Equal(DeliveryStatus.Cancelled, await StatusAsync(pending.Id));
        Assert.Equal(DeliveryStatus.Sent, await StatusAsync(sent.Id));
    }

    [Fact]
    public async Task ListClaimedKeysAsync_ReturnsDistinctKeysPerUserSince()
    {
        var userId = await NewUserAsync();
        var phone = NewSubscription(userId, Now);
        var laptop = NewSubscription(userId, Now);
        await SeedAsync(phone, laptop);
        var planned = NewDosePlan(userId, Guid.NewGuid(), Now);
        await SeedAsync(Claim(phone, planned, Now), Claim(laptop, planned, Now), Claim(phone, NewDosePlan(userId, Guid.NewGuid(), Now), Now.AddDays(-3)));

        var claimed = await WithAsync<INotificationDeliveryRepository, IReadOnlyList<DeliveredNotification>>(repository => repository.ListClaimedKeysAsync([userId], Now.AddDays(-1)));

        Assert.Equal([new DeliveredNotification(userId, planned.DedupeKey)], claimed);
    }

    [Fact]
    public async Task ListSentHeadsUpsAsync_ReturnsSentOrPendingHeadsUpsOfTheKindsOncePerKey()
    {
        var userId = await NewUserAsync();
        var phone = NewSubscription(userId, Now);
        var laptop = NewSubscription(userId, Now);
        await SeedAsync(phone, laptop);
        var babyId = Guid.NewGuid();
        var wet = NewDiaperPlan(userId, babyId, NotificationKind.DiaperWetHeadsUp, Now.AddMinutes(-50));
        var sentOnPhone = Claim(phone, wet, Now.AddMinutes(-50));
        sentOnPhone.RecordAttempt(201, null, Now.AddMinutes(-49));
        var failedOnLaptop = Claim(laptop, wet, Now.AddMinutes(-50));
        failedOnLaptop.RecordAttempt(413, null, Now.AddMinutes(-49));
        var dirtyPending = Claim(phone, NewDiaperPlan(userId, babyId, NotificationKind.DiaperDirtyHeadsUp, Now.AddMinutes(-5)), Now.AddMinutes(-5));
        var dirtyFailed = Claim(phone, NewDiaperPlan(userId, babyId, NotificationKind.DiaperDirtyHeadsUp, Now.AddMinutes(-20)), Now.AddMinutes(-20));
        dirtyFailed.RecordAttempt(413, null, Now.AddMinutes(-20));
        await SeedAsync(sentOnPhone, failedOnLaptop, dirtyPending, dirtyFailed, Claim(phone, NewDosePlan(userId, babyId, Now), Now));

        var sent = await WithAsync<INotificationDeliveryRepository, IReadOnlyList<SentHeadsUp>>(repository =>
            repository.ListSentHeadsUpsAsync([userId], [NotificationKind.DiaperWetHeadsUp, NotificationKind.DiaperDirtyHeadsUp], Now.AddDays(-1)));

        Assert.Equal(
            [(NotificationKind.DiaperDirtyHeadsUp, Now.AddMinutes(-5)), (NotificationKind.DiaperWetHeadsUp, Now.AddMinutes(-49))],
            sent.OrderBy(headsUp => headsUp.At).Reverse().Select(headsUp => (headsUp.Kind, headsUp.At)));
        Assert.All(sent, headsUp => Assert.Equal((userId, babyId), (headsUp.UserId, headsUp.BabyId)));
    }

    [Fact]
    public async Task ListCandidatesAsync_ReturnsOwnersAndParentsWithAKindOnAndAnActiveSubscription()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        var parentId = await UserIdAsync(baby.SubjectOf(BabyRole.Parent));
        var viewerId = await UserIdAsync(baby.SubjectOf(BabyRole.Viewer));
        var revokedOnly = NewSubscription(parentId, Now);
        revokedOnly.Revoke(SubscriptionRevokeReason.Gone, Now);
        await SeedAsync(NewSubscription(ownerId, Now), NewSubscription(viewerId, Now), revokedOnly);
        await SeedAsync(
            Preferences(baby.BabyId, ownerId, doseDue: true),
            Preferences(baby.BabyId, parentId, doseDue: true),
            Preferences(baby.BabyId, viewerId, doseDue: true));

        var candidates = await WithAsync<IBabyNotificationPreferencesRepository, IReadOnlyList<NotificationCandidate>>(repository => repository.ListCandidatesAsync(Now));

        var forBaby = candidates.Where(candidate => candidate.BabyId == baby.BabyId).ToArray();
        Assert.Equal([ownerId], forBaby.Select(candidate => candidate.UserId));
        Assert.Equal(BabyRole.Owner, forBaby[0].Role);
        Assert.True(forBaby[0].Preferences.DoseDue);
    }

    [Fact]
    public async Task ListCandidatesAsync_AllKindsOff_IsNotACandidate()
    {
        var baby = await Factory.SeedBabyAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        await SeedAsync(NewSubscription(ownerId, Now));
        await SeedAsync(Preferences(baby.BabyId, ownerId, doseDue: false));

        var candidates = await WithAsync<IBabyNotificationPreferencesRepository, IReadOnlyList<NotificationCandidate>>(repository => repository.ListCandidatesAsync(Now));

        Assert.DoesNotContain(candidates, candidate => candidate.BabyId == baby.BabyId);
    }

    [Fact]
    public async Task Preferences_MemberRemoved_AreDeletedWithTheMembership()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        var parentId = await UserIdAsync(baby.SubjectOf(BabyRole.Parent));
        await WithAsync<IBabyNotificationPreferencesRepository, bool>(repository => repository.TryAddAsync(Preferences(baby.BabyId, parentId, doseDue: true)));

        await Factory.SeedAsync(async context => (await context.BabyAsync(baby.BabyId)).RemoveMember(parentId));

        Assert.False(await Factory.QueryAsync(context => context.BabyNotificationPreferences.AnyAsync(stored => stored.BabyId == baby.BabyId && stored.UserId == parentId)));
    }

    [Fact]
    public async Task PreferencesTryAddAsync_NotAMember_Throws()
    {
        var baby = await Factory.SeedBabyAsync();

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            WithAsync<IBabyNotificationPreferencesRepository, bool>(repository => repository.TryAddAsync(Preferences(baby.BabyId, Guid.NewGuid(), doseDue: true))));
    }

    [Fact]
    public async Task PreferencesTryAddAsync_SavedFirst_ReturnsFalse()
    {
        var baby = await Factory.SeedBabyAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        await WithAsync<IBabyNotificationPreferencesRepository, bool>(repository => repository.TryAddAsync(Preferences(baby.BabyId, ownerId, doseDue: true)));

        Assert.False(await WithAsync<IBabyNotificationPreferencesRepository, bool>(repository => repository.TryAddAsync(Preferences(baby.BabyId, ownerId, doseDue: false))));
    }

    [Fact]
    public async Task SettingsTryAddAsync_RoundTripsZoneAndQuietHoursAndLosesToFirstSave()
    {
        var userId = await NewUserAsync();
        var terms = new NotificationSettingsTerms(NotificationTimeZone.From("America/Sao_Paulo"), QuietHours.Create(true, new TimeOnly(21, 30), new TimeOnly(6, 45)), true, false);

        var first = await WithAsync<IUserNotificationSettingsRepository, bool>(repository => repository.TryAddAsync(UserNotificationSettings.Create(userId, terms, Now)));
        var second = await WithAsync<IUserNotificationSettingsRepository, bool>(repository => repository.TryAddAsync(UserNotificationSettings.Create(userId, terms, Now)));
        var stored = await WithAsync<IUserNotificationSettingsRepository, IReadOnlyList<UserNotificationSettings>>(repository => repository.ListForUsersAsync([userId]));

        Assert.True(first);
        Assert.False(second);
        Assert.Equal(terms, stored.Single().Terms);
    }

    [Fact]
    public async Task Actions_FindListAndPurgeByLastChange()
    {
        var userId = await NewUserAsync();
        var babyId = Guid.NewGuid();
        var recent = NotificationAction.Snooze(userId, babyId, NotificationKey.ForDose(Guid.NewGuid(), Now), Now);
        var old = NotificationAction.Dismiss(userId, babyId, NotificationKey.ForNap(babyId, LongAgo), LongAgo);
        await WithAsync<INotificationActionRepository, bool>(repository => repository.TryAddAsync(recent));
        await WithAsync<INotificationActionRepository, bool>(repository => repository.TryAddAsync(old));

        var duplicate = await WithAsync<INotificationActionRepository, bool>(repository => repository.TryAddAsync(NotificationAction.Dismiss(userId, babyId, recent.BaseKey, Now)));
        var found = await WithAsync<INotificationActionRepository, NotificationAction?>(repository => repository.FindAsync(userId, recent.BaseKey));
        await WithAsync<INotificationActionRepository, int>(repository => repository.DeleteUpdatedBeforeAsync(LongAgo.AddDays(1)));
        var listed = await WithAsync<INotificationActionRepository, IReadOnlyList<NotificationAction>>(repository => repository.ListForBabyAsync(babyId, [userId]));

        Assert.False(duplicate);
        Assert.Equal(NotificationActionKind.Snoozed, found!.Action);
        Assert.Equal(1, found.SnoozeCount);
        Assert.Equal([recent.BaseKey], listed.Select(action => action.BaseKey));
    }

    [Fact]
    public async Task LeaseTryAcquireAsync_FreeHeldRenewedThenTakenAfterExpiry()
    {
        var name = NewLeaseName();
        var duration = TimeSpan.FromMinutes(2);

        var created = await AcquireAsync(name, "instance-a", Now, duration);
        var blocked = await AcquireAsync(name, "instance-b", Now.AddMinutes(1), duration);
        var renewed = await AcquireAsync(name, "instance-a", Now.AddMinutes(1), duration);
        var stillBlocked = await AcquireAsync(name, "instance-b", Now.AddMinutes(2), duration);
        var taken = await AcquireAsync(name, "instance-b", Now.AddMinutes(3), duration);
        var stored = await Factory.QueryAsync(context => context.JobLeases.AsNoTracking().SingleAsync(lease => lease.Name == name));

        Assert.Equal(new[] { true, false, true, false, true }, new[] { created, blocked, renewed, stillBlocked, taken });
        Assert.Equal("instance-b", stored.HolderId);
        Assert.Equal(Now.AddMinutes(5), stored.LeaseUntil);
    }

    [Fact]
    public async Task LeaseTryAcquireAsync_AnotherInstanceTookTheExpiredLeaseAfterItWasRead_Loses()
    {
        var name = NewLeaseName();
        var duration = TimeSpan.FromMinutes(2);
        await AcquireAsync(name, "instance-a", Now, duration);
        await using var scope = host.Host.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        await context.JobLeases.SingleAsync(lease => lease.Name == name);
        await Factory.SeedAsync(async competing =>
        {
            var lease = await competing.JobLeases.SingleAsync(stored => stored.Name == name);
            lease.TryAcquire("instance-c", Now.AddMinutes(5), duration);
            competing.BumpRowVersion(lease);
        });

        var acquired = await scope.ServiceProvider.GetRequiredService<IJobLeaseRepository>().TryAcquireAsync(name, "instance-b", Now.AddMinutes(5), duration);
        var retried = await scope.ServiceProvider.GetRequiredService<IJobLeaseRepository>().TryAcquireAsync(name, "instance-b", Now.AddMinutes(5), duration);

        Assert.False(acquired);
        Assert.False(retried);
        Assert.Equal("instance-c", await Factory.QueryAsync(competing => competing.JobLeases.Where(lease => lease.Name == name).Select(lease => lease.HolderId).SingleAsync()));
    }

    private static string NewLeaseName() => $"test-{Guid.NewGuid():N}";

    private Task<bool> AcquireAsync(string name, string holderId, DateTimeOffset now, TimeSpan duration) =>
        WithAsync<IJobLeaseRepository, bool>(repository => repository.TryAcquireAsync(name, holderId, now, duration));

    private async Task<TResult> WithAsync<TRepository, TResult>(Func<TRepository, Task<TResult>> action)
        where TRepository : notnull
    {
        await using var scope = host.Host.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<TRepository>());
    }

    private Task SeedAsync(params object[] entities) =>
        Factory.SeedAsync(context =>
        {
            context.AddRange(entities);
            return Task.CompletedTask;
        });

    private async Task<DeliveryStatus> StatusAsync(Guid deliveryId) =>
        await Factory.QueryAsync(context => context.NotificationDeliveries.Where(delivery => delivery.Id == deliveryId).Select(delivery => delivery.Status).SingleAsync());

    private async Task<Guid> NewUserAsync()
    {
        var baby = await Factory.SeedBabyAsync();
        return await UserIdAsync(baby.OwnerSubject);
    }

    private Task<Guid> UserIdAsync(string subject) =>
        Factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).Select(user => user.Id).SingleAsync());

    private static PushEndpoint NewEndpoint() => PushEndpoint.From($"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}");

    private static PushSubscription NewSubscription(Guid userId, DateTimeOffset now, PushEndpoint? endpoint = null, DateTimeOffset? expiresAt = null) =>
        PushSubscription.Create(userId, endpoint ?? NewEndpoint(), TestKeys, NotificationLocale.FromOrDefault("pt-br"), "Chrome on Android", expiresAt, now);

    private static readonly PushKeys TestKeys = PushKeys.Create(
        Base64Url([0x04, .. Enumerable.Range(1, 64).Select(value => (byte)value)]),
        Base64Url(Enumerable.Range(100, 16).Select(value => (byte)value).ToArray()));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static PlannedNotification NewDosePlan(Guid userId, Guid babyId, DateTimeOffset slot)
    {
        var prescriptionId = Guid.NewGuid();
        var key = NotificationKey.ForDose(prescriptionId, slot);
        return new PlannedNotification(
            userId,
            NotificationKind.DoseDue,
            babyId,
            key,
            key,
            slot,
            NotificationRules.DoseTimeToLive,
            NotificationUrgency.High,
            new NotificationContent(babyId, prescriptionId, slot, null));
    }

    private static PlannedNotification NewDiaperPlan(Guid userId, Guid babyId, NotificationKind kind, DateTimeOffset dueAt)
    {
        var key = kind == NotificationKind.DiaperWetHeadsUp ? NotificationKey.ForDiaperWet(babyId, dueAt.AddHours(-2)) : NotificationKey.ForDiaperDirty(babyId, dueAt.AddHours(-1));
        return new PlannedNotification(userId, kind, babyId, key, key, dueAt, TimeSpan.FromMinutes(40), NotificationUrgency.Normal, new NotificationContent(babyId, null, dueAt.AddMinutes(10), null));
    }

    private static NotificationDelivery Claim(PushSubscription subscription, PlannedNotification planned, DateTimeOffset now) =>
        NotificationDelivery.Claim(Guid.NewGuid(), subscription.Id, planned, now).Delivery;

    private static BabyNotificationPreferences Preferences(Guid babyId, Guid userId, bool doseDue) =>
        BabyNotificationPreferences.Create(babyId, userId, ReminderPreferences.Create(doseDue, 5, false, 10), Now);
}
