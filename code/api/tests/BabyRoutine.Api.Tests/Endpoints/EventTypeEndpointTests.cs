using System.Net;
using System.Net.Http.Json;
using System.Text;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.EventTypes;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Api.Tests.Endpoints;

public sealed class EventTypeEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string TypesPath(Guid babyId) => $"/api/v1/babies/{babyId}/event-types";

    private static string TypePath(Guid babyId, Guid typeId) => $"{TypesPath(babyId)}/{typeId}";

    private static object NewType(string key = "pumping", string name = "Pumping") => new
    {
        key,
        name,
        icon = "water_drop",
        color = "#123ABC",
        hasDuration = true,
        fields = new object[]
        {
            new { key = "amount_ml", label = "Amount", kind = "number", min = 0, unit = "ml" },
            new { key = "side", label = "Side", kind = "select", isRequired = true, options = new[] { "left", "right" } },
        },
    };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private async Task<EventTypeResponse> CreateAsync(SeededBaby baby, string key = "pumping")
    {
        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(TypesPath(baby.BabyId), NewType(key));
        return await response.ReadAsync<EventTypeResponse>();
    }

    [Fact]
    public async Task List_Viewer_ReturnsBuiltInsFirstThenOwnCustomTypesOnly()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var other = await factory.SeedBabyAsync();
        var mine = await CreateAsync(baby);
        await As(other, BabyRole.Owner).PostAsJsonAsync(TypesPath(other.BabyId), NewType("foreign"));

        var types = await (await As(baby, BabyRole.Viewer).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        Assert.Equal(BuiltInEventTypes.All.Count + 1, types.Count);
        Assert.All(types.Take(BuiltInEventTypes.All.Count), type => Assert.Null(type.BabyId));
        Assert.Equal(mine.Id, types[^1].Id);
        Assert.DoesNotContain(types, type => type.Key == "foreign");
    }

    [Fact]
    public async Task List_DiaperBuiltIn_CarriesRequiredContentSelectWithCamelCaseKind()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).GetAsync(TypesPath(baby.BabyId));

        var types = await response.ReadAsync<List<EventTypeResponse>>();
        var content = Assert.Single(types.Single(type => type.Key == "diaper").Fields);
        Assert.Equal(("content", EventFieldKind.Select, true), (content.Key, content.Kind, content.IsRequired));
        Assert.Equal(["WET", "DIRTY", "MIXED"], content.Options);
        Assert.Contains("\"kind\":\"select\"", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task List_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(TypesPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task List_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(TypesPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    public async Task Create_Writer_Returns201WithFields(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);

        var response = await As(baby, role).PostAsJsonAsync(TypesPath(baby.BabyId), NewType());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.ReadAsync<EventTypeResponse>();
        Assert.Equal(TypePath(baby.BabyId, created.Id), response.Headers.Location?.OriginalString);
        Assert.Equal((baby.BabyId, "pumping", "#123abc", true), (created.BabyId, created.Key, created.Color, created.HasDuration));
        Assert.Equal(["amount_ml", "side"], created.Fields.Select(field => field.Key));
        Assert.Equal(["left", "right"], created.Fields[1].Options);
    }

    [Fact]
    public async Task Create_Viewer_Returns403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);

        var response = await As(baby, BabyRole.Viewer).PostAsJsonAsync(TypesPath(baby.BabyId), NewType());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Create_DuplicateCustomKey_Returns409()
    {
        var baby = await factory.SeedBabyAsync();
        await CreateAsync(baby);

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(TypesPath(baby.BabyId), NewType());

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "event_type_key_taken");
    }

    [Theory]
    [InlineData("constructor")]
    [InlineData("not_an_icon")]
    public async Task Create_IconNotInAllowlist_Returns400OnIcon(string icon)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(TypesPath(baby.BabyId), new { key = "pumping", name = "Pumping", icon, color = "#123456", hasDuration = false });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("Icon", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData("constructor", "Key")]
    [InlineData("prototype", "Key")]
    [InlineData("__proto__", "Key")]
    [InlineData("toString", "Key")]
    public async Task Create_ReservedFieldKey_Returns400(string fieldKey, string field)
    {
        var baby = await factory.SeedBabyAsync();
        var body = new { key = "pumping", name = "Pumping", icon = "star", color = "#123456", hasDuration = false, fields = new[] { new { key = fieldKey, label = "Label", kind = "text" } } };

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(TypesPath(baby.BabyId), body);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Update_TooManyFields_Returns400()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateAsync(baby);
        var fields = Enumerable.Range(0, EventType.MaxFields + 1).Select(index => new { key = $"field_{index}", label = "Label", kind = "bool" });

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(TypePath(baby.BabyId, created.Id), new { name = "Pump", icon = "star", color = "#654321", hasDuration = false, fields });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("Fields", problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Create_KeyOfBuiltIn_Returns409()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(TypesPath(baby.BabyId), NewType("feeding"));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "event_type_key_taken");
    }

    [Fact]
    public async Task Create_SameKeyForAnotherBaby_Returns201()
    {
        var first = await factory.SeedBabyAsync();
        var second = await factory.SeedBabyAsync();
        await As(first, BabyRole.Owner).PostAsJsonAsync(TypesPath(first.BabyId), NewType());

        var response = await As(second, BabyRole.Owner).PostAsJsonAsync(TypesPath(second.BabyId), NewType());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Theory]
    [InlineData("""{"key":"Bad Key","name":"X","icon":"i","color":"#112233"}""")]
    [InlineData("""{"key":"ok","name":" ","icon":"i","color":"#112233"}""")]
    [InlineData("""{"key":"ok","name":"X","icon":"i","color":"red"}""")]
    [InlineData("""{"key":"ok","name":"X","icon":"i","color":"#112233","fields":[{"key":"a","label":"A","kind":"select"}]}""")]
    [InlineData("""{"key":"ok","name":"X","icon":"i","color":"#112233","fields":[{"key":"a","label":"A","kind":"text"},{"key":"a","label":"B","kind":"text"}]}""")]
    [InlineData("""{"key":"ok","name":"X","icon":"i","color":"#112233","fields":[{"key":"a","label":"A","kind":"number","min":5,"max":1}]}""")]
    [InlineData("""{"key":"ok","name":"X","icon":"i","color":"#112233","fields":[{"key":"a","label":"A","kind":"unknown"}]}""")]
    [InlineData("""{"name":"X","icon":"i","color":"#112233"}""")]
    public async Task Create_Invalid_Returns400(string json)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsync(TypesPath(baby.BabyId), new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Update_Custom_ReplacesDetailsAndKeepsKey()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var created = await CreateAsync(baby);

        var response = await As(baby, BabyRole.Parent).PutAsJsonAsync(
            TypePath(baby.BabyId, created.Id),
            new { name = "Pump", icon = "star", color = "#654321", hasDuration = false, fields = Array.Empty<object>() });

        var updated = await response.ReadAsync<EventTypeResponse>();
        Assert.Equal(("pumping", "Pump", "star", "#654321", false), (updated.Key, updated.Name, updated.Icon, updated.Color, updated.HasDuration));
        Assert.Empty(updated.Fields);
        var stored = await factory.QueryAsync(context => context.EventTypes.SingleAsync(type => type.Id == created.Id));
        Assert.Empty(stored.Fields);
    }

    [Fact]
    public async Task Update_BuiltIn_Returns409ReadOnly()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(
            TypePath(baby.BabyId, BuiltInEventTypes.SleepId),
            new { name = "Nap", icon = "bedtime", color = "#7e57c2", hasDuration = true });

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "event_type_built_in_read_only");
    }

    [Fact]
    public async Task Update_TypeOfAnotherBaby_Returns404()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var foreign = await CreateAsync(other);

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(
            TypePath(mine.BabyId, foreign.Id),
            new { name = "Mine now", icon = "star", color = "#112233", hasDuration = false });

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "event_type_not_found");
    }

    [Fact]
    public async Task Update_Viewer_Returns403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var created = await CreateAsync(baby);

        var response = await As(baby, BabyRole.Viewer).PutAsJsonAsync(
            TypePath(baby.BabyId, created.Id),
            new { name = "Nope", icon = "star", color = "#112233", hasDuration = false });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Delete_UnusedCustom_Returns204AndRemovesIt()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateAsync(baby);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(TypePath(baby.BabyId, created.Id));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False(await factory.QueryAsync(context => context.EventTypes.AnyAsync(type => type.Id == created.Id)));
    }

    [Fact]
    public async Task Delete_TypeUsedByEvent_Returns409AndKeepsIt()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateAsync(baby);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        await factory.SeedAsync(context =>
        {
            context.Events.Add(Event.Create(Guid.NewGuid(), baby.BabyId, created.Id, ownerId, TestUsers.Now, null, EventPayload.Empty, null, TestUsers.Now));
            return Task.CompletedTask;
        });

        var response = await As(baby, BabyRole.Owner).DeleteAsync(TypePath(baby.BabyId, created.Id));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "event_type_in_use");
        Assert.True(await factory.QueryAsync(context => context.EventTypes.AnyAsync(type => type.Id == created.Id)));
    }

    [Fact]
    public async Task Delete_TypeUsedOnlyBySoftDeletedEvent_Returns409()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateAsync(baby);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var deleted = Event.Create(Guid.NewGuid(), baby.BabyId, created.Id, ownerId, TestUsers.Now, null, EventPayload.Empty, null, TestUsers.Now);
        deleted.SoftDelete(TestUsers.Now.AddMinutes(1));
        await factory.SeedAsync(context =>
        {
            context.Events.Add(deleted);
            return Task.CompletedTask;
        });

        var response = await As(baby, BabyRole.Owner).DeleteAsync(TypePath(baby.BabyId, created.Id));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "event_type_in_use");
    }

    [Fact]
    public async Task Delete_BuiltIn_Returns409ReadOnly()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).DeleteAsync(TypePath(baby.BabyId, BuiltInEventTypes.DiaperId));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "event_type_built_in_read_only");
    }

    [Fact]
    public async Task Delete_Unknown_Returns404()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).DeleteAsync(TypePath(baby.BabyId, Guid.NewGuid()));

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "event_type_not_found");
    }

    [Fact]
    public async Task Delete_Viewer_Returns403()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var created = await CreateAsync(baby);

        var response = await As(baby, BabyRole.Viewer).DeleteAsync(TypePath(baby.BabyId, created.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
