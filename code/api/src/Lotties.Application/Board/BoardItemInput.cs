using System.Globalization;
using System.Text.Json;
using Lotties.Domain.Board;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Board;

/// <summary>
/// The fields of a board item create or patch body, read strictly from JSON (docs/design/36-project-board.md section
/// 3.1): every property must be known and of the right JSON type, else 400 <c>validation_failed</c> naming it (prefixed
/// by <c>items[i].</c> in a bulk body), so a typo never drops a field silently. A property that is present with
/// <c>null</c> is "clear it" for a patch; an absent one is "leave it".
/// </summary>
public sealed class BoardItemInput
{
    private static readonly string[] CreateFields =
        ["id", "type", "topic", "title", "body", "status", "side", "priority", "labels", "dueDate", "links", "pinned", "decisionSummary", "rationale", "decidedAt", "source", "externalKey"];

    private static readonly string[] PatchFields =
        ["type", "topic", "title", "body", "status", "side", "priority", "labels", "dueDate", "links", "pinned", "decisionSummary", "rationale", "decidedAt", "source", "version"];

    private readonly HashSet<string> _present = new(StringComparer.Ordinal);

    private BoardItemInput()
    {
    }

    public Guid? Id { get; private set; }

    public string? Type { get; private set; }

    public string? Topic { get; private set; }

    public string? Title { get; private set; }

    public string? Body { get; private set; }

    public string? Status { get; private set; }

    public string? Side { get; private set; }

    public string? Priority { get; private set; }

    public IReadOnlyList<string?>? Labels { get; private set; }

    public DateOnly? DueDate { get; private set; }

    public IReadOnlyList<(string? Label, string? Url)>? Links { get; private set; }

    public bool? Pinned { get; private set; }

    public string? DecisionSummary { get; private set; }

    public string? Rationale { get; private set; }

    public DateTimeOffset? DecidedAt { get; private set; }

    public string? Source { get; private set; }

    public string? ExternalKey { get; private set; }

    public int? Version { get; private set; }

    /// <summary>The field prefix of error messages (<c>items[3].</c> in a bulk body).</summary>
    public string Prefix { get; private set; } = string.Empty;

    public bool Has(string field) => _present.Contains(field);

    /// <summary>A create body (also one entry of a bulk body, with <paramref name="prefix"/> <c>items[i].</c>).</summary>
    public static BoardItemInput ForCreate(JsonElement body, string prefix = "") => Read(body, CreateFields, prefix);

    public static BoardItemInput ForPatch(JsonElement body) => Read(body, PatchFields, string.Empty);

    /// <summary>The field's name as errors report it.</summary>
    public string Field(string name) => Prefix + name;

    /// <summary>The content of a new item: <c>type</c>, <c>topic</c> and <c>title</c> are required; the rest has defaults.</summary>
    public BoardItemContent ToNewContent() =>
        WithPrefix(() => BoardItemContent.Create(
            ParseRequired<BoardItemType>(Type, "type"),
            Topic,
            Title,
            Body,
            ParseOr(Status, "status", BoardItemStatus.Open),
            ParseOr(Side, "side", BoardSide.Both),
            ParseOr(Priority, "priority", BoardPriority.Normal),
            BoardLabels.Create(Labels),
            DueDate,
            ToLinks(),
            Pinned ?? false,
            DecisionSummary,
            Rationale,
            DecidedAt,
            Source));

    /// <summary><paramref name="current"/> with the present fields replaced (<c>null</c> clears an optional one), validated as a whole.</summary>
    public BoardItemContent ApplyTo(BoardItemContent current)
    {
        ArgumentNullException.ThrowIfNull(current);
        return WithPrefix(() => BoardItemContent.Create(
            Has("type") ? ParseRequired<BoardItemType>(Type, "type") : current.Type,
            Has("topic") ? Topic : current.TopicKey,
            Has("title") ? Title : current.Title,
            Has("body") ? Body : current.Body,
            Has("status") ? ParseRequired<BoardItemStatus>(Status, "status") : current.Status,
            Has("side") ? ParseRequired<BoardSide>(Side, "side") : current.Side,
            Has("priority") ? ParseRequired<BoardPriority>(Priority, "priority") : current.Priority,
            Has("labels") ? BoardLabels.Create(Labels) : current.Labels,
            Has("dueDate") ? DueDate : current.DueDate,
            Has("links") ? ToLinks() : current.Links,
            Has("pinned") ? Pinned ?? false : current.Pinned,
            Has("decisionSummary") ? DecisionSummary : current.DecisionSummary,
            Has("rationale") ? Rationale : current.Rationale,
            Has("decidedAt") ? DecidedAt : current.DecidedAt,
            Has("source") ? Source : current.Source));
    }

    /// <summary>The external key, validated (<c>null</c> when absent or blank).</summary>
    public string? ValidExternalKey() => WithPrefix(() => BoardItem.OptionalExternalKey(ExternalKey));

    private static TEnum ParseRequired<TEnum>(string? code, string field)
        where TEnum : struct, Enum => BoardCodes.Parse<TEnum>(code, field);

    private static TEnum ParseOr<TEnum>(string? code, string field, TEnum fallback)
        where TEnum : struct, Enum => code is null ? fallback : BoardCodes.Parse<TEnum>(code, field);

    private BoardLinks ToLinks() => BoardLinks.Create(Links?.Select(link => BoardLink.Create(link.Label, link.Url)));

    private T WithPrefix<T>(Func<T> build)
    {
        try
        {
            return build();
        }
        catch (DomainValidationException exception) when (Prefix.Length > 0)
        {
            throw new DomainValidationException(Prefix + exception.Field, exception.Message);
        }
    }

    private static BoardItemInput Read(JsonElement body, IReadOnlyCollection<string> allowed, string prefix)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            throw new DomainValidationException(prefix.Length == 0 ? "body" : prefix.TrimEnd('.'), "The body must be a JSON object.");
        }

        var input = new BoardItemInput { Prefix = prefix };
        foreach (var property in body.EnumerateObject())
        {
            var name = allowed.FirstOrDefault(field => string.Equals(field, property.Name, StringComparison.OrdinalIgnoreCase))
                ?? throw new DomainValidationException(prefix + property.Name, $"Unknown property '{property.Name}'.");
            if (!input._present.Add(name))
            {
                throw new DomainValidationException(prefix + name, $"Property '{name}' is given twice.");
            }

            input.Set(name, property.Value);
        }

        return input;
    }

    private void Set(string name, JsonElement value)
    {
        switch (name)
        {
            case "id": Id = ReadGuid(value, name); break;
            case "type": Type = ReadString(value, name); break;
            case "topic": Topic = ReadString(value, name); break;
            case "title": Title = ReadString(value, name); break;
            case "body": Body = ReadString(value, name); break;
            case "status": Status = ReadString(value, name); break;
            case "side": Side = ReadString(value, name); break;
            case "priority": Priority = ReadString(value, name); break;
            case "labels": Labels = ReadStrings(value, name); break;
            case "dueDate": DueDate = ReadDate(value, name); break;
            case "links": Links = ReadLinks(value, name); break;
            case "pinned": Pinned = ReadBool(value, name); break;
            case "decisionSummary": DecisionSummary = ReadString(value, name); break;
            case "rationale": Rationale = ReadString(value, name); break;
            case "decidedAt": DecidedAt = ReadInstant(value, name); break;
            case "source": Source = ReadString(value, name); break;
            case "externalKey": ExternalKey = ReadString(value, name); break;
            case "version": Version = ReadInt(value, name); break;
            default: throw new DomainValidationException(Prefix + name, $"Unknown property '{name}'.");
        }
    }

    private string? ReadString(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.String => value.GetString(),
        _ => throw Invalid(name, "must be a string or null"),
    };

    private IReadOnlyList<string?>? ReadStrings(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.Array => value.EnumerateArray().Select(element => element.ValueKind == JsonValueKind.String ? element.GetString() : throw Invalid(name, "must be an array of strings")).ToArray(),
        _ => throw Invalid(name, "must be an array of strings or null"),
    };

    private IReadOnlyList<(string? Label, string? Url)>? ReadLinks(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.Array => value.EnumerateArray().Select(element => ReadLink(element, name)).ToArray(),
        _ => throw Invalid(name, "must be an array of {label, url} or null"),
    };

    private (string? Label, string? Url) ReadLink(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw Invalid(name, "must be an array of {label, url}");
        }

        string? label = null;
        string? url = null;
        foreach (var property in element.EnumerateObject())
        {
            if (string.Equals(property.Name, "label", StringComparison.OrdinalIgnoreCase))
            {
                label = ReadString(property.Value, name);
            }
            else if (string.Equals(property.Name, "url", StringComparison.OrdinalIgnoreCase))
            {
                url = ReadString(property.Value, name);
            }
            else
            {
                throw Invalid(name, "has a link with an unknown property (only label and url)");
            }
        }

        return (label, url);
    }

    private bool? ReadBool(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => throw Invalid(name, "must be true, false or null"),
    };

    private int? ReadInt(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.Number when value.TryGetInt32(out var number) && number > 0 => number,
        _ => throw Invalid(name, "must be a positive integer"),
    };

    private Guid? ReadGuid(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.String when Guid.TryParse(value.GetString(), out var id) && id != Guid.Empty => id,
        _ => throw Invalid(name, "must be a non-empty GUID"),
    };

    private DateOnly? ReadDate(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.String when DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) => date,
        _ => throw Invalid(name, "must be a date (yyyy-MM-dd) or null"),
    };

    private DateTimeOffset? ReadInstant(JsonElement value, string name) => value.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.String when value.TryGetDateTimeOffset(out var instant) => instant,
        _ => throw Invalid(name, "must be an ISO 8601 instant or null"),
    };

    private DomainValidationException Invalid(string name, string rule) => new(Prefix + name, $"{name} {rule}.");
}
