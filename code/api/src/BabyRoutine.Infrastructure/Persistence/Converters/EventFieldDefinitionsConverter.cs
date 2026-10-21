using System.Text.Json;
using System.Text.Json.Serialization;
using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace BabyRoutine.Infrastructure.Persistence.Converters;

/// <summary>
/// Stores an event type's field definitions as a JSON array, e.g.
/// <c>[{"key":"side","label":"Side","kind":"select","isRequired":false,"options":["left","right"],"visibleWhen":{"field":"method","equals":["breast"]}}]</c>.
/// Absent optional members (options, min, max, unit, visibleWhen) are left out, as are the flags <c>hidden</c> and
/// <c>integer</c> while false, so definitions stored before those flags existed read back unchanged.
/// </summary>
internal sealed class EventFieldDefinitionsConverter : ValueConverter<IReadOnlyList<EventFieldDefinition>, string>
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false) },
    };

    public EventFieldDefinitionsConverter()
        : base(fields => Serialize(fields), json => Deserialize(json))
    {
    }

    public static ValueComparer<IReadOnlyList<EventFieldDefinition>> Comparer { get; } = new(
        (left, right) => Serialize(left!) == Serialize(right!),
        fields => Serialize(fields).GetHashCode(StringComparison.Ordinal),
        fields => Deserialize(Serialize(fields)));

    public static string Serialize(IReadOnlyList<EventFieldDefinition> fields) =>
        JsonSerializer.Serialize(fields.Select(ToDocument).ToArray(), SerializerOptions);

    public static IReadOnlyList<EventFieldDefinition> Deserialize(string json)
    {
        var documents = JsonSerializer.Deserialize<FieldDocument[]>(json, SerializerOptions) ?? [];
        return Array.AsReadOnly(documents.Select(ToDefinition).ToArray());
    }

    private static FieldDocument ToDocument(EventFieldDefinition field) => new(
        field.Key,
        field.Label,
        field.Kind,
        field.IsRequired,
        field.Options.Count == 0 ? null : field.Options,
        field.Min,
        field.Max,
        field.Unit,
        field.VisibleWhen is null ? null : new VisibilityDocument(field.VisibleWhen.Field, field.VisibleWhen.Values),
        field.IsHidden ? true : null,
        field.IsInteger ? true : null);

    private static EventFieldDefinition ToDefinition(FieldDocument document) => EventFieldDefinition.Create(
        document.Key,
        document.Label,
        document.Kind,
        document.IsRequired,
        document.Options,
        document.Min,
        document.Max,
        document.Unit,
        document.VisibleWhen is null ? null : FieldVisibilityCondition.Create(document.VisibleWhen.Field, document.VisibleWhen.EqualsValues),
        document.Hidden == true,
        document.Integer == true);

    private sealed record FieldDocument(
        string Key,
        string Label,
        EventFieldKind Kind,
        bool IsRequired,
        IReadOnlyList<string>? Options,
        decimal? Min,
        decimal? Max,
        string? Unit,
        VisibilityDocument? VisibleWhen = null,
        bool? Hidden = null,
        bool? Integer = null);

    private sealed record VisibilityDocument(
        string Field,
        [property: JsonPropertyName("equals")] IReadOnlyList<string> EqualsValues);
}
