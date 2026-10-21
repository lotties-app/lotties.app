namespace BabyRoutine.Domain.Medications;

/// <summary>Persistence for <see cref="Medication"/>. Medications are hard deleted; events reference them only inside their JSON payload.</summary>
public interface IMedicationRepository
{
    /// <summary>The baby's medications, usual ones first, then by name; not tracked.</summary>
    Task<IReadOnlyList<Medication>> ListForBabyAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>The medication with <paramref name="medicationId"/> whatever baby it belongs to; tracked for changes.</summary>
    Task<Medication?> FindAsync(Guid medicationId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new medication. Returns <c>false</c>, leaving nothing tracked, when the id was saved first (concurrent upsert).</summary>
    Task<bool> TryAddAsync(Medication medication, CancellationToken cancellationToken = default);

    Task RemoveAsync(Medication medication, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
