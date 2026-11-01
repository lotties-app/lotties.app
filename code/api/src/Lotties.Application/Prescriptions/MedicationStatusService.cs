using Lotties.Domain.Catalog;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Prescriptions;

/// <summary>Computed medication status of one baby. Callers have already authorized the current user for the baby.</summary>
public interface IMedicationStatusService
{
    /// <summary>The status of every active prescription at <paramref name="now"/> seen with <paramref name="utcOffset"/> (local today, times of day).</summary>
    Task<MedicationStatusListResponse> GetAsync(Guid babyId, DateTimeOffset now, TimeSpan utcOffset, CancellationToken cancellationToken = default);
}

/// <remarks>Load (prescriptions, doses, weight) -> <see cref="MedicationStatusCalculator"/> -> enrich with medication, product and substance names.</remarks>
internal sealed class MedicationStatusService : IMedicationStatusService
{
    private readonly IPrescriptionRepository _prescriptions;
    private readonly IMedicationDoseHistoryRepository _doses;
    private readonly IMeasurementRepository _measurements;
    private readonly IMedicationRepository _medications;
    private readonly ICatalogRepository _catalog;
    private readonly ILogger<MedicationStatusService> _logger;

    public MedicationStatusService(
        IPrescriptionRepository prescriptions,
        IMedicationDoseHistoryRepository doses,
        IMeasurementRepository measurements,
        IMedicationRepository medications,
        ICatalogRepository catalog,
        ILogger<MedicationStatusService> logger)
    {
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _doses = doses ?? throw new ArgumentNullException(nameof(doses));
        _measurements = measurements ?? throw new ArgumentNullException(nameof(measurements));
        _medications = medications ?? throw new ArgumentNullException(nameof(medications));
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<MedicationStatusListResponse> GetAsync(Guid babyId, DateTimeOffset now, TimeSpan utcOffset, CancellationToken cancellationToken = default)
    {
        var prescriptions = await _prescriptions.ListActiveAsync(babyId, cancellationToken);
        var doses = await _doses.ListDosesAsync(babyId, now - MedicationStatusCalculator.HistoryLookBack, cancellationToken);
        var weight = ToBodyWeight(await _measurements.FindLatestWithWeightAsync(babyId, cancellationToken));
        var statuses = MedicationStatusCalculator.Calculate(new MedicationStatusInput(prescriptions, doses, now, utcOffset, weight));
        var names = await LoadNamesAsync(babyId, cancellationToken);
        _logger.LogDebug("Computed {StatusCount} medication statuses for baby {BabyId} from {DoseCount} doses", statuses.Count, babyId, doses.Count);
        return new MedicationStatusListResponse
        {
            BabyId = babyId,
            GeneratedAt = now.ToUniversalTime(),
            UtcOffsetMinutes = (int)utcOffset.TotalMinutes,
            Items = statuses.Select(status => MedicationStatusMapper.ToResponse(status, statuses, names)).OrderBy(item => item.MedicationName, StringComparer.OrdinalIgnoreCase).ThenBy(item => item.PrescriptionId).ToArray(),
        };
    }

    private async Task<StatusNames> LoadNamesAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var medications = (await _medications.ListForBabyAsync(babyId, cancellationToken)).ToDictionary(medication => medication.Id);
        var productIds = medications.Values.Select(medication => medication.ProductId).OfType<Guid>().ToHashSet();
        var products = (await _catalog.FindProductsAsync(productIds, cancellationToken)).ToDictionary(product => product.Id);
        var substances = productIds.Count == 0 ? new Dictionary<Guid, Substance>() : (await _catalog.ListSubstancesAsync(cancellationToken)).ToDictionary(substance => substance.Id);
        return new StatusNames(medications, products, substances);
    }

    private static BodyWeight? ToBodyWeight(Measurement? measurement) =>
        measurement?.WeightKg is { } kg ? new BodyWeight(kg, measurement.Date) : null;
}

/// <summary>Names the status response shows, by id.</summary>
internal sealed record StatusNames(
    IReadOnlyDictionary<Guid, Medication> Medications,
    IReadOnlyDictionary<Guid, Product> Products,
    IReadOnlyDictionary<Guid, Substance> Substances);

/// <summary>Maps a <see cref="MedicationStatus"/> and the names to the response.</summary>
internal static class MedicationStatusMapper
{
    public static PrescriptionStatusResponse ToResponse(MedicationStatus status, IReadOnlyList<MedicationStatus> all, StatusNames names)
    {
        var prescription = status.Prescription;
        var medication = names.Medications.GetValueOrDefault(prescription.MedicationId);
        return new PrescriptionStatusResponse
        {
            PrescriptionId = prescription.Id,
            MedicationId = prescription.MedicationId,
            MedicationName = medication?.Name ?? string.Empty,
            Product = ToProduct(medication?.ProductId, names),
            Kind = prescription.Schedule.Kind,
            Dose = prescription.Dose,
            TimesOfDay = prescription.Schedule.TimesOfDay?.ToStrings(),
            EveryMinutes = prescription.Schedule.EveryMinutes,
            MinIntervalMinutes = prescription.Schedule.MinIntervalMinutes,
            MaxDosesPer24h = prescription.Schedule.MaxDosesPer24h,
            Indication = prescription.Schedule.Indication,
            IntervalGroup = prescription.IntervalGroup?.Value,
            GroupMembers = status.GroupMemberIds.Select(id => ToMember(id, all, names)).ToArray(),
            StartDate = prescription.StartDate,
            EndDate = prescription.EndDate,
            CourseStarted = status.CourseStarted,
            CourseEnded = status.CourseEnded,
            AvailableNow = status.AvailableNow,
            AvailableAt = status.AvailableAt,
            NextScheduledAt = status.NextScheduledAt,
            OverdueByMinutes = status.OverdueBy is { } late ? (int)Math.Floor(late.TotalMinutes) : null,
            LastDoseAt = status.LastDoseAt,
            DosesLast24h = status.DosesLast24h,
            LimitReached = status.LimitReached,
            SuggestedDose = status.SuggestedDose is null ? null : (SuggestedDoseDto)status.SuggestedDose,
        };
    }

    private static StatusProductDto? ToProduct(Guid? productId, StatusNames names) =>
        productId is { } id && names.Products.GetValueOrDefault(id) is { } product
            ? new StatusProductDto { Id = product.Id, Name = product.Name, Substances = product.Substances.Select(link => ToSubstance(link.SubstanceId, names)).ToArray() }
            : null;

    private static StatusSubstanceDto ToSubstance(Guid substanceId, StatusNames names)
    {
        var substance = names.Substances.GetValueOrDefault(substanceId);
        return new StatusSubstanceDto { Id = substanceId, Key = substance?.Key ?? string.Empty, NameEn = substance?.NameEn ?? string.Empty, NamePtBr = substance?.NamePtBr ?? string.Empty };
    }

    private static GroupMemberDto ToMember(Guid prescriptionId, IReadOnlyList<MedicationStatus> all, StatusNames names)
    {
        var medicationId = all.First(status => status.Prescription.Id == prescriptionId).Prescription.MedicationId;
        return new GroupMemberDto { PrescriptionId = prescriptionId, MedicationId = medicationId, MedicationName = names.Medications.GetValueOrDefault(medicationId)?.Name ?? string.Empty };
    }
}
