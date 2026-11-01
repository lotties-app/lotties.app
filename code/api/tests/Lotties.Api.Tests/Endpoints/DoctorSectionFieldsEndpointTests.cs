using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// The fields of one section that other sections' answers carry (docs/design/19-doctor-dashboard.md section 3): a Doctor gets the
/// vaccine profile on the baby only with <c>vaccines</c>, the medication doses among the events only with <c>medications</c>, and
/// the formula a bottle names only with <c>formulas</c>; every family role always gets all of them. The scope table of
/// <c>EndpointRoleMatrixTests</c> decides the routes; these tests decide the fields inside them.
/// </summary>
public sealed class DoctorSectionFieldsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string PatientsPath = "/api/v1/doctor/patients?" + ZoneQuery;
    private const string TimelineQuery = "timeline?from=2026-01-09T03:00:00Z&to=2026-01-11T03:00:00Z";
    private const string SummaryQuery = "clinical-summary?from=2026-01-08&to=2026-01-10&" + ZoneQuery;

    private static readonly DateTimeOffset BottleAt = Local(9, 12);
    private static readonly DateTimeOffset DiaperAt = Local(9, 14);
    private static readonly DateTimeOffset DoseAt = Local(10, 8);

    private readonly WebApplicationFactory<Program> _host = factory.WithFixedClock();

    public static TheoryData<BabyRole> FamilyRoles => new() { BabyRole.Owner, BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer };

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private HttpClient As(SeededBaby baby, BabyRole role) => _host.ClientFor(baby.SubjectOf(role));

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<JsonElement>();
    }

    /// <summary>A baby with a vaccine profile, a bottle of formula, a diaper and, last, a medication dose; the Doctor sees <paramref name="scopes"/>.</summary>
    private async Task<Patient> SeedAsync(params DoctorScope[] scopes)
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create(scopes), BabyRole.Doctor, BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var profile = await As(baby, BabyRole.Owner).PutAsJsonAsync($"{BabyPath(baby.BabyId)}/vaccine-profile", new { vaccineProfile = "public+private", gestationalAgeWeeks = 32, rsvMaternalVaccination = "yes" });
        Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
        var bottle = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.FeedingId, BottleAt, BottleAt.AddMinutes(15), $$"""{"method":"bottle","amount_ml":120,"bottle_feeding_type":"formula","formula_id":"{{AptamilId}}","formula_name":"Aptamil"}""");
        var diaper = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.DiaperId, DiaperAt, DiaperAt, """{"content":"WET"}""");
        var dose = NewEvent(baby.BabyId, ownerId, BuiltInEventTypes.MedicationId, DoseAt, null, """{"medications":[{"medicationId":"0b7c4a52-8a3f-4e4b-9a5e-1f1f8e6b2c33","name":"Paracetamol"}]}""");
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(bottle, diaper, dose);
            return Task.CompletedTask;
        });
        return new Patient(baby, dose.Id, bottle.Id);
    }

    private async Task<JsonElement> EventsAsync(Patient patient, BabyRole role) =>
        await JsonAsync(await As(patient.Baby, role).GetAsync($"{BabyPath(patient.Baby.BabyId)}/events"));

    private async Task<JsonElement> TimelineAsync(Patient patient, BabyRole role) =>
        await JsonAsync(await As(patient.Baby, role).GetAsync($"{BabyPath(patient.Baby.BabyId)}/{TimelineQuery}"));

    private static Guid[] IdsOf(JsonElement events) => events.EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();

    private static JsonElement PayloadOf(JsonElement events, Guid id) =>
        events.EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id).GetProperty("payload");

    private static (string?, int?, string?) VaccineProfileOf(JsonElement baby) =>
        (baby.GetProperty("vaccineProfile").GetString(),
            baby.GetProperty("gestationalAgeWeeks").ValueKind == JsonValueKind.Null ? null : baby.GetProperty("gestationalAgeWeeks").GetInt32(),
            baby.GetProperty("rsvMaternalVaccination").GetString());

    private async Task<(string?, int?, string?)[]> VaccineProfilesAsync(Patient patient, BabyRole role)
    {
        var client = As(patient.Baby, role);
        var single = await JsonAsync(await client.GetAsync(BabyPath(patient.Baby.BabyId)));
        var listed = (await JsonAsync(await client.GetAsync("/api/v1/babies"))).EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == patient.Baby.BabyId);
        return [VaccineProfileOf(single), VaccineProfileOf(listed)];
    }

    [Theory]
    [MemberData(nameof(FamilyRoles))]
    public async Task FamilyMember_GetsTheVaccineProfile_TheDoses_AndTheFormulaOfABottle(BabyRole role)
    {
        var patient = await SeedAsync(DoctorScope.DailyLog);

        var profiles = await VaccineProfilesAsync(patient, role);
        var events = await EventsAsync(patient, role);
        var dose = await As(patient.Baby, role).GetAsync($"{BabyPath(patient.Baby.BabyId)}/events/{patient.DoseId}");
        var timeline = await TimelineAsync(patient, role);

        Assert.All(profiles, profile => Assert.Equal(("public+private", 32, "yes"), profile));
        Assert.Contains(patient.DoseId, IdsOf(events));
        Assert.Equal(HttpStatusCode.OK, dose.StatusCode);
        Assert.Contains(patient.DoseId, IdsOf(timeline));
        Assert.Equal("Aptamil", PayloadOf(events, patient.BottleId).GetProperty("formula_name").GetString());
        Assert.Equal("Aptamil", PayloadOf(timeline, patient.BottleId).GetProperty("formula_name").GetString());
    }

    [Fact]
    public async Task Doctor_WithoutVaccines_GetsNoVaccineProfile_OnTheBabyOrTheList()
    {
        var patient = await SeedAsync(DoctorScope.DailyLog, DoctorScope.Medications, DoctorScope.Formulas);

        var profiles = await VaccineProfilesAsync(patient, BabyRole.Doctor);

        Assert.All(profiles, profile => Assert.Equal(((string?)null, (int?)null, (string?)null), profile));
    }

    [Fact]
    public async Task Doctor_WithVaccines_GetsTheVaccineProfile()
    {
        var patient = await SeedAsync(DoctorScope.Vaccines);

        var profiles = await VaccineProfilesAsync(patient, BabyRole.Doctor);

        Assert.All(profiles, profile => Assert.Equal(("public+private", 32, "yes"), profile));
    }

    [Fact]
    public async Task Doctor_WithoutMedications_GetsNoDose_InTheEventsTheTimelineOrHerLastEntry()
    {
        var patient = await SeedAsync(DoctorScope.DailyLog, DoctorScope.Formulas);
        var doctor = As(patient.Baby, BabyRole.Doctor);

        var events = await EventsAsync(patient, BabyRole.Doctor);
        var dose = await doctor.GetAsync($"{BabyPath(patient.Baby.BabyId)}/events/{patient.DoseId}");
        var timeline = await TimelineAsync(patient, BabyRole.Doctor);
        var card = (await JsonAsync(await doctor.GetAsync(PatientsPath))).EnumerateArray().Single(item => item.GetProperty("babyId").GetGuid() == patient.Baby.BabyId);

        Assert.DoesNotContain(patient.DoseId, IdsOf(events));
        Assert.Contains(patient.BottleId, IdsOf(events));
        Assert.Equal(HttpStatusCode.NotFound, dose.StatusCode);
        Assert.DoesNotContain(patient.DoseId, IdsOf(timeline));
        Assert.Equal(DiaperAt, card.GetProperty("lastEventAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Doctor_WithMedications_GetsTheDoses()
    {
        var patient = await SeedAsync(DoctorScope.DailyLog, DoctorScope.Medications);
        var doctor = As(patient.Baby, BabyRole.Doctor);

        var events = await EventsAsync(patient, BabyRole.Doctor);
        var dose = await doctor.GetAsync($"{BabyPath(patient.Baby.BabyId)}/events/{patient.DoseId}");
        var timeline = await TimelineAsync(patient, BabyRole.Doctor);
        var card = (await JsonAsync(await doctor.GetAsync(PatientsPath))).EnumerateArray().Single(item => item.GetProperty("babyId").GetGuid() == patient.Baby.BabyId);

        Assert.Contains(patient.DoseId, IdsOf(events));
        Assert.Equal(HttpStatusCode.OK, dose.StatusCode);
        Assert.Contains(patient.DoseId, IdsOf(timeline));
        Assert.Equal(DoseAt, card.GetProperty("lastEventAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Doctor_WithoutFormulas_GetsBottlesWithoutTheirFormula_AndNoFormulaInTheSummary()
    {
        var patient = await SeedAsync(DoctorScope.DailyLog, DoctorScope.Medications);

        var events = await EventsAsync(patient, BabyRole.Doctor);
        var bottle = await JsonAsync(await As(patient.Baby, BabyRole.Doctor).GetAsync($"{BabyPath(patient.Baby.BabyId)}/events/{patient.BottleId}"));
        var timeline = await TimelineAsync(patient, BabyRole.Doctor);
        var summary = await JsonAsync(await As(patient.Baby, BabyRole.Doctor).GetAsync($"{BabyPath(patient.Baby.BabyId)}/{SummaryQuery}"));

        Assert.All(
            new[] { PayloadOf(events, patient.BottleId), bottle.GetProperty("payload"), PayloadOf(timeline, patient.BottleId) },
            payload =>
            {
                Assert.False(payload.TryGetProperty("formula_id", out _));
                Assert.False(payload.TryGetProperty("formula_name", out _));
                Assert.Equal(("bottle", "formula", 120), (payload.GetProperty("method").GetString(), payload.GetProperty("bottle_feeding_type").GetString(), payload.GetProperty("amount_ml").GetInt32()));
            });
        Assert.Empty(summary.GetProperty("feeding").GetProperty("formulas").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, summary.GetProperty("formulas").ValueKind);
    }

    [Fact]
    public async Task Doctor_WithFormulas_GetsTheFormulaOfABottle_AndInTheSummary()
    {
        var patient = await SeedAsync(DoctorScope.DailyLog, DoctorScope.Formulas);

        var events = await EventsAsync(patient, BabyRole.Doctor);
        var summary = await JsonAsync(await As(patient.Baby, BabyRole.Doctor).GetAsync($"{BabyPath(patient.Baby.BabyId)}/{SummaryQuery}"));

        Assert.Equal(AptamilId.ToString(), PayloadOf(events, patient.BottleId).GetProperty("formula_id").GetString());
        var formula = Assert.Single(summary.GetProperty("feeding").GetProperty("formulas").EnumerateArray());
        Assert.Equal("Aptamil", formula.GetProperty("name").GetString());
    }

    private sealed record Patient(SeededBaby Baby, Guid DoseId, Guid BottleId);
}
