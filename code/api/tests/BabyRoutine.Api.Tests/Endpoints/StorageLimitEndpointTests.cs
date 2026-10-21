using System.Net;
using System.Text;
using BabyRoutine.Api.Errors;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Api.Tests.Endpoints;

/// <summary>
/// Values PostgreSQL could not store (NUL characters, a dose beyond <c>numeric(10,3)</c>) are 400 problems from the
/// domain on every write endpoint, never a 500 from the database. Bodies are raw JSON so <c>\u0000</c> reaches the API.
/// </summary>
public sealed class StorageLimitEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Nul = "\\u0000";

    [Fact]
    public async Task PutMedication_DoseOfTenMillion_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await SendAsync(baby, HttpMethod.Put, $"/medications/{Guid.NewGuid()}", """{"name":"Colidis","defaultDosage":{"amount":10000000,"unit":"ml"},"isUsual":false}""");

        await AssertValidationAsync(response, "Amount");
    }

    [Fact]
    public async Task PutMedication_NulInName_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await SendAsync(baby, HttpMethod.Put, $"/medications/{Guid.NewGuid()}", $$"""{"name":"Coli{{Nul}}dis","isUsual":false}""");

        await AssertValidationAsync(response, "Name");
    }

    [Fact]
    public async Task PutMedication_NulInNotes_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await SendAsync(baby, HttpMethod.Put, $"/medications/{Guid.NewGuid()}", $$"""{"name":"Colidis","notes":"{{Nul}}","isUsual":false}""");

        await AssertValidationAsync(response, "Notes");
    }

    [Fact]
    public async Task PutEvent_NulInNotes_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await SendAsync(baby, HttpMethod.Put, $"/events/{Guid.NewGuid()}", EventJson(notes: $"\"fussy{Nul}\""));

        await AssertValidationAsync(response, "Notes");
    }

    [Theory]
    [InlineData("""{"mood":"calm\u0000"}""")]
    [InlineData("""{"nested":[{"\u0000key":1}]}""")]
    [InlineData("""{"amount":1e5000}""")]
    public async Task PutEvent_PayloadPostgresCannotStore_Returns400(string payload)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await SendAsync(baby, HttpMethod.Put, $"/events/{Guid.NewGuid()}", EventJson(payload: payload));

        await AssertValidationAsync(response, "Payload");
    }

    [Fact]
    public async Task PostEventType_NulInName_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await SendAsync(baby, HttpMethod.Post, "/event-types", $$"""{"key":"pumping","name":"Pump{{Nul}}","icon":"water_drop","color":"#123456","hasDuration":false}""");

        await AssertValidationAsync(response, "Name");
    }

    [Fact]
    public async Task PostEventType_NulInFieldLabel_Returns400()
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"key":"pumping","name":"Pump","icon":"water_drop","color":"#123456","hasDuration":false,"fields":[{"key":"side","label":"Si{{Nul}}de","kind":"text"}]}""";

        var response = await SendAsync(baby, HttpMethod.Post, "/event-types", json);

        await AssertValidationAsync(response, "Label");
    }

    [Fact]
    public async Task PutMeasurement_NulInNotes_Returns400()
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"date":"{{DateTime.UtcNow:yyyy-MM-dd}}","weightKg":4.2,"notes":"{{Nul}}"}""";

        var response = await SendAsync(baby, HttpMethod.Put, $"/measurements/{Guid.NewGuid()}", json);

        await AssertValidationAsync(response, "Notes");
    }

    [Fact]
    public async Task PostBaby_NulInName_Returns400()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());
        var json = $$"""{"name":"Li{{Nul}}a","birthDate":"{{DateTime.UtcNow:yyyy-MM-dd}}"}""";

        var response = await client.PostAsync("/api/v1/babies", new StringContent(json, Encoding.UTF8, "application/json"));

        await AssertValidationAsync(response, "Name");
    }

    private static string EventJson(string notes = "null", string payload = "{}") =>
        $$"""{"typeId":"{{BuiltInEventTypes.SleepId}}","startedAt":"2026-01-10T08:00:00Z","payload":{{payload}},"notes":{{notes}}}""";

    private static async Task AssertValidationAsync(HttpResponseMessage response, string field)
    {
        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty(DomainExceptionHandler.FieldExtension).GetString());
    }

    private Task<HttpResponseMessage> SendAsync(SeededBaby baby, HttpMethod method, string babyRelativePath, string json)
    {
        var request = new HttpRequestMessage(method, $"/api/v1/babies/{baby.BabyId}{babyRelativePath}")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        return factory.CreateClientFor(baby.OwnerSubject).SendAsync(request);
    }
}
