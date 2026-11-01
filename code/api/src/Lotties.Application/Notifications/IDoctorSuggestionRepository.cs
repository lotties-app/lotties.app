using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications;

/// <summary>Read access to what a baby's doctor sent, for the <c>doctor_suggestion</c> push (docs/design/16-doctor-access.md section 10.4).</summary>
public interface IDoctorSuggestionRepository
{
    /// <summary>
    /// The baby's pending prescription proposals and shared, not deleted recommendation notes created at or after
    /// <paramref name="since"/>, each recommendation with the members who already opened it; by creation time.
    /// </summary>
    Task<IReadOnlyList<DoctorSuggestion>> ListSinceAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default);
}
