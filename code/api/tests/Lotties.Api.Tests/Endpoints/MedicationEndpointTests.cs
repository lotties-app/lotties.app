using System.Net;
using System.Net.Http.Json;
using System.Text;
using Lotties.Api.Tests.Support;
using Lotties.Application.Medications;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

public sealed class MedicationEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string MedicationsPath(Guid babyId) => $"/api/v1/babies/{babyId}/medications";

    private static string MedicationPath(Guid babyId, Guid medicationId) => $"{MedicationsPath(babyId)}/{medicationId}";

    private static object Body(string name = "Simethicone", bool isUsual = true, object? defaultDosage = null, string? notes = null) =>
        new { name, defaultDosage, notes, isUsual };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private Task<int> CountAsync(Guid medicationId) =>
        factory.QueryAsync(context => context.Medications.CountAsync(medication => medication.Id == medicationId));

    [Fact]
    public async Task Put_New_Returns201WithLocationAndStoredState()
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(
            MedicationPath(baby.BabyId, id),
            Body(defaultDosage: new { amount = 2.5, unit = "ml" }, notes: "after meals"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(MedicationPath(baby.BabyId, id), response.Headers.Location?.OriginalString);
        var created = await response.ReadAsync<MedicationResponse>();
        Assert.Equal((id, baby.BabyId, "Simethicone", true, "after meals"), (created.Id, created.BabyId, created.Name, created.IsUsual, created.Notes));
        Assert.Equal((2.5m, "ml"), (created.DefaultDosage!.Amount, created.DefaultDosage.Unit));
    }

    [Fact]
    public async Task Put_ExactBodyTheWebClientSends_IsAccepted()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsync(
            MedicationPath(baby.BabyId, Guid.NewGuid()),
            new StringContent("""{"name":"Colidis","defaultDosage":null,"notes":null,"isUsual":false}""", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Put_SameRequestTwice_IsIdempotentAndKeepsOneRow()
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        var client = As(baby, BabyRole.Owner);
        var first = await (await client.PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body())).ReadAsync<MedicationResponse>();

        var replay = await client.PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body());

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(first, await replay.ReadAsync<MedicationResponse>());
        Assert.Equal(1, await CountAsync(id));
    }

    [Fact]
    public async Task Put_ChangedState_EditsInPlaceAndKeepsCreatedAt()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var id = Guid.NewGuid();
        var first = await (await As(baby, BabyRole.Owner).PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body())).ReadAsync<MedicationResponse>();

        var response = await As(baby, BabyRole.Parent).PutAsJsonAsync(
            MedicationPath(baby.BabyId, id),
            Body(name: "Paracetamol", isUsual: false, defaultDosage: new { amount = 5, unit = "ml" }, notes: "fever"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var edited = await response.ReadAsync<MedicationResponse>();
        Assert.Equal(("Paracetamol", false, "fever", 5m, first.CreatedAt), (edited.Name, edited.IsUsual, edited.Notes, edited.DefaultDosage!.Amount, edited.CreatedAt));
        Assert.Equal(1, await CountAsync(id));
    }

    [Fact]
    public async Task Put_NullDosageAfterDosage_ClearsDosage()
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        var client = As(baby, BabyRole.Owner);
        await client.PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body(defaultDosage: new { amount = 1, unit = "ml" }));

        var response = await client.PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body());

        Assert.Null((await response.ReadAsync<MedicationResponse>()).DefaultDosage);
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysMedication_Returns409AndLeavesItAlone()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(MedicationPath(other.BabyId, id), Body(name: "Theirs"));

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(MedicationPath(mine.BabyId, id), Body(name: "Mine"));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "medication_baby_mismatch");
        Assert.Equal("Theirs", (await factory.QueryAsync(context => context.Medications.SingleAsync(medication => medication.Id == id))).Name);
    }

    [Fact]
    public async Task Put_Viewer_Returns403AndCreatesNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Viewer).PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task Put_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(MedicationPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Put_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().PutAsJsonAsync(MedicationPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Put_EmptyGuid_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(MedicationPath(baby.BabyId, Guid.Empty), Body());

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Theory]
    [InlineData("""{"name":" ","isUsual":false}""")]
    [InlineData("""{"isUsual":false}""")]
    [InlineData("""{"name":"X","defaultDosage":{"amount":0,"unit":"ml"}}""")]
    [InlineData("""{"name":"X","defaultDosage":{"amount":1,"unit":" "}}""")]
    [InlineData("""{"name":"X","defaultDosage":{"amount":1}}""")]
    [InlineData("""not json""")]
    public async Task Put_Invalid_Returns400(string json)
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Owner).PutAsync(MedicationPath(baby.BabyId, id), new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task List_Viewer_ReturnsUsualFirstThenByNameAndOnlyOwnBaby()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var other = await factory.SeedBabyAsync();
        var owner = As(baby, BabyRole.Owner);
        await owner.PutAsJsonAsync(MedicationPath(baby.BabyId, Guid.NewGuid()), Body(name: "Zeta", isUsual: false));
        await owner.PutAsJsonAsync(MedicationPath(baby.BabyId, Guid.NewGuid()), Body(name: "Beta", isUsual: false));
        await owner.PutAsJsonAsync(MedicationPath(baby.BabyId, Guid.NewGuid()), Body(name: "Omega", isUsual: true));
        await As(other, BabyRole.Owner).PutAsJsonAsync(MedicationPath(other.BabyId, Guid.NewGuid()), Body(name: "Foreign"));

        var items = await (await As(baby, BabyRole.Viewer).GetAsync(MedicationsPath(baby.BabyId))).ReadAsync<List<MedicationResponse>>();

        Assert.Equal(["Omega", "Beta", "Zeta"], items.Select(item => item.Name));
    }

    [Fact]
    public async Task List_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(MedicationsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task List_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(MedicationsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_Parent_HardDeletesAndIsIdempotent()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var id = Guid.NewGuid();
        var client = As(baby, BabyRole.Parent);
        await client.PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body());

        var first = await client.DeleteAsync(MedicationPath(baby.BabyId, id));
        var second = await client.DeleteAsync(MedicationPath(baby.BabyId, id));

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (first.StatusCode, second.StatusCode));
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task Delete_IdOfAnotherBabysMedication_Returns204AndLeavesItAlone()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(MedicationPath(other.BabyId, id), Body());

        var response = await As(mine, BabyRole.Owner).DeleteAsync(MedicationPath(mine.BabyId, id));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(1, await CountAsync(id));
    }

    [Fact]
    public async Task Delete_Viewer_Returns403AndKeepsMedication()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var id = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(MedicationPath(baby.BabyId, id), Body());

        var response = await As(baby, BabyRole.Viewer).DeleteAsync(MedicationPath(baby.BabyId, id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(1, await CountAsync(id));
    }
}
