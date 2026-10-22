using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Serialization;
using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Application.Events;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// The Caregiver role: logs events, changes only the events they logged (403 <c>event_not_owned</c> otherwise), joins
/// through an invite and can be given or lose the role. The per-endpoint role decisions are in
/// <see cref="Authorization.EndpointRoleMatrixTests"/>.
/// </summary>
public sealed class CaregiverEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new EventPayloadJsonConverter() },
    };

    [Fact]
    public async Task Put_CaregiverCreates_Returns201WithCaregiverAsCreator()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(await factory.UserIdAsync(baby.SubjectOf(BabyRole.Caregiver)), (await ReadEventAsync(response)).CreatedBy);
    }

    [Fact]
    public async Task Put_CaregiverEditsOwnEvent_Returns200AndApplies()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        var client = Caregiver(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        var response = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "second"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("second", (await ReadEventAsync(response)).Notes);
    }

    [Fact]
    public async Task Delete_CaregiverOwnEvent_Returns204AndSoftDeletes()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        var client = Caregiver(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        var response = await client.DeleteAsync(EventPath(baby.BabyId, eventId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.NotNull(await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task Put_CaregiverEditsOthersEvent_Returns403EventNotOwnedAndKeepsEvent()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        var stored = await ReadEventAsync(await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "changed"));

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "event_not_owned");
        Assert.Equal(stored, await ReadEventAsync(await Owner(baby).GetAsync(EventPath(baby.BabyId, eventId))));
    }

    [Fact]
    public async Task Put_CaregiverStaleReplayOfOthersEvent_IsStill403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: Start.AddHours(1)));

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "late", updatedAt: Start));

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "event_not_owned");
    }

    [Fact]
    public async Task Delete_CaregiverOthersEvent_Returns403EventNotOwnedAndKeepsEvent()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Member(baby, BabyRole.Parent).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        var response = await Caregiver(baby).DeleteAsync(EventPath(baby.BabyId, eventId));

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "event_not_owned");
        Assert.Null(await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task Delete_CaregiverUnknownEvent_Returns204()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);

        var response = await Caregiver(baby).DeleteAsync(EventPath(baby.BabyId, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    public async Task PutAndDelete_OwnerOrParentOnCaregiversEvent_Apply(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());
        var client = Member(baby, role);

        var edit = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "fixed"));
        var delete = await client.DeleteAsync(EventPath(baby.BabyId, eventId));

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.NoContent), (edit.StatusCode, delete.StatusCode));
        Assert.NotNull(await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task OutboxReplay_MixedAllowedAndForbiddenItems_ForbiddenOnesDoNotBlockOrLoseTheRest()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var client = Caregiver(baby);
        var (mine, othersEdited, othersDeleted, created) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await client.PutAsJsonAsync(EventPath(baby.BabyId, mine), Body());
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, othersEdited), Body());
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, othersDeleted), Body());

        var othersRunning = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, othersRunning), RunningBottle());

        var statuses = new[]
        {
            (await client.PutAsJsonAsync(EventPath(baby.BabyId, created), Body(notes: "new"))).StatusCode,
            (await client.PutAsJsonAsync(EventPath(baby.BabyId, othersEdited), Body(notes: "not mine"))).StatusCode,
            (await client.DeleteAsync(EventPath(baby.BabyId, othersDeleted))).StatusCode,
            (await client.PutAsJsonAsync(EventPath(baby.BabyId, othersRunning), RunningBottle(endedAt: Start.AddMinutes(15)))).StatusCode,
            (await client.PutAsJsonAsync(EventPath(baby.BabyId, mine), Body(notes: "mine, edited"))).StatusCode,
        };

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.OK, HttpStatusCode.OK], statuses);
        var notes = await factory.QueryAsync(context => context.EventsIncludingDeleted
            .Where(stored => stored.BabyId == baby.BabyId)
            .ToDictionaryAsync(stored => stored.Id, stored => (stored.Notes, stored.DeletedAt == null)));
        Assert.Equal(("new", true), notes[created]);
        Assert.Equal(("first", true), notes[othersEdited]);
        Assert.Equal(("first", true), notes[othersDeleted]);
        Assert.Equal(("mine, edited", true), notes[mine]);
    }

    [Fact]
    public async Task Put_CaregiverStopsOthersRunningBottle_Returns200AndStops()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle());

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(endedAt: Start.AddMinutes(15)));

        var stopped = await ReadEventAsync(response);
        Assert.Equal((DateTimeOffset?)Start.AddMinutes(15), stopped.EndedAt);
        Assert.Equal(await factory.UserIdAsync(baby.OwnerSubject), stopped.CreatedBy);
    }

    [Fact]
    public async Task Put_CaregiverPausesAndResumesOthersRunningTimer_Returns200()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle());
        var client = Caregiver(baby);

        var paused = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(pausedAt: Start.AddMinutes(5)));
        var resumed = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(pauseCount: 1, pausedSeconds: 120));

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (paused.StatusCode, resumed.StatusCode));
        var stored = await ReadEventAsync(resumed);
        Assert.True(EventPayloadOf("""{"method":"bottle","bottle_feeding_type":"formula","pause_count":1,"paused_seconds":120}""").IsEquivalentTo(stored.Payload));
    }

    [Fact]
    public async Task Put_CaregiverAddsTheAmountWhenStopping_Returns200()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle());

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(endedAt: Start.AddMinutes(15), amountMl: 90));

        Assert.True(EventPayloadOf("""{"method":"bottle","bottle_feeding_type":"formula","amount_ml":90}""").IsEquivalentTo((await ReadEventAsync(response)).Payload));
    }

    [Theory]
    [InlineData("start")]
    [InlineData("notes")]
    [InlineData("value")]
    public async Task Put_CaregiverChangesMoreThanStopPauseResume_Returns403(string change)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle());
        var body = change switch
        {
            "start" => RunningBottle(endedAt: Start.AddMinutes(15), startedAt: Start.AddMinutes(-10)),
            "notes" => RunningBottle(endedAt: Start.AddMinutes(15), notes: "changed"),
            _ => RunningBottle(endedAt: Start.AddMinutes(15), content: "breast_milk"),
        };

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), body);

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "event_not_owned");
        Assert.Null((await ReadEventAsync(await Owner(baby).GetAsync(EventPath(baby.BabyId, eventId)))).EndedAt);
    }

    [Fact]
    public async Task Put_CaregiverStopsAgainAnEventAlreadyStopped_Returns403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(endedAt: Start.AddMinutes(15)));

        var response = await Caregiver(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(endedAt: Start.AddMinutes(20)));

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "event_not_owned");
    }

    [Fact]
    public async Task Put_CaregiverRetriesTheSameStop_Returns200Unchanged()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle());
        var client = Caregiver(baby);
        var first = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(endedAt: Start.AddMinutes(15))));

        var retry = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle(endedAt: Start.AddMinutes(15)));

        Assert.Equal(first, await ReadEventAsync(retry));
    }

    [Fact]
    public async Task Delete_CaregiverOthersRunningTimer_Returns403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), RunningBottle());

        var response = await Caregiver(baby).DeleteAsync(EventPath(baby.BabyId, eventId));

        await response.AssertProblemAsync(HttpStatusCode.Forbidden, "event_not_owned");
        Assert.Null(await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task Put_CaregiverLogsDoseFromPrescriptionWithOverride_Returns201()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var owner = Owner(baby);
        var medicationId = Guid.NewGuid();
        var prescriptionId = Guid.NewGuid();
        await owner.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{medicationId}", new { name = "Colidis", isUsual = true });
        var prescribed = await owner.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/prescriptions/{prescriptionId}", new
        {
            medicationId,
            kind = "asNeeded",
            dose = new { amount = 2, unit = "drops" },
            minIntervalMinutes = 480,
            startDate = "2026-01-01",
        });
        Assert.Equal(HttpStatusCode.Created, prescribed.StatusCode);
        var payload = $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"Colidis","prescriptionId":"{{prescriptionId}}","override":true}]}""";
        var at = Start.ToString("O");
        var body = $$"""{"typeId":"{{BuiltInEventTypes.MedicationId}}","startedAt":"{{at}}","endedAt":"{{at}}","payload":{{payload}}}""";

        var response = await Caregiver(baby).PutAsync(EventPath(baby.BabyId, Guid.NewGuid()), new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(await factory.UserIdAsync(baby.SubjectOf(BabyRole.Caregiver)), (await ReadEventAsync(response)).CreatedBy);
    }

    [Fact]
    public async Task Invite_CaregiverRole_AcceptJoinsAsCaregiver()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await (await Owner(baby).PostAsJsonAsync($"/api/v1/babies/{baby.BabyId}/invites", new { role = "Caregiver" })).ReadAsync<CreatedInviteResponse>();
        var grandmother = factory.CreateClientFor(TestUsers.NewSubject(), name: "Grandma Lu");

        var joined = await (await grandmother.PostAsJsonAsync("/api/v1/invites/accept", new { token = created.Token })).ReadAsync<BabyResponse>();

        var members = await (await grandmother.GetAsync($"/api/v1/babies/{baby.BabyId}/members")).ReadAsync<List<MemberResponse>>();
        Assert.Equal((BabyRole.Caregiver, BabyRole.Caregiver), (created.Role, joined.Role));
        Assert.Equal(members.Single(member => member.Role == BabyRole.Caregiver).UserId, joined.UserId);
        Assert.Contains(members, member => member is { DisplayName: "Grandma Lu", Role: BabyRole.Caregiver });
        Assert.Contains(members, member => member is { DisplayName: "Owner", Role: BabyRole.Owner });
    }

    [Fact]
    public async Task ListBabies_Caregiver_ReturnsTheRoleAndTheCallersOwnUserId()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);

        var babies = await (await Caregiver(baby).GetAsync("/api/v1/babies")).ReadAsync<List<BabyResponse>>();

        var listed = Assert.Single(babies);
        Assert.Equal((BabyRole.Caregiver, await factory.UserIdAsync(baby.SubjectOf(BabyRole.Caregiver))), (listed.Role, listed.UserId));
    }

    [Theory]
    [InlineData(BabyRole.Parent, "caregiver", BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer, "Caregiver", BabyRole.Caregiver)]
    [InlineData(BabyRole.Caregiver, "Parent", BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver, "viewer", BabyRole.Viewer)]
    public async Task ChangeRole_OwnerToAndFromCaregiver_Returns200(BabyRole from, string to, BabyRole expected)
    {
        var baby = await factory.SeedBabyAsync(from);
        var userId = await factory.UserIdAsync(baby.SubjectOf(from));

        var response = await Owner(baby).PatchAsJsonAsync($"/api/v1/babies/{baby.BabyId}/members/{userId}", new { role = to });

        Assert.Equal(expected, (await response.ReadAsync<MemberResponse>()).Role);
    }

    [Fact]
    public async Task ChangeRole_ByCaregiver_Returns403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver, BabyRole.Viewer);
        var viewerId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var response = await Caregiver(baby).PatchAsJsonAsync($"/api/v1/babies/{baby.BabyId}/members/{viewerId}", new { role = "Parent" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Put_CaregiverDemotedToViewer_Returns403WithoutProblemCode()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var eventId = Guid.NewGuid();
        var client = Caregiver(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());
        var caregiverId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Caregiver));
        await Owner(baby).PatchAsJsonAsync($"/api/v1/babies/{baby.BabyId}/members/{caregiverId}", new { role = "Viewer" });

        var response = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "offline edit"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(problem.TryGetProperty("code", out _));
    }

    private static string EventPath(Guid babyId, Guid eventId) => $"/api/v1/babies/{babyId}/events/{eventId}";

    private static object Body(string? notes = "first", DateTimeOffset? updatedAt = null) => new
    {
        typeId = BuiltInEventTypes.FeedingId,
        startedAt = Start,
        endedAt = Start.AddMinutes(10),
        payload = new { method = "bottle", amount_ml = 120 },
        notes,
        updatedAt,
    };

    /// <summary>A bottle timer as the owner started it (running, formula, a note), with the changes a test sends.</summary>
    private static object RunningBottle(
        DateTimeOffset? endedAt = null,
        DateTimeOffset? startedAt = null,
        string notes = "night bottle",
        string content = "formula",
        int? amountMl = null,
        DateTimeOffset? pausedAt = null,
        int? pauseCount = null,
        int? pausedSeconds = null)
    {
        var payload = new Dictionary<string, object> { ["method"] = "bottle", ["bottle_feeding_type"] = content };
        AddIfSet(payload, "amount_ml", amountMl);
        AddIfSet(payload, "paused_at", pausedAt);
        AddIfSet(payload, "pause_count", pauseCount);
        AddIfSet(payload, "paused_seconds", pausedSeconds);
        return new { typeId = BuiltInEventTypes.FeedingId, startedAt = startedAt ?? Start, endedAt, payload, notes };
    }

    private static void AddIfSet(Dictionary<string, object> payload, string key, object? value)
    {
        if (value is not null)
        {
            payload[key] = value;
        }
    }

    private static EventPayload EventPayloadOf(string json) => EventPayload.From(json);

    private static async Task<EventResponse> ReadEventAsync(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<EventResponse>(Json))!;
    }

    private HttpClient Owner(SeededBaby baby) => factory.CreateClientFor(baby.OwnerSubject);

    private HttpClient Caregiver(SeededBaby baby) => factory.CreateClientFor(baby.SubjectOf(BabyRole.Caregiver));

    private HttpClient Member(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private Task<DateTimeOffset?> DeletedAtAsync(Guid eventId) =>
        factory.QueryAsync(context => context.EventsIncludingDeleted.Where(stored => stored.Id == eventId).Select(stored => stored.DeletedAt).SingleAsync());
}
