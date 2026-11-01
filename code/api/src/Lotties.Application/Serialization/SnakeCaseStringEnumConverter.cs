using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lotties.Application.Serialization;

/// <summary>Writes enums as snake_case strings (e.g. <c>sleep_started</c>) and rejects numbers; used on assistant results.</summary>
public sealed class SnakeCaseStringEnumConverter : JsonStringEnumConverter
{
    public SnakeCaseStringEnumConverter()
        : base(JsonNamingPolicy.SnakeCaseLower, allowIntegerValues: false)
    {
    }
}
