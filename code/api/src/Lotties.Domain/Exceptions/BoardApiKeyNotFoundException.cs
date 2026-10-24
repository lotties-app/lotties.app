namespace Lotties.Domain.Exceptions;

/// <summary>No board API key has the id.</summary>
public sealed class BoardApiKeyNotFoundException : DomainException
{
    public BoardApiKeyNotFoundException(Guid keyId)
        : base("board_api_key_not_found", $"Board API key {keyId} was not found.")
    {
        KeyId = keyId;
    }

    public Guid KeyId { get; }
}
