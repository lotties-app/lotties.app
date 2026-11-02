using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Api.Errors;
using Lotties.Api.Tests.Support;
using Lotties.Application.EventTypes;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Api.Tests.Endpoints;

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
    public async Task List_SleepFields_ExposeHiddenAndIntegerFlags()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).GetAsync(TypesPath(baby.BabyId));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var sleep = document.RootElement.EnumerateArray().Single(type => type.GetProperty("key").GetString() == "sleep");
        var fields = sleep.GetProperty("fields").EnumerateArray().ToDictionary(field => field.GetProperty("key").GetString()!);
        Assert.Equal((true, false), (fields["mood"].GetProperty("hidden").GetBoolean(), fields["mood"].GetProperty("integer").GetBoolean()));
        Assert.Equal((false, true), (fields["time_to_fall_asleep_minutes"].GetProperty("hidden").GetBoolean(), fields["time_to_fall_asleep_minutes"].GetProperty("integer").GetBoolean()));
        Assert.Equal((true, true), (fields["paused_seconds"].GetProperty("hidden").GetBoolean(), fields["paused_seconds"].GetProperty("integer").GetBoolean()));
        Assert.Equal("""{"field":"kind","equals":["nap","night"]}""", fields["how_slept"].GetProperty("visibleWhen").GetRawText());
    }

    [Fact]
    public async Task Put_PausedRunningSleep_IsAcceptedButStoppingItWithTheOpenPauseIs400()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var paused = new { kind = "nap", pause_count = 1, paused_seconds = 120, paused_at = "2026-01-10T08:20:00.000Z" };

        var started = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), EventBody(BuiltInEventTypes.SleepId, paused, endedAt: null));
        var stopped = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), EventBody(BuiltInEventTypes.SleepId, paused, Start.AddMinutes(30)));

        Assert.Equal(HttpStatusCode.Created, started.StatusCode);
        await AssertFieldProblemAsync(stopped, "paused_at");
    }

    [Fact]
    public async Task Put_StoppedSleepPausedLongerThanItLasted_Is400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(
            EventPath(baby.BabyId, Guid.NewGuid()),
            EventBody(BuiltInEventTypes.SleepId, new { kind = "nap", pause_count = 2, paused_seconds = 1801 }, Start.AddMinutes(30)));

        await AssertFieldProblemAsync(response, "paused_seconds");
    }

    [Fact]
    public async Task Put_NapWithSleepDetailsAndPauses_IsStored()
    {
        var baby = await factory.SeedBabyAsync();
        var payload = new { kind = "nap", how_slept = "stroller", fall_asleep = "fussy", time_to_fall_asleep_minutes = 20, how_woke = "woken", mood_on_wake = "neutral", pause_count = 2, paused_seconds = 300 };

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.SleepId, payload, Start.AddMinutes(45)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Put_NightWakingWithSleepDetails_Is400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(
            EventPath(baby.BabyId, Guid.NewGuid()),
            EventBody(BuiltInEventTypes.SleepId, new { kind = "night_waking", how_woke = "woken" }, Start.AddMinutes(10)));

        await AssertFieldProblemAsync(response, "how_woke");
    }

    [Fact]
    public async Task Create_CustomTypeWithHiddenIntegerField_RoundTripsTheFlags()
    {
        var baby = await factory.SeedBabyAsync();
        var body = new
        {
            key = "reading",
            name = "Reading",
            icon = "star",
            color = "#123abc",
            hasDuration = true,
            fields = new object[] { new { key = "pages", label = "Pages", kind = "number", min = 0, integer = true, hidden = true } },
        };

        var created = await (await Owner(baby).PostAsJsonAsync(TypesPath(baby.BabyId), body)).ReadAsync<EventTypeResponse>();

        var pages = Assert.Single(created.Fields);
        Assert.Equal((true, true), (pages.Hidden, pages.Integer));
    }

    [Fact]
    public async Task Create_CustomTypeWithIntegerTextField_Is400()
    {
        var baby = await factory.SeedBabyAsync();
        var body = new
        {
            key = "diary",
            name = "Diary",
            icon = "star",
            color = "#123abc",
            hasDuration = false,
            fields = new object[] { new { key = "entry", label = "Entry", kind = "text", integer = true } },
        };

        var response = await Owner(baby).PostAsJsonAsync(TypesPath(baby.BabyId), body);

        await AssertFieldProblemAsync(response, "IsInteger");
    }

    [Fact]
    public async Task List_BreastPumpBuiltIn_IsADurationTypeWithLeftAndRightAmounts()
    {
        var baby = await factory.SeedBabyAsync();

        var types = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        var pump = types.Single(type => type.Key == "breast_pump");
        Assert.Equal((BuiltInEventTypes.BreastPumpId, (Guid?)null, "Breast pump", "opacity", "#26c6da", true), (pump.Id, pump.BabyId, pump.Name, pump.Icon, pump.Color, pump.HasDuration));
        Assert.Equal(["amount_left_ml", "amount_right_ml", "pause_count", "paused_seconds", "paused_at"], pump.Fields.Select(field => field.Key));
        Assert.All(pump.Fields.Take(2), field => Assert.Equal((EventFieldKind.Number, 0m, "ml", false), (field.Kind, field.Min!.Value, field.Unit, field.Hidden)));
        Assert.All(pump.Fields.Skip(2), field => Assert.True(field.Hidden));
    }

    [Fact]
    public async Task List_NasalSuctionBuiltIn_IsAnInstantTypeWithOptionalToolAndSaline()
    {
        var baby = await factory.SeedBabyAsync();

        var types = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        var suction = types.Single(type => type.Key == "nasal_suction");
        Assert.Equal((BuiltInEventTypes.NasalSuctionId, (Guid?)null, "Nasal suction", "air", "#78909c", false), (suction.Id, suction.BabyId, suction.Name, suction.Icon, suction.Color, suction.HasDuration));
        Assert.Equal([("tool", EventFieldKind.Select), ("saline", EventFieldKind.Bool)], suction.Fields.Select(field => (field.Key, field.Kind)));
        Assert.Equal(["bulb", "electric", "mouth"], suction.Fields[0].Options!);
        Assert.All(suction.Fields, field => Assert.Equal((false, false), (field.IsRequired, field.Hidden)));
    }

    [Fact]
    public async Task PutEvent_NasalSuction_StoresConformingPayloadsAndRejectsUnknownTool()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var full = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.NasalSuctionId, new { tool = "bulb", saline = true }, Start));
        var empty = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.NasalSuctionId, new { }, Start));
        var unknown = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.NasalSuctionId, new { tool = "syringe" }, Start));

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created], new[] { full.StatusCode, empty.StatusCode });
        await AssertFieldProblemAsync(unknown, "tool");
    }

    [Fact]
    public async Task List_BellyMassageBuiltIn_IsATimedTypeWithOptionalReasonAndHelped()
    {
        var baby = await factory.SeedBabyAsync();

        var types = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        var massage = types.Single(type => type.Key == "belly_massage");
        Assert.Equal((BuiltInEventTypes.BellyMassageId, (Guid?)null, "Belly massage", "massage", "#ff7043", true), (massage.Id, massage.BabyId, massage.Name, massage.Icon, massage.Color, massage.HasDuration));
        Assert.Equal(["reason", "helped", "pause_count", "paused_seconds", "paused_at"], massage.Fields.Select(field => field.Key));
        Assert.Equal(["gas", "constipation", "colic", "other"], massage.Fields[0].Options!);
        Assert.Equal(["yes", "a_little", "no"], massage.Fields[1].Options!);
        Assert.All(massage.Fields.Take(2), field => Assert.Equal((EventFieldKind.Select, false, false), (field.Kind, field.IsRequired, field.Hidden)));
        Assert.All(massage.Fields.Skip(2), field => Assert.True(field.Hidden));
    }

    [Fact]
    public async Task PutEvent_BellyMassage_StoresRunningAndEndedPayloadsAndRejectsUnknownOptions()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var running = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.BellyMassageId, new { }, null));
        var ended = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.BellyMassageId, new { reason = "gas", helped = "a_little" }, Start.AddMinutes(10)));
        var badReason = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.BellyMassageId, new { reason = "pain" }, Start.AddMinutes(10)));
        var badHelped = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.BellyMassageId, new { helped = "maybe" }, Start.AddMinutes(10)));

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created], new[] { running.StatusCode, ended.StatusCode });
        await AssertFieldProblemAsync(badReason, "reason");
        await AssertFieldProblemAsync(badHelped, "helped");
    }

    [Fact]
    public async Task List_FussyBuiltIn_IsATimedTypeWithOptionalIntensityAndWhatHelped()
    {
        var baby = await factory.SeedBabyAsync();

        var types = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        var fussy = types.Single(type => type.Key == "fussy");
        Assert.Equal((BuiltInEventTypes.FussyId, (Guid?)null, "Fussy / crying", "sentiment_very_dissatisfied", "#81c784", true), (fussy.Id, fussy.BabyId, fussy.Name, fussy.Icon, fussy.Color, fussy.HasDuration));
        Assert.Equal(["intensity", "what_helped", "suggested_cause", "auto_detected", "cry_confirmed", "pause_count", "paused_seconds", "paused_at"], fussy.Fields.Select(field => field.Key));
        Assert.Equal(["mild", "moderate", "intense"], fussy.Fields[0].Options!);
        Assert.Equal(["feeding", "rocking", "pacifier", "massage", "sleep", "other", "nothing", "diaper_change", "burping", "holding"], fussy.Fields[1].Options!);
        Assert.Equal(["hunger", "sleepy", "diaper", "gas", "comfort"], fussy.Fields[2].Options!);
        Assert.All(fussy.Fields.Take(2), field => Assert.Equal((EventFieldKind.Select, false, false), (field.Kind, field.IsRequired, field.Hidden)));
        Assert.All(fussy.Fields.Skip(2), field => Assert.True(field.Hidden));
        Assert.All(fussy.Fields.Skip(3).Take(2), field => Assert.Equal((EventFieldKind.Bool, false), (field.Kind, field.IsRequired)));
    }

    [Fact]
    public async Task PutEvent_Fussy_StoresRunningAndEndedPayloadsAndRejectsUnknownOptions()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var running = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FussyId, new { }, null));
        var ended = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FussyId, new { intensity = "moderate", what_helped = "rocking" }, Start.AddMinutes(20)));
        var badIntensity = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FussyId, new { intensity = "screaming" }, Start.AddMinutes(20)));
        var badHelped = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FussyId, new { what_helped = "singing" }, Start.AddMinutes(20)));

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created], new[] { running.StatusCode, ended.StatusCode });
        await AssertFieldProblemAsync(badIntensity, "intensity");
        await AssertFieldProblemAsync(badHelped, "what_helped");
    }

    [Theory]
    [InlineData("nail_trim", "bd1fde97-19c8-49a9-9ffd-537449183686", "Nail trim", "content_cut", "#5c6bc0", false, "where")]
    [InlineData("temperature", "c3691235-0279-429c-be1c-db6692ad5455", "Temperature", "thermostat", "#ffca28", false, "value_c,method")]
    [InlineData("spit_up", "1a08d284-a71f-44f5-ae83-49446a6f0e3f", "Spit-up / vomit", "sentiment_sick", "#c0ca33", false, "kind,amount")]
    [InlineData("teething", "0a3e94b0-55c5-4d85-b530-317f161ef0cc", "Teething", "dentistry", "#29b6f6", false, "stage,tooth")]
    [InlineData("milestone", "3491e7b4-895b-406f-885a-238da041dd7c", "Milestone", "emoji_events", "#ab47bc", false, "milestone,custom")]
    [InlineData("symptom", "fb45be64-6741-4762-ab9a-abf5c9e6a875", "Symptom", "coronavirus", "#e57373", false, "symptom,severity")]
    [InlineData("outdoor", "b22205ae-bae1-432f-802a-06e0c173efe1", "Outdoor time", "park", "#66bb6a", true, "kind,pause_count,paused_seconds,paused_at")]
    [InlineData("skin_care", "9ad3dce5-dd4e-43d8-a022-5561ee7256ee", "Skin care", "sanitizer", "#f48fb1", false, "product")]
    public async Task List_MoreBuiltIns_AreServedWithTheirFields(string key, string id, string name, string icon, string color, bool hasDuration, string fields)
    {
        var baby = await factory.SeedBabyAsync();

        var types = await (await Owner(baby).GetAsync(TypesPath(baby.BabyId))).ReadAsync<List<EventTypeResponse>>();

        var type = types.Single(type => type.Key == key);
        Assert.Equal((new Guid(id), (Guid?)null, name, icon, color, hasDuration), (type.Id, type.BabyId, type.Name, type.Icon, type.Color, type.HasDuration));
        Assert.Equal(fields.Split(','), type.Fields.Select(field => field.Key));
    }

    [Fact]
    public async Task List_TemperatureValue_IsServedWithOneDecimalPlaceAndOtherFieldsWithoutTheLimit()
    {
        var baby = await factory.SeedBabyAsync();

        var json = await Owner(baby).GetStringAsync(TypesPath(baby.BabyId));
        var types = System.Text.Json.JsonSerializer.Deserialize<List<EventTypeResponse>>(json, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;

        var value = types.Single(type => type.Key == "temperature").Fields[0];
        Assert.Equal(("value_c", EventFieldKind.Number, true, 30m, 45m, "°C", (int?)1), (value.Key, value.Kind, value.IsRequired, value.Min!.Value, value.Max!.Value, value.Unit, value.Decimals));
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(json, "\"decimals\""));
    }

    [Fact]
    public async Task PutEvent_Temperature_StoresAOneDecimalValueAndRejectsMissingOutOfRangeOrTooPreciseValues()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var full = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TemperatureId, new { value_c = 37.8m, method = "armpit" }, Start));
        var missing = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TemperatureId, new { method = "ear" }, Start));
        var tooHigh = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TemperatureId, new { value_c = 45.1m }, Start));
        var tooPrecise = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TemperatureId, new { value_c = 37.85m }, Start));
        var badMethod = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TemperatureId, new { value_c = 37.8m, method = "toe" }, Start));

        Assert.Equal(HttpStatusCode.Created, full.StatusCode);
        await AssertFieldProblemAsync(missing, "value_c");
        await AssertFieldProblemAsync(tooHigh, "value_c");
        await AssertFieldProblemAsync(tooPrecise, "value_c");
        await AssertFieldProblemAsync(badMethod, "method");
    }

    [Fact]
    public async Task PutEvent_TeethingAndMilestone_ApplyTheirVisibleWhenRules()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var tooth = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TeethingId, new { stage = "tooth_came_through", tooth = "lower_central_incisor" }, Start));
        var toothWhileSore = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.TeethingId, new { stage = "gums_sore", tooth = "canine" }, Start));
        var custom = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.MilestoneId, new { milestone = "other", custom = "Waved bye-bye" }, Start));
        var customForSits = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.MilestoneId, new { milestone = "sits", custom = "Waved" }, Start));

        Assert.Equal([HttpStatusCode.Created, HttpStatusCode.Created], new[] { tooth.StatusCode, custom.StatusCode });
        await AssertFieldProblemAsync(toothWhileSore, "tooth");
        await AssertFieldProblemAsync(customForSits, "custom");
    }

    [Fact]
    public async Task PutEvent_SelectOnlyNewTypes_StoreKnownOptionsAndRejectUnknownOnes()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var stored = new[]
        {
            await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.NailTrimId, new { where = "both" }, Start)),
            await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.SpitUpId, new { kind = "vomit", amount = "a_lot" }, Start)),
            await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.SymptomId, new { symptom = "rash", severity = "mild" }, Start)),
            await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.OutdoorId, new { }, null)),
            await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.OutdoorId, new { kind = "stroller_walk" }, Start.AddMinutes(30))),
            await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.SkinCareId, new { product = "sunscreen" }, Start)),
        };
        var badWhere = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.NailTrimId, new { where = "toes" }, Start));
        var badSeverity = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.SymptomId, new { severity = "intense" }, Start));

        Assert.All(stored, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
        await AssertFieldProblemAsync(badWhere, "where");
        await AssertFieldProblemAsync(badSeverity, "severity");
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
    public async Task PutEvent_BottleDrunkAmount_MustNotExceedPrepared()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var partly = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, amount_drunk_ml = 80 }, Start));
        var legacy = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120 }, Start));
        var tooMuch = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, amount_drunk_ml = 130 }, Start));
        var onBreast = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "breast", amount_drunk_ml = 30 }, Start));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.Created), (partly.StatusCode, legacy.StatusCode));
        await AssertFieldProblemAsync(tooMuch, "amount_drunk_ml");
        await AssertFieldProblemAsync(onBreast, "amount_drunk_ml");
    }

    [Fact]
    public async Task PutEvent_FeedingEndedBySleep_IsStored()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        var ended = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "breast", ended_by = "sleep" }, Start.AddMinutes(10)));
        var unknown = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "breast", ended_by = "nap" }, Start.AddMinutes(10)));

        Assert.Equal(HttpStatusCode.Created, ended.StatusCode);
        await AssertFieldProblemAsync(unknown, "ended_by");
    }

    [Fact]
    public async Task PutEvent_BottleSegments_AreCheckedAgainstTheGrammarAndTheAmounts()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);
        var id = Guid.NewGuid();

        var paused = await client.PutAsJsonAsync(EventPath(baby.BabyId, id), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, pause_count = 1, paused_seconds = 60, segments = "120>70@300" }, endedAt: null));
        var stopped = await client.PutAsJsonAsync(EventPath(baby.BabyId, id), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, amount_drunk_ml = 100, pause_count = 1, paused_seconds = 60, segments = "120>70@300;70>20@240" }, Start.AddMinutes(11)));
        var malformed = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, segments = "120 > 70" }, endedAt: null));
        var tooLong = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, segments = string.Join(';', Enumerable.Repeat("?>?@1", 21)) }, endedAt: null));
        var disagrees = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, amount_drunk_ml = 30, segments = "120>70@300;70>0@200" }, Start.AddMinutes(10)));
        var onBreast = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "breast", segments = "?>?@60" }, Start.AddMinutes(10)));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK), (paused.StatusCode, stopped.StatusCode));
        var stored = await stopped.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("120>70@300;70>20@240", (string?)stored!["payload"]!["segments"]);
        await AssertFieldProblemAsync(malformed, "segments");
        await AssertFieldProblemAsync(tooLong, "segments");
        await AssertFieldProblemAsync(disagrees, "segments");
        await AssertFieldProblemAsync(onBreast, "segments");
    }

    [Fact]
    public async Task PutEvent_BottleHistory_TimesAreCheckedAndTheTotalsRecomputed()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);

        // Owner's example: 120 ml at 12:25, pause 12:31 left 80, resume 12:34, pause 12:47 left 15, asleep 12:53 while paused.
        var edited = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, amount_drunk_ml = 105, pause_count = 9, paused_seconds = 1, segments = "120>80@360+0;80>15@780+540" }, Start.AddSeconds(1680)));
        var afterTheEnd = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, amount_drunk_ml = 105, segments = "120>80@360+0;80>15@780+1000" }, Start.AddSeconds(1680)));
        var overlapping = await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), EventBody(BuiltInEventTypes.FeedingId, new { method = "bottle", amount_ml = 120, segments = "120>80@360+0;80>?@60+300" }, endedAt: null));

        Assert.Equal(HttpStatusCode.Created, edited.StatusCode);
        var stored = (await edited.Content.ReadFromJsonAsync<JsonObject>())!["payload"]!;
        Assert.Equal((2, 540), ((int)stored["pause_count"]!, (int)stored["paused_seconds"]!));
        await AssertFieldProblemAsync(afterTheEnd, "segments");
        await AssertFieldProblemAsync(overlapping, "segments");
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
