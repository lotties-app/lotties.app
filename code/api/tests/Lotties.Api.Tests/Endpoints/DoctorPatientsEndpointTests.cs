using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Measurements;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>GET /doctor/patients</c> (docs/design/16-doctor-access.md): the babies the signed-in user is a Doctor of, each with the
/// figures her scopes open. The server clock is fixed at 2026-01-10 12:00 UTC = 09:00 in São Paulo.
/// </summary>
public sealed class DoctorPatientsEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string PatientsPath = "/api/v1/doctor/patients";

    private static readonly string[] Figures = ["lastEventAt", "week", "latestWeight", "pendingProposals", "vaccinesDue", "sharedNotes"];

    private readonly WebApplicationFactory<Program> _host = factory.WithFixedClock();

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private static bool IsNull(JsonElement element, string property) => element.GetProperty(property).ValueKind == JsonValueKind.Null;

    private async Task<JsonElement[]> PatientsAsync(string subject, string? query = ZoneQuery)
    {
        var path = query is null ? PatientsPath : $"{PatientsPath}?{query}";
        return (await JsonAsync(await _host.ClientFor(subject).GetAsync(path))).EnumerateArray().ToArray();
    }

    private static Guid[] ByNameThenId(IEnumerable<(string Name, Guid Id)> babies) =>
        babies.OrderBy(baby => baby.Name, StringComparer.Ordinal).ThenBy(baby => baby.Id.ToString(), StringComparer.OrdinalIgnoreCase).Select(baby => baby.Id).ToArray();

    private async Task<(string Subject, Guid UserId, SeededPatient Patient)> DoctorOfOneBabyAsync(DoctorScopeSet? scopes = null, string name = "Lia")
    {
        var (subject, userId) = await factory.SeedUserAsync();
        return (subject, userId, await factory.SeedPatientAsync(userId, name, scopes));
    }

    [Fact]
    public async Task Patients_AParent_GetsAnEmptyList()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer, BabyRole.Caregiver);

        Assert.Empty(await PatientsAsync(baby.SubjectOf(BabyRole.Parent)));
        Assert.Empty(await PatientsAsync(baby.OwnerSubject));
        Assert.Empty(await PatientsAsync(baby.SubjectOf(BabyRole.Viewer)));
        Assert.Empty(await PatientsAsync(baby.SubjectOf(BabyRole.Caregiver)));
    }

    [Fact]
    public async Task Patients_AUserWithNoBabies_GetsAnEmptyList()
    {
        Assert.Empty(await PatientsAsync(TestUsers.NewSubject()));
    }

    [Fact]
    public async Task Patients_Anonymous_Is401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(PatientsPath)).StatusCode);
    }

    [Fact]
    public async Task Patients_ListsOnlyTheBabiesWhereTheCallerIsADoctor_ByNameThenId()
    {
        var (subject, userId) = await factory.SeedUserAsync();
        var bia = await factory.SeedPatientAsync(userId, "Bia");
        var ana1 = await factory.SeedPatientAsync(userId, "Ana", DoctorScopeSet.Create([DoctorScope.Growth]));
        var ana2 = await factory.SeedPatientAsync(userId, "Ana");
        await factory.SeedPatientAsync(userId, "Zed", role: BabyRole.Parent);
        await factory.SeedPatientAsync(userId, "Yan", role: BabyRole.Viewer);
        var (_, strangerId) = await factory.SeedUserAsync("Other doctor");
        await factory.SeedPatientAsync(strangerId, "Not hers");

        var patients = await PatientsAsync(subject);

        Assert.Equal(ByNameThenId([("Ana", ana1.BabyId), ("Ana", ana2.BabyId), ("Bia", bia.BabyId)]), patients.Select(patient => patient.GetProperty("babyId").GetGuid()).ToArray());
        Assert.Equal(["Ana", "Ana", "Bia"], patients.Select(patient => patient.GetProperty("name").GetString()).ToArray());
        var bianca = patients.Single(patient => patient.GetProperty("babyId").GetGuid() == bia.BabyId);
        Assert.Equal("2026-01-10", bianca.GetProperty("birthDate").GetString());
        Assert.Equal(["daily_log", "growth", "medications", "vaccines", "formulas", "notes"], bianca.GetProperty("doctorScopes").EnumerateArray().Select(code => code.GetString()).ToArray());
    }

    [Theory]
    [InlineData(DoctorScope.DailyLog, "lastEventAt,week")]
    [InlineData(DoctorScope.Growth, "latestWeight")]
    [InlineData(DoctorScope.Medications, "pendingProposals")]
    [InlineData(DoctorScope.Vaccines, "vaccinesDue")]
    [InlineData(DoctorScope.Formulas, "")]
    [InlineData(DoctorScope.Notes, "sharedNotes")]
    public async Task Patients_EachFigureNeedsItsScope(DoctorScope scope, string figures)
    {
        var (subject, userId, patient) = await DoctorOfOneBabyAsync(DoctorScopeSet.Create([scope]));
        await SeedSomeDataAsync(patient, userId);

        var only = Assert.Single(await PatientsAsync(subject));

        var present = Figures.Where(figure => !IsNull(only, figure)).ToArray();
        Assert.Equal(figures.Split(',', StringSplitOptions.RemoveEmptyEntries).Order(), present.Order());
        Assert.Equal([DoctorScopes.CodeOf(scope)], only.GetProperty("doctorScopes").EnumerateArray().Select(code => code.GetString()).ToArray());
    }

    [Fact]
    public async Task Patients_NoScopeAtAll_ListsTheBabyWithoutAnyFigure()
    {
        var (subject, userId, patient) = await DoctorOfOneBabyAsync(DoctorScopeSet.None);
        await SeedSomeDataAsync(patient, userId);

        var only = Assert.Single(await PatientsAsync(subject));

        Assert.Equal(patient.BabyId, only.GetProperty("babyId").GetGuid());
        Assert.Equal(0, only.GetProperty("doctorScopes").GetArrayLength());
        Assert.All(Figures, figure => Assert.True(IsNull(only, figure), figure));
    }

    [Fact]
    public async Task Patients_GoldenWeek_AveragesLikeTheParentsInsights_AndLastEventIsTheNewestThatStartedBeforeNow()
    {
        var (subject, _, patient) = await DoctorOfOneBabyAsync();
        await factory.SeedGoldenDailyLogAsync(patient.BabyId, patient.OwnerId);
        var future = NewEvent(patient.BabyId, patient.OwnerId, BuiltInEventTypes.DiaperId, Local(10, 15), Local(10, 15), """{"content":"WET"}""");
        var gone = NewEvent(patient.BabyId, patient.OwnerId, BuiltInEventTypes.DiaperId, Local(10, 8, 30), Local(10, 8, 30), """{"content":"WET"}""");
        gone.SoftDelete(TestUsers.Now);
        var tooOld = NewEvent(patient.BabyId, patient.OwnerId, BuiltInEventTypes.SleepId, Local(1, 21), Local(2, 6), """{"kind":"night"}""");
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(future, gone, tooOld);
            return Task.CompletedTask;
        });

        var only = Assert.Single(await PatientsAsync(subject));

        Assert.Equal(Local(10, 8), only.GetProperty("lastEventAt").GetDateTimeOffset());
        var week = only.GetProperty("week");
        Assert.Equal(("2026-01-04", "2026-01-10"), (week.GetProperty("from").GetString(), week.GetProperty("to").GetString()));
        Assert.Equal((420, 3d, 135d, 2d), (week.GetProperty("sleepMinutesPerDay").GetInt32(), week.GetProperty("feedsPerDay").GetDouble(), week.GetProperty("bottleMlPerDay").GetDouble(), week.GetProperty("diapersPerDay").GetDouble()));
    }

    [Fact]
    public async Task Patients_BabyWithoutEvents_HasAWeekOfNullAveragesAndNoLastEvent()
    {
        var (subject, _, _) = await DoctorOfOneBabyAsync();

        var only = Assert.Single(await PatientsAsync(subject));

        Assert.True(IsNull(only, "lastEventAt"));
        var week = only.GetProperty("week");
        Assert.All(new[] { "sleepMinutesPerDay", "feedsPerDay", "bottleMlPerDay", "diapersPerDay" }, average => Assert.True(IsNull(week, average), average));
        Assert.Equal(("2026-01-04", "2026-01-10"), (week.GetProperty("from").GetString(), week.GetProperty("to").GetString()));
    }

    [Theory]
    [InlineData("timeZone=Pacific/Kiritimati", "2026-01-11")]
    [InlineData("utcOffsetMinutes=840", "2026-01-11")]
    [InlineData("utcOffsetMinutes=-180&timeZone=Not/AZone", "2026-01-10")]
    [InlineData("timeZone=America/Sao_Paulo&utcOffsetMinutes=0", "2026-01-10")]
    public async Task Patients_TheWeekEndsOnTheLocalDateOfNow(string query, string lastDay)
    {
        var (subject, _, _) = await DoctorOfOneBabyAsync();

        var only = Assert.Single(await PatientsAsync(subject, query));

        Assert.Equal(lastDay, only.GetProperty("week").GetProperty("to").GetString());
    }

    [Theory]
    [InlineData(-841)]
    [InlineData(841)]
    public async Task Patients_UtcOffsetOutOfRange_Is400(int offsetMinutes)
    {
        var response = await _host.ClientFor(TestUsers.NewSubject()).GetAsync($"{PatientsPath}?utcOffsetMinutes={offsetMinutes}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Patients_LatestWeight_IsTheNewestDateThenTheNewestCreated_AndIgnoresMeasurementsWithoutWeight()
    {
        var (subject, userId, patient) = await DoctorOfOneBabyAsync();
        var created = TestUsers.Now;
        await factory.SeedAsync(context =>
        {
            context.Measurements.AddRange(
                Measurement.Create(Guid.NewGuid(), patient.BabyId, new DateOnly(2026, 1, 5), 5.0m, null, null, null, patient.OwnerId, created, BabyRole.Owner),
                Measurement.Create(Guid.NewGuid(), patient.BabyId, new DateOnly(2026, 1, 9), 5.4m, null, null, null, patient.OwnerId, created.AddMinutes(1), BabyRole.Owner),
                Measurement.Create(Guid.NewGuid(), patient.BabyId, new DateOnly(2026, 1, 9), 5.5m, null, null, null, userId, created.AddMinutes(2), BabyRole.Doctor),
                Measurement.Create(Guid.NewGuid(), patient.BabyId, new DateOnly(2026, 1, 10), null, 61m, null, null, patient.OwnerId, created.AddMinutes(3), BabyRole.Owner));
            return Task.CompletedTask;
        });

        var only = Assert.Single(await PatientsAsync(subject));

        var weight = only.GetProperty("latestWeight");
        Assert.Equal((5.5m, "2026-01-09"), (weight.GetProperty("weightKg").GetDecimal(), weight.GetProperty("date").GetString()));
    }

    [Fact]
    public async Task Patients_LatestWeight_NoneYetIsNullEvenWithTheScope()
    {
        var (subject, _, _) = await DoctorOfOneBabyAsync(DoctorScopeSet.Create([DoctorScope.Growth]));

        var only = Assert.Single(await PatientsAsync(subject));

        Assert.True(IsNull(only, "latestWeight"));
    }

    [Fact]
    public async Task Patients_PendingProposals_AreHerOwnPendingOnesForThatBabyOnly()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        var doctor = _host.ClientFor(baby.SubjectOf(BabyRole.Doctor));
        var parent = _host.ClientFor(baby.SubjectOf(BabyRole.Parent));
        var (otherSubject, otherId) = await factory.SeedUserAsync("Other doctor");
        await factory.SeedAsync(async context =>
        {
            var stored = await context.Babies.Include(b => b.Members).SingleAsync(b => b.Id == baby.BabyId);
            stored.AddMember(otherId, BabyRole.Doctor, TestUsers.Now);
        });
        var otherBabyDoctor = await factory.SeedPatientAsync((await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor))), "Elsewhere");
        var proposal = new { medicationName = "Paracetamol drops", kind = "scheduled", dose = new { amount = 2, unit = "drops" }, timesOfDay = new[] { "08:00" }, startDate = "2026-01-10" };
        var accepted = Guid.NewGuid();
        foreach (var id in new[] { Guid.NewGuid(), Guid.NewGuid(), accepted })
        {
            Assert.Equal(HttpStatusCode.Created, (await doctor.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescription-proposals/{id}", proposal)).StatusCode);
        }

        Assert.Equal(HttpStatusCode.Created, (await _host.ClientFor(otherSubject).PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescription-proposals/{Guid.NewGuid()}", proposal)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await parent.PostAsJsonAsync($"{BabyPath(baby.BabyId)}/prescription-proposals/{accepted}/accept", new { prescriptionId = Guid.NewGuid() })).StatusCode);

        var patients = await PatientsAsync(baby.SubjectOf(BabyRole.Doctor));

        var thisBaby = patients.Single(patient => patient.GetProperty("babyId").GetGuid() == baby.BabyId);
        var elsewhere = patients.Single(patient => patient.GetProperty("babyId").GetGuid() == otherBabyDoctor.BabyId);
        Assert.Equal((2, 0), (thisBaby.GetProperty("pendingProposals").GetInt32(), elsewhere.GetProperty("pendingProposals").GetInt32()));
    }

    [Fact]
    public async Task Patients_VaccinesDue_MatchesTheClinicalSummaryAndDropsWhenADoseIsRecorded()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorSubject = baby.SubjectOf(BabyRole.Doctor);
        var owner = _host.ClientFor(baby.OwnerSubject);
        var summary = await JsonAsync(await _host.ClientFor(doctorSubject).GetAsync($"{BabyPath(baby.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10&{ZoneQuery}"));
        var vaccines = summary.GetProperty("vaccines");
        var expected = vaccines.GetProperty("due").GetInt32() + vaccines.GetProperty("overdue").GetInt32();
        var first = vaccines.GetProperty("dueDoses")[0];

        var before = Assert.Single(await PatientsAsync(doctorSubject)).GetProperty("vaccinesDue").GetInt32();
        await owner.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/vaccinations/{Guid.NewGuid()}", new { vaccineKey = first.GetProperty("vaccineKey").GetString(), doseId = first.GetProperty("doseId").GetString(), givenOn = "2026-01-10", network = "public" });
        var after = Assert.Single(await PatientsAsync(doctorSubject)).GetProperty("vaccinesDue").GetInt32();

        Assert.True(expected > 0);
        Assert.Equal(expected, before);
        Assert.True(after < before, $"{after} < {before}");
    }

    [Fact]
    public async Task Patients_SharedNotes_AreHerOwnSharedNonDeletedOnes()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var (otherSubject, otherId) = await factory.SeedUserAsync("Other doctor");
        await factory.SeedAsync(async context =>
        {
            var stored = await context.Babies.Include(b => b.Members).SingleAsync(b => b.Id == baby.BabyId);
            stored.AddMember(otherId, BabyRole.Doctor, TestUsers.Now);
        });
        var doctor = _host.ClientFor(baby.SubjectOf(BabyRole.Doctor));
        var other = _host.ClientFor(otherSubject);
        var removed = Guid.NewGuid();
        await PutNoteAsync(doctor, baby.BabyId, Guid.NewGuid(), "shared");
        await PutNoteAsync(doctor, baby.BabyId, Guid.NewGuid(), "shared");
        await PutNoteAsync(doctor, baby.BabyId, Guid.NewGuid(), "private");
        await PutNoteAsync(doctor, baby.BabyId, removed, "shared");
        await PutNoteAsync(other, baby.BabyId, Guid.NewGuid(), "shared");
        Assert.Equal(HttpStatusCode.NoContent, (await doctor.DeleteAsync($"{BabyPath(baby.BabyId)}/notes/{removed}")).StatusCode);

        var mine = Assert.Single(await PatientsAsync(baby.SubjectOf(BabyRole.Doctor)));
        var theirs = Assert.Single(await PatientsAsync(otherSubject));

        Assert.Equal((2, 1), (mine.GetProperty("sharedNotes").GetInt32(), theirs.GetProperty("sharedNotes").GetInt32()));
    }

    [Fact]
    public async Task Patients_WritesOneAccessEntryPerPatient_AtMostHourly_AndNoneForBabiesWhereSheIsNotADoctor()
    {
        var (subject, userId) = await factory.SeedUserAsync();
        var first = await factory.SeedPatientAsync(userId, "First");
        var second = await factory.SeedPatientAsync(userId, "Second");
        var asParent = await factory.SeedPatientAsync(userId, "Parent of this one", role: BabyRole.Parent);
        var client = factory.CreateClientFor(subject);

        await client.GetAsync(PatientsPath);
        var afterFirstCall = (await factory.AccessEntriesAsync(first.BabyId), await factory.AccessEntriesAsync(second.BabyId));
        await client.GetAsync(PatientsPath);
        await client.GetAsync($"{BabyPath(first.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10");

        Assert.Equal((1, 1), afterFirstCall);
        Assert.Equal((1, 1, 0), (await factory.AccessEntriesAsync(first.BabyId), await factory.AccessEntriesAsync(second.BabyId), await factory.AccessEntriesAsync(asParent.BabyId)));
        var entries = (await JsonAsync(await factory.CreateClientFor(first.OwnerSubject).GetAsync($"{BabyPath(first.BabyId)}/access-log"))).EnumerateArray().ToArray();
        Assert.Equal(("Doctor", "view"), (entries[0].GetProperty("role").GetString(), entries[0].GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task Patients_ADoctorWithNoScopeIsStillLoggedWhenHerDashboardListsTheBaby()
    {
        var (subject, _, patient) = await DoctorOfOneBabyAsync(DoctorScopeSet.None);

        await factory.CreateClientFor(subject).GetAsync(PatientsPath);

        Assert.Equal(1, await factory.AccessEntriesAsync(patient.BabyId));
    }

    private async Task SeedSomeDataAsync(SeededPatient patient, Guid doctorId)
    {
        await factory.SeedAsync(context =>
        {
            context.Events.Add(NewEvent(patient.BabyId, patient.OwnerId, BuiltInEventTypes.DiaperId, Local(10, 8), Local(10, 8), """{"content":"WET"}"""));
            context.Measurements.Add(Measurement.Create(Guid.NewGuid(), patient.BabyId, new DateOnly(2026, 1, 9), 5.4m, null, null, null, doctorId, TestUsers.Now, BabyRole.Doctor));
            return Task.CompletedTask;
        });
    }

    private static async Task PutNoteAsync(HttpClient client, Guid babyId, Guid noteId, string visibility)
    {
        var response = await client.PutAsJsonAsync($"{BabyPath(babyId)}/notes/{noteId}", new { kind = "note", visibility, body = "A note." });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
