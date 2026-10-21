using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BabyRoutine.Api.Errors;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.EventTypes;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Api.Tests.Endpoints;

/// <summary>Conditional fields (<c>visibleWhen</c>) on event types, and event payloads checked against the field definitions.</summary>
public sealed class EventFieldRulesEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);

    private static string TypesPath(Guid babyId) => $"/api/v1/babies/{babyId}/event-types";

    private static string EventPath(Guid babyId, Guid eventId) => $"/api/v1/babies/{babyId}/events/{eventId}";

    private static object Meal(object? foodVisibleWhen) => new
    {
        key = "meal",
        name = "Meal",
        icon = "restaurant",
        color = "#123abc",
        hasDuration = false,
        fields = new object[]
        {
            new { key = "method", label = "Method", kind = "select", isRequired = true, options = new[] { "spoon", "finger" } },
            new { key = "food", label = "Food", kind = "text", isRequired = true, visibleWhen = foodVisibleWhen },
        },
    };

    private static object EventBody(Guid typeId, object payload, DateTimeOffset? endedAt, string? notes = null) =>
        new { typeId, startedAt = Start, endedAt, payload, notes };

    private HttpClient Owner(SeededBaby baby) => factory.CreateClientFor(baby.OwnerSubject);

    private async Task<EventTypeResponse> CreateMealAsync(SeededBaby baby) =>
        await (await Owner(baby).PostAsJsonAsync(TypesPath(baby.BabyId), Meal(new { field = "method", equals = new[] { "finger" } }))).ReadAsync<EventTypeResponse>();

    private static async Task AssertFieldProblemAsync(HttpResponseMessage response, string field)
    {
        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty(DomainExceptionHandler.FieldExtension).GetString());
    }

    [Fact]
    public async Task List_FeedingFields_ExposeVisibleWhenAsCamelCaseObjectOrNull()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).GetAsync(TypesPath(baby.BabyId));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var feeding = document.RootElement.EnumerateArray().Single(type => type.GetProperty("key").GetString() == "feeding");
        var fields = feeding.GetProperty("fields").EnumerateArray().ToDictionary(field => field.GetProperty("key").GetString()!);
        Assert.Equal(JsonValueKind.Null, fields["method"].GetProperty("visibleWhen").ValueKind);
        Assert.Equal("""{"field":"method","equals":["bottle"]}""", fields["bottle_feeding_type"].GetProperty("visibleWhen").GetRawText());
        Assert.Equal(["formula", "breast_milk"], fields["bottle_feeding_type"].GetProperty("options").EnumerateArray().Select(option => option.GetString()));
        Assert.Equal("""{"field":"method","equals":["solid"]}""", fields["food"].GetProperty("visibleWhen").GetRawText());
    }

    [Fact]
    public async Task List_BreastPumpBuiltIn_IsADurationTypeWithLeftAndRightAmounts()
    {
        var baby = await factory.SeedBabyAsync();

        var types = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        var pump = types.Single(type => type.Key == "breast_pump");
        Assert.Equal((BuiltInEventTypes.BreastPumpId, (Guid?)null, "Breast pump", "opacity", "#26c6da", true), (pump.Id, pump.BabyId, pump.Name, pump.Icon, pump.Color, pump.HasDuration));
        Assert.Equal(["amount_left_ml", "amount_right_ml"], pump.Fields.Select(field => field.Key));
        Assert.All(pump.Fields, field => Assert.Equal((EventFieldKind.Number, 0m, "ml"), (field.Kind, field.Min!.Value, field.Unit)));
    }

    [Fact]
    public async Task Create_CustomTypeWithVisibleWhen_RoundTripsIt()
    {
        var baby = await factory.SeedBabyAsync();

        var created = await CreateMealAsync(baby);

        var food = created.Fields.Single(field => field.Key == "food");
        Assert.Equal("method", food.VisibleWhen!.Field);
        Assert.Equal(["finger"], food.VisibleWhen.EqualsValues!);
        Assert.Null(created.Fields.Single(field => field.Key == "method").VisibleWhen);
        var listed = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();
        Assert.Equal(["finger"], listed.Single(type => type.Id == created.Id).Fields.Single(field => field.Key == "food").VisibleWhen!.EqualsValues);
    }

    [Fact]
    public async Task Update_CustomTypeVisibleWhen_ReplacesIt()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateMealAsync(baby);

        var response = await Owner(baby).PutAsJsonAsync($"{TypesPath(baby.BabyId)}/{created.Id}", Meal(new { field = "method", equals = new[] { "spoon", "finger" } }));

        var updated = await response.ReadAsync<EventTypeResponse>();
        Assert.Equal(["spoon", "finger"], updated.Fields.Single(field => field.Key == "food").VisibleWhen!.EqualsValues);
    }

    public static TheoryData<object> InvalidConditions => new()
    {
        new { field = "missing", equals = new[] { "finger" } },
        new { field = "method", equals = new[] { "fork" } },
        new { field = "method", equals = Array.Empty<string>() },
        new { field = "food", equals = new[] { "x" } },
        new { equals = new[] { "finger" } },
        new { field = "method" },
    };

    [Theory]
    [MemberData(nameof(InvalidConditions))]
    public async Task Create_InvalidVisibleWhen_Returns400OnVisibleWhen(object condition)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PostAsJsonAsync(TypesPath(baby.BabyId), Meal(condition));

        await AssertFieldProblemAsync(response, "VisibleWhen");
    }

    [Fact]
    public async Task PutEvent_FeedingValueForHiddenField_Returns400OnThatField()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", side = "left" }, Start));

        await AssertFieldProblemAsync(response, "side");
    }

    [Theory]
    [InlineData("method", "spoon")]
    [InlineData("bottle_feeding_type", "FORMULA")]
    public async Task PutEvent_FeedingSelectValueNotAnOption_Returns400OnThatField(string field, string value)
    {
        var baby = await factory.SeedBabyAsync();
        var payload = new Dictionary<string, object> { ["method"] = "bottle", [field] = value };

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, payload, Start));

        await AssertFieldProblemAsync(response, field);
    }

    [Fact]
    public async Task PutEvent_NumberOutOfRange_Returns400OnThatField()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.BellyPainId, new { intensity = 6 }, Start));

        await AssertFieldProblemAsync(response, "intensity");
    }

    [Fact]
    public async Task PutEvent_CompleteWithoutRequiredField_Returns400ButRunningTimerIsAccepted()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);
        var eventId = Guid.NewGuid();

        var running = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), EventBody(BuiltInEventTypes.FeedingId, new { }, endedAt: null));
        var stopped = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), EventBody(BuiltInEventTypes.FeedingId, new { }, Start.AddMinutes(20)));

        Assert.Equal(HttpStatusCode.Created, running.StatusCode);
        await AssertFieldProblemAsync(stopped, "method");
    }

    [Fact]
    public async Task PutEvent_ConformingFeedingAndBreastPump_AreStored()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var bottle = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 90, bottle_feeding_type = "breast_milk" }, Start));
        var solid = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "solid", food = "Banana" }, Start));
        var pump = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.BreastPumpId, new { amount_left_ml = 40, amount_right_ml = 35.5 }, Start.AddMinutes(15)));

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created, HttpStatusCode.Created], new[] { bottle.StatusCode, solid.StatusCode, pump.StatusCode });
    }

    [Fact]
    public async Task PutEvent_CustomTypeRules_ApplyToItsFields()
    {
        var baby = await factory.SeedBabyAsync();
        var meal = await CreateMealAsync(baby);
        var client = Owner(baby);

        var hidden = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(meal.Id, new { method = "spoon", food = "Rice" }, Start));
        var missing = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(meal.Id, new { method = "finger" }, Start));
        var valid = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(meal.Id, new { method = "finger", food = "Rice" }, Start));
        var hiddenNotRequired = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(meal.Id, new { method = "spoon" }, Start));

        await AssertFieldProblemAsync(hidden, "food");
        await AssertFieldProblemAsync(missing, "food");
        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (valid.StatusCode, hiddenNotRequired.StatusCode));
    }

    [Fact]
    public async Task PutEvent_LegacyPayloadSentBackUnchanged_CanStillBeEditedButNotChangedToAnotherInvalidPayload()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var legacy = Event.Create(Guid.NewGuid(), baby.BabyId, BuiltInEventTypes.FeedingId, ownerId, Start, Start.AddMinutes(15), EventPayload.From("""{"method":"bottle","side":"left","bottle_feeding_type":"FORMULA"}"""), null, DateTimeOffset.UtcNow);
        await factory.SeedAsync(context =>
        {
            context.Events.Add(legacy);
            return Task.CompletedTask;
        });
        var client = Owner(baby);

        var notesOnly = await client.PutAsJsonAsync(EventPath(baby.BabyId, legacy.Id), EventBody(BuiltInEventTypes.FeedingId, new { bottle_feeding_type = "FORMULA", side = "left", method = "bottle" }, Start.AddMinutes(15), notes: "edited"));
        var changed = await client.PutAsJsonAsync(EventPath(baby.BabyId, legacy.Id), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", side = "right", bottle_feeding_type = "FORMULA" }, Start.AddMinutes(15), notes: "edited"));

        Assert.Equal(HttpStatusCode.OK, notesOnly.StatusCode);
        await AssertFieldProblemAsync(changed, "side");
    }
}
