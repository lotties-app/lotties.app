using Lotties.Domain.Catalog;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Medications;
using Lotties.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Medications;

/// <remarks>
/// Upserts are idempotent: replaying a request finds the stored medication and applies the same state. Concurrent
/// creates of one client id resolve to a single row: the loser reloads the winner and applies its request as an edit.
/// A product link is checked (exists, not merged) on create and whenever it changes, so replaying an unchanged edit
/// never fails because the product was merged later. Deleting a medication first soft deletes its prescriptions (in
/// the same unit of work: the repositories share the scoped context, saved by the medication removal), so clients
/// learn about it through the prescriptions delta.
/// </remarks>
internal sealed class MedicationService : IMedicationService
{
    private readonly IMedicationRepository _medications;
    private readonly ICatalogRepository _catalog;
    private readonly IPrescriptionRepository _prescriptions;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<MedicationService> _logger;

    public MedicationService(
        IMedicationRepository medications,
        ICatalogRepository catalog,
        IPrescriptionRepository prescriptions,
        TimeProvider timeProvider,
        ILogger<MedicationService> logger)
    {
        _medications = medications ?? throw new ArgumentNullException(nameof(medications));
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<MedicationResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var medications = await _medications.ListForBabyAsync(babyId, cancellationToken);
        return medications.Select(medication => (MedicationResponse)medication).ToArray();
    }

    public async Task<UpsertMedicationResult> UpsertAsync(Guid babyId, Guid medicationId, UpsertMedicationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureMedicationId(medicationId);
        var existing = await _medications.FindAsync(medicationId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, medicationId, request, cancellationToken)
            : await EditAsync(babyId, existing, request, cancellationToken);
    }

    public async Task DeleteAsync(Guid babyId, Guid medicationId, CancellationToken cancellationToken = default)
    {
        var existing = await _medications.FindAsync(medicationId, cancellationToken);
        if (existing is null || existing.BabyId != babyId)
        {
            _logger.LogDebug("Delete of unknown medication {MedicationId} for baby {BabyId} is a no-op", medicationId, babyId);
            return;
        }

        var prescriptions = await _prescriptions.ListForMedicationAsync(babyId, medicationId, cancellationToken);
        var now = _timeProvider.GetUtcNow();
        prescriptions.ToList().ForEach(prescription => prescription.SoftDelete(now));
        await _medications.RemoveAsync(existing, cancellationToken);
        _logger.LogInformation("Deleted medication {MedicationId} of baby {BabyId} and soft deleted {PrescriptionCount} prescriptions", medicationId, babyId, prescriptions.Count);
    }

    private async Task<UpsertMedicationResult> CreateAsync(Guid babyId, Guid medicationId, UpsertMedicationRequest request, CancellationToken cancellationToken)
    {
        var product = await LoadLinkableProductAsync(request.ProductId, cancellationToken);
        var created = Medication.Create(medicationId, babyId, NameFor(request, product), ToDosage(request), request.Notes, request.IsUsual, _timeProvider.GetUtcNow(), request.ProductId);
        if (!await _medications.TryAddAsync(created, cancellationToken))
        {
            return await EditAsync(babyId, await FindConcurrentWinnerAsync(medicationId, cancellationToken), request, cancellationToken);
        }

        _logger.LogInformation("Created medication {MedicationId} for baby {BabyId}", medicationId, babyId);
        return new UpsertMedicationResult(created, Created: true);
    }

    private async Task<UpsertMedicationResult> EditAsync(Guid babyId, Medication existing, UpsertMedicationRequest request, CancellationToken cancellationToken)
    {
        EnsureBelongsTo(babyId, existing);
        var product = await LoadProductForEditAsync(existing, request.ProductId, cancellationToken);
        existing.Edit(NameFor(request, product), ToDosage(request), request.Notes, request.IsUsual, request.ProductId);
        await _medications.SaveChangesAsync(cancellationToken);
        return new UpsertMedicationResult(existing, Created: false);
    }

    private Task<Product?> LoadProductForEditAsync(Medication existing, Guid? productId, CancellationToken cancellationToken) =>
        productId == existing.ProductId && productId is { } unchanged
            ? _catalog.FindProductAsync(unchanged, cancellationToken)
            : LoadLinkableProductAsync(productId, cancellationToken);

    private async Task<Product?> LoadLinkableProductAsync(Guid? productId, CancellationToken cancellationToken)
    {
        if (productId is not { } id)
        {
            return null;
        }

        var product = await _catalog.FindProductAsync(id, cancellationToken) ?? throw InvalidProductLinkException.NotFound(id);
        return product.MergedIntoId is { } target ? throw InvalidProductLinkException.Merged(id, target) : product;
    }

    private async Task<Medication> FindConcurrentWinnerAsync(Guid medicationId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Medication {MedicationId} was created concurrently; applying the request as an edit", medicationId);
        return await _medications.FindAsync(medicationId, cancellationToken)
            ?? throw new InvalidOperationException($"Medication {medicationId} was reported as existing but could not be loaded.");
    }

    private static string NameFor(UpsertMedicationRequest request, Product? product) =>
        Medication.NameOrProductName(request.Name, product?.Name) ?? string.Empty;

    private static Dosage? ToDosage(UpsertMedicationRequest request) => request.DefaultDosage is null ? null : (Dosage)request.DefaultDosage;

    private static void EnsureBelongsTo(Guid babyId, Medication existing)
    {
        if (existing.BabyId != babyId)
        {
            throw new MedicationBabyMismatchException(existing.Id, babyId);
        }
    }

    private static void EnsureMedicationId(Guid medicationId)
    {
        if (medicationId == Guid.Empty)
        {
            throw new DomainValidationException("medicationId", "The medication id must be a non-empty GUID generated by the client.");
        }
    }
}
