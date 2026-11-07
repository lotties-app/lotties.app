using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// Doctor scopes (docs/design/16-doctor-access.md): the Owner chooses, per doctor, which sections she sees; the server enforces
/// it on every request. Invites and members carry the scopes, a change applies at once, and the notes, the member list and the
/// access log follow the scopes.
/// </summary>
public sealed class DoctorScopesEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string[] AllCodes = ["daily_log", "growth", "medications", "vaccines", "formulas", "notes"];

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private static string[]? CodesOf(JsonElement element, string property = "doctorScopes") =>
        element.GetProperty(property).ValueKind == JsonValueKind.Null ? null : element.GetProperty(property).EnumerateArray().Select(code => code.GetString()!).ToArray();

    private static Task<HttpResponseMessage> DeclareAsync(HttpClient client) =>
        client.PutAsJsonAsync("/api/v1/me/professional-profile", new { displayName = "Ana Souza", specialty = "Pediatrics", shareDisplayName = true, shareRegistration = true });

    private async Task<Guid> UserIdOfAsync(SeededBaby baby, BabyRole role) => await factory.UserIdAsync(baby.SubjectOf(role));

    private Task<BabyMember> StoredMemberAsync(Guid babyId, Guid userId) =>
        factory.QueryAsync(context => context.BabyMembers.AsNoTracking().SingleAsync(member => member.BabyId == babyId && member.UserId == userId));

    private static Task<HttpResponseMessage> PatchAsync(HttpClient owner, Guid babyId, Guid userId, object body) =>
        owner.PatchAsJsonAsync($"{BabyPath(babyId)}/members/{userId}", body);

    [Fact]
    public async Task Invite_DoctorWithScopes_AreStoredAndReturnedWhenCreatedAndListed()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = As(baby, BabyRole.Owner);

        var created = await owner.PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Doctor", doctorScopes = new[] { "notes", "growth", "growth" } });
        var listed = await JsonAsync(await owner.GetAsync($"{BabyPath(baby.BabyId)}/invites"));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await JsonAsync(created);
        Assert.Equal(["growth", "notes"], CodesOf(body));
        Assert.Equal(["growth", "notes"], CodesOf(listed[0]));
        var stored = await factory.QueryAsync(context => context.Invites.AsNoTracking().SingleAsync(invite => invite.Id == body.GetProperty("id").GetGuid()));
        Assert.Equal("growth,notes", stored.DoctorScopes!.ToStorage());
    }

    [Fact]
    public async Task Invite_DoctorWithoutScopes_MeansEverySection_AndStoresTheDefaults()
    {
        var baby = await factory.SeedBabyAsync();

        var created = await JsonAsync(await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Doctor" }));

        Assert.Equal(AllCodes, CodesOf(created));
        var stored = await factory.QueryAsync(context => context.Invites.AsNoTracking().SingleAsync(invite => invite.Id == created.GetProperty("id").GetGuid()));
        Assert.Null(stored.DoctorScopes);
    }

    [Fact]
    public async Task Invite_DoctorWithAnEmptyList_OpensNoSection()
    {
        var baby = await factory.SeedBabyAsync();

        var created = await JsonAsync(await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Doctor", doctorScopes = Array.Empty<string>() }));

        Assert.Empty(CodesOf(created)!);
    }

    [Theory]
    [InlineData("Parent")]
    [InlineData("Caregiver")]
    [InlineData("Viewer")]
    public async Task Invite_OtherRoles_HaveNoScopes(string role)
    {
        var baby = await factory.SeedBabyAsync();

        var created = await JsonAsync(await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role }));

        Assert.Null(CodesOf(created));
    }

    [Theory]
    [InlineData("Parent")]
    [InlineData("Owner")]
    [InlineData("Caregiver")]
    [InlineData("Viewer")]
    public async Task Invite_ScopesForANonDoctorRole_Is400OnDoctorScopes(string role)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role, doctorScopes = new[] { "growth" } });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("doctorScopes", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData("""{"role":"Doctor","doctorScopes":["bogus"]}""")]
    [InlineData("""{"role":"Doctor","doctorScopes":["growth",null]}""")]
    [InlineData("""{"role":"Doctor","doctorScopes":["Growth"]}""")]
    public async Task Invite_UnknownOrNullScopeCode_Is400OnDoctorScopes(string json)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsync($"{BabyPath(baby.BabyId)}/invites", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("doctorScopes", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Accept_DoctorInviteWithScopes_ReturnsTheBabyWithHerScopes_AndSoDoTheLists()
    {
        var baby = await factory.SeedBabyAsync();
        var owner = As(baby, BabyRole.Owner);
        var invite = await (await owner.PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Doctor", doctorScopes = new[] { "daily_log", "vaccines" } })).ReadAsync<CreatedInviteResponse>();
        var doctor = factory.CreateClientFor(TestUsers.NewSubject());
        await DeclareAsync(doctor);

        var accepted = await JsonAsync(await doctor.PostAsJsonAsync("/api/v1/invites/accept", new { token = invite.Token }));
        var single = await JsonAsync(await doctor.GetAsync(BabyPath(baby.BabyId)));
        var list = await JsonAsync(await doctor.GetAsync("/api/v1/babies"));
        var ownerView = await JsonAsync(await owner.GetAsync(BabyPath(baby.BabyId)));
        var members = (await JsonAsync(await owner.GetAsync($"{BabyPath(baby.BabyId)}/members"))).EnumerateArray().ToArray();

        Assert.Equal(["daily_log", "vaccines"], CodesOf(accepted));
        Assert.Equal(["daily_log", "vaccines"], CodesOf(single));
        Assert.Equal(["daily_log", "vaccines"], CodesOf(Assert.Single(list.EnumerateArray())));
        Assert.Null(CodesOf(ownerView));
        Assert.Equal(["daily_log", "vaccines"], CodesOf(members.Single(member => member.GetProperty("role").GetString() == "Doctor")));
        Assert.Null(CodesOf(members.Single(member => member.GetProperty("role").GetString() == "Owner")));
    }

    [Fact]
    public async Task Accept_DoctorInviteWithoutScopes_GivesEverySection()
    {
        var baby = await factory.SeedBabyAsync();
        var invite = await (await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Doctor" })).ReadAsync<CreatedInviteResponse>();
        var doctor = factory.CreateClientFor(TestUsers.NewSubject());
        await DeclareAsync(doctor);

        var accepted = await JsonAsync(await doctor.PostAsJsonAsync("/api/v1/invites/accept", new { token = invite.Token }));

        Assert.Equal(AllCodes, CodesOf(accepted));
        Assert.Equal(HttpStatusCode.OK, (await doctor.GetAsync($"{BabyPath(baby.BabyId)}/measurements")).StatusCode);
    }

    [Fact]
    public async Task Accept_ParentInvite_ReturnsNullScopes()
    {
        var baby = await factory.SeedBabyAsync();
        var invite = await (await As(baby, BabyRole.Owner).PostAsJsonAsync($"{BabyPath(baby.BabyId)}/invites", new { role = "Parent" })).ReadAsync<CreatedInviteResponse>();

        var accepted = await JsonAsync(await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync("/api/v1/invites/accept", new { token = invite.Token }));

        Assert.Null(CodesOf(accepted));
    }

    [Fact]
    public async Task Create_ABaby_ReturnsNullScopesForItsOwner()
    {
        var parent = factory.CreateClientFor(TestUsers.NewSubject());

        var created = await JsonAsync(await parent.PostAsJsonAsync("/api/v1/babies", new { name = "Lia", birthDate = "2026-01-01" }));

        Assert.Null(CodesOf(created));
    }

    [Fact]
    public async Task Patch_DoctorScopes_ReturnsTheMemberAndTheDoctorsNextRequestIsRefusedAtOnce()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);
        var growthBefore = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/measurements");
        var summaryBefore = await JsonAsync(await doctor.GetAsync($"{BabyPath(baby.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10"));

        var patched = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, doctorId, new { doctorScopes = new[] { "notes", "daily_log" } });
        var growthAfter = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/measurements");
        var eventsAfter = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/events");
        var summaryAfter = await JsonAsync(await doctor.GetAsync($"{BabyPath(baby.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10"));

        Assert.Equal(HttpStatusCode.OK, growthBefore.StatusCode);
        Assert.False(summaryBefore.GetProperty("growth").ValueKind == JsonValueKind.Null);
        var member = await JsonAsync(patched);
        Assert.Equal((doctorId, "Doctor"), (member.GetProperty("userId").GetGuid(), member.GetProperty("role").GetString()));
        Assert.Equal(["daily_log", "notes"], CodesOf(member));
        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.OK), (growthAfter.StatusCode, eventsAfter.StatusCode));
        Assert.Equal(JsonValueKind.Null, summaryAfter.GetProperty("growth").ValueKind);
        Assert.Equal(JsonValueKind.Null, summaryAfter.GetProperty("vaccines").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, summaryAfter.GetProperty("sleep").ValueKind);
        Assert.Equal("daily_log,notes", (await StoredMemberAsync(baby.BabyId, doctorId)).DoctorScopes!.ToStorage());
    }

    [Fact]
    public async Task Patch_EmptyScopes_ClosesEverySectionButTheBabyDetails()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        var patched = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, doctorId, new { doctorScopes = Array.Empty<string>() });

        Assert.Empty(CodesOf(await JsonAsync(patched))!);
        Assert.Equal(HttpStatusCode.Forbidden, (await doctor.GetAsync($"{BabyPath(baby.BabyId)}/events")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await doctor.GetAsync($"{BabyPath(baby.BabyId)}/notes")).StatusCode);
        var details = await JsonAsync(await doctor.GetAsync(BabyPath(baby.BabyId)));
        Assert.Equal(("Lia", 0), (details.GetProperty("name").GetString(), details.GetProperty("doctorScopes").GetArrayLength()));
    }

    [Fact]
    public async Task Patch_ScopesBackToAllSections_ReopensThem()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.None, BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, doctorId, new { doctorScopes = AllCodes });

        Assert.Equal(HttpStatusCode.OK, (await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/events")).StatusCode);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public async Task Patch_ScopesOfAMemberWhoIsNotADoctor_Is400OnDoctorScopes(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(role);
        var userId = await UserIdOfAsync(baby, role);

        var response = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, userId, new { doctorScopes = new[] { "growth" } });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("doctorScopes", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Patch_ScopesOfTheOwner_Is400OnDoctorScopes()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);

        var response = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, ownerId, new { doctorScopes = new[] { "growth" } });

        Assert.Equal("doctorScopes", (await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Patch_ScopesOfAUserWhoIsNotAMember_Is404()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, Guid.NewGuid(), new { doctorScopes = new[] { "growth" } });

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "member_not_found");
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"role":null,"doctorScopes":null}""")]
    public async Task Patch_NeitherRoleNorScopes_Is400OnRole(string json)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        var response = await As(baby, BabyRole.Owner).PatchAsync($"{BabyPath(baby.BabyId)}/members/{doctorId}", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal("role", (await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Theory]
    [InlineData("""{"doctorScopes":["bogus"]}""")]
    [InlineData("""{"doctorScopes":[null]}""")]
    public async Task Patch_UnknownScopeCode_Is400OnDoctorScopes(string json)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        var response = await As(baby, BabyRole.Owner).PatchAsync($"{BabyPath(baby.BabyId)}/members/{doctorId}", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal("doctorScopes", (await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Patch_RoleAndScopesTogether_AppliesTheRoleFirst()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var viewer = As(baby, BabyRole.Viewer);
        await DeclareAsync(viewer);
        var viewerId = await UserIdOfAsync(baby, BabyRole.Viewer);

        var patched = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, viewerId, new { role = "Doctor", doctorScopes = new[] { "vaccines" } });

        var member = await JsonAsync(patched);
        Assert.Equal("Doctor", member.GetProperty("role").GetString());
        Assert.Equal(["vaccines"], CodesOf(member));
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync($"{BabyPath(baby.BabyId)}/vaccinations")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync($"{BabyPath(baby.BabyId)}/events")).StatusCode);
    }

    [Fact]
    public async Task Patch_RoleThatIsNotDoctorWithScopes_Is400AndNothingChanges()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        var response = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, doctorId, new { role = "Parent", doctorScopes = new[] { "growth" } });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(BabyRole.Doctor, (await StoredMemberAsync(baby.BabyId, doctorId)).Role);
    }

    [Fact]
    public async Task Patch_DoctorToAnotherRole_ClearsHerScopes()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Notes]), BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        var patched = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, doctorId, new { role = "Viewer" });

        var member = await JsonAsync(patched);
        Assert.Null(CodesOf(member));
        var stored = await StoredMemberAsync(baby.BabyId, doctorId);
        Assert.Equal((BabyRole.Viewer, null), (stored.Role, stored.DoctorScopes));
        Assert.Equal(HttpStatusCode.OK, (await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/events")).StatusCode);
    }

    [Fact]
    public async Task Patch_RoleOnlyChangeOfADoctorToDoctor_KeepsHerScopes()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Notes]), BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);
        await DeclareAsync(As(baby, BabyRole.Doctor));

        var patched = await PatchAsync(As(baby, BabyRole.Owner), baby.BabyId, doctorId, new { role = "Doctor" });

        Assert.Equal(["notes"], CodesOf(await JsonAsync(patched)));
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Patch_ByAnyoneButTheOwner_Is403(BabyRole caller)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var doctorId = await UserIdOfAsync(baby, BabyRole.Doctor);

        var response = await PatchAsync(As(baby, caller), baby.BabyId, doctorId, new { doctorScopes = new[] { "growth" } });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Members_AFamilyMemberSeesTheScopesOfTheDoctor_TheDoctorCannotListMembersAtAll()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Growth]), BabyRole.Parent, BabyRole.Viewer, BabyRole.Doctor);

        var asViewer = (await JsonAsync(await As(baby, BabyRole.Viewer).GetAsync($"{BabyPath(baby.BabyId)}/members"))).EnumerateArray().ToArray();
        var asDoctor = await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/members");

        Assert.Equal(["growth"], CodesOf(asViewer.Single(member => member.GetProperty("role").GetString() == "Doctor")));
        Assert.All(asViewer.Where(member => member.GetProperty("role").GetString() != "Doctor"), member => Assert.Null(CodesOf(member)));
        Assert.Equal(HttpStatusCode.Forbidden, asDoctor.StatusCode);
    }

    [Fact]
    public async Task Enforcement_DoctorWithOnlyGrowth_ReadsMeasurementsAndNothingElseOfTheBabysData()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Growth]), BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        var path = BabyPath(baby.BabyId);

        var statuses = new Dictionary<string, HttpStatusCode>();
        foreach (var route in new[] { "measurements", "events", "event-types", "predictions", "medications", "prescriptions", "medications/status", "prescription-proposals", "formulas", "vaccinations", "notes", "note-reads" })
        {
            statuses[route] = (await doctor.GetAsync($"{path}/{route}")).StatusCode;
        }

        Assert.Equal(HttpStatusCode.OK, statuses["measurements"]);
        Assert.All(statuses.Where(item => item.Key != "measurements"), item => Assert.True(item.Value == HttpStatusCode.Forbidden, $"{item.Key}: {(int)item.Value}"));
    }

    [Fact]
    public async Task Enforcement_AGrowthDoctorWritesHerConsultationMeasurement_ADoctorWithoutGrowthCannot()
    {
        var withGrowth = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Growth]), BabyRole.Doctor);
        var withoutGrowth = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.DailyLog]), BabyRole.Doctor);
        var body = new { date = "2026-01-09", weightKg = 5.4m };

        var allowed = await As(withGrowth, BabyRole.Doctor).PutAsJsonAsync($"{BabyPath(withGrowth.BabyId)}/measurements/{Guid.NewGuid()}", body);
        var refused = await As(withoutGrowth, BabyRole.Doctor).PutAsJsonAsync($"{BabyPath(withoutGrowth.BabyId)}/measurements/{Guid.NewGuid()}", body);

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Forbidden), (allowed.StatusCode, refused.StatusCode));
    }

    [Fact]
    public async Task Enforcement_AnotherBabysScopesDoNotLeakAcross()
    {
        var doctor = await factory.SeedUserAsync();
        var open = await factory.SeedPatientAsync(doctor.UserId, "Open", DoctorScopeSet.All);
        var closed = await factory.SeedPatientAsync(doctor.UserId, "Closed", DoctorScopeSet.None);
        var client = factory.CreateClientFor(doctor.Subject);

        var openEvents = await client.GetAsync($"{BabyPath(open.BabyId)}/events");
        var closedEvents = await client.GetAsync($"{BabyPath(closed.BabyId)}/events");

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.Forbidden), (openEvents.StatusCode, closedEvents.StatusCode));
    }

    [Fact]
    public async Task Notes_DoctorWithTheNotesScope_WritesAndReadsHerNotes_APrivateNoteOfAnotherDoctorStaysInvisible()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Notes]), BabyRole.Doctor, BabyRole.Viewer);
        var second = await SecondDoctorAsync(baby, DoctorScopeSet.Create([DoctorScope.Notes]));
        var first = As(baby, BabyRole.Doctor);
        var sharedId = Guid.NewGuid();
        var privateId = Guid.NewGuid();
        var notePath = (Guid id) => $"{BabyPath(baby.BabyId)}/notes/{id}";

        var shared = await first.PutAsJsonAsync(notePath(sharedId), new { kind = "note", visibility = "shared", body = "Offer 120 ml." });
        var hidden = await first.PutAsJsonAsync(notePath(privateId), new { kind = "note", visibility = "private", body = "My own reminder." });
        var secondSees = (await JsonAsync(await second.GetAsync($"{BabyPath(baby.BabyId)}/notes"))).EnumerateArray().Select(note => note.GetProperty("id").GetGuid()).ToArray();
        var secondOpensHidden = await second.GetAsync(notePath(privateId));
        var firstSees = (await JsonAsync(await first.GetAsync($"{BabyPath(baby.BabyId)}/notes"))).EnumerateArray().Select(note => note.GetProperty("id").GetGuid()).Order().ToArray();

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (shared.StatusCode, hidden.StatusCode));
        Assert.Equal([sharedId], secondSees);
        await secondOpensHidden.AssertProblemAsync(HttpStatusCode.NotFound, "note_not_found");
        Assert.Equal(new[] { sharedId, privateId }.Order(), firstSees);
    }

    [Fact]
    public async Task Notes_DoctorWithoutTheNotesScope_CannotListReadOrWriteNotes_ParentsStillSeeTheSharedOnes()
    {
        var baby = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.DailyLog, DoctorScope.Growth]), BabyRole.Doctor, BabyRole.Parent);
        var doctor = As(baby, BabyRole.Doctor);
        var noteId = Guid.NewGuid();
        var withNotes = await SecondDoctorAsync(baby, DoctorScopeSet.Create([DoctorScope.Notes]));
        await withNotes.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}", new { kind = "note", visibility = "shared", body = "Hello." });

        var list = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/notes");
        var one = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}");
        var write = await doctor.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/notes/{Guid.NewGuid()}", new { kind = "note", visibility = "shared", body = "Nope." });
        var delete = await doctor.DeleteAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}");
        var read = await doctor.PutAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}/read", null);
        var reads = await doctor.GetAsync($"{BabyPath(baby.BabyId)}/note-reads");
        var parentSees = await JsonAsync(await As(baby, BabyRole.Parent).GetAsync($"{BabyPath(baby.BabyId)}/notes"));

        Assert.All(new[] { list, one, write, delete, read, reads }, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
        Assert.Equal(noteId, Assert.Single(parentSees.EnumerateArray()).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Proposals_DoctorNeedsTheMedicationsScopeToProposeAndToListHerProposals()
    {
        var withScope = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Medications]), BabyRole.Doctor);
        var withoutScope = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Notes]), BabyRole.Doctor);
        var proposal = new { medicationName = "Paracetamol drops", kind = "scheduled", dose = new { amount = 2, unit = "drops" }, timesOfDay = new[] { "08:00" }, startDate = "2026-10-22" };

        var allowed = await As(withScope, BabyRole.Doctor).PutAsJsonAsync($"{BabyPath(withScope.BabyId)}/prescription-proposals/{Guid.NewGuid()}", proposal);
        var listed = await As(withScope, BabyRole.Doctor).GetAsync($"{BabyPath(withScope.BabyId)}/prescription-proposals");
        var refused = await As(withoutScope, BabyRole.Doctor).PutAsJsonAsync($"{BabyPath(withoutScope.BabyId)}/prescription-proposals/{Guid.NewGuid()}", proposal);

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.Forbidden), (allowed.StatusCode, listed.StatusCode, refused.StatusCode));
    }

    [Fact]
    public async Task AccessLog_ClinicalSummaryAndTimeline_WriteOneEntryPerHourPerDoctorAndBaby()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        var summary = $"{BabyPath(baby.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10";
        var timeline = $"{BabyPath(baby.BabyId)}/timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z";

        await doctor.GetAsync(summary);
        var afterSummary = await factory.AccessEntriesAsync(baby.BabyId);
        await doctor.GetAsync(summary);
        await doctor.GetAsync(timeline);
        await doctor.GetAsync(timeline);
        var afterAll = await factory.AccessEntriesAsync(baby.BabyId);

        Assert.Equal((1, 1), (afterSummary, afterAll));
        var entry = Assert.Single(await JsonListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/access-log"));
        Assert.Equal(("Doctor", "view"), (entry.GetProperty("role").GetString(), entry.GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task AccessLog_TimelineAlone_WritesAnEntry_AndARefusedScopeWritesNothing()
    {
        var allowed = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.DailyLog]), BabyRole.Doctor);
        var refused = await factory.SeedBabyAsync(DoctorScopeSet.Create([DoctorScope.Notes]), BabyRole.Doctor);
        const string Timeline = "timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z";

        await As(allowed, BabyRole.Doctor).GetAsync($"{BabyPath(allowed.BabyId)}/{Timeline}");
        await As(refused, BabyRole.Doctor).GetAsync($"{BabyPath(refused.BabyId)}/{Timeline}");

        Assert.Equal((1, 0), (await factory.AccessEntriesAsync(allowed.BabyId), await factory.AccessEntriesAsync(refused.BabyId)));
    }

    [Fact]
    public async Task AccessLog_MembersWhoAreNotDoctors_AreNeverLoggedForTheNewRoutes()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);

        await As(baby, BabyRole.Parent).GetAsync($"{BabyPath(baby.BabyId)}/clinical-summary?from=2026-01-08&to=2026-01-10");
        await As(baby, BabyRole.Viewer).GetAsync($"{BabyPath(baby.BabyId)}/timeline?from=2026-01-09T03:00:00Z&to=2026-01-10T03:00:00Z");

        Assert.Equal(0, await factory.AccessEntriesAsync(baby.BabyId));
    }

    private static async Task<JsonElement[]> JsonListAsync(HttpClient client, string path) =>
        (await JsonAsync(await client.GetAsync(path))).EnumerateArray().ToArray();

    private async Task<HttpClient> SecondDoctorAsync(SeededBaby baby, DoctorScopeSet scopes)
    {
        var subject = TestUsers.NewSubject();
        await factory.SeedAsync(async context =>
        {
            var user = Lotties.Domain.Users.User.Create(Lotties.Domain.Users.User.UnknownIssuer, subject, "Second", TestUsers.Now);
            context.Users.Add(user);
            var stored = await context.Babies.Include(b => b.Members).SingleAsync(b => b.Id == baby.BabyId);
            stored.AddMember(user.Id, BabyRole.Doctor, TestUsers.Now);
            stored.ChangeDoctorScopes(user.Id, scopes);
        });
        return factory.CreateClientFor(subject);
    }
}
