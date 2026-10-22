using Lotties.Application.Users;
using Lotties.Domain.Appointments;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Appointments;

/// <summary>Appointment use cases of one baby, for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface IAppointmentService
{
    /// <summary>
    /// The baby's appointments, cancelled and done included: changed at or after <c>since</c> (the delta, by
    /// <c>(updatedAt, id)</c>) and/or starting in <c>[from, to)</c> (the calendar range, by <c>(startsAt, id)</c> without
    /// <c>since</c>). 400 <c>validation_failed</c> (<c>to</c>) when <c>to</c> is not after <c>from</c> or the range is longer
    /// than <see cref="AppointmentService.MaxRangeDays"/> days.
    /// </summary>
    Task<IReadOnlyList<AppointmentResponse>> ListAsync(Guid babyId, AppointmentQuery query, CancellationToken cancellationToken = default);

    /// <summary>One appointment of the baby; 404 <c>appointment_not_found</c> when unknown or of another baby.</summary>
    Task<AppointmentResponse> GetAsync(Guid babyId, Guid appointmentId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent upsert by client id (see <see cref="Appointment.DecideUpsert"/> for the stale and other-baby rules).</summary>
    Task<UpsertAppointmentResult> UpsertAsync(Guid babyId, Guid appointmentId, UpsertAppointmentRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as formulas: the server <c>updatedAt</c> is the delta cursor, the client <c>updatedAt</c> (stored as
/// <c>clientUpdatedAt</c>) decides conflicts, an unchanged replay changes nothing, and concurrent creates of one id
/// resolve to one row (the loser applies its request as an edit). There is no delete: cancelling is the soft delete.
/// </remarks>
internal sealed class AppointmentService : IAppointmentService
{
    /// <summary>The longest calendar range one read may ask for.</summary>
    public const int MaxRangeDays = 400;

    private readonly IAppointmentRepository _appointments;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AppointmentService> _logger;

    public AppointmentService(IAppointmentRepository appointments, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<AppointmentService> logger)
    {
        _appointments = appointments ?? throw new ArgumentNullException(nameof(appointments));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<AppointmentResponse>> ListAsync(Guid babyId, AppointmentQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        EnsureRange(query);
        var found = await _appointments.ListAsync(babyId, query, cancellationToken);
        return found.Select(appointment => (AppointmentResponse)appointment).ToArray();
    }

    public async Task<AppointmentResponse> GetAsync(Guid babyId, Guid appointmentId, CancellationToken cancellationToken = default)
    {
        var found = await _appointments.FindAsync(appointmentId, cancellationToken);
        if (found is null || found.BabyId != babyId)
        {
            throw new AppointmentNotFoundException(babyId, appointmentId);
        }

        return found;
    }

    public async Task<UpsertAppointmentResult> UpsertAsync(Guid babyId, Guid appointmentId, UpsertAppointmentRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureAppointmentId(appointmentId);
        var terms = (AppointmentTerms)request;
        var existing = await _appointments.FindAsync(appointmentId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, appointmentId, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, existing, terms, request.UpdatedAt, cancellationToken);
    }

    private async Task<UpsertAppointmentResult> CreateAsync(Guid babyId, Guid appointmentId, AppointmentTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var created = Appointment.Create(appointmentId, babyId, terms, user.Id, _timeProvider.GetUtcNow(), clientUpdatedAt);
        if (!await _appointments.TryAddAsync(created, cancellationToken))
        {
            return await UpdateAsync(babyId, await FindConcurrentWinnerAsync(appointmentId, cancellationToken), terms, clientUpdatedAt, cancellationToken);
        }

        _logger.LogInformation("Created appointment {AppointmentId} for baby {BabyId}", appointmentId, babyId);
        return new UpsertAppointmentResult(created, Created: true);
    }

    private async Task<UpsertAppointmentResult> UpdateAsync(Guid babyId, Appointment existing, AppointmentTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        var decision = existing.DecideUpsert(babyId, clientUpdatedAt, now);
        if (decision != AppointmentUpsertDecision.Apply || terms == existing.Terms)
        {
            _logger.LogInformation("Upsert of appointment {AppointmentId} changed nothing: {Decision}", existing.Id, decision);
            return new UpsertAppointmentResult(existing, Created: false);
        }

        existing.Edit(terms, now, clientUpdatedAt);
        await _appointments.SaveChangesAsync(cancellationToken);
        return new UpsertAppointmentResult(existing, Created: false);
    }

    private async Task<Appointment> FindConcurrentWinnerAsync(Guid appointmentId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Appointment {AppointmentId} was created concurrently; applying the request as an edit", appointmentId);
        return await _appointments.FindAsync(appointmentId, cancellationToken)
            ?? throw new InvalidOperationException($"Appointment {appointmentId} was reported as existing but could not be loaded.");
    }

    private static void EnsureRange(AppointmentQuery query)
    {
        if (query is not { From: { } from, To: { } to })
        {
            return;
        }

        if (to <= from || to - from > TimeSpan.FromDays(MaxRangeDays))
        {
            throw new DomainValidationException("to", $"to must be after from and at most {MaxRangeDays} days later.");
        }
    }

    private static void EnsureAppointmentId(Guid appointmentId)
    {
        if (appointmentId == Guid.Empty)
        {
            throw new DomainValidationException("appointmentId", "The appointment id must be a non-empty GUID generated by the client.");
        }
    }
}
