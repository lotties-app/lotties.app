namespace BabyRoutine.Application.Medications;

/// <summary>Medication catalog use cases of one baby. Callers have already authorized the current user for the baby.</summary>
public interface IMedicationService
{
    /// <summary>The baby's catalog, usual medications first, then by name.</summary>
    Task<IReadOnlyList<MedicationResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent upsert by client id: creates the medication or applies the full state to the existing one. Throws
    /// <see cref="Domain.Exceptions.MedicationBabyMismatchException"/> when the id belongs to another baby.
    /// </summary>
    Task<UpsertMedicationResult> UpsertAsync(Guid babyId, Guid medicationId, UpsertMedicationRequest request, CancellationToken cancellationToken = default);

    /// <summary>Hard deletes the medication. Unknown ids and ids of another baby are a no-op.</summary>
    Task DeleteAsync(Guid babyId, Guid medicationId, CancellationToken cancellationToken = default);
}
