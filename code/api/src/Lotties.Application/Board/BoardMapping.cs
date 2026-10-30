using System.Globalization;
using System.Text;
using Lotties.Domain.Board;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Board;

/// <summary>Board entities to their API shapes; user ids are never exposed (only the kind and the display name).</summary>
internal static class BoardMapping
{
    public static BoardItemResponse ToResponse(BoardItem item) => new()
    {
        Id = item.Id,
        Type = BoardCodes.ToCode(item.Type),
        Topic = item.TopicKey,
        Title = item.Title,
        Body = item.Body,
        Status = BoardCodes.ToCode(item.Status),
        Side = BoardCodes.ToCode(item.Side),
        Priority = BoardCodes.ToCode(item.Priority),
        Labels = item.Labels.Values,
        DueDate = item.DueDate,
        Links = Links(item),
        Pinned = item.Pinned,
        Decision = Decision(item),
        Source = item.Source,
        ExternalKey = item.ExternalKey,
        CreatedBy = CreatedBy(item),
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
        ClosedAt = item.ClosedAt,
        DeletedAt = item.DeletedAt,
        Version = item.Version,
    };

    public static BoardItemSummaryResponse ToSummary(BoardItem item) => new()
    {
        Id = item.Id,
        Type = BoardCodes.ToCode(item.Type),
        Topic = item.TopicKey,
        Title = item.Title,
        Excerpt = item.Body is { Length: > BoardItemSummaryResponse.ExcerptLength } body ? body[..BoardItemSummaryResponse.ExcerptLength] : item.Body,
        Status = BoardCodes.ToCode(item.Status),
        Side = BoardCodes.ToCode(item.Side),
        Priority = BoardCodes.ToCode(item.Priority),
        Labels = item.Labels.Values,
        DueDate = item.DueDate,
        Links = Links(item),
        Pinned = item.Pinned,
        Decision = Decision(item),
        Source = item.Source,
        ExternalKey = item.ExternalKey,
        CreatedBy = CreatedBy(item),
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
        ClosedAt = item.ClosedAt,
        DeletedAt = item.DeletedAt,
        Version = item.Version,
    };

    public static BoardApiKeyResponse ToResponse(BoardApiKey key, DateTimeOffset now) => new(
        key.Id,
        key.Name,
        key.Prefix,
        BoardCodes.ToCode(key.Scope),
        key.AllowedTopics,
        key.CreatedByName,
        key.CreatedAt,
        key.ExpiresAt,
        key.LastUsedAt,
        key.UseCount,
        key.RevokedAt,
        key.IsActive(now));

    private static IReadOnlyList<BoardLinkResponse> Links(BoardItem item) =>
        item.Links.Values.Select(link => new BoardLinkResponse(link.Label, link.Url)).ToArray();

    /// <summary>The decision of a decision item that has one; <c>null</c> otherwise (an open decision: no summary, rationale or time yet).</summary>
    private static BoardDecisionResponse? Decision(BoardItem item) =>
        item.Type == BoardItemType.Decision && (item.DecisionSummary is not null || item.Rationale is not null || item.DecidedAt is not null)
            ? new BoardDecisionResponse(item.DecisionSummary, item.Rationale, item.DecidedAt)
            : null;

    private static BoardActorResponse CreatedBy(BoardItem item) =>
        new(BoardCodes.ToCode(item.CreatedByKeyId is null ? BoardActorKind.User : BoardActorKind.ApiKey), item.CreatedByName, item.CreatedByKeyId);
}

/// <summary>
/// The opaque paging cursor of <c>GET /board/items</c>: base64url of <c>v1|sort|offset</c>. It is bound to its sort (another
/// sort is <see cref="InvalidBoardCursorException"/>); clients must not build or parse it (docs/design/36 section 3.2).
/// </summary>
internal static class BoardCursor
{
    private const string Version = "v1";

    public static string Encode(BoardItemSort sort, int offset) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(string.Join('|', Version, BoardCodes.ToCode(sort), offset.ToString(CultureInfo.InvariantCulture))))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static int Decode(string? cursor, BoardItemSort sort)
    {
        if (string.IsNullOrEmpty(cursor))
        {
            return 0;
        }

        var parts = TryText(cursor)?.Split('|');
        return parts is [Version, var code, var number]
            && code == BoardCodes.ToCode(sort)
            && int.TryParse(number, NumberStyles.None, CultureInfo.InvariantCulture, out var offset)
            ? offset
            : throw new InvalidBoardCursorException();
    }

    private static string? TryText(string cursor)
    {
        if (cursor.Length > 64)
        {
            return null;
        }

        var base64 = cursor.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        var buffer = new byte[base64.Length];
        return Convert.TryFromBase64String(base64, buffer, out var written) ? Encoding.UTF8.GetString(buffer, 0, written) : null;
    }
}
