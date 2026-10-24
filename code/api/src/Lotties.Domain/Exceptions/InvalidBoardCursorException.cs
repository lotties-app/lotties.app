namespace Lotties.Domain.Exceptions;

/// <summary>The paging cursor does not parse, or was issued for another sort order.</summary>
public sealed class InvalidBoardCursorException : DomainException
{
    public InvalidBoardCursorException()
        : base("invalid_cursor", "The cursor is not valid for this list; start again without it.")
    {
    }
}
