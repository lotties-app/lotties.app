namespace Lotties.Domain.Exceptions;

/// <summary>An appointment was marked done while its start is still in the future.</summary>
public sealed class AppointmentNotStartedException : DomainException
{
    public AppointmentNotStartedException(Guid appointmentId, DateTimeOffset startsAt)
        : base("appointment_not_started", $"Appointment {appointmentId} starts at {startsAt:O}; it can be marked done only once it has started.")
    {
        AppointmentId = appointmentId;
        StartsAt = startsAt;
    }

    public Guid AppointmentId { get; }

    public DateTimeOffset StartsAt { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["field"] = "status" };
}
