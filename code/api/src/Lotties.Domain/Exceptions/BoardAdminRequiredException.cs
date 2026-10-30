namespace Lotties.Domain.Exceptions;

/// <summary>Only a board admin may do this (e.g. list deleted items).</summary>
public sealed class BoardAdminRequiredException : DomainException
{
    public BoardAdminRequiredException(string what)
        : base("board_admin_required", $"Only a board admin may {what}.")
    {
    }
}
