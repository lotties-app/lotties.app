using BabyRoutine.Domain.Notifications;

namespace BabyRoutine.Application.Notifications;

/// <summary>Leader leases for background jobs (<see cref="JobLease"/>), safe across API instances.</summary>
public interface IJobLeaseRepository
{
    /// <summary>
    /// Takes or renews the lease <paramref name="name"/> for <paramref name="holderId"/> until <paramref name="now"/> +
    /// <paramref name="duration"/> when it is free, expired or already held by <paramref name="holderId"/>, creating the
    /// row on first use. Returns <c>false</c> when another holder has it or wins a concurrent attempt (skip this run).
    /// Saves immediately; call it on a fresh unit of work.
    /// </summary>
    Task<bool> TryAcquireAsync(string name, string holderId, DateTimeOffset now, TimeSpan duration, CancellationToken cancellationToken = default);
}
