namespace Lotties.Domain.Exceptions;

/// <summary>
/// No board item with the id exists for the caller: unknown, soft deleted (for a caller who is not an admin) or in a
/// topic the caller's API key may not use (the same answer, so nothing about it is revealed).
/// </summary>
public sealed class BoardItemNotFoundException : DomainException
{
    public BoardItemNotFoundException(Guid itemId)
        : base("board_item_not_found", $"Board item {itemId} was not found.")
    {
        ItemId = itemId;
    }

    public Guid ItemId { get; }
}
