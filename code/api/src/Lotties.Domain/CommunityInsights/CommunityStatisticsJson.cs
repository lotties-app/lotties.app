using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// Reads the community statistics catalog (schema 2). Strict on the shape: every property must be present (null where
/// the record allows it), with its JSON type, and no unknown property; an output tier is exactly <c>"A"</c>, <c>"B"</c> or
/// <c>"notInV1"</c>; anything else is a <see cref="FormatException"/>. The rules across entries are
/// <see cref="CommunityStatisticsValidator"/>'s.
/// </summary>
public static class CommunityStatisticsJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new TierConverter() },
    };

    public static CommunityStatisticsCatalog Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            return JsonSerializer.Deserialize<CommunityStatisticsCatalog>(json, Options)
                ?? throw new FormatException("The community statistics catalog is null.");
        }
        catch (JsonException exception)
        {
            throw new FormatException($"The community statistics catalog is not valid: {exception.Message}", exception);
        }
    }

    /// <summary>The wire names of <see cref="CommunityOutputTier"/>; nothing else is read.</summary>
    private sealed class TierConverter : JsonConverter<CommunityOutputTier>
    {
        public override CommunityOutputTier Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            reader.TokenType == JsonTokenType.String
                ? TierOf(reader.GetString())
                : throw new JsonException($"An output tier must be a string, got {reader.TokenType}.");

        public override void Write(Utf8JsonWriter writer, CommunityOutputTier value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value == CommunityOutputTier.NotInV1 ? "notInV1" : value.ToString());

        private static CommunityOutputTier TierOf(string? name) => name switch
        {
            "A" => CommunityOutputTier.A,
            "B" => CommunityOutputTier.B,
            "notInV1" => CommunityOutputTier.NotInV1,
            _ => throw new JsonException($"Unknown output tier '{name}' (A, B or notInV1)."),
        };
    }
}
