using Lotties.Domain.Appointments;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Race safety of <see cref="TryAddAsync"/> relies on the primary key: a concurrent insert of the same id fails with a
/// unique violation, the rejected entity is detached and <c>false</c> is returned. Any other database error is logged and rethrown.
/// </remarks>
internal sealed class EfAppointmentRepository(LottiesDbContext context, UniqueViolations uniqueViolations, ILogger<EfAppointmentRepository> logger) : IAppointmentRepository
{
    public Task<Appointment?> FindAsync(Guid appointmentId, CancellationToken cancellationToken = default) =>
        context.Appointments.SingleOrDefaultAsync(appointment => appointment.Id == appointmentId, cancellationToken);

    public async Task<IReadOnlyList<Appointment>> ListAsync(Guid babyId, AppointmentQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var matching = Filtered(context.Appointments.AsNoTracking().Where(appointment => appointment.BabyId == babyId), query);
        var ordered = query.Since is null
            ? matching.OrderBy(appointment => appointment.StartsAt).ThenBy(appointment => appointment.Id)
            : matching.OrderBy(appointment => appointment.UpdatedAt).ThenBy(appointment => appointment.Id);
        return await ordered.ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Appointment>> ListUpcomingAsync(Guid babyId, DateTimeOffset after, DateTimeOffset until, CancellationToken cancellationToken = default)
    {
        var from = after.ToUniversalTime();
        var to = until.ToUniversalTime();
        return await context.Appointments
            .AsNoTracking()
            .Where(appointment => appointment.BabyId == babyId && appointment.Status == AppointmentStatus.Upcoming && appointment.StartsAt > from && appointment.StartsAt <= to)
            .OrderBy(appointment => appointment.StartsAt)
            .ThenBy(appointment => appointment.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<bool> TryAddAsync(Appointment appointment, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(appointment);
        try
        {
            context.Appointments.Add(appointment);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (uniqueViolations.IsUniqueViolation(exception))
        {
            context.Entry(appointment).State = EntityState.Detached;
            return false;
        }
        catch (DbUpdateException exception)
        {
            context.Entry(appointment).State = EntityState.Detached;
            logger.LogError(exception, "Saving new appointment {AppointmentId} failed with a database error that is not a unique violation", appointment.Id);
            throw;
        }
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    private static IQueryable<Appointment> Filtered(IQueryable<Appointment> appointments, AppointmentQuery query)
    {
        var since = query.Since?.ToUniversalTime();
        var from = query.From?.ToUniversalTime();
        var to = query.To?.ToUniversalTime();
        return appointments
            .Where(appointment => since == null || appointment.UpdatedAt >= since)
            .Where(appointment => from == null || appointment.StartsAt >= from)
            .Where(appointment => to == null || appointment.StartsAt < to);
    }
}
