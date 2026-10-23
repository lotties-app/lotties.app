using Lotties.Application.Babies;
using Lotties.Application.Events;
using Lotties.Application.Formulas;
using Lotties.Application.Measurements;
using Lotties.Application.Prescriptions;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Patterns;
using Lotties.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Clinical;

/// <summary>What a clinical summary is asked for: the local dates (<c>yyyy-MM-dd</c>, both included) and the family's time zone.</summary>
/// <param name="From">First local date, as sent.</param>
/// <param name="To">Last local date, as sent.</param>
/// <param name="TimeZone">IANA time zone id; an unknown one falls back to <paramref name="UtcOffset"/>.</param>
/// <param name="UtcOffset">The family's current UTC offset, used without a usable time zone.</param>
public sealed record ClinicalSummaryRequest(string? From, string? To, string? TimeZone, TimeSpan UtcOffset);

/// <summary>The doctor's clinical summary of one baby. Callers have already authorized the current user as a member of the baby.</summary>
public interface IClinicalSummaryService
{
    /// <summary>
    /// The summary of the requested local days, with the sections the caller's scopes open (every section for a member who is
    /// not a Doctor). Throws <see cref="DomainValidationException"/> (fields <c>from</c>, <c>to</c>) for an invalid range.
    /// </summary>
    Task<ClinicalSummaryResponse> GetAsync(Guid babyId, ClinicalSummaryRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>
/// The math is pure Domain code (<c>Lotties.Domain.Clinical</c>, ported from the parents' Insights); this service loads what
/// each section needs, only for the sections the caller's scopes open, and maps. Reads share the request's database context,
/// so they run one after another.
/// </remarks>
internal sealed class ClinicalSummaryService : IClinicalSummaryService
{
    private static readonly string[] SymptomKeys = ["temperature", "symptom", "spit_up", "belly_pain", "teething"];
    private static readonly string[] MedicationKeys = ["medication"];

    private readonly IBabyAccessService _access;
    private readonly IBabyRepository _babies;
    private readonly DailyObservationReader _daily;
    private readonly VaccineOverviewReader _vaccines;
    private readonly IClinicalEventRepository _events;
    private readonly IPrescriptionService _prescriptions;
    private readonly IMeasurementService _measurements;
    private readonly IFormulaService _formulas;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<ClinicalSummaryService> _logger;

    public ClinicalSummaryService(
        IBabyAccessService access,
        IBabyRepository babies,
        DailyObservationReader daily,
        VaccineOverviewReader vaccines,
        IClinicalEventRepository events,
        IPrescriptionService prescriptions,
        IMeasurementService measurements,
        IFormulaService formulas,
        TimeProvider timeProvider,
        ILogger<ClinicalSummaryService> logger)
    {
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _daily = daily ?? throw new ArgumentNullException(nameof(daily));
        _vaccines = vaccines ?? throw new ArgumentNullException(nameof(vaccines));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _measurements = measurements ?? throw new ArgumentNullException(nameof(measurements));
        _formulas = formulas ?? throw new ArgumentNullException(nameof(formulas));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<ClinicalSummaryResponse> GetAsync(Guid babyId, ClinicalSummaryRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var range = ClinicalRange.Parse(request.From, request.To);
        var scopes = await ScopesOfCallerAsync(babyId, cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var window = ClinicalWindow.Create(range, LocalClock.ForZoneOrOffset(request.TimeZone, request.UtcOffset), now);
        var daily = scopes.Contains(DoctorScope.DailyLog) ? await _daily.LoadAsync(babyId, window, cancellationToken) : null;
        _logger.LogDebug("Clinical summary of baby {BabyId} for {From}..{To} with sections {Scopes}", babyId, range.From, range.To, scopes.ToStorage());
        return new ClinicalSummaryResponse
        {
            BabyId = babyId,
            From = range.From,
            To = range.To,
            Today = window.Today,
            TimeZone = window.Clock.TimeZoneId,
            GeneratedAt = now,
            Scopes = scopes.Codes,
            Sleep = daily is null ? null : (SleepSectionResponse)SleepSummaries.Summarize(daily.Sleep, window),
            Feeding = daily is null ? null : FeedingOf(daily, window, scopes),
            Diapers = daily is null ? null : (DiaperSectionResponse)DiaperSummaries.Summarize(daily.Diapers, window),
            Symptoms = scopes.Contains(DoctorScope.DailyLog) ? await SymptomsAsync(babyId, window, cancellationToken) : null,
            Medications = scopes.Contains(DoctorScope.Medications) ? await MedicationsAsync(babyId, window, cancellationToken) : null,
            Vaccines = scopes.Contains(DoctorScope.Vaccines) ? await VaccinesAsync(babyId, window, cancellationToken) : null,
            Growth = scopes.Contains(DoctorScope.Growth) ? await GrowthAsync(babyId, cancellationToken) : null,
            Formulas = scopes.Contains(DoctorScope.Formulas) ? await FormulasAsync(babyId, cancellationToken) : null,
        };
    }

    /// <summary>The sections the caller sees: a Doctor's effective scopes, every section for any other member.</summary>
    private async Task<DoctorScopeSet> ScopesOfCallerAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var member = await _access.FindMembershipAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        return member.Role.IsDoctor() ? member.EffectiveDoctorScopes : DoctorScopeSet.All;
    }

    /// <summary>The feeding section; the formulas the bottles named only with the formulas section (an empty list without it).</summary>
    private static FeedingSectionResponse FeedingOf(DailyObservations daily, ClinicalWindow window, DoctorScopeSet scopes)
    {
        FeedingSectionResponse feeding = FeedingSummaries.Summarize(daily.Feeds, window);
        return scopes.Contains(DoctorScope.Formulas) ? feeding : feeding with { Formulas = [] };
    }

    private async Task<SymptomsSectionResponse> SymptomsAsync(Guid babyId, ClinicalWindow window, CancellationToken cancellationToken)
    {
        var newest = await _events.ListNewestByTypesAsync(babyId, SymptomKeys, window.Start, window.End, SymptomsSectionResponse.MaxItems, cancellationToken);
        return new SymptomsSectionResponse { Items = newest.Select(item => (EventResponse)item.Event).ToArray() };
    }

    private async Task<MedicationsSectionResponse> MedicationsAsync(Guid babyId, ClinicalWindow window, CancellationToken cancellationToken)
    {
        var given = await _events.ListByTypesAsync(babyId, MedicationKeys, window.Start, window.End, cancellationToken);
        var doses = given.SelectMany(item => MedicationDosePayload.ReadGiven(item.Event.Payload, item.Event.StartedAt));
        return new MedicationsSectionResponse
        {
            Doses = MedicationUsages.Summarize(doses).Select(usage => (MedicationDoseCountResponse)usage).ToArray(),
            ActivePrescriptions = await _prescriptions.ListActiveAsync(babyId, cancellationToken),
        };
    }

    private async Task<VaccinesSectionResponse> VaccinesAsync(Guid babyId, ClinicalWindow window, CancellationToken cancellationToken)
    {
        var baby = await _babies.FindAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        return await _vaccines.ReadAsync(baby, window.Today, cancellationToken);
    }

    private async Task<GrowthSectionResponse> GrowthAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var measurements = await _measurements.ListAsync(babyId, cancellationToken);
        return new GrowthSectionResponse
        {
            Measurements = measurements.OrderBy(item => item.Date).ThenBy(item => item.CreatedAt).ThenBy(item => item.Id).ToArray(),
        };
    }

    private async Task<FormulasSectionResponse> FormulasAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var formulas = await _formulas.ListChangesAsync(babyId, since: null, cancellationToken);
        var history = formulas
            .OrderByDescending(item => item.StartedOn ?? DateOnly.FromDateTime(item.CreatedAt.UtcDateTime))
            .ThenByDescending(item => item.CreatedAt)
            .ThenBy(item => item.Id)
            .ToArray();
        return new FormulasSectionResponse { Current = history.FirstOrDefault(item => item.IsCurrent), History = history };
    }
}
