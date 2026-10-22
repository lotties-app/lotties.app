using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>/babies/{id}/appointments</c>: idempotent upsert, validation, done only once started, cancel (no delete), delta
/// and calendar range, one by id, roles, and offline replays. The server clock is fixed at 2026-01-10 12:00 UTC.
/// </summary>
public sealed class AppointmentEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;

    private readonly WebApplicationFactory<Program> _host =
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(new FixedTimeProvider(Now))));

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string AppointmentPath(Guid babyId, Guid appointmentId) => $"{BabyPath(babyId)}/appointments/{appointmentId}";

    private static Dictionary<string, object?> Body(
        string title = "Pediatrician",
        DateTimeOffset? startsAt = null,
        string status = "upcoming",
        object? updatedAt = null,
        int[]? reminders = null,
        string? outcome = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["title"] = title,
            ["type"] = "consultation",
            ["startsAt"] = startsAt ?? Now.AddDays(3),
            ["durationMinutes"] = 30,
            ["location"] = "Clinic Central",
            ["doctorName"] = "Dr. Ana",
            ["notes"] = "Bring the vaccine card",
            ["outcome"] = outcome,
            ["status"] = status,
            ["updatedAt"] = updatedAt,
        };
        if (reminders is not null)
        {
            body["reminderOffsetsMinutes"] = reminders;
        }

        return body;
    }

    private HttpClient As(SeededBaby baby, BabyRole role)
    {
        var client = _host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, baby.SubjectOf(role));
        return client;
    }

    private static Task<JsonElement> JsonAsync(HttpResponseMessage response) => response.ReadAsync<JsonElement>();

    private static async Task<JsonElement[]> ListAsync(HttpClient client, Guid babyId, string query = "")
    {
        var response = await client.GetAsync($"{BabyPath(babyId)}/appointments{query}");
        return (await response.ReadAsync<JsonElement>()).EnumerateArray().ToArray();
    }

    private static Task<HttpResponseMessage> PutJsonAsync(HttpClient client, string path, string json) =>
        client.PutAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));

    [Fact]
    public async Task Put_New_Returns201WithTheDefaultRemindersAndAReplayReturnsTheSameRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();

        var created = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(title: "  Pediatrician  "));
        var replay = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body());

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(AppointmentPath(baby.BabyId, id), created.Headers.Location?.OriginalString);
        var body = await JsonAsync(created);
        Assert.Equal(("Pediatrician", "consultation", "upcoming", 30), (body.GetProperty("title").GetString(), body.GetProperty("type").GetString(), body.GetProperty("status").GetString(), body.GetProperty("durationMinutes").GetInt32()));
        Assert.Equal([1440, 120], body.GetProperty("reminderOffsetsMinutes").EnumerateArray().Select(offset => offset.GetInt32()));
        Assert.Equal(Now.AddDays(3), body.GetProperty("startsAt").GetDateTimeOffset());
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(body.GetProperty("updatedAt").GetDateTimeOffset(), (await JsonAsync(replay)).GetProperty("updatedAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Put_RemindersEmptyOrChosen_AreStoredLargestFirst()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);

        var none = await JsonAsync(await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, Guid.NewGuid()), Body(reminders: [])));
        var chosen = await JsonAsync(await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, Guid.NewGuid()), Body(reminders: [30, 10080])));

        Assert.Empty(none.GetProperty("reminderOffsetsMinutes").EnumerateArray());
        Assert.Equal([10080, 30], chosen.GetProperty("reminderOffsetsMinutes").EnumerateArray().Select(offset => offset.GetInt32()));
    }

    [Theory]
    [InlineData("""{"type":"exam","startsAt":"2026-01-12T10:00:00Z"}""", "title")]
    [InlineData("""{"title":"123456789012345678901234567890123456789012345678901234567890123456789012345678901","type":"exam","startsAt":"2026-01-12T10:00:00Z"}""", "title")]
    [InlineData("""{"title":"Exam","startsAt":"2026-01-12T10:00:00Z"}""", "type")]
    [InlineData("""{"title":"Exam","type":"exam"}""", "startsAt")]
    [InlineData("""{"title":"Exam","type":"exam","startsAt":"1999-12-31T10:00:00Z"}""", "startsAt")]
    [InlineData("""{"title":"Exam","type":"exam","startsAt":"2026-01-12T10:00:00Z","durationMinutes":4}""", "durationMinutes")]
    [InlineData("""{"title":"Exam","type":"exam","startsAt":"2026-01-12T10:00:00Z","durationMinutes":481}""", "durationMinutes")]
    [InlineData("""{"title":"Exam","type":"exam","startsAt":"2026-01-12T10:00:00Z","reminderOffsetsMinutes":[60]}""", "reminderOffsetsMinutes")]
    [InlineData("""{"title":"Exam","type":"exam","startsAt":"2026-01-12T10:00:00Z","reminderOffsetsMinutes":[30,30]}""", "reminderOffsetsMinutes")]
    [InlineData("""{"title":"Exam","type":"exam","startsAt":"2026-01-12T10:00:00Z","doctorName":"Dr\u0000 Ana"}""", "doctorName")]
    public async Task Put_InvalidTerms_Returns400WithTheField(string json, string field)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutJsonAsync(As(baby, BabyRole.Owner), AppointmentPath(baby.BabyId, Guid.NewGuid()), json);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_UnknownTypeCode_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutJsonAsync(As(baby, BabyRole.Owner), AppointmentPath(baby.BabyId, Guid.NewGuid()), """{"title":"X","type":"surgery","startsAt":"2026-01-12T10:00:00Z"}""");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_DoneBeforeTheStart_Returns422AndAfterTheStartIsStored()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var future = Guid.NewGuid();
        var past = Guid.NewGuid();

        var early = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, future), Body(status: "done"));
        var logged = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, past), Body(startsAt: Now.AddHours(-2), status: "done", outcome: "Weight 5.2 kg, all good"));

        var problem = await early.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "appointment_not_started");
        Assert.Equal("status", problem.GetProperty("field").GetString());
        var body = await JsonAsync(logged);
        Assert.Equal(("done", "Weight 5.2 kg, all good"), (body.GetProperty("status").GetString(), body.GetProperty("outcome").GetString()));
    }

    [Fact]
    public async Task Put_Cancel_KeepsTheAppointmentListedAndThereIsNoDelete()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body());

        var cancelled = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(status: "cancelled"));

        Assert.Equal("cancelled", (await JsonAsync(cancelled)).GetProperty("status").GetString());
        Assert.Single(await ListAsync(client, baby.BabyId));
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.DeleteAsync(AppointmentPath(baby.BabyId, id))).StatusCode);
    }

    [Fact]
    public async Task Put_OfflineEditsReplayedOutOfOrder_TheNewerClientTimeWins()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        var created = Now.AddHours(-3);
        await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(updatedAt: created));
        await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(status: "cancelled", updatedAt: created.AddHours(2)));

        var staleEdit = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(title: "Renamed earlier", updatedAt: created.AddHours(1)));
        var replayOfTheCreate = await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(updatedAt: created));

        var stale = await JsonAsync(staleEdit);
        Assert.Equal(("Pediatrician", "cancelled"), (stale.GetProperty("title").GetString(), stale.GetProperty("status").GetString()));
        Assert.Equal(HttpStatusCode.OK, replayOfTheCreate.StatusCode);
        Assert.Equal("cancelled", (await JsonAsync(replayOfTheCreate)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysAppointment_Returns409()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(AppointmentPath(other.BabyId, id), Body());

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(AppointmentPath(mine.BabyId, id), Body());

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "appointment_baby_mismatch");
    }

    [Fact]
    public async Task Get_One_ReturnsItAndUnknownOrAnotherBabysIs404()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        var othersId = Guid.NewGuid();
        await As(mine, BabyRole.Owner).PutAsJsonAsync(AppointmentPath(mine.BabyId, id), Body());
        await As(other, BabyRole.Owner).PutAsJsonAsync(AppointmentPath(other.BabyId, othersId), Body());
        var client = As(mine, BabyRole.Owner);

        var found = await client.GetAsync(AppointmentPath(mine.BabyId, id));
        var unknown = await client.GetAsync(AppointmentPath(mine.BabyId, Guid.NewGuid()));
        var foreign = await client.GetAsync(AppointmentPath(mine.BabyId, othersId));

        Assert.Equal(id, (await JsonAsync(found)).GetProperty("id").GetGuid());
        await unknown.AssertProblemAsync(HttpStatusCode.NotFound, "appointment_not_found");
        await foreign.AssertProblemAsync(HttpStatusCode.NotFound, "appointment_not_found");
    }

    [Fact]
    public async Task List_DeltaSinceACursorAndCalendarRange()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var january = Guid.NewGuid();
        var february = Guid.NewGuid();
        await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, january), Body(startsAt: new DateTimeOffset(2026, 1, 20, 13, 0, 0, TimeSpan.Zero)));
        await client.PutAsJsonAsync(AppointmentPath(baby.BabyId, february), Body(startsAt: new DateTimeOffset(2026, 2, 3, 13, 0, 0, TimeSpan.Zero)));
        var cursor = (await ListAsync(client, baby.BabyId)).Max(item => item.GetProperty("updatedAt").GetDateTimeOffset());

        var range = await ListAsync(client, baby.BabyId, "?from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z");
        var delta = await ListAsync(client, baby.BabyId, $"?since={Uri.EscapeDataString(cursor.AddSeconds(1).ToString("O"))}");
        var all = await ListAsync(client, baby.BabyId);

        Assert.Equal([february], range.Select(item => item.GetProperty("id").GetGuid()));
        Assert.Empty(delta);
        Assert.Equal([january, february], all.Select(item => item.GetProperty("id").GetGuid()));
    }

    [Theory]
    [InlineData("?from=2026-02-01T00:00:00Z&to=2026-02-01T00:00:00Z")]
    [InlineData("?from=2026-01-01T00:00:00Z&to=2027-03-01T00:00:00Z")]
    public async Task List_InvalidRange_Returns400ForTo(string query)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/appointments{query}");

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("to", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Roles_OwnerAndParentWrite_CaregiverAndViewerOnlyRead()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer);
        var id = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body());

        var parent = await As(baby, BabyRole.Parent).PutAsJsonAsync(AppointmentPath(baby.BabyId, Guid.NewGuid()), Body(title: "Vaccines"));
        var caregiver = await As(baby, BabyRole.Caregiver).PutAsJsonAsync(AppointmentPath(baby.BabyId, id), Body(status: "cancelled"));
        var viewer = await As(baby, BabyRole.Viewer).PutAsJsonAsync(AppointmentPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (parent.StatusCode, caregiver.StatusCode, viewer.StatusCode));
        Assert.Equal(2, (await ListAsync(As(baby, BabyRole.Caregiver), baby.BabyId)).Length);
        Assert.Equal(HttpStatusCode.OK, (await As(baby, BabyRole.Viewer).GetAsync(AppointmentPath(baby.BabyId, id))).StatusCode);
    }
}
