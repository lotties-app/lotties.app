namespace Lotties.Domain.Exceptions;

/// <summary>
/// The version the caller expected (<c>If-Match</c> or <c>version</c>) is not the stored one: someone changed the item in
/// between. The answer carries <see cref="CurrentVersion"/>; reload and apply the change again.
/// </summary>
public sealed class BoardVersionMismatchException : DomainException
{
    public BoardVersionMismatchException(Guid itemId, int expectedVersion, int currentVersion)
        : base("board_version_mismatch", $"Board item {itemId} is at version {currentVersion}, not {expectedVersion}; reload it and try again.")
    {
        ItemId = itemId;
        ExpectedVersion = expectedVersion;
        CurrentVersion = currentVersion;
    }

    public Guid ItemId { get; }

    public int ExpectedVersion { get; }

    public int CurrentVersion { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["currentVersion"] = CurrentVersion };
}
