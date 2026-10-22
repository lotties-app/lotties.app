using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Medications;
using Lotties.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Prescriptions;

/// <summary>Prescription use cases of one baby, for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface IPrescriptionService
{
    /// <summary>The baby's prescriptions changed at or after <paramref name="since"/> (all when <c>null</c>), soft-deleted included, by (updatedAt, id).</summary>
    Task<IReadOnlyList<PrescriptionResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent upsert by client id (see <see cref="Prescription.DecideUpsert"/> for the deleted, stale and other-baby
    /// rules). The medication must be in the baby's catalog (<see cref="PrescriptionMedicationNotFoundException"/>).
    /// </summary>
    Task<UpsertPrescriptionResult> UpsertAsync(Guid babyId, Guid prescriptionId, UpsertPrescriptionRequest request, CancellationToken cancellationToken = default);

    /// <summary>Soft delete; unknown ids and ids of another baby are a no-op.</summary>
    Task DeleteAsync(Guid babyId, Guid prescriptionId, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as events: the server <c>updatedAt</c> is the delta cursor, the client <c>updatedAt</c> (stored as
/// <c>clientUpdatedAt</c>) decides conflicts, an unchanged replay changes nothing, concurrent creates of one id resolve
/// to one row (the loser applies its request as an edit).
/// </remarks>
internal sealed class PrescriptionService : IPrescriptionService
{
    private readonly IPrescriptionRepository _prescriptions;
    private readonly IMedicationRepository _medications;
    private readonly IPersonDirectory _people;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<PrescriptionService> _logger;

    public PrescriptionService(
        IPrescriptionRepository prescriptions,
        IMedicationRepository medications,
        IPersonDirectory people,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<PrescriptionService> logger)
    {
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _medications = medications ?? throw new ArgumentNullException(nameof(medications));
        _people = people ?? throw new ArgumentNullException(nameof(people));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<PrescriptionResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var changed = await _prescriptions.ListChangesAsync(babyId, since, cancellationToken);
        return await DescribeAsync(changed, cancellationToken);
    }

    public async Task<UpsertPrescriptionResult> UpsertAsync(Guid babyId, Guid prescriptionId, UpsertPrescriptionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsurePrescriptionId(prescriptionId);
        var terms = (PrescriptionTerms)request;
        var existing = await _prescriptions.FindAsync(prescriptionId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, prescriptionId, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, existing, terms, request.UpdatedAt, cancellationToken);
    }

    public async Task DeleteAsync(Guid babyId, Guid prescriptionId, CancellationToken cancellationToken = default)
    {
        var existing = await _prescriptions.FindAsync(prescriptionId, cancellationToken);
        if (existing is null || existing.BabyId != babyId)
        {
            _logger.LogDebug("Delete of unknown prescription {PrescriptionId} for baby {BabyId} is a no-op", prescriptionId, babyId);
            return;
        }

        existing.SoftDelete(_timeProvider.GetUtcNow());
        await _prescriptions.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Soft deleted prescription {PrescriptionId} of baby {BabyId}", prescriptionId, babyId);
    }

    private async Task<UpsertPrescriptionResult> CreateAsync(Guid babyId, Guid prescriptionId, PrescriptionTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        await EnsureMedicationOfBabyAsync(babyId, terms.MedicationId, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var created = Prescription.Create(prescriptionId, babyId, terms, user.Id, _timeProvider.GetUtcNow(), clientUpdatedAt);
        if (!await _prescriptions.TryAddAsync(created, cancellationToken))
        {
            return await UpdateAsync(babyId, await FindConcurrentWinnerAsync(prescriptionId, cancellationToken), terms, clientUpdatedAt, cancellationToken);
        }

        _logger.LogInformation("Created prescription {PrescriptionId} for baby {BabyId}", prescriptionId, babyId);
        return new UpsertPrescriptionResult(await DescribeAsync(created, cancellationToken), Created: true);
    }

    private async Task<UpsertPrescriptionResult> UpdateAsync(Guid babyId, Prescription existing, PrescriptionTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        var decision = existing.DecideUpsert(babyId, clientUpdatedAt, now);
        if (decision != PrescriptionUpsertDecision.Apply)
        {
            _logger.LogInformation("Upsert of prescription {PrescriptionId} ignored: {Decision}", existing.Id, decision);
            return new UpsertPrescriptionResult(await DescribeAsync(existing, cancellationToken), Created: false);
        }

        await EnsureMedicationChangeAllowedAsync(babyId, existing, terms, cancellationToken);
        existing.Edit(terms, now, clientUpdatedAt);
        await _prescriptions.SaveChangesAsync(cancellationToken);
        return new UpsertPrescriptionResult(await DescribeAsync(existing, cancellationToken), Created: false);
    }

    private async Task<PrescriptionResponse> DescribeAsync(Prescription prescription, CancellationToken cancellationToken) =>
        (await DescribeAsync([prescription], cancellationToken))[0];

    /// <summary>The responses, with the prescribing doctor of the doctor-sourced ones as the family sees her now.</summary>
    private async Task<IReadOnlyList<PrescriptionResponse>> DescribeAsync(IReadOnlyList<Prescription> prescriptions, CancellationToken cancellationToken)
    {
        var doctorIds = prescriptions.Select(prescription => prescription.PrescribedByUserId).OfType<Guid>().Distinct().ToArray();
        var doctors = await _people.DescribeAsync(doctorIds, cancellationToken);
        return prescriptions.Select(prescription => PrescriptionResponse.For(prescription, doctors)).ToArray();
    }

    private Task EnsureMedicationChangeAllowedAsync(Guid babyId, Prescription existing, PrescriptionTerms terms, CancellationToken cancellationToken) =>
        terms.MedicationId == existing.MedicationId ? Task.CompletedTask : EnsureMedicationOfBabyAsync(babyId, terms.MedicationId, cancellationToken);

    private async Task EnsureMedicationOfBabyAsync(Guid babyId, Guid medicationId, CancellationToken cancellationToken)
    {
        var medication = await _medications.FindAsync(medicationId, cancellationToken);
        if (medication?.BabyId != babyId)
        {
            throw new PrescriptionMedicationNotFoundException(medicationId, babyId);
        }
    }

    private async Task<Prescription> FindConcurrentWinnerAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Prescription {PrescriptionId} was created concurrently; applying the request as an edit", prescriptionId);
        return await _prescriptions.FindAsync(prescriptionId, cancellationToken)
            ?? throw new InvalidOperationException($"Prescription {prescriptionId} was reported as existing but could not be loaded.");
    }

    private static void EnsurePrescriptionId(Guid prescriptionId)
    {
        if (prescriptionId == Guid.Empty)
        {
            throw new DomainValidationException("prescriptionId", "The prescription id must be a non-empty GUID generated by the client.");
        }
    }
}
