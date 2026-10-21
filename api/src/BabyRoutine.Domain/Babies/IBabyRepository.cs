namespace BabyRoutine.Domain.Babies;

/// <summary>
/// Persistence for the <see cref="Baby"/> aggregate (members included). Repositories of one request share a unit of
/// work, so <see cref="SaveChangesAsync"/> also saves changes made through <see cref="IInviteRepository"/>.
/// </summary>
public interface IBabyRepository
{
    /// <summary>The babies <paramref name="userId"/> is a member of, with members, ordered by name; not tracked.</summary>
    Task<IReadOnlyList<Baby>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The baby with its members, or null when there is none; tracked for changes.</summary>
    Task<Baby?> FindAsync(Guid babyId, CancellationToken cancellationToken = default);

    Task AddAsync(Baby baby, CancellationToken cancellationToken = default);

    /// <summary>Saves changes made to babies returned by this repository.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
