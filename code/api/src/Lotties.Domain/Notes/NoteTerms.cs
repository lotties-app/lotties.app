using Lotties.Domain.Common;

namespace Lotties.Domain.Notes;

/// <summary>
/// What a note is. <see cref="Recommendation"/> exists for step 2 (the parents' recommendations inbox and its push);
/// in v1 both kinds behave the same.
/// </summary>
public enum NoteKind
{
    Note,
    Recommendation,
}

/// <summary>Who reads a note: <see cref="Shared"/> = every member of the baby, <see cref="Private"/> = only its author.</summary>
public enum NoteVisibility
{
    Shared,
    Private,
}

/// <summary>
/// The editable state of a note: kind, visibility and the text (required, trimmed, 1-4000 characters, line breaks kept,
/// no NUL). Compared by value, so an idempotent replay changes nothing.
/// </summary>
public sealed record NoteTerms
{
    public const int BodyMaxLength = 4000;

    private NoteTerms(NoteKind kind, NoteVisibility visibility, string body)
    {
        Kind = kind;
        Visibility = visibility;
        Body = body;
    }

    public NoteKind Kind { get; }

    public NoteVisibility Visibility { get; }

    public string Body { get; }

    /// <summary>Validates every rule; throws <see cref="Exceptions.DomainValidationException"/> naming the field.</summary>
    public static NoteTerms Create(NoteKind kind, NoteVisibility visibility, string? body) =>
        new(kind, visibility, Text.Required(body, "body", BodyMaxLength));
}
