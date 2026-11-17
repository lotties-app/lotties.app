using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// Reads the community statistics catalog (schema 1). Strict on the shape: every property must be present (null where
/// the record allows it), with its JSON type, and no unknown property; anything else is a <see cref="FormatException"/>.
/// The rules across entries are <see cref="CommunityStatisticsValidator"/>'s. Accepts <c>epsilon</c> as either a plain
/// number (v1 backward compat) or an object <c>{tierA, tierB}</c> (v2); when the object form is used, the effective
/// epsilon stored on <see cref="CommunityStatistic.Epsilon"/> is <c>tierA</c> (the Phase 0 budget).
/// </summary>
public static class CommunityStatisticsJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        Converters = { new EpsilonConverter() },
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

    /// <summary>
    /// Reads <c>epsilon</c> as either a plain decimal (v1) or <c>{"tierA": d, "tierB": d}</c> (v2). When the object
    /// form is present, the deserialized value is <c>tierA</c>; <c>tierB</c> is accepted but not stored on the record
    /// (Phase 0 uses only tier-A shares, so the tier-B budget is metadata until O2 approval).
    /// </summary>
    private sealed class EpsilonConverter : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Number)
            {
                return reader.GetDecimal();
            }

            if (reader.TokenType == JsonTokenType.StartObject)
            {
                decimal? tierA = null;
                while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                {
                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        continue;
                    }

                    var name = reader.GetString();
                    reader.Read();
                    if (string.Equals(name, "tierA", StringComparison.Ordinal))
                    {
                        tierA = reader.GetDecimal();
                    }
                    else if (string.Equals(name, "tierB", StringComparison.Ordinal))
                    {
                        // Accepted but not stored; Phase 0 ignores tier-B.
                        _ = reader.GetDecimal();
                    }
                    else
                    {
                        reader.Skip();
                    }
                }

                return tierA ?? throw new JsonException("epsilon object must contain 'tierA'.");
            }

            throw new JsonException($"epsilon must be a number or {{tierA, tierB}} object, got {reader.TokenType}.");
        }

        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options)
        {
            writer.WriteNumberValue(value);
        }
    }
}
