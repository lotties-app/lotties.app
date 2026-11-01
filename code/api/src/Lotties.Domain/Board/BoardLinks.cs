using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Board;

/// <summary>A link of a board item: a label and an absolute <c>http</c>/<c>https</c> URL.</summary>
public sealed record BoardLink(string Label, string Url)
{
    public const int LabelMaxLength = 100;
    public const int UrlMaxLength = 2000;

    public static BoardLink Create(string? label, string? url, string field = "links")
    {
        var link = Text.Required(url, field, UrlMaxLength);
        if (!Uri.TryCreate(link, UriKind.Absolute, out var parsed) || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            throw new DomainValidationException(field, "Each link must be an absolute http or https URL.");
        }

        return new BoardLink(Text.Required(label, field, LabelMaxLength), link);
    }
}

/// <summary>The links of a board item: at most <see cref="MaxCount"/>, in the given order.</summary>
public sealed record BoardLinks
{
    public const int MaxCount = 10;

    private BoardLinks(IReadOnlyList<BoardLink> values) => Values = values;

    public static BoardLinks None { get; } = new(Array.Empty<BoardLink>());

    public IReadOnlyList<BoardLink> Values { get; }

    public static BoardLinks Create(IEnumerable<BoardLink>? links, string field = "links")
    {
        var list = links?.ToArray() ?? [];
        return list.Length > MaxCount
            ? throw new DomainValidationException(field, $"An item has at most {MaxCount} links.")
            : list.Length == 0 ? None : new BoardLinks(list);
    }

    /// <summary>Links already validated (read back from storage).</summary>
    public static BoardLinks Rehydrate(IEnumerable<BoardLink>? links) => links?.ToArray() is { Length: > 0 } list ? new BoardLinks(list) : None;

    public bool Equals(BoardLinks? other) => other is not null && Values.SequenceEqual(other.Values);

    public override int GetHashCode() => Values.Aggregate(0, (hash, link) => HashCode.Combine(hash, link));

    public override string ToString() => string.Join(", ", Values.Select(link => link.Url));
}
