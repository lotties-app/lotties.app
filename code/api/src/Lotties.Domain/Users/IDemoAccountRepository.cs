namespace Lotties.Domain.Users;

/// <summary>Persistence queries for the throwaway try-it demo accounts (docs/design/45-try-it-demo.md).</summary>
public interface IDemoAccountRepository
{
    /// <summary>How many demo accounts exist now (expired ones not yet cleaned up included): what the global cap counts.</summary>
    Task<int> CountAsync(CancellationToken cancellationToken = default);

    /// <summary>The ids of up to <paramref name="take"/> demo accounts whose expiry is at or before <paramref name="now"/>, oldest first.</summary>
    Task<IReadOnlyList<Guid>> ListExpiredIdsAsync(DateTimeOffset now, int take, CancellationToken cancellationToken = default);

    /// <summary>Removes the (already erased) user row. Returns <c>false</c> when it is gone or another row still points at it.</summary>
    Task<bool> DeleteUserRowAsync(Guid userId, CancellationToken cancellationToken = default);
}
