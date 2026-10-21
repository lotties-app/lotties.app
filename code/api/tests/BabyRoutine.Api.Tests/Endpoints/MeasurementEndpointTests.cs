using System.Net;
using System.Net.Http.Json;
using System.Text;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Measurements;
using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Api.Tests.Endpoints;

public sealed class MeasurementEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private static string MeasurementsPath(Guid babyId) => $"/api/v1/babies/{babyId}/measurements";

    private static string MeasurementPath(Guid babyId, Guid measurementId) => $"{MeasurementsPath(babyId)}/{measurementId}";

    private static object Body(DateOnly? date = null, decimal? weightKg = 5.2m, decimal? heightCm = null, decimal? headCircumferenceCm = null, string? notes = null) =>
        new { date = (date ?? Today).ToString("yyyy-MM-dd"), weightKg, heightCm, headCircumferenceCm, notes };

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private Task<int> CountAsync(Guid measurementId) =>
        factory.QueryAsync(context => context.Measurements.CountAsync(measurement => measurement.Id == measurementId));

    [Fact]
    public async Task Put_New_Returns201WithLocationAndStoredState()
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(
            MeasurementPath(baby.BabyId, id),
            Body(weightKg: 5.2m, heightCm: 58.5m, headCircumferenceCm: 38m, notes: "check-up"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(MeasurementPath(baby.BabyId, id), response.Headers.Location?.OriginalString);
        var created = await response.ReadAsync<MeasurementResponse>();
        Assert.Equal(
            (id, baby.BabyId, Today, (decimal?)5.2m, (decimal?)58.5m, (decimal?)38m, "check-up"),
            (created.Id, created.BabyId, created.Date, created.WeightKg, created.HeightCm, created.HeadCircumferenceCm, created.Notes));
        Assert.Equal(created.CreatedAt, created.UpdatedAt);
    }

    [Fact]
    public async Task Put_ExactBodyTheWebClientSends_IsAcceptedWithEmptyValues()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsync(
            MeasurementPath(baby.BabyId, Guid.NewGuid()),
            new StringContent("""{"date":"2026-03-04","weightKg":4.8,"heightCm":null,"headCircumferenceCm":null,"notes":null}""", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Put_SameRequestTwice_IsIdempotentAndKeepsOneRow()
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        var client = As(baby, BabyRole.Owner);
        var first = await (await client.PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body())).ReadAsync<MeasurementResponse>();

        var replay = await client.PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body());

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(first, await replay.ReadAsync<MeasurementResponse>());
        Assert.Equal(1, await CountAsync(id));
    }

    [Fact]
    public async Task Put_ChangedState_EditsInPlaceAndKeepsCreatorAndCreatedAt()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var id = Guid.NewGuid();
        var first = await (await As(baby, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body())).ReadAsync<MeasurementResponse>();

        var response = await As(baby, BabyRole.Parent).PutAsJsonAsync(
            MeasurementPath(baby.BabyId, id),
            Body(date: Today.AddDays(-1), weightKg: null, heightCm: 60m, notes: "fixed"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var edited = await response.ReadAsync<MeasurementResponse>();
        Assert.Equal(
            (Today.AddDays(-1), (decimal?)null, (decimal?)60m, "fixed", first.CreatedBy, first.CreatedAt),
            (edited.Date, edited.WeightKg, edited.HeightCm, edited.Notes, edited.CreatedBy, edited.CreatedAt));
        Assert.True(edited.UpdatedAt >= first.UpdatedAt);
        Assert.Equal(1, await CountAsync(id));
    }

    [Fact]
    public async Task Put_SeveralOnTheSameDay_AreAllKept()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);

        await client.PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body(weightKg: 5m));
        await client.PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body(weightKg: 5.1m));

        var items = await (await client.GetAsync(MeasurementsPath(baby.BabyId))).ReadAsync<List<MeasurementResponse>>();
        Assert.Equal(2, items.Count);
    }

    [Fact]
    public async Task Put_ManyDecimals_AreRoundedToTwoPlaces()
    {
        var baby = await factory.SeedBabyAsync();
        var json = "{\"date\":\"" + Today.ToString("yyyy-MM-dd") + "\",\"weightKg\":5.2349}";

        var response = await As(baby, BabyRole.Owner).PutAsync(
            MeasurementPath(baby.BabyId, Guid.NewGuid()),
            new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(5.23m, (await response.ReadAsync<MeasurementResponse>()).WeightKg);
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysMeasurement_Returns409AndLeavesItAlone()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(other.BabyId, id), Body(weightKg: 7m));

        var response = await As(mine, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(mine.BabyId, id), Body(weightKg: 3m));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "measurement_baby_mismatch");
        Assert.Equal(7m, (await factory.QueryAsync(context => context.Measurements.SingleAsync(measurement => measurement.Id == id))).WeightKg);
    }

    [Fact]
    public async Task Put_NoValues_Returns422()
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body(weightKg: null));

        await response.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "measurement_without_values");
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task Put_Viewer_Returns403AndCreatesNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Viewer).PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task Put_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Put_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Put_EmptyGuid_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.Empty), Body());

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Theory]
    [InlineData("""{"weightKg":5}""")]
    [InlineData("""{"date":"not a date","weightKg":5}""")]
    [InlineData("""{"date":"2026-01-01","weightKg":0.1}""")]
    [InlineData("""{"date":"2026-01-01","weightKg":41}""")]
    [InlineData("""{"date":"2026-01-01","heightCm":19}""")]
    [InlineData("""{"date":"2026-01-01","heightCm":131}""")]
    [InlineData("""{"date":"2026-01-01","headCircumferenceCm":19}""")]
    [InlineData("""{"date":"2026-01-01","headCircumferenceCm":61}""")]
    [InlineData("""{"date":"1999-12-31","weightKg":5}""")]
    [InlineData("""{"date":"2999-01-01","weightKg":5}""")]
    [InlineData("""{"date":"2026-01-01","weightKg":"heavy"}""")]
    [InlineData("""not json""")]
    public async Task Put_Invalid_Returns400(string json)
    {
        var baby = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();

        var response = await As(baby, BabyRole.Owner).PutAsync(MeasurementPath(baby.BabyId, id), new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task List_Viewer_ReturnsNewestDateFirstAndOnlyOwnBaby()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var other = await factory.SeedBabyAsync();
        var owner = As(baby, BabyRole.Owner);
        await owner.PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body(date: Today.AddDays(-10), weightKg: 4m));
        await owner.PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body(date: Today, weightKg: 6m));
        await owner.PutAsJsonAsync(MeasurementPath(baby.BabyId, Guid.NewGuid()), Body(date: Today.AddDays(-5), weightKg: 5m));
        await As(other, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(other.BabyId, Guid.NewGuid()), Body(weightKg: 9m));

        var items = await (await As(baby, BabyRole.Viewer).GetAsync(MeasurementsPath(baby.BabyId))).ReadAsync<List<MeasurementResponse>>();

        Assert.Equal([6m, 5m, 4m], items.Select(item => item.WeightKg!.Value));
    }

    [Fact]
    public async Task List_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(MeasurementsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task List_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(MeasurementsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_Parent_HardDeletesAndIsIdempotent()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var id = Guid.NewGuid();
        var client = As(baby, BabyRole.Parent);
        await client.PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body());

        var first = await client.DeleteAsync(MeasurementPath(baby.BabyId, id));
        var second = await client.DeleteAsync(MeasurementPath(baby.BabyId, id));

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (first.StatusCode, second.StatusCode));
        Assert.Equal(0, await CountAsync(id));
    }

    [Fact]
    public async Task Delete_IdOfAnotherBabysMeasurement_Returns204AndLeavesItAlone()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var id = Guid.NewGuid();
        await As(other, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(other.BabyId, id), Body());

        var response = await As(mine, BabyRole.Owner).DeleteAsync(MeasurementPath(mine.BabyId, id));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(1, await CountAsync(id));
    }

    [Fact]
    public async Task Delete_Viewer_Returns403AndKeepsMeasurement()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var id = Guid.NewGuid();
        await As(baby, BabyRole.Owner).PutAsJsonAsync(MeasurementPath(baby.BabyId, id), Body());

        var response = await As(baby, BabyRole.Viewer).DeleteAsync(MeasurementPath(baby.BabyId, id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(1, await CountAsync(id));
    }
}
