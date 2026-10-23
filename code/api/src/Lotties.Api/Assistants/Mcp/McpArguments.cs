using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Lotties.Domain.Notifications;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>The JSON types a tool parameter takes.</summary>
internal enum McpParameterKind
{
    /// <summary>A UUID string (a baby id from <c>list_babies</c>).</summary>
    Uuid,

    /// <summary>A JSON integer within <see cref="McpParameter.Min"/>..<see cref="McpParameter.Max"/>.</summary>
    Integer,

    /// <summary>One of <see cref="McpParameter.Values"/>.</summary>
    Choice,

    /// <summary>A <c>YYYY-MM-DD</c> calendar date.</summary>
    Date,

    /// <summary>An idempotency key: <see cref="McpParameter.Min"/>..<see cref="McpParameter.Max"/> characters of <c>[A-Za-z0-9._:-]</c>.</summary>
    Key,

    /// <summary>An IANA time zone id the server knows (<c>America/Sao_Paulo</c>).</summary>
    TimeZone,
}

/// <summary>
/// One tool parameter: its JSON schema (what <c>tools/list</c> shows) and its strict validation (what <c>tools/call</c>
/// enforces) come from the same definition, so they cannot drift apart.
/// </summary>
internal sealed partial record McpParameter(string Name, McpParameterKind Kind, string Description, bool Required = false, int Min = 0, int Max = 0, IReadOnlyList<string>? Values = null)
{
    public const int MaxKeyLength = 64;
    public const int MinKeyLength = 8;

    public static McpParameter BabyId { get; } = new(
        "babyId",
        McpParameterKind.Uuid,
        "The baby's id, as list_babies returns it. Omit it to use the default baby (the only one, or the one chosen in the app).");

    public static McpParameter IdempotencyKey { get; } = new(
        "idempotencyKey",
        McpParameterKind.Key,
        "A unique key for this action (for example a UUID). Send the same key again only when retrying the same action: it is then logged once. Without a key every call logs.",
        Min: MinKeyLength,
        Max: MaxKeyLength);

    public static McpParameter TimeZone { get; } = new(
        "timeZone",
        McpParameterKind.TimeZone,
        "The IANA time zone to answer in, e.g. America/Sao_Paulo (local days and times). Omit it to use the family's zone stored in Lotties; the result always names the zone it used.");

    /// <summary>The parameter's JSON schema (draft 2020-12 keywords).</summary>
    public JsonObject Schema() => Kind switch
    {
        McpParameterKind.Uuid => new JsonObject { ["type"] = "string", ["format"] = "uuid", ["description"] = Description },
        McpParameterKind.Integer => new JsonObject { ["type"] = "integer", ["minimum"] = Min, ["maximum"] = Max, ["description"] = Description },
        McpParameterKind.Choice => new JsonObject { ["type"] = "string", ["enum"] = new JsonArray(Values!.Select(value => (JsonNode)JsonValue.Create(value)).ToArray()), ["description"] = Description },
        McpParameterKind.Date => new JsonObject { ["type"] = "string", ["format"] = "date", ["pattern"] = DatePattern, ["description"] = Description },
        McpParameterKind.Key => new JsonObject { ["type"] = "string", ["minLength"] = Min, ["maxLength"] = Max, ["pattern"] = KeyPattern, ["description"] = Description },
        McpParameterKind.TimeZone => new JsonObject { ["type"] = "string", ["minLength"] = 1, ["maxLength"] = NotificationTimeZone.MaxLength, ["description"] = Description },
        _ => throw new InvalidOperationException($"Unknown parameter kind {Kind}."),
    };

    /// <summary>The value of <paramref name="element"/>, or the reason it is not one this parameter takes.</summary>
    public (object? Value, string? Error) Read(JsonElement element) => Kind switch
    {
        McpParameterKind.Uuid => element.ValueKind == JsonValueKind.String && Guid.TryParseExact(element.GetString(), "D", out var id) && id != Guid.Empty
            ? (id, null)
            : (null, $"{Name} must be a baby id (a UUID) from list_babies."),
        McpParameterKind.Integer => element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var number) && number >= Min && number <= Max
            ? (number, null)
            : (null, $"{Name} must be a whole number from {Min} to {Max}."),
        McpParameterKind.Choice => element.ValueKind == JsonValueKind.String && Values!.Contains(element.GetString()!, StringComparer.Ordinal)
            ? (element.GetString(), null)
            : (null, $"{Name} must be one of: {string.Join(", ", Values!)}."),
        McpParameterKind.Date => element.ValueKind == JsonValueKind.String && DateOnly.TryParseExact(element.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? (date, null)
            : (null, $"{Name} must be a date like 2026-10-23."),
        McpParameterKind.Key => element.ValueKind == JsonValueKind.String && element.GetString() is { } key && key.Length >= Min && key.Length <= Max && KeyRegex().IsMatch(key)
            ? (key, null)
            : (null, $"{Name} must be {Min} to {Max} characters of letters, digits, '.', '_', ':' or '-'."),
        McpParameterKind.TimeZone => element.ValueKind == JsonValueKind.String && NotificationTimeZone.TryFrom(element.GetString(), out var zone)
            ? (zone.Value, null)
            : (null, $"{Name} must be an IANA time zone id such as America/Sao_Paulo."),
        _ => (null, $"{Name} is not supported."),
    };

    private const string DatePattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
    private const string KeyPattern = "^[A-Za-z0-9._:-]+$";

    [GeneratedRegex(@"\A[A-Za-z0-9._:\-]+\z")]
    private static partial Regex KeyRegex();
}

/// <summary>Why a tool call's arguments were refused: the parameter (or <c>arguments</c>) and a sentence for the model.</summary>
internal sealed record McpArgumentError(string Field, string Message);

/// <summary>
/// A tool call's arguments after strict validation against the tool's parameters: no unknown member, every required one
/// present, every value of its exact JSON type and range (no coercion: <c>"120"</c> is not a number). <c>null</c> counts as
/// absent.
/// </summary>
internal sealed class McpArguments
{
    private readonly IReadOnlyDictionary<string, object> _values;

    private McpArguments(IReadOnlyDictionary<string, object> values) => _values = values;

    public static McpArguments Empty { get; } = new(new Dictionary<string, object>());

    public Guid? BabyId => _values.TryGetValue(McpParameter.BabyId.Name, out var value) ? (Guid)value : null;

    public string? IdempotencyKey => _values.TryGetValue(McpParameter.IdempotencyKey.Name, out var value) ? (string)value : null;

    public string? TimeZone => _values.TryGetValue(McpParameter.TimeZone.Name, out var value) ? (string)value : null;

    /// <summary>The arguments, or the first error in parameter order (unknown members first).</summary>
    public static (McpArguments? Arguments, McpArgumentError? Error) Parse(IDictionary<string, JsonElement>? arguments, IReadOnlyList<McpParameter> parameters)
    {
        var given = (arguments ?? new Dictionary<string, JsonElement>()).Where(pair => pair.Value.ValueKind != JsonValueKind.Null).ToArray();
        if (given.FirstOrDefault(pair => parameters.All(parameter => parameter.Name != pair.Key)) is { Key: { } unknown })
        {
            return (null, new McpArgumentError(Truncate(unknown), $"Unknown argument. This tool takes: {Names(parameters)}."));
        }

        var values = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var parameter in parameters)
        {
            var found = given.FirstOrDefault(pair => pair.Key == parameter.Name);
            if (found.Key is null)
            {
                if (parameter.Required)
                {
                    return (null, new McpArgumentError(parameter.Name, $"{parameter.Name} is required."));
                }

                continue;
            }

            var (value, error) = parameter.Read(found.Value);
            if (error is not null)
            {
                return (null, new McpArgumentError(parameter.Name, error));
            }

            values[parameter.Name] = value!;
        }

        return (new McpArguments(values), null);
    }

    public int? Integer(string name) => _values.TryGetValue(name, out var value) ? (int)value : null;

    public string? Text(string name) => _values.TryGetValue(name, out var value) ? (string)value : null;

    public DateOnly? Date(string name) => _values.TryGetValue(name, out var value) ? (DateOnly)value : null;

    private static string Names(IReadOnlyList<McpParameter> parameters) => parameters.Count == 0 ? "no arguments" : string.Join(", ", parameters.Select(parameter => parameter.Name));

    /// <summary>An unknown member's name, cut short: it is echoed in the error, never logged.</summary>
    private static string Truncate(string name) => name.Length <= 64 ? name : name[..64];
}
