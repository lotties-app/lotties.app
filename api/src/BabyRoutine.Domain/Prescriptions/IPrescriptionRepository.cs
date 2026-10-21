namespace BabyRoutine.Domain.Prescriptions;

/// <summary>Persistence for <see cref="Prescription"/>. Reads include soft-deleted prescriptions unless stated otherwise.</summary>
public interface IPrescriptionRepository
{
    /// <summary>The prescription with <paramref name="prescriptionId"/> whatever baby it belongs to, deleted or not; tracked.</summary>
    Task<Prescription?> FindAsync(Guid prescriptionId, CancellationToken cancellationToken = default);

    /// <summary>The prescriptions with these ids, deleted or not, whatever baby; not tracked.</summary>
    Task<IReadOnlyList<Prescription>> FindManyAsync(IReadOnlyCollection<Guid> prescriptionIds, CancellationToken cancellationToken = default);

    /// <summary>The baby's prescriptions changed at or after <paramref name="since"/> (all when <c>null</c>), deleted included, by (UpdatedAt, Id); not tracked.</summary>
    Task<IReadOnlyList<Prescription>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>The baby's active, non-deleted prescriptions; not tracked.</summary>
    Task<IReadOnlyList<Prescription>> ListActiveAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>The baby's non-deleted prescriptions of <paramref name="medicationId"/>; tracked.</summary>
    Task<IReadOnlyList<Prescription>> ListForMedicationAsync(Guid babyId, Guid medicationId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new prescription. Returns <c>false</c>, leaving nothing tracked, when the id was saved first (concurrent upsert).</summary>
    Task<bool> TryAddAsync(Prescription prescription, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}

/// <summary>Read access to the medication doses the status calculator needs.</summary>
public interface IMedicationDoseHistoryRepository
{
    /// <summary>
    /// The doses of the baby's non-deleted built-in medication events started at or after <paramref name="since"/>
    /// (one per payload entry), by time.
    /// </summary>
    Task<IReadOnlyList<MedicationDose>> ListDosesAsync(Guid babyId, DateTimeOffset since, CancellationToken cancellationToken = default);
}
