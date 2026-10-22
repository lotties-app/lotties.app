namespace Lotties.Domain.Professionals;

/// <summary>Persistence for <see cref="ProfessionalProfile"/> (one per user).</summary>
public interface IProfessionalProfileRepository
{
    /// <summary>The profile of <paramref name="userId"/>, or <c>null</c>; tracked.</summary>
    Task<ProfessionalProfile?> FindAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The profiles of the given users that exist; not tracked.</summary>
    Task<IReadOnlyList<ProfessionalProfile>> FindManyAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);

    /// <summary>Saves a new profile. Returns <c>false</c>, leaving nothing tracked, when the user's profile was saved first (concurrent save).</summary>
    Task<bool> TryAddAsync(ProfessionalProfile profile, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
