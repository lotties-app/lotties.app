using BabyRoutine.Domain.Babies;

namespace BabyRoutine.Application.Babies;

/// <summary>Checks the current user's access to a baby.</summary>
public interface IBabyAccessService
{
    /// <summary>Decides whether the current user's membership on <paramref name="babyId"/> satisfies <paramref name="requiredRole"/>.</summary>
    Task<BabyAccessDecision> CheckAsync(Guid babyId, BabyRole requiredRole, CancellationToken cancellationToken = default);
}
