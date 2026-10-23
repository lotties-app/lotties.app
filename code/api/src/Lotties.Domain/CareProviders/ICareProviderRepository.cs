namespace Lotties.Domain.CareProviders;

/// <summary>Persistence for <see cref="CareProvider"/>. Providers are never removed (soft delete); reads include deleted ones.</summary>
public interface ICareProviderRepository
{
    /// <summary>The provider with <paramref name="providerId"/> whatever baby it belongs to; tracked.</summary>
    Task<CareProvider?> FindAsync(Guid providerId, CancellationToken cancellationToken = default);

    /// <summary>The baby's providers changed at or after <paramref name="since"/> (all when <c>null</c>), by (UpdatedAt, Id); not tracked.</summary>
    Task<IReadOnlyList<CareProvider>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>Saves a new provider; <c>false</c> (nothing tracked) when a concurrent request created the same id first.</summary>
    Task<bool> TryAddAsync(CareProvider provider, CancellationToken cancellationToken = default);

    /// <summary>Saves the tracked changes.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
