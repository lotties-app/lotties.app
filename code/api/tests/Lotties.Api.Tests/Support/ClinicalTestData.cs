using System.Runtime.CompilerServices;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Shared data of the doctor dashboard tests. The server clock is fixed at <see cref="TestUsers.Now"/> (2026-01-10 12:00 UTC),
/// which is 09:00 on 2026-01-10 in São Paulo (UTC-3, no daylight saving): the tests ask for <see cref="ZoneQuery"/> and
/// <see cref="Local"/> turns a São Paulo wall-clock time into the instant that is stored.
/// </summary>
internal static class ClinicalTestData
{
    public const string ZoneQuery = "timeZone=America/Sao_Paulo&utcOffsetMinutes=-180";

    private static readonly TimeSpan SaoPaulo = TimeSpan.FromHours(-3);

    public static readonly Guid AptamilId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static readonly ConditionalWeakTable<ApiFactory, WebApplicationFactory<Program>> FixedClockHosts = new();

    /// <summary>
    /// A host that shares the factory's database and has the clock fixed at <see cref="TestUsers.Now"/>. One per factory (that is,
    /// per test class): starting a host for every test would dominate the run time. The factory disposes it with itself.
    /// </summary>
    public static WebApplicationFactory<Program> WithFixedClock(this ApiFactory factory) =>
        FixedClockHosts.GetValue(factory, owner => owner.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(TestUsers.Now)))));

    public static HttpClient ClientFor(this WebApplicationFactory<Program> host, string subject)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }

    /// <summary>The instant of a São Paulo wall-clock time on a day of January 2026.</summary>
    public static DateTimeOffset Local(int day, int hour, int minute = 0) => new(2026, 1, day, hour, minute, 0, SaoPaulo);

    public static Event NewEvent(Guid babyId, Guid createdBy, Guid typeId, DateTimeOffset start, DateTimeOffset? end, string payload = "{}") =>
        Event.Create(Guid.NewGuid(), babyId, typeId, createdBy, start, end, EventPayload.From(payload), null, TestUsers.Now);

    /// <summary>
    /// Seeds the daily log of the golden scenario (the numbers the tests expect are in <see cref="ClinicalSummaryEndpointTests"/>):
    /// two nights and a nap with a pause, a running nap, feeds of every method with formula bottles, and diapers, on 8-10 January.
    /// </summary>
    public static async Task SeedGoldenDailyLogAsync(this ApiFactory factory, Guid babyId, Guid createdBy)
    {
        var events = new[]
        {
            NewEvent(babyId, createdBy, BuiltInEventTypes.SleepId, Local(8, 21), Local(9, 6, 30), """{"kind":"night"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.SleepId, Local(9, 13), Local(9, 15), """{"kind":"nap","paused_seconds":1800,"pause_count":1}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.SleepId, Local(9, 21), Local(10, 6), """{"kind":"night"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.SleepId, Local(10, 8), null, """{"kind":"nap"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(8, 8), Local(8, 8, 15), """{"method":"breast","side":"left"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(8, 12), Local(8, 12, 15), $$"""{"method":"bottle","amount_ml":120,"bottle_feeding_type":"formula","formula_id":"{{AptamilId}}","formula_name":"Aptamil"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(8, 18), Local(8, 18, 15), $$"""{"method":"bottle","amount_ml":90,"bottle_feeding_type":"formula","formula_id":"{{AptamilId}}","formula_name":"Aptamil"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(9, 2), Local(9, 2, 20), """{"method":"solid","food":"banana"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(9, 12), Local(9, 12, 15), """{"method":"bottle","amount_ml":60,"bottle_feeding_type":"breast_milk"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(9, 15), Local(9, 15, 15), """{"method":"bottle","bottle_feeding_type":"formula","formula_name":"Nan"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.FeedingId, Local(10, 7), Local(10, 7, 20), """{"method":"breast","side":"right"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.DiaperId, Local(8, 7), Local(8, 7), """{"content":"WET"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.DiaperId, Local(9, 7), Local(9, 7), """{"content":"WET"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.DiaperId, Local(9, 10), Local(9, 10), """{"content":"DIRTY"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.DiaperId, Local(9, 14), Local(9, 14), """{"content":"MIXED"}"""),
            NewEvent(babyId, createdBy, BuiltInEventTypes.DiaperId, Local(10, 8), Local(10, 8), """{"content":"WET"}"""),
        };
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(events);
            return Task.CompletedTask;
        });
    }

    /// <summary>A new user (a doctor, say) who exists in the database; returns her subject and id.</summary>
    public static async Task<(string Subject, Guid UserId)> SeedUserAsync(this ApiFactory factory, string displayName = "Dr. Ana")
    {
        var user = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), displayName, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            return Task.CompletedTask;
        });
        return (user.Subject, user.Id);
    }

    /// <summary>
    /// Seeds a baby named <paramref name="name"/> (born <paramref name="birthDate"/>, today by default) owned by a new user, with
    /// <paramref name="memberUserId"/> as a member of <paramref name="role"/> (a Doctor limited to <paramref name="doctorScopes"/> when given).
    /// </summary>
    public static async Task<SeededPatient> SeedPatientAsync(
        this ApiFactory factory,
        Guid memberUserId,
        string name,
        DoctorScopeSet? doctorScopes = null,
        BabyRole role = BabyRole.Doctor,
        DateOnly? birthDate = null)
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", TestUsers.Now);
        var baby = Baby.Create(name, birthDate ?? DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), owner.Id, TestUsers.Now);
        baby.AddMember(memberUserId, role, TestUsers.Now);
        if (doctorScopes is not null)
        {
            baby.ChangeDoctorScopes(memberUserId, doctorScopes);
        }

        await factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        return new SeededPatient(baby.Id, owner.Subject, owner.Id);
    }

    public static Task<int> AccessEntriesAsync(this ApiFactory factory, Guid babyId) =>
        factory.QueryAsync(context => context.AccessLog.CountAsync(entry => entry.BabyId == babyId));
}

internal sealed record SeededPatient(Guid BabyId, string OwnerSubject, Guid OwnerId);
