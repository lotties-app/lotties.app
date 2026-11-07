using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// Doctor access, step 1 (docs/design/16-doctor-access.md): the professional profile, Doctor invites, notes with
/// server-side visibility, consultation measurements, the access log and the reminders a Doctor never gets.
/// </summary>
public sealed class DoctorAccessEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProfilePath = "/api/v1/me/professional-profile";

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string NotePath(Guid babyId, Guid noteId) => $"{BabyPath(babyId)}/notes/{noteId}";

    private static string MeasurementPath(Guid babyId, Guid measurementId) => $"{BabyPath(babyId)}/measurements/{measurementId}";

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static object Note(string body = "Offer 120 ml every 3 hours.", string visibility = "shared", string kind = "note", object? updatedAt = null) =>
        new { kind, visibility, body, updatedAt };

    private static object Weight(decimal kg = 5.4m) => new { date = "2026-01-09", weightKg = kg };

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private static async Task<JsonElement[]> ListAsync(HttpClient client, string path) =>
        (await JsonAsync(await client.GetAsync(path))).EnumerateArray().ToArray();

    private static async Task<Guid[]> NoteIdsAsync(HttpClient client, Guid babyId, string? since = null)
    {
        var query = since is null ? string.Empty : $"?since={Uri.EscapeDataString(since)}";
        return (await ListAsync(client, $"{BabyPath(babyId)}/notes{query}")).Select(note => note.GetProperty("id").GetGuid()).ToArray();
    }

    private static Task<HttpResponseMessage> DeclareAsync(HttpClient client, string displayName = "Ana Souza") =>
        client.PutAsJsonAsync(ProfilePath, new { displayName, specialty = "Pediatrics", registrationNumber = "CRM-SP 123456", shareDisplayName = true, shareRegistration = true });

    private async Task<Guid> PutNoteAsync(SeededBaby baby, string visibility, BabyRole author = BabyRole.Doctor)
    {
        var id = Guid.NewGuid();
        var response = await As(baby, author).PutAsJsonAsync(NotePath(baby.BabyId, id), Note(visibility: visibility));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return id;
    }

    private Task<int> AccessEntriesAsync(Guid babyId) =>
        factory.QueryAsync(context => context.AccessLog.CountAsync(entry => entry.BabyId == babyId));

    [Fact]
    public async Task ProfessionalProfile_GetBeforeDeclaring_Returns404ThenPutDeclaresAndUpdates()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var missing = await client.GetAsync(ProfilePath);
        var declared = await DeclareAsync(client);
        var updated = await DeclareAsync(client, "Dra. Ana Souza");
        var stored = await JsonAsync(await client.GetAsync(ProfilePath));

        await missing.AssertProblemAsync(HttpStatusCode.NotFound, "professional_profile_not_found");
        Assert.Equal(HttpStatusCode.Created, declared.StatusCode);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(("doctor", "Dra. Ana Souza", "Pediatrics", "CRM-SP 123456", false), (stored.GetProperty("kind").GetString(), stored.GetProperty("displayName").GetString(), stored.GetProperty("specialty").GetString(), stored.GetProperty("registrationNumber").GetString(), stored.GetProperty("verified").GetBoolean()));
    }

    [Fact]
    public async Task ProfessionalProfile_VerifiedInTheBody_IsIgnoredAndBlankSpecialtyIs400()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var selfVerified = await client.PutAsJsonAsync(ProfilePath, new { displayName = "Ana", specialty = "Pediatrics", verified = true });
        var blank = await client.PutAsJsonAsync(ProfilePath, new { displayName = "Ana", specialty = "  " });

        Assert.False((await JsonAsync(selfVerified)).GetProperty("verified").GetBoolean());
        var problem = await blank.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("specialty", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task AcceptDoctorInvite_WithoutProfile_Is422AndTheInviteStaysUsableUntilSheDeclaresOne()
    {
        var baby = await factory.SeedBabyAsync();
        var invite = await (await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Doctor" })).ReadAsync<CreatedInviteResponse>();
        var doctor = factory.CreateClientFor(TestUsers.NewSubject());

        var refused = await doctor.PostAsJsonAsync("/api/v1/invites/accept", new { token = invite.Token });
        await DeclareAsync(doctor);
        var accepted = await doctor.PostAsJsonAsync("/api/v1/invites/accept", new { token = invite.Token });

        await refused.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "professional_profile_required");
        Assert.Equal("Doctor", (await JsonAsync(accepted)).GetProperty("role").GetString());
        var members = await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/members");
        var professional = members.Single(member => member.GetProperty("role").GetString() == "Doctor").GetProperty("professional");
        Assert.Equal(("Ana Souza", false), (professional.GetProperty("displayName").GetString(), professional.GetProperty("verified").GetBoolean()));
        Assert.Equal(JsonValueKind.Null, members.Single(member => member.GetProperty("role").GetString() == "Owner").GetProperty("professional").ValueKind);
    }

    [Fact]
    public async Task ChangeRoleToDoctor_MemberWithoutProfile_Is422()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var viewerId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var response = await As(baby, BabyRole.Owner).PatchAsJsonAsync($"{BabyPath(baby.BabyId)}/members/{viewerId}", new { role = "Doctor" });

        await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "professional_profile_required");
    }

    [Fact]
    public async Task Notes_PrivateNote_NeverReachesAnotherMemberByListDeltaOrId()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer, BabyRole.Doctor);
        var start = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O");
        var shared = await PutNoteAsync(baby, "shared");
        var hidden = await PutNoteAsync(baby, "private");

        foreach (var role in new[] { BabyRole.Owner, BabyRole.Parent, BabyRole.Viewer })
        {
            var client = As(baby, role);
            Assert.Equal([shared], await NoteIdsAsync(client, baby.BabyId));
            Assert.Equal([shared], await NoteIdsAsync(client, baby.BabyId, start));
            await (await client.GetAsync(NotePath(baby.BabyId, hidden))).AssertProblemAsync(HttpStatusCode.NotFound, "note_not_found");
        }

        Assert.Equal(new[] { shared, hidden }.Order(), (await NoteIdsAsync(As(baby, BabyRole.Doctor), baby.BabyId)).Order());
        Assert.Equal(hidden, (await JsonAsync(await As(baby, BabyRole.Doctor).GetAsync(NotePath(baby.BabyId, hidden)))).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Notes_SecondDoctor_CannotSeeChangeOrDeleteTheFirstDoctorsNotes()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var second = TestUsers.NewSubject();
        await factory.SeedAsync(async context =>
        {
            var user = Lotties.Domain.Users.User.Create(Lotties.Domain.Users.User.UnknownIssuer, second, "Second", TestUsers.Now);
            context.Users.Add(user);
            var stored = await context.Babies.Include(b => b.Members).SingleAsync(b => b.Id == baby.BabyId);
            stored.AddMember(user.Id, BabyRole.Doctor, TestUsers.Now);
        });
        var shared = await PutNoteAsync(baby, "shared");
        var hidden = await PutNoteAsync(baby, "private");
        var other = factory.CreateClientFor(second);

        var editShared = await other.PutAsJsonAsync(NotePath(baby.BabyId, shared), Note(body: "Mine now"));
        var editHidden = await other.PutAsJsonAsync(NotePath(baby.BabyId, hidden), Note(body: "Mine now"));
        var deleteShared = await other.DeleteAsync(NotePath(baby.BabyId, shared));
        var deleteHidden = await other.DeleteAsync(NotePath(baby.BabyId, hidden));

        await editShared.AssertProblemAsync(HttpStatusCode.Forbidden, "note_not_owned");
        await editHidden.AssertProblemAsync(HttpStatusCode.NotFound, "note_not_found");
        await deleteShared.AssertProblemAsync(HttpStatusCode.Forbidden, "note_not_owned");
        Assert.Equal(HttpStatusCode.NoContent, deleteHidden.StatusCode);
        Assert.Equal([shared], await NoteIdsAsync(other, baby.BabyId));
        var stillThere = await JsonAsync(await As(baby, BabyRole.Doctor).GetAsync(NotePath(baby.BabyId, hidden)));
        Assert.Equal(JsonValueKind.Null, stillThere.GetProperty("deletedAt").ValueKind);
    }

    [Fact]
    public async Task Notes_UpsertReplayStaleEditAndDeleteFollowTheSyncContract()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        var id = Guid.NewGuid();
        var editTime = DateTimeOffset.UtcNow.AddMinutes(-5);

        var created = await JsonAsync(await doctor.PutAsJsonAsync(NotePath(baby.BabyId, id), Note(kind: "recommendation", updatedAt: editTime)));
        var replay = await doctor.PutAsJsonAsync(NotePath(baby.BabyId, id), Note(kind: "recommendation", updatedAt: editTime));
        var stale = await JsonAsync(await doctor.PutAsJsonAsync(NotePath(baby.BabyId, id), Note(body: "Older", updatedAt: editTime.AddMinutes(-1))));
        var withdrawn = await doctor.PutAsJsonAsync(NotePath(baby.BabyId, id), Note(visibility: "private", updatedAt: editTime.AddMinutes(1)));
        var delete = await doctor.DeleteAsync(NotePath(baby.BabyId, id));
        var afterDelete = await JsonAsync(await doctor.PutAsJsonAsync(NotePath(baby.BabyId, id), Note(body: "Revived")));

        Assert.Equal(("recommendation", "shared", "Doctor"), (created.GetProperty("kind").GetString(), created.GetProperty("visibility").GetString(), created.GetProperty("author").GetProperty("displayName").GetString()));
        Assert.Equal(JsonValueKind.Null, created.GetProperty("author").GetProperty("professional").ValueKind);
        Assert.Equal(created.GetProperty("updatedAt").GetDateTimeOffset(), (await JsonAsync(replay)).GetProperty("updatedAt").GetDateTimeOffset());
        Assert.Equal("Offer 120 ml every 3 hours.", stale.GetProperty("body").GetString());
        await withdrawn.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "note_already_shared");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.NotEqual(JsonValueKind.Null, afterDelete.GetProperty("deletedAt").ValueKind);
        var ownerView = (await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/notes")).Single();
        Assert.NotEqual(JsonValueKind.Null, ownerView.GetProperty("deletedAt").ValueKind);
    }

    [Fact]
    public async Task Notes_OtherBabysNoteId_Is409AndOwnersCannotWrite()
    {
        var first = await factory.SeedBabyAsync(BabyRole.Doctor);
        var second = await factory.SeedBabyAsync(BabyRole.Doctor);
        var id = await PutNoteAsync(first, "shared");

        var mismatch = await As(second, BabyRole.Doctor).PutAsJsonAsync(NotePath(second.BabyId, id), Note());
        var owner = await As(first, BabyRole.Owner).PutAsJsonAsync(NotePath(first.BabyId, Guid.NewGuid()), Note());

        await mismatch.AssertProblemAsync(HttpStatusCode.Conflict, "note_baby_mismatch");
        Assert.Equal(HttpStatusCode.Forbidden, owner.StatusCode);
    }

    [Fact]
    public async Task RemovedDoctor_HerSharedNotesStayWithHerName()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        await DeclareAsync(As(baby, BabyRole.Doctor));
        var id = await PutNoteAsync(baby, "shared");
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));

        var removed = await As(baby, BabyRole.Owner).DeleteAsync($"{BabyPath(baby.BabyId)}/members/{doctorId}");
        var note = (await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/notes")).Single();

        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        Assert.Equal((id, "Ana Souza"), (note.GetProperty("id").GetGuid(), note.GetProperty("author").GetProperty("displayName").GetString()));
        Assert.False(note.GetProperty("author").GetProperty("professional").GetProperty("verified").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/notes")).StatusCode);
    }

    [Fact]
    public async Task Measurements_DoctorRecordsAndChangesOnlyHerOwn_ParentsDeleteAny()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        await DeclareAsync(As(baby, BabyRole.Doctor));
        var doctor = As(baby, BabyRole.Doctor);
        var hers = Guid.NewGuid();
        var parents = Guid.NewGuid();
        await (await As(baby, BabyRole.Parent).PutAsJsonAsync(MeasurementPath(baby.BabyId, parents), Weight(5.1m))).ReadAsync<JsonElement>();

        var created = await doctor.PutAsJsonAsync(MeasurementPath(baby.BabyId, hers), Weight());
        var edited = await doctor.PutAsJsonAsync(MeasurementPath(baby.BabyId, hers), Weight(5.5m));
        var editOthers = await doctor.PutAsJsonAsync(MeasurementPath(baby.BabyId, parents), Weight(6m));
        var deleteOthers = await doctor.DeleteAsync(MeasurementPath(baby.BabyId, parents));
        var list = await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/measurements");
        var ownerDeletes = await As(baby, BabyRole.Owner).DeleteAsync(MeasurementPath(baby.BabyId, hers));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await JsonAsync(edited);
        Assert.Equal((5.5m, true, "Ana Souza"), (body.GetProperty("weightKg").GetDecimal(), body.GetProperty("recordedByDoctor").GetBoolean(), body.GetProperty("recordedBy").GetProperty("displayName").GetString()));
        await editOthers.AssertProblemAsync(HttpStatusCode.Forbidden, "measurement_not_owned");
        await deleteOthers.AssertProblemAsync(HttpStatusCode.Forbidden, "measurement_not_owned");
        var byParent = list.Single(measurement => measurement.GetProperty("id").GetGuid() == parents);
        Assert.Equal((false, JsonValueKind.Null), (byParent.GetProperty("recordedByDoctor").GetBoolean(), byParent.GetProperty("recordedBy").ValueKind));
        Assert.Equal(HttpStatusCode.NoContent, ownerDeletes.StatusCode);
    }

    [Fact]
    public async Task AccessLog_DoctorReadsAreRecordedAtMostHourly_OthersNever()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Doctor);
        await DeclareAsync(As(baby, BabyRole.Doctor));

        await As(baby, BabyRole.Viewer).GetAsync($"{BabyPath(baby.BabyId)}/events");
        await As(baby, BabyRole.Owner).GetAsync($"{BabyPath(baby.BabyId)}/events");
        var beforeDoctor = await AccessEntriesAsync(baby.BabyId);
        await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/events");
        await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/predictions");
        await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/notes");
        var afterDoctor = await AccessEntriesAsync(baby.BabyId);
        var entries = await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/access-log");

        Assert.Equal((0, 1), (beforeDoctor, afterDoctor));
        var entry = Assert.Single(entries);
        Assert.Equal(("Doctor", "view", "Ana Souza"), (entry.GetProperty("role").GetString(), entry.GetProperty("kind").GetString(), entry.GetProperty("person").GetProperty("displayName").GetString()));
    }

    [Fact]
    public async Task AccessLog_PreviousEntryOlderThanAnHour_RecordsANewOne()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));
        await factory.SeedAsync(context =>
        {
            context.AccessLog.Add(AccessLogEntry.View(baby.BabyId, doctorId, BabyRole.Doctor, DateTimeOffset.UtcNow.AddHours(-2)));
            return Task.CompletedTask;
        });

        await As(baby, BabyRole.Doctor).GetAsync(BabyPath(baby.BabyId));
        await As(baby, BabyRole.Doctor).GetAsync(BabyPath(baby.BabyId));

        Assert.Equal(2, await AccessEntriesAsync(baby.BabyId));
    }

    [Fact]
    public async Task AccessLog_RecentEntry_RecordsNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));
        await factory.SeedAsync(context =>
        {
            context.AccessLog.Add(AccessLogEntry.View(baby.BabyId, doctorId, BabyRole.Doctor, DateTimeOffset.UtcNow.AddMinutes(-10)));
            return Task.CompletedTask;
        });

        await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/measurements");

        Assert.Equal(1, await AccessEntriesAsync(baby.BabyId));
    }

    [Fact]
    public async Task Doctor_CannotLogInviteOrEditTheBaby()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);

        var invite = await doctor.PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Parent" });
        var edit = await doctor.PutAsJsonAsync(BabyPath(baby.BabyId), new { name = "X", birthDate = "2026-01-01" });
        var log = await doctor.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/events/{Guid.NewGuid()}", new { typeId = Guid.NewGuid(), startedAt = "2026-01-09T08:00:00Z" });

        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (invite.StatusCode, edit.StatusCode, log.StatusCode));
    }

    /// <summary>
    /// The family's own records are not clinical data (docs/design/16-doctor-access.md, "Doctor read audit"): a Doctor gets
    /// 403 on the members list, the invites and the access log, and a refused read writes no access log entry; she can
    /// still leave. The family roles still list the members.
    /// </summary>
    [Fact]
    public async Task Doctor_CannotReadMembersInvitesOrAccessLog_ButCanLeave()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);

        var members = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/members");
        var invites = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/invites");
        var accessLog = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/access-log");
        var entries = await AccessEntriesAsync(baby.BabyId);
        var familyLists = await Task.WhenAll(new[] { BabyRole.Owner, BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer }
            .Select(role => As(baby, role).GetAsync($"{BabyPath(baby.BabyId)}/members")));
        var left = await doctor.DeleteAsync($"{BabyPath(baby.BabyId)}/members/me");

        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (members.StatusCode, invites.StatusCode, accessLog.StatusCode));
        Assert.Equal(0, entries);
        Assert.All(familyLists, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal(HttpStatusCode.NoContent, left.StatusCode);
    }
}
