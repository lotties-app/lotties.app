using System.Text.Json.Serialization;
using BabyRoutine.Application.Serialization;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Application.EventTypes;

/// <summary>
/// One field of an event type. <see cref="Kind"/> is written as <c>text</c>, <c>number</c>, <c>select</c> or <c>bool</c>.
/// <see cref="Options"/> apply to select fields, <see cref="Min"/>, <see cref="Max"/> and <see cref="Unit"/> to number fields.
/// </summary>
public sealed record EventFieldDefinitionDto
{
    public required string Key { get; init; }

    public required string Label { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public required EventFieldKind Kind { get; init; }

    public bool IsRequired { get; init; }

    public IReadOnlyList<string>? Options { get; init; }

    public decimal? Min { get; init; }

    public decimal? Max { get; init; }

    public string? Unit { get; init; }

    public static implicit operator EventFieldDefinitionDto(EventFieldDefinition field)
    {
        ArgumentNullException.ThrowIfNull(field);
        return new EventFieldDefinitionDto
        {
            Key = field.Key,
            Label = field.Label,
            Kind = field.Kind,
            IsRequired = field.IsRequired,
            Options = field.Options,
            Min = field.Min,
            Max = field.Max,
            Unit = field.Unit,
        };
    }

    /// <summary>Validates the definition with the domain rules; throws <see cref="Domain.Exceptions.DomainValidationException"/> when invalid.</summary>
    public static explicit operator EventFieldDefinition(EventFieldDefinitionDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return EventFieldDefinition.Create(dto.Key, dto.Label, dto.Kind, dto.IsRequired, dto.Options, dto.Min, dto.Max, dto.Unit);
    }
}

/// <summary>An event type as returned by the API; <see cref="BabyId"/> is <c>null</c> for built-in templates.</summary>
public sealed record EventTypeResponse
{
    public Guid Id { get; init; }

    public Guid? BabyId { get; init; }

    public string Key { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string Icon { get; init; } = string.Empty;

    public string Color { get; init; } = string.Empty;

    public bool HasDuration { get; init; }

    public IReadOnlyList<EventFieldDefinitionDto> Fields { get; init; } = [];

    public static implicit operator EventTypeResponse(EventType eventType)
    {
        ArgumentNullException.ThrowIfNull(eventType);
        return new EventTypeResponse
        {
            Id = eventType.Id,
            BabyId = eventType.BabyId,
            Key = eventType.Key.Value,
            Name = eventType.Name,
            Icon = eventType.Icon,
            Color = eventType.Color.Value,
            HasDuration = eventType.HasDuration,
            Fields = eventType.Fields.Select(field => (EventFieldDefinitionDto)field).ToArray(),
        };
    }
}

/// <summary>Body of <c>POST /api/v1/babies/{babyId}/event-types</c>. The key is immutable afterwards.</summary>
public sealed record CreateEventTypeRequest
{
    /// <summary>Lower snake_case, unique among built-in types and the baby's custom types.</summary>
    public required string Key { get; init; }

    public required string Name { get; init; }

    public required string Icon { get; init; }

    /// <summary><c>#rrggbb</c>.</summary>
    public required string Color { get; init; }

    public bool HasDuration { get; init; }

    public IReadOnlyList<EventFieldDefinitionDto>? Fields { get; init; }
}

/// <summary>Body of <c>PUT /api/v1/babies/{babyId}/event-types/{eventTypeId}</c>: the full editable state, without the key.</summary>
public sealed record UpdateEventTypeRequest
{
    public required string Name { get; init; }

    public required string Icon { get; init; }

    public required string Color { get; init; }

    public bool HasDuration { get; init; }

    public IReadOnlyList<EventFieldDefinitionDto>? Fields { get; init; }
}
