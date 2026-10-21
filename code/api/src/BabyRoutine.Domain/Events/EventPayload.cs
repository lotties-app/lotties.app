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
    /// <summary>
    /// Parses and validates client <paramref name="json"/>: a JSON object of at most <see cref="MaxLength"/> characters
    /// whose strings and numbers PostgreSQL <c>jsonb</c> can store (see <see cref="StorableJson"/>). <c>null</c> or
    /// blank yields <see cref="Empty"/>.
    /// </summary>
    public static EventPayload From(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Empty;
        }

        EnsureWithinLimit(json);
        EnsureStorableJsonObject(json);
        return new EventPayload(json);
    }

    /// <summary>
    /// Restores a payload read from storage, which was validated by <see cref="From"/> when written. Not revalidated:
    /// <c>jsonb</c> may render a stored number longer than it was sent (e.g. <c>1e60</c> as 61 digits).
    /// </summary>
    public static EventPayload Rehydrate(string? json) =>
        string.IsNullOrWhiteSpace(json) ? Empty : new EventPayload(json);

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

    /// <summary>The value of the top-level string member <paramref name="propertyName"/>, or <c>null</c> when it is absent or not a string.</summary>
    public string? GetString(string propertyName)
    {
        ArgumentNullException.ThrowIfNull(propertyName);
        using var document = JsonDocument.Parse(Value);
        return document.RootElement.ValueKind == JsonValueKind.Object
            && document.RootElement.TryGetProperty(propertyName, out var member)
            && member.ValueKind == JsonValueKind.String
                ? member.GetString()
                : null;
    }

    public override string ToString() => Value;

    private static void EnsureWithinLimit(string json)
    {
        if (json.Length > MaxLength)
        {
            throw new DomainValidationException("Payload", $"Payload must be at most {MaxLength} characters.");
        }
    }

    private static void EnsureStorableJsonObject(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            EnsureObjectRoot(document.RootElement.ValueKind);
            StorableJson.Ensure(document.RootElement, "Payload");
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
