using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>/babies/{id}/formulas</c>: idempotent upsert, one current formula per baby, archive, delta, roles, and the
/// <c>formula_id</c> / <c>formula_name</c> members of a bottle.
/// </summary>
public sealed class FormulaEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string FormulaPath(Guid babyId, Guid formulaId) => $"{BabyPath(babyId)}/formulas/{formulaId}";

    private static object Body(string name = "Aptamil 2", bool isCurrent = false, bool archived = false, object? updatedAt = null) => new
    {
        name,
        brand = "Aptamil",
        stage = "2",
        notes = (string?)null,
        startedOn = "2026-10-01",
        isCurrent,
        archived,
        updatedAt,
    };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private static async Task<JsonElement[]> ListAsync(HttpClient client, Guid babyId, string? since = null)
    {
        var query = since is null ? string.Empty : $"?since={Uri.EscapeDataString(since)}";
        return (await (await client.GetAsync($"{BabyPath(babyId)}/formulas{query}")).ReadAsync<JsonElement>()).EnumerateArray().ToArray();
    }

    private static Task<HttpResponseMessage> PutBottleAsync(HttpClient client, Guid babyId, string formulaMembers, string content = "formula", Guid? eventId = null)
    {
        const string At = "2026-10-20T08:00:00Z";
        var payload = $$"""{"method":"bottle","amount_ml":120,"bottle_feeding_type":"{{content}}"{{formulaMembers}}""" + "}";
        var body = $$"""{"typeId":"{{BuiltInEventTypes.FeedingId}}","startedAt":"{{At}}","endedAt":"{{At}}","payload":{{payload}}""" + "}";
        return client.PutAsync($"{BabyPath(babyId)}/events/{eventId ?? Guid.NewGuid()}", new StringContent(body, Encoding.UTF8, "application/json"));
    }

    [Fact]
    public async Task Put_New_Returns201AndReplayReturnsTheSameRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();

        var created = await client.PutAsJsonAsync(FormulaPath(baby.BabyId, id), Body(name: "  Nan Supreme 1 "));
        var replay = await client.PutAsJsonAsync(FormulaPath(baby.BabyId, id), Body(name: "Nan Supreme 1"));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(FormulaPath(baby.BabyId, id), created.Headers.Location?.OriginalString);
        var body = await JsonAsync(created);
        Assert.Equal(("Nan Supreme 1", "Aptamil", "2", "2026-10-01", false, false), (body.GetProperty("name").GetString(), body.GetProperty("brand").GetString(), body.GetProperty("stage").GetString(), body.GetProperty("startedOn").GetString(), body.GetProperty("isCurrent").GetBoolean(), body.GetProperty("archived").GetBoolean()));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(body.GetProperty("updatedAt").GetDateTimeOffset(), (await JsonAsync(replay)).GetProperty("updatedAt").GetDateTimeOffset());
    }

    [Theory]
    [InlineData("""{"brand":"Nan"}""", "name")]
    [InlineData("""{"name":"1234567890123456789012345678901234567890123456789012345678901"}""", "name")]
    [InlineData("""{"name":"Nan","stage":"12345678901"}""", "stage")]
    [InlineData("""{"name":"Nan","startedOn":"1999-12-31"}""", "startedOn")]
    [InlineData("""{"name":"Na\u0000n"}""", "name")]
    public async Task Put_InvalidTerms_Returns400WithTheField(string json, string field)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsync(FormulaPath(baby.BabyId, Guid.NewGuid()), new StringContent(json, Encoding.UTF8, "application/json"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_SetCurrent_UnsetsTheOtherAtomicallyAndTheDeltaCarriesIt()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await client.PutAsJsonAsync(FormulaPath(baby.BabyId, first), Body(name: "Nan 1", isCurrent: true));
        var cursor = (await ListAsync(client, baby.BabyId)).Single().GetProperty("updatedAt").GetString()!;

        var response = await client.PutAsJsonAsync(FormulaPath(baby.BabyId, second), Body(name: "Aptamil 1", isCurrent: true));

        Assert.True((await JsonAsync(response)).GetProperty("isCurrent").GetBoolean());
        var delta = await ListAsync(client, baby.BabyId, cursor);
        Assert.Equal([(first, false), (second, true)], delta.Select(item => (item.GetProperty("id").GetGuid(), item.GetProperty("isCurrent").GetBoolean())).OrderBy(item => item.Item2));
        Assert.Equal(1, await factory.QueryAsync(context => context.Formulas.CountAsync(formula => formula.BabyId == baby.BabyId && formula.IsCurrent)));
    }

    [Fact]
    public async Task Put_StaleWriteMakingTheOldFormulaCurrentAgain_LosesToTheNewerChoice()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        var at = new DateTimeOffset(2026, 10, 20, 10, 0, 0, TimeSpan.Zero);
        await client.PutAsJsonAsync(FormulaPath(baby.BabyId, first), Body(name: "Nan 1", isCurrent: true, updatedAt: at));
        await client.PutAsJsonAsync(FormulaPath(baby.BabyId, second), Body(name: "Aptamil 1", isCurrent: true, updatedAt: at.AddMinutes(10)));

        var stale = await client.PutAsJsonAsync(FormulaPath(baby.BabyId, first), Body(name: "Nan 1 renamed", isCurrent: true, updatedAt: at.AddMinutes(5)));

        var body = await JsonAsync(stale);
        Assert.Equal(("Nan 1", false), (body.GetProperty("name").GetString(), body.GetProperty("isCurrent").GetBoolean()));
    }

    [Fact]
    public async Task Put_Archive_KeepsTheFormulaListedAndNeverCurrent()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync(FormulaPath(baby.BabyId, id), Body(isCurrent: true));

        var archived = await client.PutAsJsonAsync(FormulaPath(baby.BabyId, id), Body(isCurrent: true, archived: true));

        var body = await JsonAsync(archived);
        Assert.Equal((true, false), (body.GetProperty("archived").GetBoolean(), body.GetProperty("isCurrent").GetBoolean()));
        Assert.Single(await ListAsync(client, baby.BabyId));
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.DeleteAsync(FormulaPath(baby.BabyId, id))).StatusCode);
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysFormula_Returns409()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(FormulaPath(other.BabyId, id), Body());

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(FormulaPath(mine.BabyId, id), Body());

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "formula_baby_mismatch");
    }

    [Fact]
    public async Task Roles_CaregiverAndViewerRead_OnlyOwnerAndParentWrite()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer);
        await As(baby, BabyRole.Owner).PutAsJsonAsync(FormulaPath(baby.BabyId, Guid.NewGuid()), Body());

        var parent = await As(baby, BabyRole.Parent).PutAsJsonAsync(FormulaPath(baby.BabyId, Guid.NewGuid()), Body(name: "Nan 2"));
        var caregiver = await As(baby, BabyRole.Caregiver).PutAsJsonAsync(FormulaPath(baby.BabyId, Guid.NewGuid()), Body(name: "Nan 3"));
        var viewer = await As(baby, BabyRole.Viewer).PutAsJsonAsync(FormulaPath(baby.BabyId, Guid.NewGuid()), Body(name: "Nan 4"));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (parent.StatusCode, caregiver.StatusCode, viewer.StatusCode));
        Assert.Equal(2, (await ListAsync(As(baby, BabyRole.Caregiver), baby.BabyId)).Length);
        Assert.Equal(2, (await ListAsync(As(baby, BabyRole.Viewer), baby.BabyId)).Length);
    }

    [Fact]
    public async Task Bottle_CaregiverSelectsAFormula_AndAFormulaOfAnotherBabyIsRejected()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver);
        var other = await factory.SeedBabyAsync();
        var mine = Guid.NewGuid();
        var theirs = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(FormulaPath(baby.BabyId, mine), Body(isCurrent: true));
        await As(other, BabyRole.Owner).PutAsJsonAsync(FormulaPath(other.BabyId, theirs), Body());
        var caregiver = As(baby, BabyRole.Caregiver);

        var selected = await PutBottleAsync(caregiver, baby.BabyId, $$""","formula_id":"{{mine}}","formula_name":"Aptamil 2" """);
        var foreign = await PutBottleAsync(caregiver, baby.BabyId, $$""","formula_id":"{{theirs}}","formula_name":"Aptamil 2" """);
        var unknown = await PutBottleAsync(caregiver, baby.BabyId, $$""","formula_id":"{{Guid.NewGuid()}}" """);
        var notFormula = await PutBottleAsync(caregiver, baby.BabyId, $$""","formula_id":"{{mine}}" """, content: "breast_milk");
        var legacy = await PutBottleAsync(caregiver, baby.BabyId, string.Empty);

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (selected.StatusCode, legacy.StatusCode));
        Assert.Equal("formula_id", (await foreign.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal("formula_id", (await unknown.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal("formula_id", (await notFormula.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Bottle_RenameAndArchiveLater_KeepTheLoggedNameSnapshot()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var formulaId = Guid.NewGuid();
        var eventId = Guid.NewGuid();
        await client.PutAsJsonAsync(FormulaPath(baby.BabyId, formulaId), Body(name: "Nan 1", isCurrent: true));
        await PutBottleAsync(client, baby.BabyId, $$""","formula_id":"{{formulaId}}","formula_name":"Nan 1" """, eventId: eventId);

        await client.PutAsJsonAsync(FormulaPath(baby.BabyId, formulaId), Body(name: "Nan Supreme 1", archived: true));
        var replayed = await PutBottleAsync(client, baby.BabyId, $$""","formula_id":"{{formulaId}}","formula_name":"Nan 1" """, eventId: eventId);

        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);
        var stored = await (await client.GetAsync($"{BabyPath(baby.BabyId)}/events/{eventId}")).ReadAsync<JsonElement>();
        Assert.Equal("Nan 1", stored.GetProperty("payload").GetProperty("formula_name").GetString());
        Assert.Equal("Nan Supreme 1", (await ListAsync(client, baby.BabyId)).Single().GetProperty("name").GetString());
    }
}
