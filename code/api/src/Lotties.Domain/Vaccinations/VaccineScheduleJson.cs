using System.Globalization;
using System.Text.Json;

namespace Lotties.Domain.Vaccinations;

/// <summary>
/// Reads the schedule file (schema v2, docs/design/18-vaccines.md section 2). Strict on the shape: every documented
/// property must be present with its JSON type (<c>null</c> where the schema allows it); anything else is a
/// <see cref="FormatException"/> naming the JSON path. The rules across entries are <see cref="VaccineScheduleValidator"/>'s.
/// </summary>
public static class VaccineScheduleJson
{
    public static VaccineSchedule Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            using var document = JsonDocument.Parse(json);
            return Read(document.RootElement);
        }
        catch (JsonException exception)
        {
            throw new FormatException($"The vaccine schedule is not valid JSON: {exception.Message}", exception);
        }
    }

    private static VaccineSchedule Read(JsonElement root)
    {
        var at = new Path("$");
        Expect(root, JsonValueKind.Object, at);
        return new VaccineSchedule(
            Int(root, "schemaVersion", at),
            String(root, "profile", at),
            Date(root, "generatedOn", at),
            Array(root, "sources", at, Source),
            Array(root, "vaccines", at, Vaccine),
            Array(root, "doses", at, Dose));
    }

    private static VaccineSource Source(JsonElement element, Path at) =>
        new(
            String(element, "id", at),
            String(element, "name", at),
            String(element, "edition", at),
            String(element, "url", at),
            Date(element, "retrievedOn", at),
            String(element, "network", at));

    private static VaccineDefinition Vaccine(JsonElement element, Path at) =>
        new(
            String(element, "key", at),
            Text(element, "names", at),
            List(element, "protectsAgainst", at),
            String(element, "network", at));

    private static ScheduledDose Dose(JsonElement element, Path at) =>
        new(
            String(element, "vaccineKey", at),
            String(element, "doseId", at),
            Text(element, "label", at),
            Int(element, "recommendedAgeDays", at),
            Int(element, "earliestAgeDays", at),
            OptionalInt(element, "latestAgeDays", at),
            OptionalInt(element, "minIntervalDaysFromPrevious", at),
            Strings(element, "sources", at),
            Network(element, "network", at),
            Text(element, "notes", at),
            OptionalString(element, "alternativeGroup", at),
            Bool(element, "needsReview", at),
            OptionalString(element, "needsReviewReason", at),
            Strings(element, "previousDoseIds", at),
            Strings(element, "covers", at),
            Recurrence(element, "recurrence", at),
            OptionalString(element, "condition", at),
            Bool(element, "recordOnly", at));

    private static DoseRecurrence? Recurrence(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        if (value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        var inner = at.Then(name);
        Expect(value, JsonValueKind.Object, inner);
        return new DoseRecurrence(Int(value, "everyDays", inner), Int(value, "startAgeDays", inner));
    }

    private static VaccineNetwork Network(JsonElement element, string name, Path at) => String(element, name, at) switch
    {
        "public" => VaccineNetwork.Public,
        "private" => VaccineNetwork.Private,
        var other => throw new FormatException($"{at.Then(name)} must be public or private, not '{other}'."),
    };

    private static LocalizedText Text(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        var inner = at.Then(name);
        Expect(value, JsonValueKind.Object, inner);
        return new LocalizedText(value.EnumerateObject().ToDictionary(
            property => property.Name,
            property => StringValue(property.Value, inner.Then(property.Name)),
            StringComparer.Ordinal));
    }

    private static LocalizedList List(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        var inner = at.Then(name);
        Expect(value, JsonValueKind.Object, inner);
        return new LocalizedList(value.EnumerateObject().ToDictionary(
            property => property.Name,
            property => (IReadOnlyList<string>)StringItems(property.Value, inner.Then(property.Name)),
            StringComparer.Ordinal));
    }

    private static IReadOnlyList<T> Array<T>(JsonElement element, string name, Path at, Func<JsonElement, Path, T> read)
    {
        var value = Property(element, name, at);
        var inner = at.Then(name);
        Expect(value, JsonValueKind.Array, inner);
        return value.EnumerateArray().Select((item, index) =>
        {
            var itemPath = inner.Index(index);
            Expect(item, JsonValueKind.Object, itemPath);
            return read(item, itemPath);
        }).ToArray();
    }

    private static IReadOnlyList<string> Strings(JsonElement element, string name, Path at) =>
        StringItems(Property(element, name, at), at.Then(name));

    private static string[] StringItems(JsonElement value, Path at)
    {
        Expect(value, JsonValueKind.Array, at);
        return value.EnumerateArray().Select((item, index) => StringValue(item, at.Index(index))).ToArray();
    }

    private static string String(JsonElement element, string name, Path at) => StringValue(Property(element, name, at), at.Then(name));

    private static string? OptionalString(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        return value.ValueKind == JsonValueKind.Null ? null : StringValue(value, at.Then(name));
    }

    private static string StringValue(JsonElement value, Path at)
    {
        Expect(value, JsonValueKind.String, at);
        return value.GetString()!;
    }

    private static int Int(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        Expect(value, JsonValueKind.Number, at.Then(name));
        return value.TryGetInt32(out var number) ? number : throw new FormatException($"{at.Then(name)} must be a whole number.");
    }

    private static int? OptionalInt(JsonElement element, string name, Path at) =>
        Property(element, name, at).ValueKind == JsonValueKind.Null ? null : Int(element, name, at);

    private static bool Bool(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw new FormatException($"{at.Then(name)} must be true or false."),
        };
    }

    private static DateOnly Date(JsonElement element, string name, Path at)
    {
        var text = String(element, name, at);
        return DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new FormatException($"{at.Then(name)} must be a yyyy-MM-dd date.");
    }

    private static JsonElement Property(JsonElement element, string name, Path at) =>
        element.TryGetProperty(name, out var value) ? value : throw new FormatException($"{at.Then(name)} is missing.");

    private static void Expect(JsonElement value, JsonValueKind kind, Path at)
    {
        if (value.ValueKind != kind)
        {
            throw new FormatException($"{at} must be a JSON {kind.ToString().ToLowerInvariant()}, not {value.ValueKind.ToString().ToLowerInvariant()}.");
        }
    }

    /// <summary>A JSON path for error messages.</summary>
    private readonly record struct Path(string Value)
    {
        public Path Then(string name) => new($"{Value}.{name}");

        public Path Index(int index) => new($"{Value}[{index}]");

        public override string ToString() => Value;
    }
}
