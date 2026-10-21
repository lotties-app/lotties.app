using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lotties.Application.Serialization;

/// <summary>Writes enums as camelCase strings (e.g. <c>select</c>) and rejects numbers; used on DTO properties.</summary>
public sealed class CamelCaseStringEnumConverter : JsonStringEnumConverter
{
    public CamelCaseStringEnumConverter()
        : base(JsonNamingPolicy.CamelCase, allowIntegerValues: false)
    {
    }
}
