using System.Text.Json;
using System.Text.Json.Nodes;

namespace Lotties.Api.Board.Mcp;

/// <summary>The JSON shapes a board tool parameter takes.</summary>
internal enum BoardMcpParameterKind
{
    /// <summary>A string (<see cref="BoardMcpParameter.Max"/> characters at most when set; the service checks the content).</summary>
    Text,

    /// <summary>An item id: a UUID string.</summary>
    Uuid,

    /// <summary>A JSON integer within <see cref="BoardMcpParameter.Min"/>..<see cref="BoardMcpParameter.Max"/>.</summary>
    Integer,

    /// <summary><c>true</c> or <c>false</c>.</summary>
    Boolean,

    /// <summary>One code of <see cref="BoardMcpParameter.Values"/> (the service parses it).</summary>
    Choice,

    /// <summary>An array of codes of <see cref="BoardMcpParameter.Values"/>.</summary>
    ChoiceList,

    /// <summary>An array of strings (labels).</summary>
    TextList,

    /// <summary>A <c>YYYY-MM-DD</c> date (the service parses it).</summary>
    Date,

    /// <summary>An ISO 8601 instant with an offset (<c>2026-10-24T12:00:00Z</c>).</summary>
    Instant,

    /// <summary>An array of <c>{label, url}</c> objects.</summary>
    Links,
}

/// <summary>
/// One board tool parameter: its JSON schema (what <c>tools/list</c> shows) and its shape check (what <c>tools/call</c>
/// enforces) come from the same definition. Only the JSON shape is checked here; the values (codes, lengths, topics, URLs)
/// are the application service's rules (<c>BoardItemInput</c>, <c>BoardService</c>), never repeated in the adapter.
/// <see cref="Nullable"/> parameters take <c>null</c> to clear an optional field (<c>board_update_item</c>); for the others
/// <c>null</c> counts as absent.
/// </summary>
internal sealed record BoardMcpParameter(
    string Name,
    BoardMcpParameterKind Kind,
    string Description,
    bool Required = false,
    bool Nullable = false,
    int Min = 0,
    int Max = 0,
    IReadOnlyList<string>? Values = null)
{
    /// <summary>The parameter's JSON schema (draft 2020-12 keywords).</summary>
    public JsonObject Schema()
    {
        var schema = Kind switch
        {
            BoardMcpParameterKind.Text => WithMax(new JsonObject { ["type"] = "string", ["minLength"] = Required ? 1 : 0 }, "maxLength"),
            BoardMcpParameterKind.Uuid => new JsonObject { ["type"] = "string", ["format"] = "uuid" },
            BoardMcpParameterKind.Integer => new JsonObject { ["type"] = "integer", ["minimum"] = Min, ["maximum"] = Max },
            BoardMcpParameterKind.Boolean => new JsonObject { ["type"] = "boolean" },
            BoardMcpParameterKind.Choice => new JsonObject { ["type"] = "string", ["enum"] = Codes() },
            BoardMcpParameterKind.ChoiceList => WithMax(new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string", ["enum"] = Codes() }, ["uniqueItems"] = true }, "maxItems"),
            BoardMcpParameterKind.TextList => WithMax(new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string", ["minLength"] = 1 } }, "maxItems"),
            BoardMcpParameterKind.Date => new JsonObject { ["type"] = "string", ["format"] = "date", ["pattern"] = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            BoardMcpParameterKind.Instant => new JsonObject { ["type"] = "string", ["format"] = "date-time" },
            BoardMcpParameterKind.Links => WithMax(new JsonObject { ["type"] = "array", ["items"] = LinkSchema() }, "maxItems"),
            _ => throw new InvalidOperationException($"Unknown parameter kind {Kind}."),
        };
        if (Nullable)
        {
            schema["type"] = new JsonArray(schema["type"]!.GetValue<string>(), "null");
        }

        schema["description"] = Description;
        return schema;
    }

    /// <summary>The reason <paramref name="element"/> does not have this parameter's shape, or <c>null</c>.</summary>
    public string? ShapeError(JsonElement element) => Kind switch
    {
        BoardMcpParameterKind.Text or BoardMcpParameterKind.Choice or BoardMcpParameterKind.Date =>
            element.ValueKind == JsonValueKind.String && (!Required || !string.IsNullOrWhiteSpace(element.GetString()))
                ? null
                : Required ? $"{Name} must be a non-empty string." : $"{Name} must be a string.",
        BoardMcpParameterKind.Uuid => element.ValueKind == JsonValueKind.String && Guid.TryParseExact(element.GetString(), "D", out var id) && id != Guid.Empty
            ? null
            : $"{Name} must be a board item id (a UUID).",
        BoardMcpParameterKind.Integer => element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var number) && number >= Min && number <= Max
            ? null
            : $"{Name} must be a whole number from {Min} to {Max}.",
        BoardMcpParameterKind.Boolean => element.ValueKind is JsonValueKind.True or JsonValueKind.False ? null : $"{Name} must be true or false.",
        BoardMcpParameterKind.ChoiceList or BoardMcpParameterKind.TextList =>
            element.ValueKind == JsonValueKind.Array && element.EnumerateArray().All(value => value.ValueKind == JsonValueKind.String)
                ? null
                : $"{Name} must be an array of strings.",
        BoardMcpParameterKind.Instant => element.ValueKind == JsonValueKind.String && element.TryGetDateTimeOffset(out _)
            ? null
            : $"{Name} must be an ISO 8601 instant such as 2026-10-24T12:00:00Z.",
        BoardMcpParameterKind.Links => element.ValueKind == JsonValueKind.Array && element.EnumerateArray().All(value => value.ValueKind == JsonValueKind.Object)
            ? null
            : $"{Name} must be an array of {{label, url}} objects.",
        _ => $"{Name} is not supported.",
    };

    private JsonArray Codes() => new(Values!.Select(value => (JsonNode)JsonValue.Create(value)).ToArray());

    private JsonObject WithMax(JsonObject schema, string keyword)
    {
        if (Max > 0)
        {
            schema[keyword] = Max;
        }

        return schema;
    }

    private static JsonObject LinkSchema() => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["label"] = new JsonObject { ["type"] = "string", ["minLength"] = 1, ["maxLength"] = Domain.Board.BoardLink.LabelMaxLength },
            ["url"] = new JsonObject { ["type"] = "string", ["format"] = "uri", ["maxLength"] = Domain.Board.BoardLink.UrlMaxLength, ["description"] = "An absolute http or https URL." },
        },
        ["required"] = new JsonArray("label", "url"),
        ["additionalProperties"] = false,
    };
}

/// <summary>Why a tool call's arguments were refused: the parameter (or <c>arguments</c>) and a sentence for the model.</summary>
internal sealed record BoardMcpArgumentError(string Field, string Message);

/// <summary>
/// A board tool call's arguments after the strict shape check against the tool's parameters: no unknown member, every
/// required one present, every value of its JSON shape (no coercion: <c>"20"</c> is not a number). <c>null</c> is kept only
/// for <see cref="BoardMcpParameter.Nullable"/> parameters ("clear it"); elsewhere it counts as absent.
/// </summary>
internal sealed class BoardMcpArguments
{
    private readonly IReadOnlyDictionary<string, JsonElement> _values;

    private BoardMcpArguments(IReadOnlyDictionary<string, JsonElement> values) => _values = values;

    /// <summary>The arguments, or the first error (unknown members first, then in parameter order).</summary>
    public static (BoardMcpArguments? Arguments, BoardMcpArgumentError? Error) Parse(IDictionary<string, JsonElement>? arguments, IReadOnlyList<BoardMcpParameter> parameters)
    {
        var given = arguments ?? new Dictionary<string, JsonElement>();
        if (given.Keys.FirstOrDefault(name => parameters.All(parameter => parameter.Name != name)) is { } unknown)
        {
            return (null, new BoardMcpArgumentError(unknown.Length <= 64 ? unknown : unknown[..64], $"Unknown argument. This tool takes: {Names(parameters)}."));
        }

        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var parameter in parameters)
        {
            var present = given.TryGetValue(parameter.Name, out var value) && (value.ValueKind != JsonValueKind.Null || parameter.Nullable);
            if (!present)
            {
                if (parameter.Required)
                {
                    return (null, new BoardMcpArgumentError(parameter.Name, $"{parameter.Name} is required."));
                }

                continue;
            }

            if (value.ValueKind != JsonValueKind.Null && parameter.ShapeError(value) is { } error)
            {
                return (null, new BoardMcpArgumentError(parameter.Name, error));
            }

            values[parameter.Name] = value.Clone();
        }

        return (new BoardMcpArguments(values), null);
    }

    public bool Has(string name) => _values.ContainsKey(name);

    public string? Text(string name) => _values.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    public Guid Id(string name) => Guid.ParseExact(_values[name].GetString()!, "D");

    public Guid? OptionalId(string name) => _values.ContainsKey(name) ? Id(name) : null;

    public int? Integer(string name) => _values.TryGetValue(name, out var value) ? value.GetInt32() : null;

    public bool? Boolean(string name) => _values.TryGetValue(name, out var value) ? value.GetBoolean() : null;

    public DateTimeOffset? Instant(string name) => _values.TryGetValue(name, out var value) ? value.GetDateTimeOffset() : null;

    public IReadOnlyList<string>? Strings(string name) =>
        _values.TryGetValue(name, out var value) ? value.EnumerateArray().Select(item => item.GetString()!).ToArray() : null;

    /// <summary>The given arguments among <paramref name="names"/> as one JSON object (explicit <c>null</c>s kept), for the service's strict body reader.</summary>
    public JsonElement ObjectOf(IEnumerable<string> names, IReadOnlyDictionary<string, JsonNode?>? extra = null)
    {
        var body = new JsonObject();
        foreach (var name in names.Where(_values.ContainsKey))
        {
            body[name] = JsonNode.Parse(_values[name].GetRawText());
        }

        foreach (var (name, value) in extra ?? new Dictionary<string, JsonNode?>())
        {
            body[name] = value;
        }

        return JsonSerializer.SerializeToElement(body);
    }

    private static string Names(IReadOnlyList<BoardMcpParameter> parameters) =>
        parameters.Count == 0 ? "no arguments" : string.Join(", ", parameters.Select(parameter => parameter.Name));
}
