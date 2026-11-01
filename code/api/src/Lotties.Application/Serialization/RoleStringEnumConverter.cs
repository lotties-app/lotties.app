using System.Text.Json.Serialization;

namespace Lotties.Application.Serialization;

/// <summary>Writes enums by their name (e.g. <c>Owner</c>), reads them case-insensitively and rejects numbers; used for roles on DTOs.</summary>
public sealed class RoleStringEnumConverter : JsonStringEnumConverter
{
    public RoleStringEnumConverter()
        : base(namingPolicy: null, allowIntegerValues: false)
    {
    }
}
