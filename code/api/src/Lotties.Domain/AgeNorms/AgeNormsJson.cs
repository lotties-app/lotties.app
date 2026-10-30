using System.Globalization;
using System.Text.Json;

namespace Lotties.Domain.AgeNorms;

/// <summary>
/// Reads the age norms file (schema 1, docs/design/28-age-norms.md section 5). Strict on the shape: every documented
/// property must be present with its JSON type (<c>null</c> where the schema allows it); anything else is a
/// <see cref="FormatException"/> naming the JSON path. The rules across entries are <see cref="AgeNormsValidator"/>'s.
/// </summary>
public static class AgeNormsJson
{
    public static AgeNormSet Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            using var document = JsonDocument.Parse(json);
            return Read(document.RootElement);
        }
        catch (JsonException exception)
        {
            throw new FormatException($"The age norms are not valid JSON: {exception.Message}", exception);
        }
    }

    private static AgeNormSet Read(JsonElement root)
    {
        var at = new Path("$");
        Expect(root, JsonValueKind.Object, at);
        return new AgeNormSet(
            Int(root, "schemaVersion", at),
            Date(root, "generatedAt", at),
            String(root, "purpose", at),
            Strings(root, "units", at),
            Strings(root, "populations", at),
            Strings(root, "rangeKinds", at),
            Strings(root, "typicalKinds", at),
            Array(root, "metrics", at, Metric),
            Array(root, "sources", at, Source),
            Array(root, "norms", at, Norm));
    }

    private static AgeNormMetric Metric(JsonElement element, Path at) =>
        new(
            String(element, "key", at),
            String(element, "unit", at),
            String(element, "description", at),
            OptionalString(element, "missingReason", at));

    private static AgeNormSource Source(JsonElement element, Path at) =>
        new(
            String(element, "id", at),
            String(element, "kind", at),
            String(element, "country", at),
            String(element, "citation", at),
            OptionalString(element, "doi", at),
            String(element, "url", at),
            Date(element, "accessedOn", at),
            String(element, "licence", at),
            String(element, "licenceNote", at));

    private static AgeNorm Norm(JsonElement element, Path at) =>
        new(
            String(element, "id", at),
            String(element, "metric", at),
            String(element, "population", at),
            OptionalString(element, "populationNote", at),
            Band(element, "ageBand", at),
            OptionalNumber(element, "low", at),
            OptionalNumber(element, "typical", at),
            OptionalNumber(element, "high", at),
            String(element, "unit", at),
            OptionalString(element, "typicalSourceId", at),
            Strings(element, "sourceIds", at),
            String(element, "confidence", at),
            Bool(element, "needsReview", at),
            OptionalString(element, "needsReviewReason", at),
            OptionalString(element, "notes", at),
            Array(element, "evidence", at, Evidence));

    private static AgeNormBand Band(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        var inner = at.Then(name);
        Expect(value, JsonValueKind.Object, inner);
        return new AgeNormBand(
            Int(value, "fromDays", inner),
            Int(value, "toDays", inner),
            Number(value, "fromWeeks", inner),
            Number(value, "toWeeks", inner),
            String(value, "label", inner));
    }

    private static AgeNormEvidence Evidence(JsonElement element, Path at) =>
        new(
            String(element, "sourceId", at),
            String(element, "location", at),
            String(element, "sourceAge", at),
            OptionalNumber(element, "low", at),
            OptionalNumber(element, "typical", at),
            OptionalNumber(element, "high", at),
            OptionalString(element, "rangeKind", at),
            OptionalString(element, "typicalKind", at),
            OptionalNumber(element, "sd", at),
            OptionalString(element, "note", at));

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

    private static IReadOnlyList<string> Strings(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        var inner = at.Then(name);
        Expect(value, JsonValueKind.Array, inner);
        return value.EnumerateArray().Select((item, index) => StringValue(item, inner.Index(index))).ToArray();
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

    private static decimal Number(JsonElement element, string name, Path at)
    {
        var value = Property(element, name, at);
        Expect(value, JsonValueKind.Number, at.Then(name));
        return value.TryGetDecimal(out var number) ? number : throw new FormatException($"{at.Then(name)} is out of range.");
    }

    private static decimal? OptionalNumber(JsonElement element, string name, Path at) =>
        Property(element, name, at).ValueKind == JsonValueKind.Null ? null : Number(element, name, at);

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
