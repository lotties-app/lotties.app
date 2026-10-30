using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications;

/// <summary>Read access to the cry monitor's fussy spells, for the <c>cry_detected</c> push (docs/design/31-cry-detector-spike.md section 8).</summary>
public interface IDetectedCrySpellRepository
{
    /// <summary>
    /// The baby's fussy spells that are not deleted, were started by the cry monitor and not marked "Not crying"
    /// (<see cref="Domain.Events.CryDetection.IsOpenDetection"/>), started at or after <paramref name="lookBackFrom"/>, and
    /// started at or after <paramref name="since"/> or were still running at <paramref name="since"/>; by start.
    /// </summary>
    Task<IReadOnlyList<DetectedCrySpell>> ListAsync(Guid babyId, DateTimeOffset since, DateTimeOffset lookBackFrom, CancellationToken cancellationToken = default);
}
