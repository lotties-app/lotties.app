using Lotties.Application.AccessLogs;
using Lotties.Application.Stores;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Measurements;
using Lotties.Domain.Notes;
using Lotties.Domain.Patterns;
using Lotties.Domain.Proposals;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Clinical;

/// <summary>What the patient list is asked for: the family's time zone, which the "last seven days" and "today" are cut in.</summary>
/// <param name="TimeZone">IANA time zone id; an unknown one falls back to <paramref name="UtcOffset"/>.</param>
/// <param name="UtcOffset">The family's current UTC offset, used without a usable time zone.</param>
public sealed record DoctorPatientsRequest(string? TimeZone, TimeSpan UtcOffset);

/// <summary>The signed-in doctor's dashboard: the babies she is a Doctor of, with a few figures each.</summary>
public interface IDoctorPatientsService
{
    /// <summary>
    /// The babies where the current user's role is Doctor, by name then id (empty for a user who is not a Doctor anywhere),
    /// each with the figures her scopes open. Records a view in each baby's access log (at most one per hour per doctor and baby).
    /// </summary>
    Task<IReadOnlyList<DoctorPatientResponse>> ListAsync(DoctorPatientsRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>
/// One simple set of queries per patient (a doctor has dozens of patients, not thousands), and only for the sections the doctor's
/// scopes on that baby open. The access view is recorded before the figures are read, so a baby is logged even when a figure fails.
/// The route names no baby, so each patient (a baby she is the Doctor of) is entered in the request's <see cref="IStoreScope"/>
/// before its figures are read.
/// </remarks>
internal sealed class DoctorPatientsService : IDoctorPatientsService
{
    private const int WeekDays = 7;

    private readonly ICurrentUser _currentUser;
    private readonly IBabyRepository _babies;
    private readonly IAccessLogService _accessLog;
    private readonly IClinicalEventRepository _events;
    private readonly DailyObservationReader _daily;
    private readonly VaccineOverviewReader _vaccines;
    private readonly IMeasurementRepository _measurements;
    private readonly IPrescriptionProposalRepository _proposals;
    private readonly INoteRepository _notes;
    private readonly IStoreScope _stores;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<DoctorPatientsService> _logger;

    public DoctorPatientsService(
        ICurrentUser currentUser,
        IBabyRepository babies,
        IAccessLogService accessLog,
        IClinicalEventRepository events,
        DailyObservationReader daily,
        VaccineOverviewReader vaccines,
        IMeasurementRepository measurements,
        IPrescriptionProposalRepository proposals,
        INoteRepository notes,
        IStoreScope stores,
        TimeProvider timeProvider,
        ILogger<DoctorPatientsService> logger)
    {
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _accessLog = accessLog ?? throw new ArgumentNullException(nameof(accessLog));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _daily = daily ?? throw new ArgumentNullException(nameof(daily));
        _vaccines = vaccines ?? throw new ArgumentNullException(nameof(vaccines));
        _measurements = measurements ?? throw new ArgumentNullException(nameof(measurements));
        _proposals = proposals ?? throw new ArgumentNullException(nameof(proposals));
        _notes = notes ?? throw new ArgumentNullException(nameof(notes));
        _stores = stores ?? throw new ArgumentNullException(nameof(stores));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<DoctorPatientResponse>> ListAsync(DoctorPatientsRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var babies = await _babies.ListForUserAsync(user.Id, cancellationToken);
        var patients = babies.Select(baby => new Patient(baby, baby.FindMember(user.Id))).Where(patient => patient.Member?.Role.IsDoctor() == true).ToArray();
        var responses = await DescribeAllAsync(patients, user.Id, LocalClock.ForZoneOrOffset(request.TimeZone, request.UtcOffset), _timeProvider.GetUtcNow(), cancellationToken);
        _logger.LogInformation("Doctor {UserId} listed {PatientCount} patients", user.Id, responses.Count);
        return responses;
    }

    /// <summary>One patient after the other: they share the request's database context.</summary>
    private async Task<IReadOnlyList<DoctorPatientResponse>> DescribeAllAsync(IReadOnlyList<Patient> patients, Guid doctorId, LocalClock clock, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var responses = new List<DoctorPatientResponse>(patients.Count);
        foreach (var patient in patients)
        {
            responses.Add(await DescribeAsync(patient, doctorId, clock, now, cancellationToken));
        }

        return responses;
    }

    private async Task<DoctorPatientResponse> DescribeAsync(Patient patient, Guid doctorId, LocalClock clock, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var baby = patient.Baby;
        var scopes = patient.Member!.EffectiveDoctorScopes;
        var view = SectionView.Of(patient.Member);
        await _accessLog.RecordViewAsync(baby.Id, BabyRole.Doctor, cancellationToken);
        await _stores.EnterAsync(baby.Id, cancellationToken);
        return new DoctorPatientResponse
        {
            BabyId = baby.Id,
            Name = baby.Name,
            Label = baby.ResolvedLabel,
            BirthDate = baby.BirthDate,
            BirthWeekOnly = baby.BirthDateWeekOnly,
            DoctorScopes = scopes.Codes,
            LastEventAt = scopes.Contains(DoctorScope.DailyLog) ? await _events.FindLatestStartAsync(baby.Id, now, view.HiddenEventTypeIds, cancellationToken) : null,
            Week = scopes.Contains(DoctorScope.DailyLog) ? await WeekAsync(baby.Id, clock, now, cancellationToken) : null,
            LatestWeight = scopes.Contains(DoctorScope.Growth) ? await LatestWeightAsync(baby.Id, cancellationToken) : null,
            PendingProposals = scopes.Contains(DoctorScope.Medications) ? await _proposals.CountPendingByAuthorAsync(baby.Id, doctorId, cancellationToken) : null,
            VaccinesDue = scopes.Contains(DoctorScope.Vaccines) ? (await _vaccines.ReadAsync(baby, clock.DateOf(now), cancellationToken)).DueOrOverdue : null,
            SharedNotes = scopes.Contains(DoctorScope.Notes) ? await _notes.CountSharedByAuthorAsync(baby.Id, doctorId, cancellationToken) : null,
        };
    }

    /// <summary>The averages of the seven local days that end today, like the parents' Insights.</summary>
    private async Task<PatientWeekResponse> WeekAsync(Guid babyId, LocalClock clock, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var range = ClinicalRange.LastDays(clock.DateOf(now), WeekDays);
        var window = ClinicalWindow.Create(range, clock, now);
        var observed = await _daily.LoadAsync(babyId, window, cancellationToken);
        var feeding = FeedingSummaries.Summarize(observed.Feeds, window);
        return new PatientWeekResponse
        {
            From = range.From,
            To = range.To,
            SleepMinutesPerDay = ClinicalRounding.Minutes(SleepSummaries.Summarize(observed.Sleep, window).AverageTotalMs),
            FeedsPerDay = ClinicalRounding.OneDecimal(feeding.FeedsPerDay),
            BottleMlPerDay = ClinicalRounding.OneDecimal(feeding.BottleMlPerDay),
            DiapersPerDay = ClinicalRounding.OneDecimal(DiaperSummaries.Summarize(observed.Diapers, window).PerDay),
        };
    }

    private async Task<PatientWeightResponse?> LatestWeightAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var latest = await _measurements.FindLatestWithWeightAsync(babyId, cancellationToken);
        return latest?.WeightKg is { } weightKg ? new PatientWeightResponse { WeightKg = weightKg, Date = latest.Date } : null;
    }

    private sealed record Patient(Baby Baby, BabyMember? Member);
}
