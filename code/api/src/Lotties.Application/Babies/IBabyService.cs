namespace Lotties.Application.Babies;

/// <summary>Baby use cases for the current user. Callers have already authorized the user for the baby where one is given.</summary>
public interface IBabyService
{
    /// <summary>The babies the current user is a member of, with the user's role on each.</summary>
    Task<IReadOnlyList<BabyResponse>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates a baby; the current user becomes its owner.</summary>
    Task<BabyResponse> CreateAsync(SaveBabyRequest request, CancellationToken cancellationToken = default);

    Task<BabyResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Renames the baby and/or changes its birth date.</summary>
    Task<BabyResponse> UpdateAsync(Guid babyId, SaveBabyRequest request, CancellationToken cancellationToken = default);

    /// <summary>Replaces the baby's vaccine profile (coverage, gestational age, the mother's RSV vaccination).</summary>
    Task<BabyResponse> UpdateVaccineProfileAsync(Guid babyId, UpdateVaccineProfileRequest request, CancellationToken cancellationToken = default);
}
