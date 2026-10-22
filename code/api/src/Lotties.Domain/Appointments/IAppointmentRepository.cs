namespace Lotties.Domain.Appointments;

/// <summary>Which of a baby's appointments a list read returns; every part is optional and they combine.</summary>
/// <param name="Since">Changed at or after this instant (the delta pull, ordered by <c>(UpdatedAt, Id)</c>).</param>
/// <param name="From">Starting at or after this instant (the calendar range).</param>
/// <param name="To">Starting before this instant (the calendar range; ordered by <c>(StartsAt, Id)</c> without <paramref name="Since"/>).</param>
public sealed record AppointmentQuery(DateTimeOffset? Since = null, DateTimeOffset? From = null, DateTimeOffset? To = null);

/// <summary>Persistence for <see cref="Appointment"/>. Appointments are never deleted (cancelled instead); reads include cancelled ones.</summary>
public interface IAppointmentRepository
{
    /// <summary>The appointment with <paramref name="appointmentId"/> whatever baby it belongs to; tracked.</summary>
    Task<Appointment?> FindAsync(Guid appointmentId, CancellationToken cancellationToken = default);

    /// <summary>The baby's appointments matching <paramref name="query"/>, cancelled and done included; not tracked.</summary>
    Task<IReadOnlyList<Appointment>> ListAsync(Guid babyId, AppointmentQuery query, CancellationToken cancellationToken = default);

    /// <summary>The baby's upcoming appointments starting after <paramref name="after"/> and at or before <paramref name="until"/>, by start; not tracked.</summary>
    Task<IReadOnlyList<Appointment>> ListUpcomingAsync(Guid babyId, DateTimeOffset after, DateTimeOffset until, CancellationToken cancellationToken = default);

    /// <summary>Saves a new appointment; <c>false</c> (nothing tracked) when a concurrent request created the same id first.</summary>
    Task<bool> TryAddAsync(Appointment appointment, CancellationToken cancellationToken = default);

    /// <summary>Saves the tracked changes.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
