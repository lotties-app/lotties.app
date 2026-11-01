using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Notifications.Dispatching;
using Lotties.Application.Push;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Medications;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using Lotties.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Api.Tests.Notifications;

/// <summary>A push the fake sender received, with its parsed payload.</summary>
internal sealed record SentPush(PushTarget Target, PushMessage Message)
{
    public JsonElement Payload => JsonDocument.Parse(Message.Payload).RootElement;

    public bool IsFor(PushSubscription subscription) => Target.Endpoint.Hash == subscription.EndpointHash;
}

/// <summary>Records every send and answers with <see cref="Responder"/> (201 by default); thread-safe.</summary>
internal sealed class ScriptedPushSender : IPushSender
{
    private readonly object _gate = new();
    private readonly List<SentPush> _sent = [];

    /// <summary>The answer for each send; may throw to inject a sender failure.</summary>
    public Func<SentPush, PushSendResult> Responder { get; set; } = _ => PushSendResult.FromStatusCode(201);

    public IReadOnlyList<SentPush> Sent
    {
        get
        {
            lock (_gate)
            {
                return _sent.ToArray();
            }
        }
    }

    public Task<PushSendResult> SendAsync(PushTarget target, PushMessage message, CancellationToken cancellationToken = default)
    {
        var push = new SentPush(target, message);
        lock (_gate)
        {
            _sent.Add(push);
        }

        return Task.FromResult(Responder(push));
    }
}

/// <summary>
/// The test API host with the push scheduler registered and a <see cref="ScriptedPushSender"/>, on a throw-away SQLite
/// database of its own (one per test, so the scheduler lease and candidates never leak between tests). Push is not
/// configured, so the background service does not run: tests drive <see cref="INotificationTick.RunOnceAsync"/>.
/// Further instances (<see cref="AddInstance"/>) share the database, like API replicas.
/// </summary>
internal sealed class SchedulerTestHost : IDisposable
{
    /// <summary>A São Paulo (UTC-3, no daylight saving time) wall-clock time on 2026-01-10.</summary>
    public static DateTimeOffset SaoPaulo(int hour, int minute = 0) => new(2026, 1, 10, hour, minute, 0, TimeSpan.FromHours(-3));

    private readonly List<WebApplicationFactory<Program>> _instances = [];

    public SchedulerTestHost()
    {
        Factory = new ApiFactory();
        Sender = new ScriptedPushSender();
        Host = AddInstance(Sender);
    }

    public ApiFactory Factory { get; }

    public ScriptedPushSender Sender { get; }

    public WebApplicationFactory<Program> Host { get; }

    public INotificationTick Tick => Host.Services.GetRequiredService<INotificationTick>();

    /// <summary>Another API instance on the same database with its own sender, lease holder id and optional overrides.</summary>
    public WebApplicationFactory<Program> AddInstance(ScriptedPushSender sender, Action<IServiceCollection>? configure = null)
    {
        var instance = Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddNotificationPersistence();
            services.AddNotificationScheduler();
            services.RemoveAll<IPushSender>();
            services.AddSingleton<IPushSender>(sender);
            configure?.Invoke(services);
        }));
        _instances.Add(instance);
        return instance;
    }

    public Task<NotificationTickResult> RunAsync(DateTimeOffset now) => Tick.RunOnceAsync(now);

    public async Task<Family> SeedFamilyAsync(params BabyRole[] memberRoles)
    {
        var baby = await Factory.SeedBabyAsync(memberRoles);
        var owner = await Factory.UserIdAsync(baby.OwnerSubject);
        var members = new Dictionary<BabyRole, Guid>();
        foreach (var role in memberRoles)
        {
            members[role] = await Factory.UserIdAsync(baby.SubjectOf(role));
        }

        return new Family(baby.BabyId, owner, members);
    }

    /// <summary>A scheduled prescription at <paramref name="times"/> (local times of day) of a new medication, started 2026-01-01.</summary>
    public async Task<SeededPrescription> SeedPrescriptionAsync(Guid babyId, Guid userId, params string[] times)
    {
        var created = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var medication = Medication.Create(babyId, "Simeticona", null, null, false, created);
        var schedule = PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(times), null, null, null, null);
        var terms = PrescriptionTerms.Create(medication.Id, PrescriptionStatus.Active, DoseRule.Create(2, "drops", perKg: false, roundingStep: null), schedule, null, new DateOnly(2026, 1, 1), null, null, null);
        var prescription = Prescription.Create(Guid.NewGuid(), babyId, terms, userId, created);
        await SeedAsync(medication);
        await SeedAsync(prescription);
        return new SeededPrescription(medication.Id, prescription.Id);
    }

    public Task SeedDoseAsync(Guid babyId, Guid userId, Guid medicationId, DateTimeOffset givenAt)
    {
        var payload = EventPayload.From($$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Simeticona"}]}""");
        return SeedAsync(Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.MedicationId, userId, givenAt, givenAt, payload, null, givenAt));
    }

    public async Task<PushSubscription> SeedSubscriptionAsync(Guid userId, DateTimeOffset? expiresAt = null)
    {
        var subscription = PushSubscription.Create(
            userId,
            PushEndpoint.From($"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}"),
            Keys,
            NotificationLocale.FromOrDefault("pt-BR"),
            "Chrome on Android",
            expiresAt,
            TestUsers.Now);
        await SeedAsync(subscription);
        return subscription;
    }

    public Task SeedSettingsAsync(Guid userId, string timeZone, QuietHours? quietHours = null, bool quietIncludesMedicine = false, bool showNames = false) =>
        SeedAsync(UserNotificationSettings.Create(
            userId,
            new NotificationSettingsTerms(NotificationTimeZone.From(timeZone), quietHours ?? QuietHours.Default, quietIncludesMedicine, showNames),
            TestUsers.Now));

    public Task SeedPreferencesAsync(
        Guid babyId,
        Guid userId,
        bool doseDue = true,
        int doseLead = 0,
        bool napWindow = false,
        int napLead = 10,
        bool bellyPainPattern = false,
        bool overtiredWarning = false,
        bool fussyPattern = false,
        bool diaperWet = false,
        bool diaperDirty = false,
        bool appointmentReminders = true,
        bool doctorSuggestions = false,
        bool vaccineReminders = false) =>
        SeedAsync(BabyNotificationPreferences.Create(
            babyId,
            userId,
            ReminderPreferences.Create(doseDue, doseLead, napWindow, napLead, bellyPainPattern, overtiredWarning, fussyPattern, diaperWet, diaperDirty, appointmentReminders, doctorSuggestions, vaccineReminders),
            TestUsers.Now));

    /// <summary>An instant event of a built-in type (e.g. belly pain with intensity 3, or a finished belly massage).</summary>
    public Task SeedEventAsync(Guid babyId, Guid userId, Guid typeId, DateTimeOffset startedAt, string payload = "{}") =>
        SeedAsync(Event.Create(Guid.NewGuid(), babyId, typeId, userId, startedAt, startedAt, EventPayload.From(payload), null, startedAt));

    /// <summary>A timed event of a built-in type from <paramref name="startedAt"/> to <paramref name="endedAt"/> (<c>null</c> = running), e.g. a nap.</summary>
    public Task SeedTimedEventAsync(Guid babyId, Guid userId, Guid typeId, DateTimeOffset startedAt, DateTimeOffset? endedAt, string payload = "{}") =>
        SeedAsync(Event.Create(Guid.NewGuid(), babyId, typeId, userId, startedAt, endedAt, EventPayload.From(payload), null, startedAt));

    /// <summary>An opted-in recipient: São Paulo zone unless given, dose reminders on, one device.</summary>
    public async Task<PushSubscription> SeedRecipientAsync(Guid babyId, Guid userId, string timeZone = "America/Sao_Paulo", int doseLead = 0, bool quietIncludesMedicine = false, QuietHours? quietHours = null, bool showNames = false)
    {
        await SeedSettingsAsync(userId, timeZone, quietHours, quietIncludesMedicine, showNames);
        await SeedPreferencesAsync(babyId, userId, doseLead: doseLead);
        return await SeedSubscriptionAsync(userId);
    }

    public Task SeedAsync(params object[] entities) =>
        Factory.SeedAsync(context =>
        {
            context.AddRange(entities);
            return Task.CompletedTask;
        });

    public Task<NotificationDelivery[]> DeliveriesAsync() =>
        Factory.QueryAsync(context => context.NotificationDeliveries.AsNoTracking().ToArrayAsync());

    public Task<PushSubscription> SubscriptionAsync(Guid subscriptionId) =>
        Factory.QueryAsync(context => context.PushSubscriptions.AsNoTracking().SingleAsync(subscription => subscription.Id == subscriptionId));

    public void Dispose()
    {
        _instances.ForEach(instance => instance.Dispose());
        Factory.Dispose();
    }

    private static readonly PushKeys Keys = PushKeys.Create(
        Base64Url([0x04, .. Enumerable.Range(1, 64).Select(value => (byte)value)]),
        Base64Url(Enumerable.Range(100, 16).Select(value => (byte)value).ToArray()));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

internal sealed record Family(Guid BabyId, Guid OwnerId, IReadOnlyDictionary<BabyRole, Guid> Members)
{
    public Guid UserOf(BabyRole role) => role == BabyRole.Owner ? OwnerId : Members[role];
}

internal sealed record SeededPrescription(Guid MedicationId, Guid PrescriptionId)
{
    /// <summary>The base key of the dose slot at <paramref name="slot"/>.</summary>
    public NotificationKey KeyAt(DateTimeOffset slot) => NotificationKey.ForDose(PrescriptionId, slot);
}
