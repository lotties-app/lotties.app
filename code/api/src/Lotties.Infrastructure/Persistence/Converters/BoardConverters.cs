using System.Text.Json;
using Lotties.Domain.Board;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Converters;

/// <summary>
/// Storage forms of the board's values: enums as their snake_case codes (<see cref="BoardCodes"/>), links as a JSON array
/// <c>[{"label":"...","url":"..."}]</c> and history changes as <c>[{"field":"status","from":"open","to":"done"}]</c>.
/// </summary>
internal static class BoardConverters
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static ValueConverter<TEnum, string> Code<TEnum>()
        where TEnum : struct, Enum =>
        new(value => BoardCodes.ToCode(value), code => BoardCodes.Parse<TEnum>(code, "stored"));

    public static readonly ValueConverter<BoardLinks, string> Links =
        new(links => SerializeLinks(links), json => DeserializeLinks(json));

    public static readonly ValueComparer<BoardLinks> LinksComparer =
        new((left, right) => Equals(left, right), links => links.GetHashCode(), links => links);

    public static readonly ValueConverter<IReadOnlyList<BoardFieldChange>, string> Changes =
        new(changes => SerializeChanges(changes), json => DeserializeChanges(json));

    public static readonly ValueComparer<IReadOnlyList<BoardFieldChange>> ChangesComparer =
        new((left, right) => left!.SequenceEqual(right!), changes => changes.Aggregate(0, (hash, change) => HashCode.Combine(hash, change)), changes => changes);

    private static string SerializeLinks(BoardLinks links) =>
        JsonSerializer.Serialize(links.Values.Select(link => new LinkDocument(link.Label, link.Url)).ToArray(), Json);

    private static BoardLinks DeserializeLinks(string json) =>
        BoardLinks.Rehydrate((JsonSerializer.Deserialize<LinkDocument[]>(json, Json) ?? []).Select(document => new BoardLink(document.Label, document.Url)));

    private static string SerializeChanges(IReadOnlyList<BoardFieldChange> changes) =>
        JsonSerializer.Serialize(changes.Select(change => new ChangeDocument(change.Field, change.From, change.To)).ToArray(), Json);

    private static IReadOnlyList<BoardFieldChange> DeserializeChanges(string json) =>
        (JsonSerializer.Deserialize<ChangeDocument[]>(json, Json) ?? []).Select(document => new BoardFieldChange(document.Field, document.From, document.To)).ToArray();

    private sealed record LinkDocument(string Label, string Url);

    private sealed record ChangeDocument(string Field, string? From, string? To);
}
