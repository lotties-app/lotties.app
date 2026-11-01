using System.Text.Json.Nodes;
using Lotties.Domain.Events;

namespace Lotties.Domain.Imports;

/// <summary>Builds an <see cref="EventPayload"/> field by field, leaving out <c>null</c> values; keys keep insertion order.</summary>
internal sealed class PayloadBuilder
{
    private readonly JsonObject _fields = [];

    public PayloadBuilder With(string key, string? value) => value is null ? this : Set(key, JsonValue.Create(value));

    public PayloadBuilder With(string key, decimal? value) => value is null ? this : Set(key, JsonValue.Create(value.Value));

    public PayloadBuilder With(string key, int? value) => value is null ? this : Set(key, JsonValue.Create(value.Value));

    public PayloadBuilder With(string key, JsonNode node) => Set(key, node);

    public EventPayload Build() => EventPayload.From(_fields.ToJsonString());

    private PayloadBuilder Set(string key, JsonNode node)
    {
        _fields[key] = node;
        return this;
    }
}

/// <summary>Composes event notes from the Napper comment and labelled extra values that have no payload field.</summary>
internal static class NapperNotes
{
    public static string? Compose(string? comment, params string?[] extraLines)
    {
        var lines = extraLines.Prepend(comment).Where(line => !string.IsNullOrWhiteSpace(line)).Select(line => line!.Trim()).ToArray();
        return lines.Length == 0 ? null : string.Join('\n', lines);
    }

    public static string? Line(string label, string? value) => string.IsNullOrWhiteSpace(value) ? null : $"{label}: {value.Trim()}";

    public static string? Line(string label, decimal? value) =>
        value is null ? null : $"{label}: {value.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
}
