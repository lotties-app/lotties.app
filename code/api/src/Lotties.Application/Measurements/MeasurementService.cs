using Lotties.Application.Babies;
using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Measurements;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Measurements;

/// <remarks>
/// Upserts are idempotent: replaying a request finds the stored measurement and applies the same state without
/// bumping <c>UpdatedAt</c>. Concurrent creates of one client id resolve to a single row: the loser reloads the
/// winner and applies its request as an edit. A Doctor's measurement is marked as hers, and she changes only her own
/// (<see cref="Measurement.EnsureChangeableBy"/>, 403 <c>measurement_not_owned</c>).
/// </remarks>
internal sealed class MeasurementService : IMeasurementService
{
    private readonly IMeasurementRepository _measurements;
    private readonly IBabyAccessService _access;
    private readonly IPersonDirectory _people;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<MeasurementService> _logger;

    public MeasurementService(
        IMeasurementRepository measurements,
        IBabyAccessService access,
        IPersonDirectory people,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<MeasurementService> logger)
    {
        _measurements = measurements ?? throw new ArgumentNullException(nameof(measurements));
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _people = people ?? throw new ArgumentNullException(nameof(people));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<MeasurementResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var measurements = await _measurements.ListForBabyAsync(babyId, cancellationToken);
        return await DescribeAsync(measurements, cancellationToken);
    }

    public async Task<UpsertMeasurementResult> UpsertAsync(Guid babyId, Guid measurementId, UpsertMeasurementRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureMeasurementId(measurementId);
        var existing = await _measurements.FindAsync(measurementId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, measurementId, request, cancellationToken)
            : await EditAsync(babyId, existing, request, cancellationToken);
    }

    public async Task DeleteAsync(Guid babyId, Guid measurementId, CancellationToken cancellationToken = default)
    {
        var existing = await _measurements.FindAsync(measurementId, cancellationToken);
        if (existing is null || existing.BabyId != babyId)
        {
            _logger.LogDebug("Delete of unknown measurement {MeasurementId} for baby {BabyId} is a no-op", measurementId, babyId);
            return;
        }

        await EnsureChangeableAsync(existing, cancellationToken);
        await _measurements.RemoveAsync(existing, cancellationToken);
        _logger.LogInformation("Deleted measurement {MeasurementId} of baby {BabyId}", measurementId, babyId);
    }

    private async Task<UpsertMeasurementResult> CreateAsync(Guid babyId, Guid measurementId, UpsertMeasurementRequest request, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var role = await _access.FindRoleAsync(babyId, cancellationToken);
        var created = Measurement.Create(
            measurementId, babyId, request.Date, request.WeightKg, request.HeightCm, request.HeadCircumferenceCm, request.Notes, user.Id, _timeProvider.GetUtcNow(), role);
        if (!await _measurements.TryAddAsync(created, cancellationToken))
        {
            return await EditAsync(babyId, await FindConcurrentWinnerAsync(measurementId, cancellationToken), request, cancellationToken);
        }

        _logger.LogInformation("Created measurement {MeasurementId} for baby {BabyId}", measurementId, babyId);
        return new UpsertMeasurementResult(await DescribeAsync(created, cancellationToken), Created: true);
    }

    private async Task<UpsertMeasurementResult> EditAsync(Guid babyId, Measurement existing, UpsertMeasurementRequest request, CancellationToken cancellationToken)
    {
        EnsureBelongsTo(babyId, existing);
        await EnsureChangeableAsync(existing, cancellationToken);
        existing.Edit(request.Date, request.WeightKg, request.HeightCm, request.HeadCircumferenceCm, request.Notes, _timeProvider.GetUtcNow());
        await _measurements.SaveChangesAsync(cancellationToken);
        return new UpsertMeasurementResult(await DescribeAsync(existing, cancellationToken), Created: false);
    }

    private async Task EnsureChangeableAsync(Measurement existing, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var role = await _access.FindRoleAsync(existing.BabyId, cancellationToken) ?? throw new BabyNotFoundException(existing.BabyId);
        existing.EnsureChangeableBy(user.Id, role);
    }

    private async Task<MeasurementResponse> DescribeAsync(Measurement measurement, CancellationToken cancellationToken) =>
        (await DescribeAsync([measurement], cancellationToken))[0];

    private async Task<IReadOnlyList<MeasurementResponse>> DescribeAsync(IReadOnlyList<Measurement> measurements, CancellationToken cancellationToken)
    {
        var doctors = measurements.Where(measurement => measurement.RecordedByDoctor).Select(measurement => measurement.CreatedBy).ToArray();
        var people = await _people.DescribeAsync(doctors, cancellationToken);
        return measurements.Select(measurement => MeasurementResponse.For(measurement, people.GetValueOrDefault(measurement.CreatedBy))).ToArray();
    }

    private async Task<Measurement> FindConcurrentWinnerAsync(Guid measurementId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Measurement {MeasurementId} was created concurrently; applying the request as an edit", measurementId);
        return await _measurements.FindAsync(measurementId, cancellationToken)
            ?? throw new InvalidOperationException($"Measurement {measurementId} was reported as existing but could not be loaded.");
    }

    private static void EnsureBelongsTo(Guid babyId, Measurement existing)
    {
        if (existing.BabyId != babyId)
        {
            throw new MeasurementBabyMismatchException(existing.Id, babyId);
        }
    }

    private static void EnsureMeasurementId(Guid measurementId)
    {
        if (measurementId == Guid.Empty)
        {
            throw new DomainValidationException("measurementId", "The measurement id must be a non-empty GUID generated by the client.");
        }
    }
}
