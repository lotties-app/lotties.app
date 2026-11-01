using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Tests.Vaccinations;

/// <summary>
/// The status vectors shared with the web port (code/web/src/vaccines/vaccineStatusVectors.json, linked into the test
/// output): the same schedule, profile, records and day must give the same dose states and dates on both sides.
/// </summary>
public sealed class VaccineStatusVectorTests
{
    private static readonly Lazy<JsonDocument> Vectors = new(() => JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Vaccinations", "vaccineStatusVectors.json"))));

    public static TheoryData<string> Names
    {
        get
        {
            var names = new TheoryData<string>();
            foreach (var vector in Vectors.Value.RootElement.GetProperty("vectors").EnumerateArray())
            {
                names.Add(vector.GetProperty("name").GetString()!);
            }

            return names;
        }
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void Calculate_SharedVector_GivesTheExpectedDoses(string name)
    {
        var vector = Vectors.Value.RootElement.GetProperty("vectors").EnumerateArray().Single(item => item.GetProperty("name").GetString() == name);
        var schedule = ScheduleOf(vector.GetProperty("schedule"));
        Assert.Empty(VaccineScheduleValidator.Validate(schedule));

        var result = VaccineStatusCalculator.Calculate(new VaccineStatusInput(
            schedule,
            ProfileOf(vector.GetProperty("profile")),
            Date(vector.GetProperty("birthDate"))!.Value,
            vector.GetProperty("records").EnumerateArray().Select(RecordOf).ToArray(),
            Date(vector.GetProperty("today"))!.Value));

        var expected = vector.GetProperty("expected");
        Assert.Equal(expected.GetProperty("prematureNotice").GetBoolean(), result.PrematureNotice);
        if (expected.GetProperty("ageDays").ValueKind == JsonValueKind.Number)
        {
            Assert.Equal(expected.GetProperty("ageDays").GetInt32(), result.AgeDays);
        }

        foreach (var dose in expected.GetProperty("doses").EnumerateArray())
        {
            AssertMatches(dose, result.Doses.Single(status => status.DoseId == dose.GetProperty("doseId").GetString()));
        }
    }

    /// <summary>Compares only the fields the vector lists (a listed <c>null</c> must be <c>null</c>).</summary>
    private static void AssertMatches(JsonElement expected, DoseStatus actual)
    {
        var doseId = actual.DoseId;
        foreach (var field in expected.EnumerateObject())
        {
            var actualValue = field.Name switch
            {
                "doseId" => actual.DoseId,
                "state" => Code(actual.State),
                "reason" => actual.Reason is { } reason ? Code(reason) : null,
                "dueOn" => Text(actual.DueOn),
                "earliestOn" => Text(actual.EarliestOn),
                "latestOn" => Text(actual.LatestOn),
                "overdueFrom" => Text(actual.OverdueFrom),
                "recordId" => actual.RecordId?.ToString("D"),
                "givenOn" => Text(actual.GivenOn),
                "coveredBy" => actual.CoveredBy,
                "alternativeOf" => actual.AlternativeOf,
                "optionalPrivate" => actual.OptionalPrivate ? "true" : "false",
                "nextDueOn" => Text(actual.NextDueOn),
                "waitingFor" => actual.WaitingFor,
                _ => throw new InvalidOperationException($"Unknown expected field {field.Name}."),
            };
            var expectedValue = field.Value.ValueKind switch
            {
                JsonValueKind.Null => null,
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => field.Value.GetString(),
            };
            Assert.True(expectedValue == actualValue, $"{doseId}.{field.Name}: expected {expectedValue ?? "null"}, got {actualValue ?? "null"}");
        }
    }

    private static string Code(DoseState state) => state switch
    {
        DoseState.NotApplicable => "notApplicable",
        _ => state.ToString().ToLowerInvariant(),
    };

    private static string Code(NotApplicableReason reason) => reason.ToString().ToLowerInvariant();

    private static string? Text(DateOnly? date) => date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly? Date(JsonElement element) =>
        element.ValueKind == JsonValueKind.Null ? null : DateOnly.ParseExact(element.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static VaccinationRecord RecordOf(JsonElement record) =>
        new(Guid.Parse(record.GetProperty("id").GetString()!), record.GetProperty("doseId").GetString(), Date(record.GetProperty("givenOn"))!.Value);

    private static VaccineProfile ProfileOf(JsonElement profile) =>
        VaccineProfile.Create(
            VaccineProfile.CoverageOf(profile.GetProperty("coverage").GetString()),
            profile.GetProperty("gestationalAgeWeeks").ValueKind == JsonValueKind.Number ? profile.GetProperty("gestationalAgeWeeks").GetInt32() : null,
            profile.GetProperty("rsvMaternalVaccination").GetString() switch
            {
                null => null,
                var code => Enum.Parse<RsvMaternalVaccination>(code, ignoreCase: true),
            });

    /// <summary>A full schema v2 document from the vector's short dose list (the defaults the vectors file documents).</summary>
    private static VaccineSchedule ScheduleOf(JsonElement doses)
    {
        var fullDoses = new JsonArray(doses.EnumerateArray().Select(dose => (JsonNode)DoseWithDefaults(dose)).ToArray());
        var keys = fullDoses.Select(dose => dose!["vaccineKey"]!.GetValue<string>()).Distinct().ToArray();
        var document = new JsonObject
        {
            ["schemaVersion"] = 2,
            ["profile"] = "TEST",
            ["generatedOn"] = "2026-10-22",
            ["sources"] = new JsonArray(Source("pni", "public"), Source("sbp", "private-recommendation"), Source("sbim", "private-recommendation")),
            ["vaccines"] = new JsonArray(keys.Select(key => (JsonNode)new JsonObject
            {
                ["key"] = key,
                ["names"] = Both(key),
                ["protectsAgainst"] = new JsonObject { ["en"] = new JsonArray(key), ["pt-BR"] = new JsonArray(key) },
                ["network"] = "both",
            }).ToArray()),
            ["doses"] = fullDoses,
        };
        return VaccineScheduleJson.Parse(document.ToJsonString());
    }

    private static JsonObject DoseWithDefaults(JsonElement dose)
    {
        var given = JsonNode.Parse(dose.GetRawText())!.AsObject();
        var doseId = given["doseId"]!.GetValue<string>();
        var isPrivate = given["network"]?.GetValue<string>() == "private";
        var full = new JsonObject
        {
            ["vaccineKey"] = "v",
            ["doseId"] = doseId,
            ["label"] = Both(doseId),
            ["recommendedAgeDays"] = given["recommendedAgeDays"]!.GetValue<int>(),
            ["earliestAgeDays"] = given["recommendedAgeDays"]!.GetValue<int>(),
            ["latestAgeDays"] = null,
            ["minIntervalDaysFromPrevious"] = null,
            ["sources"] = new JsonArray(isPrivate ? "sbp" : "pni"),
            ["network"] = "public",
            ["notes"] = Both(doseId),
            ["alternativeGroup"] = null,
            ["needsReview"] = false,
            ["needsReviewReason"] = null,
            ["previousDoseIds"] = new JsonArray(),
            ["covers"] = new JsonArray(),
            ["recurrence"] = null,
            ["condition"] = null,
            ["recordOnly"] = false,
        };
        foreach (var (key, value) in given)
        {
            full[key] = value?.DeepClone();
        }

        return full;
    }

    private static JsonObject Both(string text) => new() { ["en"] = text, ["pt-BR"] = text };

    private static JsonObject Source(string id, string network) => new()
    {
        ["id"] = id,
        ["name"] = id,
        ["edition"] = "test",
        ["url"] = $"https://example.org/{id}",
        ["retrievedOn"] = "2026-10-22",
        ["network"] = network,
    };
}
