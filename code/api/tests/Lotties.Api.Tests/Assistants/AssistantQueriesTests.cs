using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The adapter-neutral queries added with the MCP server (docs/design/32-assistants.md section 9): the babies list, the
/// baby profile, the day and week summaries (the clinical summary's math, compared with <c>GET /clinical-summary</c> on the
/// shared golden scenario), and the named baby (<see cref="AssistantInvocation.BabyId"/>). The clock is fixed at
/// 2026-01-10 12:00 UTC = 09:00 in São Paulo.
/// </summary>
public sealed class AssistantQueriesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Zone = "America/Sao_Paulo";

    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private readonly WebApplicationFactory<Program> _host = factory.WithFixedClock();

    private async Task<SeededBaby> GoldenBabyAsync(params BabyRole[] members)
    {
        var baby = await factory.SeedBabyAsync(members);
        await factory.SeedGoldenDailyLogAsync(baby.BabyId, await factory.UserIdAsync(baby.OwnerSubject));
        await factory.SetTimeZoneAsync(baby.OwnerSubject, Zone);
        return baby;
    }

    [Fact]
    public async Task DaySummary_GoldenDay_HasTheInsightsNumbers()
    {
        var baby = await GoldenBabyAsync();

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDaySummaryAsync(Invocation(), new DateOnly(2026, 1, 9)));

        Assert.Equal((AssistantResultCode.DaySummary, Zone), (result.Code, result.TimeZone));
        var day = Assert.Single(result.Days);
        Assert.Equal((new DateOnly(2026, 1, 9), true), (day.Date, day.Complete));
        Assert.Equal((660, 570, 90, 1), (day.Sleep.TotalMinutes, day.Sleep.NightMinutes, day.Sleep.NapMinutes, day.Sleep.Naps));
        Assert.Equal((3, 60d, 0, 2, 1), (day.Feeding.Feeds, day.Feeding.BottleMl, day.Feeding.Breast, day.Feeding.Bottle, day.Feeding.Solid));
        Assert.Equal((3, 2, 2), (day.Diapers.Total, day.Diapers.Wet, day.Diapers.Dirty));
    }

    [Fact]
    public async Task DaySummary_WithoutADate_IsTodaySoFar()
    {
        var baby = await GoldenBabyAsync();

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDaySummaryAsync(Invocation(), null));

        var day = Assert.Single(result.Days);
        Assert.Equal((new DateOnly(2026, 1, 10), false), (day.Date, day.Complete));
        Assert.Equal((420, 1, 1), (day.Sleep.TotalMinutes, day.Feeding.Feeds, day.Diapers.Total));
    }

    [Fact]
    public async Task WeekSummary_EqualsTheClinicalSummaryDaysOfTheSameRange()
    {
        var baby = await GoldenBabyAsync();

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadWeekSummaryAsync(Invocation(), new DateOnly(2026, 1, 10)));
        var summary = await (await _host.ClientFor(baby.OwnerSubject).GetAsync($"/api/v1/babies/{baby.BabyId}/clinical-summary?from=2026-01-04&to=2026-01-10&{ZoneQuery}")).ReadAsync<JsonElement>();

        Assert.Equal(AssistantResultCode.WeekSummary, result.Code);
        Assert.Equal(Enumerable.Range(4, 7).Select(day => new DateOnly(2026, 1, day)), result.Days.Select(day => day.Date));
        Assert.Equal([true, true, true, true, true, true, false], result.Days.Select(day => day.Complete));
        Assert.Equal(Rows(summary, "sleep"), result.Days.Select(day => Json(day.Sleep)));
        Assert.Equal(Rows(summary, "feeding"), result.Days.Select(day => Json(day.Feeding)));
        Assert.Equal(Rows(summary, "diapers"), result.Days.Select(day => Json(day.Diapers)));
    }

    [Theory]
    [InlineData(2026, 1, 11)]
    [InlineData(2025, 1, 9)]
    public async Task Summaries_DateInTheFutureOrOverAYearBack_AreInvalidDateAndNameTheBounds(int year, int month, int day)
    {
        var baby = await GoldenBabyAsync();

        var daily = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDaySummaryAsync(Invocation(), new DateOnly(year, month, day)));
        var weekly = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadWeekSummaryAsync(Invocation(), new DateOnly(year, month, day)));

        Assert.All([daily, weekly], result => Assert.Equal(
            (AssistantResultCode.InvalidDate, (DateOnly?)new DateOnly(2025, 1, 10), (DateOnly?)new DateOnly(2026, 1, 10), 0),
            (result.Code, result.EarliestDate, result.LatestDate, result.Days.Count)));
    }

    [Fact]
    public async Task DaySummary_WithoutAKnownZone_UsesUtcDays()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.SeedGoldenDailyLogAsync(baby.BabyId, await factory.UserIdAsync(baby.OwnerSubject));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDaySummaryAsync(Invocation(), new DateOnly(2026, 1, 9)));

        Assert.Equal(("UTC", (AssistantZoneSource?)AssistantZoneSource.Utc), (result.TimeZone, result.TimeZoneSource));
        // 9 January UTC is 8 January 21:00 to 9 January 21:00 in São Paulo: the night from 21:00 (9 h 30) and the 90-minute nap.
        Assert.Equal(660, Assert.Single(result.Days).Sleep.TotalMinutes);
    }

    /// <summary>
    /// The zone rule (AssistantZoneChoice): a diaper at 22:00 on 9 January in São Paulo is 01:00 UTC on 10 January, so it counts
    /// on 9 January only when the days are São Paulo's.
    /// </summary>
    [Theory]
    [InlineData(null, null, null, null, "UTC", AssistantZoneSource.Utc, 0)]
    [InlineData(null, "America/Sao_Paulo", null, null, "America/Sao_Paulo", AssistantZoneSource.Stored, 1)]
    [InlineData(null, "Asia/Tokyo", null, null, "Asia/Tokyo", AssistantZoneSource.Stored, 0)]
    [InlineData("America/Sao_Paulo", "Asia/Tokyo", null, null, "America/Sao_Paulo", AssistantZoneSource.Requested, 1)]
    [InlineData("Not/AZone", "Asia/Tokyo", null, null, "Asia/Tokyo", AssistantZoneSource.Stored, 0)]
    [InlineData(null, null, "America/Sao_Paulo", null, "America/Sao_Paulo", AssistantZoneSource.Adapter, 1)]
    [InlineData(null, null, null, "pt-BR", "America/Sao_Paulo", AssistantZoneSource.Language, 1)]
    [InlineData(null, null, null, "en", "UTC", AssistantZoneSource.Utc, 0)]
    public async Task DaySummary_ZoneRule_RequestedThenStoredThenAdapterThenAppLanguageElseUtc(
        string? requested, string? stored, string? adapterFallback, string? appLocale, string expectedZone, AssistantZoneSource expectedSource, int diapersOnThe9th)
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        await factory.SeedAsync(context =>
        {
            context.Events.Add(NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, Local(9, 22), Local(9, 22), """{"content":"WET"}"""));
            return Task.CompletedTask;
        });
        if (stored is not null)
        {
            await factory.SetTimeZoneAsync(baby.OwnerSubject, stored);
        }

        if (appLocale is not null)
        {
            await factory.SeedPushSubscriptionAsync(ownerId, appLocale);
        }

        var invocation = Invocation(fallbackZone: adapterFallback) with { TimeZone = requested };
        var ninth = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDaySummaryAsync(invocation, new DateOnly(2026, 1, 9)));
        var week = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadWeekSummaryAsync(invocation, new DateOnly(2026, 1, 10)));

        Assert.Equal((expectedZone, (AssistantZoneSource?)expectedSource), (ninth.TimeZone, ninth.TimeZoneSource));
        Assert.Equal((expectedZone, (AssistantZoneSource?)expectedSource), (week.TimeZone, week.TimeZoneSource));
        Assert.Equal(diapersOnThe9th, Assert.Single(ninth.Days).Diapers.Total);
        Assert.Equal((diapersOnThe9th, 1 - diapersOnThe9th), (week.Days[^2].Diapers.Total, week.Days[^1].Diapers.Total));
    }

    [Fact]
    public async Task DaySummary_BottleMl_IsTheDrunkAmount_AsTheClinicalSummaryAndLastFeedCountIt()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        await factory.SetTimeZoneAsync(baby.OwnerSubject, Zone);
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, Local(9, 6), Local(9, 6, 15), """{"method":"bottle","amount_ml":120,"amount_drunk_ml":80,"bottle_feeding_type":"formula"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, Local(9, 10), Local(9, 10, 15), """{"method":"bottle","amount_ml":90,"bottle_feeding_type":"breast_milk"}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, Local(9, 14), Local(9, 14, 15), """{"method":"bottle","amount_ml":60}"""),
                NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, Local(10, 7), Local(10, 7, 10), """{"method":"bottle","amount_ml":150,"amount_drunk_ml":110}"""));
            return Task.CompletedTask;
        });

        var ninth = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadDaySummaryAsync(Invocation(), new DateOnly(2026, 1, 9)));
        var last = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadLastFeedAsync(Invocation()));
        var summary = await (await _host.ClientFor(baby.OwnerSubject).GetAsync($"/api/v1/babies/{baby.BabyId}/clinical-summary?from=2026-01-09&to=2026-01-10&{ZoneQuery}")).ReadAsync<JsonElement>();

        // 80 drunk of 120, 90 with no drunk value (all of it), 60 of a legacy bottle (no type, no drunk value).
        Assert.Equal((3, 230d), (Assert.Single(ninth.Days).Feeding.Bottle, ninth.Days[0].Feeding.BottleMl));
        Assert.Equal([230d, 110d], summary.GetProperty("feeding").GetProperty("days").EnumerateArray().Select(day => day.GetProperty("bottleMl").GetDouble()));
        Assert.Equal(110, last.AmountMl);
    }

    [Theory]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Caregiver)]
    public async Task Summaries_AnyFamilyRole_Reads(BabyRole role)
    {
        var baby = await GoldenBabyAsync(role);

        var result = await _host.RunAsAsync(baby.SubjectOf(role), assistant => assistant.ReadWeekSummaryAsync(Invocation(), null));

        Assert.Equal((AssistantResultCode.WeekSummary, 7), (result.Code, result.Days.Count));
    }

    [Fact]
    public async Task Queries_DoctorOfTheBaby_AreNotAllowedAndNameNoBaby()
    {
        var baby = await GoldenBabyAsync(BabyRole.Doctor);
        var doctor = baby.SubjectOf(BabyRole.Doctor);

        var results = new[]
        {
            await _host.RunAsAsync(doctor, assistant => assistant.ReadDaySummaryAsync(Invocation(), null)),
            await _host.RunAsAsync(doctor, assistant => assistant.ReadWeekSummaryAsync(Invocation(), null)),
            await _host.RunAsAsync(doctor, assistant => assistant.ReadBabyProfileAsync(Invocation())),
            await _host.RunAsAsync(doctor, assistant => assistant.ListBabiesAsync(Invocation())),
            await _host.RunAsAsync(doctor, assistant => assistant.ReadDaySummaryAsync(Invocation(babyId: baby.BabyId), null)),
        };

        Assert.All(results, result => Assert.Equal((AssistantResultCode.NotAllowed, (AssistantBaby?)null, 0), (result.Code, result.Baby, result.Babies.Count)));
    }

    [Fact]
    public async Task ListBabies_FamilyMembershipsOnly_WithRoleAndTheDefault()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Viewer, BabyRole.Doctor);

        var result = await _host.RunAsAsync(subject, assistant => assistant.ListBabiesAsync(Invocation()));

        Assert.Equal(AssistantResultCode.Babies, result.Code);
        Assert.Equal(
            [new AssistantBabyAccess(babyIds[0], "Baby0", "parent", true, true), new AssistantBabyAccess(babyIds[1], "Baby1", "viewer", false, false)],
            result.Babies);
        Assert.Null(result.Baby);
    }

    [Fact]
    public async Task ListBabies_SeveralToLogWithoutDefault_FlagsNone()
    {
        var (subject, _) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Owner);

        var result = await _host.RunAsAsync(subject, assistant => assistant.ListBabiesAsync(Invocation()));

        Assert.Equal(2, result.Babies.Count);
        Assert.DoesNotContain(result.Babies, baby => baby.IsDefault);
    }

    [Fact]
    public async Task ListBabies_NoBaby_IsNoBaby()
    {
        var (subject, _) = await factory.SeedMemberOfAsync();

        var result = await _host.RunAsAsync(subject, assistant => assistant.ListBabiesAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NoBaby, result.Code);
    }

    [Fact]
    public async Task NamedBaby_OneOfSeveral_IsTheSubjectInsteadOfChooseBaby()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Parent);

        var unnamed = await _host.RunAsAsync(subject, assistant => assistant.ReadLastFeedAsync(Invocation()));
        var named = await _host.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(babyId: babyIds[1]), DiaperKind.Wet));

        Assert.Equal(AssistantResultCode.ChooseBaby, unnamed.Code);
        Assert.Equal((AssistantResultCode.DiaperLogged, babyIds[1]), (named.Code, named.Baby!.Id));
        Assert.Single(await factory.EventsAsync(babyIds[1]));
        Assert.Empty(await factory.EventsAsync(babyIds[0]));
    }

    [Fact]
    public async Task NamedBaby_SomeoneElsesOrUnknownOrAPatient_IsUnknownBabyAndWritesNothing()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Doctor);
        var stranger = await factory.SeedBabyAsync();

        var results = new[]
        {
            await _host.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(babyId: stranger.BabyId), DiaperKind.Wet)),
            await _host.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(babyId: Guid.NewGuid()), DiaperKind.Wet)),
            await _host.RunAsAsync(subject, assistant => assistant.ReadLastFeedAsync(Invocation(babyId: babyIds[1]))),
        };

        Assert.All(results, result => Assert.Equal((AssistantResultCode.UnknownBaby, (AssistantBaby?)null), (result.Code, result.Baby)));
        Assert.Empty(await factory.EventsAsync(stranger.BabyId));
        Assert.Empty(await factory.EventsAsync(babyIds[1]));
    }

    [Fact]
    public async Task NamedBaby_ViewerWriting_IsStillNotAllowed()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Viewer);

        var result = await _host.RunAsAsync(subject, assistant => assistant.LogDiaperAsync(Invocation(babyId: babyIds[1]), DiaperKind.Wet));

        Assert.Equal((AssistantResultCode.NotAllowed, babyIds[1]), (result.Code, result.Baby!.Id));
        Assert.Empty(await factory.EventsAsync(babyIds[1]));
    }

    [Fact]
    public async Task BabyProfile_IsTheNameAndAgeOnly()
    {
        var (subject, userId) = await factory.SeedUserAsync("Parent");
        var patient = await factory.SeedPatientAsync(userId, "Theo", role: BabyRole.Parent, birthDate: new DateOnly(2025, 10, 5));

        var result = await _host.RunAsAsync(subject, assistant => assistant.ReadBabyProfileAsync(Invocation()));

        Assert.Equal((AssistantResultCode.BabyProfile, patient.BabyId, "Theo"), (result.Code, result.Baby!.Id, result.Baby.Name));
        Assert.Equal(new AssistantBabyAge(97, 13, 3), result.Age);
    }

    private static string Json<T>(T value) => JsonSerializer.Serialize(value, WebJson);

    private static IEnumerable<string> Rows(JsonElement summary, string section) =>
        summary.GetProperty(section).GetProperty("days").EnumerateArray().Select(day => JsonSerializer.Serialize(day, WebJson));
}
