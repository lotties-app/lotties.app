using System.Text.Json;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// Reads the community statistics catalog (schema 1). Strict on the shape: every property must be present (null where
/// the record allows it), with its JSON type, and no unknown property; anything else is a <see cref="FormatException"/>.
/// The rules across entries are <see cref="CommunityStatisticsValidator"/>'s.
/// </summary>
public static class CommunityStatisticsJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
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
}
