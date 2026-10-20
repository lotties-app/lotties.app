using System.Text.Json;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Events;

/// <summary>Type-specific event data: the JSON text of a single JSON object. Defaults to <c>{}</c>.</summary>
public readonly record struct EventPayload
{
    public const int MaxLength = 16 * 1024;
    private const string EmptyObject = "{}";

    private readonly string? _json;

    private EventPayload(string json)
    {
        _json = json;
    }

    public static EventPayload Empty { get; } = new(EmptyObject);

    /// <summary>The JSON object text.</summary>
    public string Value => _json ?? EmptyObject;

    /// <summary>Parses <paramref name="json"/>; <c>null</c> or blank yields <see cref="Empty"/>.</summary>
    public static EventPayload From(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Empty;
        }

        EnsureWithinLimit(json);
        EnsureJsonObject(json);
        return new EventPayload(json);
    }

    /// <summary>
    /// Whether both payloads hold the same JSON value, ignoring member order and whitespace
    /// (see <see cref="JsonEquivalence"/>), so a replayed upsert is recognized after a <c>jsonb</c> round trip.
    /// </summary>
    public bool IsEquivalentTo(EventPayload other)
    {
        using var left = JsonDocument.Parse(Value);
        using var right = JsonDocument.Parse(other.Value);
        return JsonEquivalence.AreEquivalent(left.RootElement, right.RootElement);
    }

    public override string ToString() => Value;

    private static void EnsureWithinLimit(string json)
    {
        if (json.Length > MaxLength)
        {
            throw new DomainValidationException("Payload", $"Payload must be at most {MaxLength} characters.");
        }
    }

    private static void EnsureJsonObject(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            EnsureObjectRoot(document.RootElement.ValueKind);
        }
        catch (JsonException exception)
        {
            throw new DomainValidationException("Payload", $"Payload is not valid JSON: {exception.Message}");
        }
    }

    private static void EnsureObjectRoot(JsonValueKind kind)
    {
        if (kind != JsonValueKind.Object)
        {
            throw new DomainValidationException("Payload", "Payload must be a JSON object.");
        }
    }
}
