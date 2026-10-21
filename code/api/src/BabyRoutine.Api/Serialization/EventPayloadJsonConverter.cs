using System.Text.Json;
using System.Text.Json.Serialization;
using BabyRoutine.Domain.Events;

namespace BabyRoutine.Api.Serialization;

/// <summary>
/// Puts <see cref="EventPayload"/> on the wire as the JSON object itself (not a string). Reading validates it with
/// <see cref="EventPayload.From"/>, so a non-object or oversized payload is a 400; <c>null</c> reads as <c>{}</c>.
/// </summary>
internal sealed class EventPayloadJsonConverter : JsonConverter<EventPayload>
{
    public override EventPayload Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        return document.RootElement.ValueKind == JsonValueKind.Null
            ? EventPayload.Empty
            : EventPayload.From(document.RootElement.GetRawText());
    }

    public override void Write(Utf8JsonWriter writer, EventPayload value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WriteRawValue(value.Value);
    }
}
