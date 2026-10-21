namespace BabyRoutine.Domain.Babies;

/// <summary>Read access to baby memberships, used for authorization.</summary>
public interface IBabyMembershipRepository
{
    /// <summary>The membership of <paramref name="userId"/> on <paramref name="babyId"/>, or null when there is none.</summary>
    Task<BabyMember?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default);
}
