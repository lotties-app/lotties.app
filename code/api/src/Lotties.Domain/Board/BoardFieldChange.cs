using System.Globalization;

namespace Lotties.Domain.Board;

/// <summary>
/// One changed field in a board history entry, as display texts (<c>null</c> = empty). Texts longer than
/// <see cref="TextMaxLength"/> are cut and end in an ellipsis, so a body is never copied whole into the history.
/// </summary>
public sealed record BoardFieldChange(string Field, string? From, string? To)
{
    public const int TextMaxLength = 200;

    /// <summary>The field-by-field difference of two contents, in a fixed field order (empty when they are equal).</summary>
    public static IReadOnlyList<BoardFieldChange> Between(BoardItemContent before, BoardItemContent after)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);
        var fields = new (string Field, Func<BoardItemContent, string?> Text)[]
        {
            ("type", content => BoardCodes.ToCode(content.Type)),
            ("topic", content => content.TopicKey),
            ("title", content => content.Title),
            ("body", content => content.Body),
            ("status", content => BoardCodes.ToCode(content.Status)),
            ("side", content => BoardCodes.ToCode(content.Side)),
            ("priority", content => BoardCodes.ToCode(content.Priority)),
            ("labels", content => content.Labels.Values.Count == 0 ? null : content.Labels.ToString()),
            ("dueDate", content => content.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            ("links", content => content.Links.Values.Count == 0 ? null : content.Links.ToString()),
            ("pinned", content => content.Pinned ? "true" : "false"),
            ("decisionSummary", content => content.DecisionSummary),
            ("rationale", content => content.Rationale),
            ("decidedAt", content => content.DecidedAt?.ToString("O", CultureInfo.InvariantCulture)),
            ("source", content => content.Source),
        };
        return fields
            .Select(field => (field.Field, From: field.Text(before), To: field.Text(after)))
            .Where(change => !string.Equals(change.From, change.To, StringComparison.Ordinal))
            .Select(change => new BoardFieldChange(change.Field, Cut(change.From), Cut(change.To)))
            .ToArray();
    }

    private static string? Cut(string? text) => text is { Length: > TextMaxLength } ? string.Concat(text.AsSpan(0, TextMaxLength - 1), "…") : text;
}
