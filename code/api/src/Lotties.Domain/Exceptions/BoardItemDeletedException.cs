namespace Lotties.Domain.Exceptions;

/// <summary>The board item is soft deleted: it cannot be edited or commented until an admin restores it.</summary>
public sealed class BoardItemDeletedException : DomainException
{
    public BoardItemDeletedException(Guid itemId)
        : base("board_item_deleted", $"Board item {itemId} is deleted; restore it first.")
    {
        ItemId = itemId;
    }

    public Guid ItemId { get; }
}
